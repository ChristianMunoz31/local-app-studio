// The real parser child, end to end, in dev mode (`node server/entry.js --role parser`): the role switch, the
// default spawn spec, the empty environment, the heap cap flag, the stubbed fetch, and the privacy invariant that a
// parse never touches the data folder. The data folder is only checked where the child could really reach it: a child
// started by the host has an empty environment (it cannot even learn APP_DATA_DIR), so there the folder cannot be
// touched by construction; the test "does not touch APP_DATA_DIR" runs entry.js directly with APP_DATA_DIR set.
//
// How spawning works under Vitest: the network guard and the temp data dir (setup/*.js) patch the Vitest process
// only. A child is a fresh `node` with the environment the host gives it ({}), so VITEST, APP_TEST_DATA_DIR and
// the guard are all absent there. The child is also not covered by the guard; it makes no network call by design.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIMITS } from '../ingest/limits.js';
import { parseDocument } from '../ingest/index.js';
import { createParserHost, defaultSpawnSpec } from '../ingest/parserHost.js';
import { childEnv } from './helpers/childEnv.js';
import { SAMPLE_PAGES, makeDocx, makePdf } from './helpers/ingestDocs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENTRY = path.join(ROOT, 'server', 'entry.js');
const SERVER = path.join(ROOT, 'server.js');

let dataDir;
beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-child-data-'));
});
afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const entries = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : null);

/** Runs entry.js with a job on stdin and an explicit environment. */
function runEntry(args, input, env = {}) {
  return spawnSync(process.execPath, [ENTRY, ...args], { input, env, timeout: 60_000, windowsHide: true });
}

describe('parse through the real child (default spawn spec, empty environment)', () => {
  it('parses a PDF with positions, a DOCX and a text file', async () => {
    const pdf = await parseDocument(makePdf(SAMPLE_PAGES));
    expect(pdf.ok).toBe(true);
    expect(pdf.pages[0].runs.map((r) => r.text)).toEqual(['Panel Report', 'Glucose', '92', 'mg/dL']);
    expect(Math.abs(pdf.pages[0].runs[2].x - 220)).toBeLessThan(0.5);
    const docx = await parseDocument(makeDocx(['Alpha', 'Beta']), { kind: 'docx' });
    expect(docx).toMatchObject({ ok: true, kind: 'docx', pages: [{ page: null, text: 'Alpha\nBeta' }] });
    const text = await parseDocument(Buffer.from('plain note\n'), { kind: 'text' });
    expect(text).toMatchObject({ ok: true, kind: 'text', meta: { paginated: false } });
  }, 60_000);

  it('maps document problems to fixed codes through the child', async () => {
    expect(await parseDocument(makePdf(SAMPLE_PAGES, { encrypted: true }))).toMatchObject({ ok: false, code: 'encrypted' });
    expect(await parseDocument(makePdf([{ runs: [] }]))).toMatchObject({ ok: false, code: 'empty' });
    expect(await parseDocument(Buffer.from('%PDF-1.4\nnot really'))).toMatchObject({ ok: false, code: 'parse_failed' });
    expect(await parseDocument(Buffer.from([1, 2, 0, 3]))).toMatchObject({ ok: false, code: 'unsupported' });
    expect(await parseDocument(makeDocx(['x']), { kind: 'pdf' })).toMatchObject({ ok: false, code: 'unsupported' });
  }, 60_000);

  it('two parses at once both finish (the second waits for the single slot)', async () => {
    const host = createParserHost();
    const [a, b] = await Promise.all([host.run(makePdf(SAMPLE_PAGES), 'pdf'), host.run(Buffer.from('x\n'), 'text')]);
    expect([a.ok, b.ok]).toEqual([true, true]);
  }, 60_000);
});

