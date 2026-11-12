// The restore gate must not wait for the build toolchain check (it spawns tools, takes up to a minute on a
// loaded PC and never touches the database), concurrent toolchain checks share one run, and the drain
// limit is wall-clock time, not a count of polls.
import { EventEmitter } from 'node:events';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { insert, select } from '../db/index.js';
import { inFlightCount, restoreGateMiddleware, waitForDrain } from '../backup/lock.js';
import { registerBackupRoutes } from '../backup/routes.js';
import { createBackup } from '../backup/service.js';
import { registerBuildRoutes } from '../studio/buildRoutes.js';
import { cleanupBackupEnv, day, resetBackupEnv } from './helpers/backupEnv.js';

// The toolchain route is a build route: it needs the installer in the build these tests run in (a public run answers 403 first).
vi.mock('../../src/proParts.js', () => ({ PRO_PARTS: { helper: true, installer: true, licensing: true, cloud: true } }));

const REPORT = {
  ok: true,
  checkedAt: '2026-11-03T10:00:00.000Z',
  hostTriple: 'aarch64-pc-windows-msvc',
  items: [{ id: 'node', label: 'Node.js 24 or newer', status: 'found', required: true, path: 'C:\\node.exe', hint: '' }],
};
const TOOLCHAIN_URL = '/api/studio/build/toolchain';

/** A promise the test settles by hand. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Same middleware order as server.js: JSON parser, restore gate, routes. */
function makeApp(detect) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', restoreGateMiddleware);
  registerBackupRoutes(app, { authEnabled: false });
  registerBuildRoutes(app, { service: {}, detect });
  return app;
}

beforeEach(() => {
  resetBackupEnv();
});
afterAll(() => {
  cleanupBackupEnv();
});

describe('restore with a toolchain check still running', () => {
  it('is not held back by GET /api/studio/build/toolchain (no 409 backup_busy)', async () => {
    const check = deferred();
    const started = deferred();
    const detect = vi.fn(() => {
      started.resolve();
      return check.promise;
    });
    const app = makeApp(detect);

    insert('app_state', { key: 'saved', value: 1 });
    const backup = (await createBackup({ kind: 'manual', now: day(1) })).meta;
    insert('app_state', { key: 'live', value: 1 });

    const pending = request(app).get(TOOLCHAIN_URL);
    pending.end(() => {});
    await started.promise;

    const res = await request(app).post('/api/backups/restore').set('Content-Type', 'application/json').send({ id: backup.id, confirm: true });
    expect(res.status).toBe(200);
    expect(res.body.data.restoredFrom).toBe(backup.id);
    expect(select('app_state').map((n) => n.key)).toEqual(['saved']);
    expect(inFlightCount()).toBe(0);

    check.resolve(REPORT);
    pending.abort();
  }, 30_000);

  it('does not count GET /api/studio/diagnostics/doctor, but counts info, report and logs', () => {
    const res = new EventEmitter();
    restoreGateMiddleware({ method: 'GET', path: '/studio/diagnostics/doctor' }, res, () => {});
    restoreGateMiddleware({ method: 'GET', path: '/Studio/Diagnostics/Doctor/' }, res, () => {});
    expect(inFlightCount()).toBe(0);
    restoreGateMiddleware({ method: 'POST', path: '/studio/diagnostics/doctor' }, res, () => {});
    restoreGateMiddleware({ method: 'GET', path: '/studio/diagnostics' }, res, () => {});
    restoreGateMiddleware({ method: 'GET', path: '/studio/diagnostics/report' }, res, () => {});
    restoreGateMiddleware({ method: 'GET', path: '/studio/diagnostics/logs' }, res, () => {});
    expect(inFlightCount()).toBe(4);
  });

  it('still counts other GET requests, so a restore keeps waiting for them', () => {
    const res = new EventEmitter();
    restoreGateMiddleware({ method: 'GET', path: '/studio/build/toolchains' }, res, () => {});
    restoreGateMiddleware({ method: 'POST', path: '/studio/build/toolchain' }, res, () => {});
    expect(inFlightCount()).toBe(2);
  });
});

describe('GET /api/studio/build/toolchain single flight', () => {
  it('two concurrent requests call detect once and both get the report', async () => {
    const check = deferred();
    const started = deferred();
    const detect = vi.fn(() => {
      started.resolve();
      return check.promise;
    });
    const app = makeApp(detect);

    const first = request(app).get(TOOLCHAIN_URL);
    const second = request(app).get(`${TOOLCHAIN_URL}?refresh=1`);
    const both = Promise.all([first, second]);
    await started.promise;
    // Let the second request reach the handler while the first check is still running.
    await new Promise((resolve) => setTimeout(resolve, 50));
    check.resolve(REPORT);
    const [a, b] = await both;

    expect(detect).toHaveBeenCalledTimes(1);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.data.items).toEqual(REPORT.items);
    expect(b.body.data.items).toEqual(REPORT.items);
  });

  it('a failed check frees the slot, so the next request runs detect again', async () => {
    const detect = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(REPORT);
    const app = makeApp(detect);

    expect((await request(app).get(TOOLCHAIN_URL)).status).toBeGreaterThanOrEqual(500);
    const ok = await request(app).get(TOOLCHAIN_URL);
    expect(ok.status).toBe(200);
    expect(detect).toHaveBeenCalledTimes(2);
  });
});

describe('waitForDrain deadline', () => {
  it('is wall-clock time: slow polls end the wait at the limit, not after limit/pollMs polls', async () => {
    restoreGateMiddleware({ method: 'GET', path: '/state' }, new EventEmitter(), () => {});
    let t = 1_000;
    let polls = 0;
    // Each "25 ms" sleep really takes 100 ms, as on a loaded PC.
    const drained = await waitForDrain({
      timeoutMs: 1_000,
      pollMs: 25,
      now: () => t,
      sleep: async () => {
        polls += 1;
        t += 100;
      },
    });
    expect(drained).toBe(false);
    expect(polls).toBe(10);
  });

  it('returns true as soon as the request ends before the deadline', async () => {
    const res = new EventEmitter();
    restoreGateMiddleware({ method: 'GET', path: '/state' }, res, () => {});
    let t = 0;
    const drained = await waitForDrain({
      timeoutMs: 1_000,
      now: () => t,
      sleep: async () => {
        t += 25;
        if (t === 75) res.emit('finish');
      },
    });
    expect(drained).toBe(true);
    expect(t).toBe(75);
  });
});
