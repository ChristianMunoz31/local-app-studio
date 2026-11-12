// POST /api/studio/preview/reset: validation, containment, only RESETTABLE entries removed, and a running child is
// stopped, the data deleted and the child started again on an empty folder. Uses the fake preview child.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { importApp } from '../../studio/apps.js';
import { createPreviewManager } from '../../studio/preview/manager.js';
import { RESETTABLE } from '../../studio/preview/scratch.js';
import { registerPreviewRoutes } from '../../studio/previewRoutes.js';
import { starterSpec } from '../../studio/specCheck.js';
import { closeTestDb, createTestDb } from '../helpers/testDb.js';

const FAKE = fileURLToPath(new URL('./fixtures/fakePreviewChild.mjs', import.meta.url));
const { spawn: realSpawn } = await import('node:child_process');
let root;
let db;
const managers = [];
const pids = new Set();

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'las-reset-'));
  db = createTestDb();
});
afterEach(async () => {
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
afterAll(() => {
  closeTestDb(db);
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

function make() {
  const spawned = [];
  const spawn = vi.fn((...args) => {
    const child = realSpawn(...args);
    spawned.push(child);
    pids.add(child.pid);
    return child;
  });
  const manager = createPreviewManager({
    rootDir: root,
    spawn,
    spawnSpec: () => ({ command: process.execPath, args: [FAKE, ''] }),
    startTimeoutMs: 8000,
    stopTimeoutMs: 1000,
  });
  managers.push(manager);
  const server = express();
  server.use(express.json());
  registerPreviewRoutes(server, { manager });
  return { manager, spawned, server };
}

const newApp = () => {
  const spec = starterSpec('Crew Roster', 'crew-roster');
  spec.tables = [{ id: 'crews', label: 'Crews', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] }];
  return importApp(spec);
};
const post = (server, body) => request(server).post('/api/studio/preview/reset').send(body);
const scratch = (id) => path.join(root, id);

describe('POST /api/studio/preview/reset', () => {
  it('refuses a bad app id, a missing or wrong confirm, and leaves every file alone', async () => {
    const { server } = make();
    const record = newApp();
    fs.mkdirSync(path.join(scratch(record.id), 'data'), { recursive: true });
    fs.writeFileSync(path.join(scratch(record.id), 'data', 'app.db'), 'rows');
    const outside = path.join(root, 'outside.txt');
    fs.writeFileSync(outside, 'keep');
    for (const body of [
      {},
      { appId: record.id },
      { appId: record.id, confirm: 'yes' },
      { appId: record.id, confirm: true },
      { confirm: 'reset' },
      { appId: 'not-a-uuid', confirm: 'reset' },
      { appId: '../outside', confirm: 'reset' },
      { appId: `${record.id}/../..`, confirm: 'reset' },
      { appId: 5, confirm: 'reset' },
    ]) {
      const res = await post(server, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(fs.readFileSync(path.join(scratch(record.id), 'data', 'app.db'), 'utf8')).toBe('rows');
    expect(fs.readFileSync(outside, 'utf8')).toBe('keep');
  });

  it('answers 404 for an unknown app', async () => {
    const { server } = make();
    expect((await post(server, { appId: crypto.randomUUID(), confirm: 'reset' })).status).toBe(404);
  });

  it('removes only the RESETTABLE entries when nothing runs', async () => {
    const { server } = make();
    const record = newApp();
    const dir = scratch(record.id);
    fs.mkdirSync(dir, { recursive: true });
    for (const name of RESETTABLE) {
      if (name === 'data' || name === 'app-migrations') fs.mkdirSync(path.join(dir, name), { recursive: true });
      else fs.writeFileSync(path.join(dir, name), '{}');
    }
    fs.writeFileSync(path.join(dir, 'sentinel.txt'), 'x');
    const res = await post(server, { appId: record.id, confirm: 'reset' });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    for (const name of RESETTABLE) expect(fs.existsSync(path.join(dir, name))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'sentinel.txt'))).toBe(true);
  });

  it('stops a running child, deletes the data and starts the child again on an empty folder', async () => {
    const { manager, spawned, server } = make();
    const record = newApp();
    await manager.start({ id: record.id, spec: record.spec, revision: record.revision });
    const marker = path.join(scratch(record.id), 'data', 'app.db');
    fs.writeFileSync(marker, 'rows');
    const firstPid = spawned[0].pid;
    const res = await post(server, { appId: record.id, confirm: 'reset' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ state: 'running', appId: record.id, data: { kept: false, reason: 'reset' } });
    expect(fs.existsSync(marker)).toBe(false);
    expect(spawned).toHaveLength(2);
    expect(alive(firstPid)).toBe(false);
    expect(manager.status().data).toEqual({ kept: false, reason: 'reset' });
    expect(fs.existsSync(path.join(scratch(record.id), 'app-migrations', '001_app.sql'))).toBe(true);
  });

  it('rejects a non-UUID id at the manager with preview_reset_failed and deletes nothing', async () => {
    const { manager } = make();
    const outside = path.join(root, 'victim.txt');
    fs.writeFileSync(outside, 'keep');
    await expect(manager.resetData({ id: '../..', spec: null, revision: 1 })).rejects.toMatchObject({ code: 'preview_reset_failed' });
    expect(fs.readFileSync(outside, 'utf8')).toBe('keep');
  });
});
