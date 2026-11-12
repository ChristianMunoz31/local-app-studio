// server/log.js file output: location, rotation, buffering before configureLog, no file under Vitest by default.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOG_FILE_KEEP, LOG_FILE_MAX_BYTES, configureLog, flushLog, log, logFiles, resetLogForTests } from '../log.js';

let dir;
beforeEach(() => {
  resetLogForTests();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'las-logfile-'));
  vi.stubEnv('APP_LOG_TEST', '1');
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetLogForTests();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('log file', () => {
  it('writes JSON lines to <dataDir>/logs/server.jsonl', async () => {
    configureLog({ dataDir: dir, role: 'runtime', env: {} });
    log('info', 'one', { a: 1 });
    log('warn', 'two');
    await flushLog();
    const lines = fs.readFileSync(path.join(dir, 'logs', 'server.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => l.event)).toEqual(['one', 'two']);
    expect(lines[0]).toMatchObject({ a: 1, role: 'runtime' });
  });

  it('writes records logged before configureLog once the file opens', async () => {
    log('info', 'early');
    configureLog({ dataDir: dir, env: {} });
    log('info', 'late');
    await flushLog();
    const text = fs.readFileSync(path.join(dir, 'logs', 'server.jsonl'), 'utf8');
    expect(text.indexOf('early')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('early')).toBeLessThan(text.indexOf('late'));
  });

  it('rotates before the file passes 2 MiB and keeps three rotated files', async () => {
    configureLog({ dataDir: dir, env: {} });
    const chunk = 'x'.repeat(290);
    const perFile = Math.ceil(LOG_FILE_MAX_BYTES / 400);
    for (let round = 0; round < 6; round += 1) {
      for (let i = 0; i < perFile; i += 1) log('info', 'fill', { chunk });
      await flushLog();
    }
    const files = logFiles();
    expect(files.map((f) => f.name)).toEqual(['server.jsonl', 'server.1.jsonl', 'server.2.jsonl', 'server.3.jsonl']);
    expect(LOG_FILE_KEEP).toBe(3);
    for (const f of files) expect(f.bytes).toBeLessThanOrEqual(LOG_FILE_MAX_BYTES);
    expect(files.reduce((n, f) => n + f.bytes, 0)).toBeLessThanOrEqual(4 * LOG_FILE_MAX_BYTES);
    expect(fs.existsSync(path.join(dir, 'logs', 'server.4.jsonl'))).toBe(false);
  }, 30_000);

  it('writes no file under Vitest unless APP_LOG_TEST=1', async () => {
    vi.stubEnv('APP_LOG_TEST', '');
    configureLog({ dataDir: dir, env: {} });
    log('info', 'quiet');
    await flushLog();
    expect(fs.existsSync(path.join(dir, 'logs'))).toBe(false);
    expect(logFiles()).toEqual([]);
  });
});
