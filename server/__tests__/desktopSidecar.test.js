// End-to-end sidecar protocol: spawn `node server.js` in desktop mode, handshake over stdin, read
// APP_READY, bootstrap, call the API with the cookie, then close stdin and expect a clean exit.
import { describe, it, expect, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/childEnv.js';

vi.mock('../../loadEnv.js', () => ({}));

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SERVER = path.join(ROOT, 'server.js');
const READY_RE = /^APP_READY (\{.*\})$/m;

function launch({ dataDir, distDir, stdinLine }) {
  const child = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: childEnv({
      APP_DESKTOP: '1',
      APP_HOST: '127.0.0.1',
      APP_PORT: '0',
      APP_NO_DOTENV: '1',
      APP_DATA_DIR: dataDir,
      APP_DIST_DIR: distDir,
      APP_SCHEDULER: '0',
    }),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (err += d));
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  if (stdinLine !== undefined) child.stdin.write(stdinLine);
  const ready = async (timeoutMs = 10000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const m = READY_RE.exec(out);
      if (m) return JSON.parse(m[1]);
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('no APP_READY line');
  };
  return { child, exited, ready, stdout: () => out, stderr: () => err };
}

describe('desktop sidecar protocol', () => {
  it('handshakes, serves behind the gate, and exits 0 with a checkpointed WAL when stdin closes', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-app-studio-sidecar-'));
    const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-app-studio-sidecar-dist-'));
    fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><html><body>ok</body></html>');
    const secret = crypto.randomBytes(32);
    const proc = launch({ dataDir, distDir, stdinLine: `${secret.toString('hex')}\n` });
    try {
      const ready = await proc.ready();
      expect(ready.port).toBeGreaterThan(0);
      expect(ready.dataDir).toBe(path.resolve(dataDir));
      expect(ready.version).toMatch(/^\d+\.\d+\.\d+|unknown/);
      expect(proc.stdout()).not.toContain(secret.toString('hex'));

      const base = `http://127.0.0.1:${ready.port}`;
      const token = crypto.createHmac('sha256', secret).update('desktop-bootstrap-v1').digest('hex');
      expect((await fetch(`${base}/api/auth/status`)).status).toBe(401);

      const boot = await fetch(`${base}/desktop/bootstrap?token=${token}`, { redirect: 'manual' });
      expect(boot.status).toBe(302);
      const cookie = boot.headers.get('set-cookie').split(';')[0];
      expect(cookie).toMatch(/^app_desktop=/);

      const api = await fetch(`${base}/api/state`, { headers: { cookie } });
      expect(api.status).toBe(200);
      const page = await fetch(`${base}/`, { headers: { cookie } });
      expect(page.headers.get('content-security-policy')).toContain("default-src 'self'");

      expect(fs.existsSync(path.join(dataDir, 'app.db-wal'))).toBe(true);
      proc.child.stdin.end();
      const result = await Promise.race([
        proc.exited,
        new Promise((_, rej) => setTimeout(() => rej(new Error('did not exit after stdin close')), 8000)),
      ]);
      expect(result.code).toBe(0);
      expect(fs.existsSync(path.join(dataDir, 'app.db-wal'))).toBe(false);
    } finally {
      if (proc.child.exitCode === null) proc.child.kill();
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      fs.rmSync(distDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }, 30000);

  it('stdin closing during a backup still exits 0 with a checkpointed WAL (the worker is drained first)', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-app-studio-sidecar-'));
    const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-app-studio-sidecar-dist-'));
    fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><html><body>ok</body></html>');
    const secret = crypto.randomBytes(32);
    const proc = launch({ dataDir, distDir, stdinLine: `${secret.toString('hex')}\n` });
    try {
      const ready = await proc.ready();
      const base = `http://127.0.0.1:${ready.port}`;
      const token = crypto.createHmac('sha256', secret).update('desktop-bootstrap-v1').digest('hex');
      const boot = await fetch(`${base}/desktop/bootstrap?token=${token}`, { redirect: 'manual' });
      const cookie = boot.headers.get('set-cookie').split(';')[0];

      // Start a backup and close stdin while it runs (or just before it ends: either way the exit is clean).
      const inflight = fetch(`${base}/api/backups`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: '{}',
      }).catch(() => null);
      await new Promise((r) => setTimeout(r, 30));
      proc.child.stdin.end();
      const result = await Promise.race([
        proc.exited,
        new Promise((_, rej) => setTimeout(() => rej(new Error('did not exit after stdin close')), 10000)),
      ]);
      await inflight;
      expect(result.code).toBe(0);
      expect(fs.existsSync(path.join(dataDir, 'app.db-wal'))).toBe(false);
      expect(proc.stderr()).not.toContain('Backup worker unavailable');
    } finally {
      if (proc.child.exitCode === null) proc.child.kill();
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      fs.rmSync(distDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }, 30000);

  it('exits 2 with a generic message on a malformed secret line', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-app-studio-sidecar-'));
    const bad = 'A'.repeat(64);
    const proc = launch({ dataDir, distDir: dataDir, stdinLine: `${bad}\n` });
    try {
      const result = await Promise.race([
        proc.exited,
        new Promise((_, rej) => setTimeout(() => rej(new Error('did not exit')), 10000)),
      ]);
      expect(result.code).toBe(2);
      expect(proc.stdout()).not.toMatch(/APP_READY/);
      expect(proc.stderr()).not.toContain(bad);
    } finally {
      if (proc.child.exitCode === null) proc.child.kill();
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }, 20000);

  it('refuses a non-loopback host before reading stdin', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-app-studio-sidecar-'));
    const child = spawn(process.execPath, [SERVER], {
      cwd: ROOT,
      env: childEnv({
        APP_DESKTOP: '1',
        APP_HOST: '0.0.0.0',
        APP_PORT: '0',
        APP_NO_DOTENV: '1',
        APP_DATA_DIR: dataDir,
      }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    try {
      const code = await new Promise((resolve) => child.once('exit', resolve));
      expect(code).toBe(1);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }, 15000);
});

describe('stdin error between the handshake and the shutdown listeners', () => {
  it('is not an uncaught exception and leads to a graceful exit', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-app-studio-stdin-window-'));
    const saved = { desktop: process.env.APP_DESKTOP, test: process.env.APP_TEST_DATA_DIR, sched: process.env.APP_SCHEDULER };
    const sigint = process.listeners('SIGINT');
    const sigterm = process.listeners('SIGTERM');
    process.env.APP_DESKTOP = '1';
    process.env.APP_SCHEDULER = '0';
    process.env.APP_TEST_DATA_DIR = dataDir;
    const exited = new Promise((resolve) => {
      vi.spyOn(process, 'exit').mockImplementation((code) => {
        resolve(code);
        return undefined;
      });
    });
    try {
      vi.resetModules();
      const { startServer } = await import('../../server.js');
      const stdin = new PassThrough();
      const starting = startServer({ port: 0, host: '127.0.0.1', handleSignals: true, stdin });
      stdin.write(`${crypto.randomBytes(32).toString('hex')}
`);
      // Fires in the window after the secret was read and before the real listeners attach.
      setImmediate(() => stdin.emit('error', new Error('pipe broke')));
      const { stop } = await starting;
      expect(await exited).toBe(0);
      await stop();
    } finally {
      vi.restoreAllMocks();
      for (const [name, list] of [['SIGINT', sigint], ['SIGTERM', sigterm]]) {
        for (const l of process.listeners(name)) if (!list.includes(l)) process.off(name, l);
      }
      for (const [k, v] of [['APP_DESKTOP', saved.desktop], ['APP_TEST_DATA_DIR', saved.test], ['APP_SCHEDULER', saved.sched]]) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }, 20000);
});