describe('the child environment', () => {
  it('carries nothing from the parent: a fake child sees only OS constants, everything else empty', async () => {
    process.env.INGEST_TEST_SECRET = 'must-not-reach-the-child';
    const out = path.join(dataDir, '..', `ingest-env-${process.pid}.json`);
    try {
      const host = createParserHost({
        spawnSpec: () => ({
          command: process.execPath,
          args: ['-e', `require('fs').writeFileSync(process.argv[1], JSON.stringify(process.env));process.exit(0)`, out],
        }),
      });
      await host.run(Buffer.from('x'), 'text'); // the fake child writes no result, so this is doc_crashed; only the env matters
      const seen = JSON.parse(fs.readFileSync(out, 'utf8'));
      // On Windows libuv adds a fixed baseline of variables (copying the parent's values) to a child that lacks them:
      // minimalChildEnv() blanks the path and user ones; the machine constants stay.
      const constants = /^(SYSTEMROOT|WINDIR|SYSTEMDRIVE|PROCESSOR_ARCHITECTURE)$/i;
      expect(Object.entries(seen).filter(([k, v]) => !constants.test(k) && v !== '')).toEqual([]);
      if (process.platform !== 'win32') expect(seen).toEqual({});
      expect(JSON.stringify(seen)).not.toContain('must-not-reach-the-child');
      expect(JSON.stringify(seen)).not.toContain(os.userInfo().username);
    } finally {
      delete process.env.INGEST_TEST_SECRET;
      fs.rmSync(out, { force: true });
    }
  });
});

describe('heap cap', () => {
  const limitMb = (args) => {
    const probe = spawnSync(process.execPath, [args[0], '-e', "console.log(require('v8').getHeapStatistics().heap_size_limit)"], { env: {}, encoding: 'utf8' });
    return Number(probe.stdout.trim()) / (1024 * 1024);
  };
  it('the dev spawn spec carries --max-old-space-size and V8 honours it', () => {
    const spec = defaultSpawnSpec({ heapMb: LIMITS.heapMb });
    expect(spec.command).toBe(process.execPath);
    expect(spec.args[0]).toBe(`--max-old-space-size=${LIMITS.heapMb}`);
    expect(spec.args.slice(-2)).toEqual(['--role', 'parser']);
    expect(path.resolve(spec.args[1])).toBe(ENTRY);
    expect(spec.env).toBeUndefined();
    const effective = limitMb(spec.args);
    // heap_size_limit is the old-space cap plus the young generation V8 adds on top, so it lands above the flag.
    expect(effective).toBeGreaterThanOrEqual(LIMITS.heapMb);
    expect(effective).toBeLessThan(LIMITS.heapMb * 2);
    const small = limitMb(defaultSpawnSpec({ heapMb: 128 }).args);
    expect(small).toBeLessThan(effective);
  });
});

