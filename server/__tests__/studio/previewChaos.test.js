// B3 preview chaos: the manager and the scratch folder under killed, hung, locked and raced children. The fake children
// are real node processes (fixtures/previewChild/chaosChild.mjs applies the real app-track migrations; the older
// fakePreviewChild.mjs only listens). No network beyond loopback, ports from 0.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn as realSpawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPreviewManager } from '../../studio/preview/manager.js';
import { prepareScratch } from '../../studio/preview/scratch.js';
import { starterSpec } from '../../studio/specCheck.js';
import { closeTestDb, createTestDb } from '../helpers/testDb.js';

vi.mock('../../../loadEnv.js', () => ({}));

const CHAOS = fileURLToPath(new URL('../fixtures/previewChild/chaosChild.mjs', import.meta.url));
const FAKE = fileURLToPath(new URL('./fixtures/fakePreviewChild.mjs', import.meta.url));
const GENERIC = 'The preview could not start. Try again.';
let root;
const managers = [];
const pids = new Set();

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'las-chaos-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(managers.splice(0).map((m) => m.stop()));
  for (const pid of pids) {
    try {
      process.kill(pid);
    } catch {
      // already gone
    }
  }
  pids.clear();
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const until = async (cond, ms = 8000) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
  return cond();
};

/** A manager whose children are recorded (pid, exited flag, the port they printed); the script and mode are switchable. */
function make({ script = CHAOS, mode = 'ok', ...opts } = {}) {
  const ctl = { script, mode };
  const spawned = [];
  const manager = createPreviewManager({
    rootDir: root,
    spawn: (...args) => {
      const child = realSpawn(...args);
      const rec = { child, pid: child.pid, exited: false, port: null, aliveAtSpawn: spawned.filter((c) => !c.exited).length };
      child.once('exit', () => {
        rec.exited = true;
      });
      child.stdout.on('data', (chunk) => {
        const m = /APP_READY (\{.*\})/.exec(String(chunk));
        if (m) rec.port = JSON.parse(m[1]).port;
      });
      spawned.push(rec);
      pids.add(child.pid);
      return child;
    },
    spawnSpec: () => ({ command: process.execPath, args: [ctl.script, ctl.mode] }),
    startTimeoutMs: 15000,
    stopTimeoutMs: 1000,
    ...opts,
  });
  managers.push(manager);
  return { manager, ctl, spawned };
}

const crewTable = { id: 'crews', label: 'Crews', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] };
const app = (name = 'Crew Roster', revision = 1) => {
  const spec = starterSpec(name, 'crew-roster');
  spec.tables = [structuredClone(crewTable)];
  return { id: crypto.randomUUID(), spec, revision };
};
const withSize = (a, revision = 2) => {
  const spec = structuredClone(a.spec);
  spec.tables[0].fields.push({ id: 'size', label: 'Size', type: 'integer', required: false });
  return { ...a, spec, revision };
};
const dirOf = (a) => path.join(root, a.id);
const dbOf = (a) => path.join(dirOf(a), 'data', 'app.db');
const pendingOf = (a) => path.join(dirOf(a), 'pending-spec.json');
const seedRows = (a) => {
  const db = new DatabaseSync(dbOf(a));
  for (const name of ['North', 'South']) {
    db.prepare('INSERT INTO "crews" ("id","name","created_at","updated_at") VALUES (?,?,?,?)').run(crypto.randomUUID(), name, 't', 't');
  }
  db.close();
};
const rowCount = (a) => {
  const db = new DatabaseSync(dbOf(a), { readOnly: true });
  try {
    return db.prepare('SELECT COUNT(*) AS n FROM "crews"').get().n;
  } finally {
    db.close();
  }
};

/** A running app with two rows, then a changed start whose child applied the pending migration and died before ready. */
async function appliedThenKilled() {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const made = make();
  const a = app();
  expect((await made.manager.start(a)).state).toBe('running');
  seedRows(a);
  const changed = withSize(a);
  made.ctl.mode = 'apply-die';
  const failed = await made.manager.start(changed);
  return { ...made, a, changed, failed };
}

describe('A3.1 and A3.2 a child applies the pending migration and dies before ready', () => {
  it('fails plainly, then commits the migration through the matching envelope and keeps the data', async () => {
    const { manager, ctl, a, changed, failed } = await appliedThenKilled();
    expect(failed).toMatchObject({ state: 'failed', message: GENERIC });
    expect(fs.existsSync(pendingOf(a))).toBe(true);
    ctl.mode = 'ok';
    const again = await manager.start(changed);
    expect(again).toMatchObject({ state: 'running', data: { kept: true, reason: 'unchanged' } });
    expect(rowCount(a)).toBe(2);
  });

  it('says the data was cleared and runs when the pending spec is garbage', async () => {
    const { manager, ctl, a, changed } = await appliedThenKilled();
    fs.writeFileSync(pendingOf(a), '{');
    ctl.mode = 'ok';
    const again = await manager.start(changed);
    expect(again).toMatchObject({ state: 'running', data: { kept: false, reason: 'tables_replaced' } });
    expect(rowCount(a)).toBe(0);
  });
});

