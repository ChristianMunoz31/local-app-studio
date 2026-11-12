// The preview manager seeds an example's sample records into a fresh data folder before it reports `running`: once per
// folder (a stamp), again after Reset, never when the folder has rows, never when a stop or a newer start got in first.
// Uses the fake preview child in its `records` modes (it logs every request it gets).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPreviewManager } from '../../studio/preview/manager.js';
import { scratchDirFor } from '../../studio/preview/paths.js';
import { STAMP_FILE } from '../../studio/preview/seed.js';
import { starterSpec } from '../../studio/specCheck.js';

const FAKE = fileURLToPath(new URL('./fixtures/fakePreviewChild.mjs', import.meta.url));
const { spawn: realSpawn } = await import('node:child_process');
let root;
const managers = [];
const pids = new Set();

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'las-pseed-'));
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
afterAll(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

const until = async (cond, ms = 5000) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
  return cond();
};

const spec = () => {
  const s = starterSpec('Crew Board', 'crew-board');
  s.tables = [
    { id: 'people', label: 'People', titleField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] },
    {
      id: 'crews',
      label: 'Crews',
      titleField: 'name',
      fields: [
        { id: 'name', label: 'Name', type: 'text', required: true },
        { id: 'lead', label: 'Lead', type: 'reference', table: 'people' },
        { id: 'started', label: 'Started', type: 'date' },
      ],
    },
  ];
  return s;
};
const sample = {
  v: 1,
  tables: {
    crews: [{ name: 'North Crew', lead: 'p1', started: { $days: 0 } }],
    people: [{ _id: 'p1', name: 'Mara Quill' }, { name: 'Theo Brannock' }],
  },
};
const newApp = (revision = 1) => ({ id: crypto.randomUUID(), spec: spec(), revision });

function make({ mode = 'records', readSample = () => sample, ...opts } = {}) {
  const logFile = path.join(root, `${crypto.randomUUID()}.log`);
  const secretFile = path.join(root, `${crypto.randomUUID()}.txt`);
  const spawn = vi.fn((...args) => {
    const child = realSpawn(...args);
    pids.add(child.pid);
    return child;
  });
  const manager = createPreviewManager({
    rootDir: root,
    spawn,
    spawnSpec: () => ({ command: process.execPath, args: [FAKE, mode, secretFile, logFile, 'people,crews'] }),
    startTimeoutMs: 8000,
    stopTimeoutMs: 1000,
    now: () => new Date(2026, 5, 15, 12),
    readSample,
    ...opts,
  });
  managers.push(manager);
  const requests = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { manager, requests, spawn };
}
const stampPath = (id) => path.join(scratchDirFor(root, id), 'data', STAMP_FILE);

