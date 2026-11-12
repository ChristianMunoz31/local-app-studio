import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPreviewManager } from '../../studio/preview/manager.js';
import { starterSpec } from '../../studio/specCheck.js';

const FAKE = fileURLToPath(new URL('./fixtures/fakePreviewChild.mjs', import.meta.url));
let root;
const managers = [];
const pids = new Set();

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'las-mgr-'));
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
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const until = async (cond, ms = 5000) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
  return cond();
};

/** A manager whose spawns are recorded (pid list) and run the fake child in `mode`. */
function make({ mode = '', secretFile, ...opts } = {}) {
  const spawned = [];
  const spawn = vi.fn((...args) => {
    const child = opts.realSpawn(...args);
    spawned.push(child);
    pids.add(child.pid);
    return child;
  });
  const manager = createPreviewManager({
    rootDir: root,
    spawn,
    spawnSpec: () => ({ command: process.execPath, args: [FAKE, mode, ...(secretFile ? [secretFile] : [])] }),
    startTimeoutMs: 8000,
    stopTimeoutMs: 1000,
    ...opts,
  });
  managers.push(manager);
  return { manager, spawned, spawn };
}
const app = (name = 'Crew Roster', revision = 1) => ({ id: crypto.randomUUID(), spec: starterSpec(name, 'crew-roster'), revision });
const realSpawn = (await import('node:child_process')).spawn;

