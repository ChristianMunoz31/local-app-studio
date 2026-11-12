// server/processGuards.js: the classification table, and the real guards in a child process.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { EXIT_UNSAFE, classifyUncaught } from '../processGuards.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/guardChild.js', import.meta.url));
const base = { inTransaction: false, heapRatio: 0.2, lastUncaughtAt: null, now: 1_000_000, startupDone: true, role: 'studio' };

describe('classifyUncaught', () => {
  it('continues for an ordinary error', () => {
    expect(classifyUncaught(new Error('x'), base)).toEqual({ exit: false, reason: null });
  });
  it('exits when a transaction is open', () => {
    expect(classifyUncaught(new Error('x'), { ...base, inTransaction: true })).toEqual({ exit: true, reason: 'transaction_open' });
  });
  it.each([['SQLITE_CORRUPT'], ['SQLITE_NOTADB'], ['SQLITE_IOERR_READ'], ['SQLITE_CANTOPEN']])('exits for %s, also as a cause', (code) => {
    const direct = Object.assign(new Error('db'), { code });
    expect(classifyUncaught(direct, base).reason).toBe('database_damaged');
    expect(classifyUncaught(new Error('wrap', { cause: direct }), base).reason).toBe('database_damaged');
  });
  it('exits for the node:sqlite numeric result codes', () => {
    expect(classifyUncaught(Object.assign(new Error('db'), { errcode: 11 }), base).reason).toBe('database_damaged');
    expect(classifyUncaught(Object.assign(new Error('db'), { errcode: 266 }), base).reason).toBe('database_damaged');
    expect(classifyUncaught(Object.assign(new Error('db'), { errcode: 19 }), base).exit).toBe(false);
  });
  it('exits for a stack overflow', () => {
    expect(classifyUncaught(new RangeError('Maximum call stack size exceeded'), base).reason).toBe('stack_overflow');
    expect(classifyUncaught(new RangeError('Invalid array length'), base).exit).toBe(false);
  });
  it('exits for out of memory by code or by heap use', () => {
    expect(classifyUncaught(Object.assign(new Error('m'), { code: 'ERR_OUT_OF_MEMORY' }), base).reason).toBe('out_of_memory');
    expect(classifyUncaught(new Error('x'), { ...base, heapRatio: 0.91 }).reason).toBe('out_of_memory');
    expect(classifyUncaught(new Error('x'), { ...base, heapRatio: 0.9 }).exit).toBe(false);
  });
  it('exits for a second error within 60 seconds only', () => {
    expect(classifyUncaught(new Error('x'), { ...base, lastUncaughtAt: base.now - 59_000 }).reason).toBe('repeat');
    expect(classifyUncaught(new Error('x'), { ...base, lastUncaughtAt: base.now - 61_000 }).exit).toBe(false);
  });
  it('a second ERR_HTTP_HEADERS_SENT within 60 seconds is the follow-up of an answered request, not a repeat', () => {
    const late = Object.assign(new Error('Cannot set headers after they are sent'), { code: 'ERR_HTTP_HEADERS_SENT' });
    expect(classifyUncaught(late, { ...base, lastUncaughtAt: base.now - 1000 }).exit).toBe(false);
    expect(classifyUncaught(late, { ...base, inTransaction: true }).reason).toBe('transaction_open');
  });
  it('keeps the old startup and parser paths', () => {
    expect(classifyUncaught(new Error('x'), { ...base, startupDone: false }).reason).toBe('startup');
    expect(classifyUncaught(new Error('x'), { ...base, role: 'parser' }).reason).toBe('parser');
  });
  it('uses exit code 5 for unsafe state', () => {
    expect(EXIT_UNSAFE).toBe(5);
  });
});

const children = [];
afterEach(() => {
  for (const c of children.splice(0)) c.kill();
});

function start(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'las-guard-'));
  const child = spawn(process.execPath, [FIXTURE], {
    env: { ...process.env, APP_LOG_TEST: '1', GUARD_DATA_DIR: dir, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  const ready = new Promise((resolve, reject) => {
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      const m = /READY (\d+)/.exec(buf);
      if (m) resolve(Number(m[1]));
    });
    child.on('exit', () => reject(new Error('child exited before ready')));
  });
  return { child, dir, exited, ready };
}

function get(port, url) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: url, agent: false, headers: { Connection: 'close' } }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', (e) => resolve({ status: 0, body: String(e.code) }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exitedWithin = (p, ms) => Promise.race([p, sleep(ms).then(() => 'alive')]);

describe('guards in a child process', () => {
  it('(a) a throwing timer keeps the server alive, answers the request in context and is logged', async () => {
    const c = start();
    const port = await c.ready;
    const res = await get(port, '/throw');
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body).code).toBe('server_error');
    expect((await get(port, '/ping')).body).toBe('pong');
    const records = JSON.parse((await get(port, '/log')).body);
    const hit = records.find((r) => r.event === 'process.uncaught');
    expect(hit).toMatchObject({ level: 'error', code: 'server_error', name: 'Error', exit: false });
    expect(await exitedWithin(c.exited, 200)).toBe('alive');
  }, 20_000);

  it('(b) an open transaction exits 5 and the in-flight request got the server_error envelope', async () => {
    const c = start({ GUARD_TX: '1' });
    const port = await c.ready;
    const hang = get(port, '/hang');
    await sleep(50);
    void get(port, '/throw');
    const res = await hang;
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body).code).toBe('server_error');
    expect(await c.exited).toBe(5);
    const file = fs.readFileSync(path.join(c.dir, 'logs', 'server.jsonl'), 'utf8');
    expect(file).toContain('"event":"process.exit_unsafe"');
    expect(file).toContain('"reason":"transaction_open"');
  }, 20_000);

  it('(c) two uncaught errors within 60 seconds exit 5', async () => {
    const c = start();
    const port = await c.ready;
    await get(port, '/throw');
    expect(await exitedWithin(c.exited, 150)).toBe('alive');
    void get(port, '/throw');
    expect(await c.exited).toBe(5);
  }, 20_000);

  it('(d) an unhandled rejection keeps the server alive', async () => {
    const c = start();
    const port = await c.ready;
    const res = await get(port, '/reject');
    expect(res.status).toBe(500);
    expect((await get(port, '/ping')).body).toBe('pong');
    const records = JSON.parse((await get(port, '/log')).body);
    expect(records.some((r) => r.event === 'process.unhandled_rejection')).toBe(true);
    expect(await exitedWithin(c.exited, 200)).toBe('alive');
  }, 20_000);
});