describe('preview manager seeding', () => {
  it('seeds a first start before running, stamps the folder and reports how many rows', async () => {
    const states = [];
    let manager;
    const seed = vi.fn(async (opts) => {
      states.push(manager.status().state);
      return (await import('../../studio/preview/seed.js')).seedSample(opts);
    });
    const made = make({ seed });
    manager = made.manager;
    const a = newApp();
    const status = await manager.start(a);
    expect(states).toEqual(['starting']);
    expect(status).toMatchObject({ state: 'running', data: { kept: false, reason: 'first_start', seeded: 3 } });
    const posts = made.requests().filter((r) => r.method === 'POST');
    expect(posts.map((p) => p.url)).toEqual(['/api/data/people', '/api/data/people', '/api/data/crews']);
    expect(posts[2].body).toEqual({ name: 'North Crew', lead: 'people-1', started: '2026-06-15' });
    expect(JSON.parse(fs.readFileSync(stampPath(a.id), 'utf8'))).toMatchObject({ v: 1, created: 3, skipped: 0 });
    expect(JSON.stringify(manager.status())).not.toContain(manager.target().cookie);
  });

  it('does not seed again on a restart of the same folder', async () => {
    const { manager, requests } = make();
    const a = newApp();
    await manager.start(a);
    const first = requests().filter((r) => r.method === 'POST').length;
    expect(first).toBe(3);
    const status = await manager.start({ ...a, revision: 2 });
    expect(status.state).toBe('running');
    expect(status.data.seeded).toBeUndefined();
    expect(requests().filter((r) => r.method === 'POST')).toHaveLength(first);
  });

  it('seeds again after Reset, with reason reset', async () => {
    const { manager, requests } = make();
    const a = newApp();
    await manager.start(a);
    expect(fs.existsSync(stampPath(a.id))).toBe(true);
    const status = await manager.resetData(a);
    expect(status).toMatchObject({ state: 'running', data: { kept: false, reason: 'reset', seeded: 3 } });
    expect(requests().filter((r) => r.method === 'POST')).toHaveLength(6);
    expect(fs.existsSync(stampPath(a.id))).toBe(true);
  });

  it('makes no data request for an app without a sample', async () => {
    const { manager, requests } = make({ readSample: () => null });
    const a = newApp();
    const status = await manager.start(a);
    expect(status.state).toBe('running');
    expect(status.data.seeded).toBeUndefined();
    expect(requests()).toEqual([]);
    expect(fs.existsSync(stampPath(a.id))).toBe(false);
  });

  it('writes no rows when the child already has some, and still stamps the folder', async () => {
    const { manager, requests } = make({ mode: 'records-rows' });
    const a = newApp();
    const status = await manager.start(a);
    expect(status.state).toBe('running');
    expect(status.data.seeded).toBeUndefined();
    expect(requests().map((r) => r.method)).toEqual(['GET']);
    expect(fs.existsSync(stampPath(a.id))).toBe(true);
  });

  it('keeps running and writes no stamp when seeding aborted', async () => {
    const seed = vi.fn(async () => ({ created: 1, skipped: 0, hadRows: false, aborted: true }));
    const { manager } = make({ seed });
    const a = newApp();
    const status = await manager.start(a);
    expect(status).toMatchObject({ state: 'running', data: { seeded: 1 } });
    expect(fs.existsSync(stampPath(a.id))).toBe(false);
  });

  it('never reports running when a stop comes during seeding', async () => {
    const { manager, requests } = make({ mode: 'records-slow' });
    const a = newApp();
    const started = manager.start(a);
    expect(await until(() => requests().some((r) => r.method === 'POST'))).toBe(true);
    expect(manager.status().state).toBe('starting');
    expect(manager.target()).toBeNull();
    await manager.stop();
    const result = await started;
    expect(result.state).not.toBe('running');
    expect(manager.status()).toMatchObject({ state: 'stopped', appId: null });
    expect(manager.target()).toBeNull();
    expect(fs.existsSync(stampPath(a.id))).toBe(false);
  });

  it('a newer start cancels the seeding of the older one within one request', async () => {
    const big = { v: 1, tables: { people: Array.from({ length: 12 }, (_, i) => ({ name: `Person ${i}` })) } };
    const runs = [];
    const seed = vi.fn((opts) => {
      const run = { stoppedAt: null, startedAt: Date.now() };
      runs.push(run);
      return import('../../studio/preview/seed.js').then(({ seedSample }) =>
        seedSample(opts).then((result) => {
          run.stoppedAt = Date.now();
          run.result = result;
          return result;
        }),
      );
    });
    const { manager } = make({ mode: 'records-slow', seed, readSample: () => big });
    const a = newApp();
    const first = manager.start(a);
    expect(await until(() => runs.length === 1)).toBe(true);
    await new Promise((r) => setTimeout(r, 350));
    const restartedAt = Date.now();
    const second = manager.start({ ...a, revision: 2 });
    await first;
    expect(runs[0].result).toMatchObject({ aborted: true });
    // the 12 rows take 3.6 s at 300 ms each; the cancelled run ends after at most the request in flight
    expect(runs[0].stoppedAt - restartedAt).toBeLessThan(900);
    const status = await second;
    expect(status).toMatchObject({ state: 'running', revision: 2 });
  });

  it('a newer start during seeding wins and the older one leaves no stamp', async () => {
    const { manager } = make({ mode: 'records-slow' });
    const a = newApp();
    const b = newApp();
    const first = manager.start(a);
    await new Promise((r) => setTimeout(r, 300));
    const second = manager.start(b);
    await first;
    const status = await second;
    expect(status).toMatchObject({ state: 'running', appId: b.id });
    expect(fs.existsSync(stampPath(a.id))).toBe(false);
    expect(fs.existsSync(stampPath(b.id))).toBe(true);
  });
});