describe('A3.3 and A3.12 start and stop races (fake child that only listens)', () => {
  it('A3.3 start A, start B without awaiting, start A again: one child, A running, the last child serves', async () => {
    const { manager, spawned } = make({ script: FAKE, mode: '' });
    const a = app('App A');
    const b = app('App B');
    await Promise.all([manager.start(a), manager.start(b), manager.start(a)]);
    expect(manager.status()).toMatchObject({ state: 'running', appId: a.id, revision: 1 });
    expect(spawned).toHaveLength(1);
    expect(spawned.filter((c) => !c.exited)).toHaveLength(1);
    expect(manager.target().port).toBe(spawned.at(-1).port);
  });

  it.each([1, 2, 3])('A3.12 stop racing start 20 times (seed %i): never two live children, the final status is the last call', async (seed) => {
    const { manager, spawned } = make({ script: FAKE, mode: '' });
    const a = app();
    let x = seed * 2654435761;
    const rand = () => {
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
      return x / 2 ** 32;
    };
    let revision = 0;
    let last = null;
    const calls = [];
    for (let i = 0; i < 20; i += 1) {
      if (rand() < 0.4) {
        last = { stop: true };
        calls.push(manager.stop());
      } else {
        revision += 1;
        last = { stop: false, revision };
        calls.push(manager.start({ ...a, revision }));
      }
    }
    await Promise.all(calls);
    expect(
      spawned.every((c) => c.aliveAtSpawn === 0),
      `seed ${seed}`,
    ).toBe(true);
    if (last.stop) {
      expect(manager.status().state, `seed ${seed}`).toBe('stopped');
      expect(await until(() => spawned.every((c) => c.exited))).toBe(true);
    } else {
      expect(manager.status(), `seed ${seed}`).toMatchObject({ state: 'running', revision: last.revision });
      expect(spawned.filter((c) => !c.exited)).toHaveLength(1);
    }
  });
});

describe('A3.5 and A3.6 a database the child cannot use', () => {
  it('A3.5 read-only app.db: the start fails with the plain message, and works once the mode is restored', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { manager } = make();
    const a = app();
    expect((await manager.start(a)).state).toBe('running');
    await manager.stop();
    fs.chmodSync(dbOf(a), 0o444);
    try {
      expect(await manager.start(a)).toMatchObject({ state: 'failed', message: GENERIC });
    } finally {
      fs.chmodSync(dbOf(a), 0o666);
    }
    expect(await manager.start(a)).toMatchObject({ state: 'running', data: { kept: true } });
  });

  it('A3.6 app.db held by another process: the status says the database is in use, and a start after unlocking works', async () => {
    const { manager, ctl, a, changed } = await appliedThenKilled();
    const holder = new DatabaseSync(dbOf(a));
    holder.exec('PRAGMA locking_mode = EXCLUSIVE');
    holder.exec('BEGIN EXCLUSIVE');
    holder.prepare('SELECT COUNT(*) FROM "crews"').get();
    try {
      const status = await manager.start(changed);
      expect(status.state).toBe('failed');
      expect(status.message).toMatch(/database is in use by another process/);
    } finally {
      holder.exec('COMMIT');
      holder.close();
    }
    ctl.mode = 'ok';
    expect(await manager.start(changed)).toMatchObject({ state: 'running', data: { kept: true } });
    expect(rowCount(a)).toBe(2);
  });
});

describe('A3.7 a pending-spec.json that no pending migration explains', () => {
  it('is ignored and removed, and the data is kept', () => {
    const a = app();
    const dir = dirOf(a);
    const out = prepareScratch(dir, a.spec, root);
    const db = new DatabaseSync(path.join(out.dataDir, 'app.db'));
    db.exec(fs.readFileSync(path.join(out.appMigrationsDir, '001_app.sql'), 'utf8'));
    db.close();
    prepareScratch(dir, withSize(a).spec, root, { deferCommit: true });
    for (const text of ['{', '[]', JSON.stringify(a.spec)]) {
      fs.writeFileSync(pendingOf(a), text);
      const again = prepareScratch(dir, a.spec, root);
      expect(again.data).toEqual({ kept: true, reason: 'unchanged' });
      expect(fs.existsSync(pendingOf(a))).toBe(false);
    }
  });
});