describe('preview manager', () => {
  it('starts, gives the child a valid secret line and exposes a target', async () => {
    const secretFile = path.join(root, `${crypto.randomUUID()}.txt`);
    const { manager, spawned } = make({ secretFile, realSpawn });
    const a = app();
    const status = await manager.start(a);
    expect(status).toMatchObject({ state: 'running', appId: a.id, revision: 1, message: null });
    const target = manager.target();
    expect(target.port).toBeGreaterThan(0);
    expect(fs.readFileSync(secretFile, 'utf8')).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(manager.status())).not.toContain(target.cookie);
    expect(spawned).toHaveLength(1);
  });

  it('stops the first child when another app starts', async () => {
    const { manager, spawned } = make({ realSpawn });
    await manager.start(app('First App'));
    const first = spawned[0].pid;
    const b = app('Second App');
    await manager.start(b);
    expect(await until(() => !alive(first))).toBe(true);
    expect(manager.status().appId).toBe(b.id);
    expect(spawned).toHaveLength(2);
  });

  it('restarts on specSaved for the running app, and ignores another app', async () => {
    const { manager, spawn } = make({ realSpawn });
    const a = app();
    await manager.start(a);
    manager.specSaved({ ...a, id: crypto.randomUUID(), revision: 2 });
    expect(spawn.mock.calls).toHaveLength(1);
    manager.specSaved({ ...a, revision: 2 });
    expect(manager.status().state === 'starting' || manager.status().state === 'running').toBe(true);
    expect(await until(() => spawn.mock.calls.length === 2 && manager.status().state === 'running' && manager.status().revision === 2)).toBe(true);
  });

  it('stop ends stdin and the child exits', async () => {
    const { manager, spawned } = make({ realSpawn });
    await manager.start(app());
    const pid = spawned[0].pid;
    expect(await manager.stop()).toMatchObject({ state: 'stopped', appId: null });
    expect(await until(() => !alive(pid))).toBe(true);
    expect(manager.target()).toBeNull();
    expect((await manager.stop()).state).toBe('stopped');
  });

  it('fails when the child never says ready, and kills it', async () => {
    const { manager, spawned } = make({ mode: 'no-ready', startTimeoutMs: 500, realSpawn });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const status = await manager.start(app());
    expect(status).toMatchObject({ state: 'failed', message: 'The preview could not start. Try again.' });
    expect(await until(() => !alive(spawned[0].pid))).toBe(true);
    expect(manager.target()).toBeNull();
  });

  it('fails when the child crashes at once, and when it crashes while running', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await make({ mode: 'crash', realSpawn }).manager.start(app())).state).toBe('failed');
    const { manager } = make({ mode: 'crash-later', realSpawn });
    expect((await manager.start(app())).state).toBe('running');
    expect(await until(() => manager.status().state === 'failed')).toBe(true);
    expect(manager.status().message).toBe('The preview stopped unexpectedly. Start it again.');
    expect(manager.target()).toBeNull();
  });

  it('removes the scratch folder when the app is deleted', async () => {
    const { manager } = make({ realSpawn });
    const a = app();
    await manager.start(a);
    const dir = path.join(root, a.id);
    expect(fs.existsSync(dir)).toBe(true);
    await manager.appDeleted(a.id);
    expect(fs.existsSync(dir)).toBe(false);
    expect(manager.status().state).toBe('stopped');
  });

  it('reports starting with the new revision at once while the old child still runs', async () => {
    const { manager } = make({ realSpawn });
    const a = app();
    await manager.start(a);
    const next = manager.start({ ...a, revision: 2 });
    expect(manager.status()).toMatchObject({ state: 'starting', appId: a.id, revision: 2 });
    expect(manager.target()).toBeNull();
    expect(await next).toMatchObject({ state: 'running', revision: 2 });
  });

  it('stop kills the child of a pending start at once and the start gives up', async () => {
    const { manager, spawned } = make({ mode: 'no-ready', realSpawn });
    const pending = manager.start(app());
    expect(await until(() => spawned.length === 1)).toBe(true);
    const t0 = Date.now();
    expect((await manager.stop()).state).toBe('stopped');
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(await until(() => !alive(spawned[0].pid))).toBe(true);
    expect((await pending).state).not.toBe('running');
    expect(manager.status().state).toBe('stopped');
    expect(manager.target()).toBeNull();
  });

  it('stop makes a start that is still queued give up without spawning', async () => {
    const { manager, spawn } = make({ mode: 'no-ready', realSpawn });
    const first = manager.start(app('First App'));
    const queued = manager.start(app('Second App'));
    await manager.stop();
    await Promise.all([first, queued]);
    expect(spawn.mock.calls).toHaveLength(0);
    expect(manager.status().state).toBe('stopped');
  });

  it('a superseded start never spawns, and never overwrites the newer starting status', async () => {
    const { manager, spawn } = make({ realSpawn });
    const a = app();
    const all = [1, 2, 3].map((revision) => manager.start({ ...a, revision }));
    const results = await Promise.all(all);
    expect(spawn.mock.calls).toHaveLength(1);
    expect(results[2]).toMatchObject({ state: 'running', revision: 3 });
    expect(manager.status()).toMatchObject({ state: 'running', revision: 3 });
  });

  it('a start waiting for ready gives up at once when a newer start arrives', async () => {
    const { manager, spawned } = make({ mode: 'no-ready', realSpawn });
    const a = app();
    const first = manager.start(a);
    expect(await until(() => spawned.length === 1)).toBe(true);
    const t0 = Date.now();
    const second = manager.start({ ...a, revision: 2 });
    expect((await first).state).toBe('starting');
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(manager.status()).toMatchObject({ state: 'starting', revision: 2 });
    await manager.stop();
    await second;
  });

  it('spawns once for concurrent starts of the same app and revision', async () => {
    const { manager, spawn } = make({ realSpawn });
    const a = app();
    const [x, y] = await Promise.all([manager.start(a), manager.start(a)]);
    expect(x.state).toBe('running');
    expect(y.state).toBe('running');
    expect(spawn.mock.calls).toHaveLength(1);
  });

  it('clears the data once and says repaired when the child cannot apply a new table migration', async () => {
    let calls = 0;
    const { manager, spawn } = make({
      realSpawn,
      spawnSpec: () => {
        calls += 1;
        // 1: first start; 2: the start after the table change (dies like a failed migration); 3: the fresh retry.
        return { command: process.execPath, args: [FAKE, calls === 2 ? 'migration-failed' : ''] };
      },
    });
    const a = app();
    a.spec.tables = [{ id: 'crews', label: 'Crews', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] }];
    expect((await manager.start(a)).data).toEqual({ kept: false, reason: 'first_start' });
    const changed = structuredClone(a.spec);
    changed.tables[0].fields.push({ id: 'size', label: 'Size', type: 'integer', required: false });
    const status = await manager.start({ ...a, spec: changed, revision: 2 });
    expect(status).toMatchObject({ state: 'running', data: { kept: false, reason: 'repaired' } });
    expect(spawn.mock.calls).toHaveLength(3);
  });

  it('keeps the data when the child exits for another reason after a table migration', async () => {
    let calls = 0;
    const { manager, spawn } = make({
      realSpawn,
      spawnSpec: () => {
        calls += 1;
        return { command: process.execPath, args: [FAKE, calls === 2 ? 'crash' : ''] };
      },
    });
    const a = app();
    a.spec.tables = [{ id: 'crews', label: 'Crews', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] }];
    await manager.start(a);
    const marker = path.join(root, a.id, 'data', 'rows.marker');
    fs.writeFileSync(marker, 'x');
    const changed = structuredClone(a.spec);
    changed.tables[0].fields.push({ id: 'size', label: 'Size', type: 'integer', required: false });
    const status = await manager.start({ ...a, spec: changed, revision: 2 });
    expect(status.state).toBe('failed');
    expect(spawn.mock.calls).toHaveLength(2);
    expect(fs.existsSync(marker)).toBe(true);
  });

  it('fails the start and ends the child when the state commit after ready throws', async () => {
    const { manager, spawned } = make({ realSpawn });
    const a = app();
    a.spec.tables = [{ id: 'crews', label: 'Crews', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] }];
    await manager.start(a);
    const changed = structuredClone(a.spec);
    changed.tables[0].fields.push({ id: 'size', label: 'Size', type: 'integer', required: false });
    const real = fs.writeFileSync;
    const spy = vi.spyOn(fs, 'writeFileSync').mockImplementation((file, ...rest) => {
      if (String(file).endsWith('preview-state.json')) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      return real(file, ...rest);
    });
    try {
      const status = await manager.start({ ...a, spec: changed, revision: 2 });
      expect(status).toMatchObject({ state: 'failed' });
    } finally {
      spy.mockRestore();
    }
    expect(manager.target()).toBeNull();
    expect(spawned).toHaveLength(2);
    expect(await until(() => !alive(spawned[1].pid))).toBe(true);
  });
});