describe('role switch', () => {
  const job = (bytes, kind) => Buffer.concat([Buffer.from(`${JSON.stringify({ v: 1, kind, bytes: bytes.length })}\n`), bytes]);

  it('does not touch APP_DATA_DIR: dev mode child with the data dir in its OWN env, no APP_NO_DOTENV, cwd with a sentinel .env', () => {
    // Everything that could lead a child to the data folder is present: APP_DATA_DIR in its environment, dotenv loading
    // allowed (APP_NO_DOTENV unset), and a working directory holding a .env that repoints the data folder. A parse that
    // needed none of it must succeed and leave both folders empty.
    const cwdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-child-cwd-'));
    const decoyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-child-decoy-'));
    try {
      fs.writeFileSync(path.join(cwdDir, '.env'), `APP_DATA_DIR=${decoyDir}\nAPP_DESKTOP=1\n`);
      const env = childEnv({ APP_DATA_DIR: dataDir });
      expect(env.APP_NO_DOTENV).toBeUndefined();
      const run = spawnSync(process.execPath, [ENTRY, '--role', 'parser'], {
        input: job(Buffer.from('sentinel note\n'), 'text'),
        env,
        cwd: cwdDir,
        timeout: 60_000,
        windowsHide: true,
      });
      expect(run.status).toBe(0);
      expect(JSON.parse(run.stdout.toString())).toMatchObject({ ok: true, kind: 'text', pages: [{ text: 'sentinel note\n' }] });
      expect(entries(dataDir)).toEqual([]);
      expect(entries(decoyDir)).toEqual([]);
      expect(fs.readdirSync(cwdDir)).toEqual(['.env']);
    } finally {
      fs.rmSync(cwdDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      fs.rmSync(decoyDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it('stray console and stdout writes from a library cannot corrupt the one-line result (stdout is sealed)', () => {
    const script = `
      const { runParserChild } = await import(${JSON.stringify(new URL('../ingest/parserChild.js', import.meta.url).href)});
      runParserChild();
      console.log('STRAY-LOG');
      console.info('STRAY-INFO');
      console.debug('STRAY-DEBUG');
      process.stdout.write('STRAY-WRITE' + String.fromCharCode(10));
    `;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      input: job(Buffer.from('clean line\n'), 'text'),
      env: childEnv({}),
      timeout: 60_000,
      windowsHide: true,
    });
    expect(run.status).toBe(0);
    const lines = run.stdout.toString().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ ok: true, kind: 'text' });
    expect(run.stdout.toString()).not.toContain('STRAY');
    expect(run.stderr.toString()).toContain('STRAY-LOG');
    expect(run.stderr.toString()).toContain('STRAY-WRITE');
  });

  it('entry.js --role parser reads one job on stdin, writes one result line and exits 0', () => {
    const run = runEntry(['--role', 'parser'], job(Buffer.from('hello there\n'), 'text'));
    expect(run.status).toBe(0);
    const lines = run.stdout.toString().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ ok: true, kind: 'text', pages: [{ page: null, text: 'hello there\n' }] });
    expect(run.stderr.toString()).toBe('');
  });

  it('entry.js --role=parser works and a malformed frame is a parse_failed answer, not a crash', () => {
    const run = runEntry(['--role=parser'], Buffer.from('garbage with no header line'));
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout.toString())).toEqual({ ok: false, code: 'parse_failed' });
  });

  it.each([
    ['an unknown role', ['--role', 'bogus']],
    ['a missing role value', ['--role']],
    ['a repeated role', ['--role', 'parser', '--role', 'parser']],
  ])('entry.js refuses %s with exit 2 and starts nothing', (_name, args) => {
    const run = runEntry(args, '', { APP_DATA_DIR: dataDir, APP_NO_DOTENV: '1' });
    expect(run.status).toBe(2);
    expect(run.stdout.toString()).toBe('');
    expect(entries(dataDir)).toEqual([]);
  });

  it('server.js refuses --role before startServer runs: exit 2, short message, nothing created', () => {
    const run = spawnSync(process.execPath, [SERVER, '--role', 'parser'], {
      env: childEnv({ APP_DATA_DIR: dataDir, APP_NO_DOTENV: '1', APP_PORT: '0', APP_SCHEDULER: '0' }),
      timeout: 60_000,
    });
    expect(run.status).toBe(2);
    expect(run.stderr.toString()).toContain('server/entry.js');
    expect(run.stdout.toString()).toBe('');
    expect(entries(dataDir)).toEqual([]);
  });
});

describe('the child is sealed', () => {
  it('replaces fetch with a rejecting stub before it reads the job', async () => {
    const script = `
      const { runParserChild } = await import(${JSON.stringify(new URL('../ingest/parserChild.js', import.meta.url).href)});
      runParserChild();
      const r = await fetch('http://127.0.0.1:9/').then(() => 'LEAK', (e) => 'blocked:' + e.message);
      process.stderr.write(r);
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { env: {}, stdio: ['pipe', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.stdin.end();
    await new Promise((resolve) => child.once('close', resolve));
    expect(err).toBe('blocked:network disabled');
  });
});