describe('A3.8 the scratch folder disappears while the preview runs', () => {
  it('keeps Studio up with a plain status, and a later start recreates the folder', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { manager } = make();
    const a = app();
    await manager.start(a);
    try {
      fs.rmSync(dirOf(a), { recursive: true, force: true });
    } catch {
      // Windows may refuse (EBUSY): either outcome is allowed
    }
    const status = manager.status();
    expect(['running', 'failed']).toContain(status.state);
    if (status.state === 'failed') expect(status.message).toBeTruthy();
    expect(await manager.start({ ...a, revision: 2 })).toMatchObject({ state: 'running' });
    expect(fs.existsSync(path.join(dirOf(a), 'app-spec.json'))).toBe(true);
  });
});

describe('A3.9 the port is taken', () => {
  it('fails plainly, wipes nothing, and a later start works with the data kept', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { manager, ctl } = make();
    const a = app();
    await manager.start(a);
    seedRows(a);
    ctl.mode = 'eaddrinuse';
    expect(await manager.start({ ...a, revision: 2 })).toMatchObject({ state: 'failed', message: GENERIC });
    expect(rowCount(a)).toBe(2);
    ctl.mode = 'ok';
    expect(await manager.start({ ...a, revision: 3 })).toMatchObject({ state: 'running', data: { kept: true, reason: 'unchanged' } });
    expect(rowCount(a)).toBe(2);
  });
});

describe('A3.10 a ready line that is not valid', () => {
  it.each(['ready-str-port', 'ready-big-port', 'ready-garbage'])('%s is ignored: the start times out as failed and the child is gone', async (mode) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { manager, spawned } = make({ mode, startTimeoutMs: 300 });
    expect(await manager.start(app())).toMatchObject({ state: 'failed', message: GENERIC });
    expect(manager.target()).toBeNull();
    expect(await until(() => spawned.every((c) => c.exited && !alive(c.pid)))).toBe(true);
  });
});

describe('A3.11 resetting app B while app A runs', () => {
  it('clears only B and leaves A running with its files untouched', async () => {
    const { manager } = make({ script: FAKE, mode: '' });
    const a = app('App A');
    const b = app('App B');
    await manager.start(a);
    prepareScratch(dirOf(b), b.spec, root);
    fs.writeFileSync(path.join(dirOf(b), 'data', 'rows.marker'), 'x');
    const listing = () =>
      fs
        .readdirSync(dirOf(a), { recursive: true })
        .sort()
        .map((n) => [n, fs.statSync(path.join(dirOf(a), n)).isFile() ? fs.readFileSync(path.join(dirOf(a), n), 'utf8') : null]);
    const before = listing();
    const status = await manager.resetData(b);
    expect(status).toMatchObject({ state: 'running', appId: a.id });
    expect(manager.target()).not.toBeNull();
    expect(listing()).toEqual(before);
    for (const name of ['data', 'app-migrations', 'preview-state.json', 'applied-spec.json']) expect(fs.existsSync(path.join(dirOf(b), name))).toBe(false);
  });
});

describe('A3.4 a write in flight while the data is reset (real preview child)', () => {
  let server;
  let db;
  beforeAll(async () => {
    delete process.env.APP_PASSWORD;
    delete process.env.AUTH_SECRET;
    db = createTestDb();
    server = (await import('../../../server.js')).default;
  });
  afterAll(async () => {
    const { getPreviewManager } = await import('../../studio/preview/manager.js');
    const { previewRoot } = await import('../../studio/preview/paths.js');
    await getPreviewManager().stop();
    fs.rmSync(previewRoot(), { recursive: true, force: true });
    closeTestDb(db);
  });

  it('answers the write plainly, ends with no rows and reason reset, and Studio keeps answering', async () => {
    const { importApp } = await import('../../studio/apps.js');
    const { getPreviewManager } = await import('../../studio/preview/manager.js');
    const record = importApp(app('Crew Roster').spec);
    const hdr = { 'X-Forwarded-For': '192.0.2.10' };
    const started = await request(server).post('/api/studio/preview/start').set(hdr).send({ appId: record.id });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    const write = request(server).post('/api/preview/data/crews').set(hdr).send({ name: 'North' });
    const reset = request(server).post('/api/studio/preview/reset').set(hdr).send({ appId: record.id, confirm: 'reset' });
    const [w, r] = await Promise.all([write, reset]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    if (w.status >= 300) {
      expect([409, 502, 503]).toContain(w.status);
      expect(JSON.stringify(w.body)).not.toMatch(/stack|SQLITE|\sat\s/);
    }
    const rows = await request(server).get('/api/preview/data/crews').set(hdr);
    expect(rows.status, JSON.stringify(rows.body)).toBe(200);
    expect(rows.body.data.total).toBe(0);
    expect(getPreviewManager().status().data).toMatchObject({ reason: 'reset' });
    expect((await request(server).get('/api/studio/preview/status').set(hdr)).status).toBe(200);
  }, 60000);
});
