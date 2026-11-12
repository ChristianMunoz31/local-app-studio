// A public build has no installer: the build routes answer the 403 feature_unavailable envelope before they read anything, the stub
// service builds nothing and says nothing is running, and Apps and the doctor work without any installer state. The pro twin of this
// file is buildService.test.js, which runs only in a pro build; buildRoutesGate.test.js runs the route gate in both builds.
import crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FeatureUnavailableError } from '../../buildFeatures.js';
import { defaultDoctorFacade, runDoctor } from '../../diagnostics/doctor.js';
import { createApp, listApps } from '../../studio/apps.js';
import { STEPS, createBuildService, getBuildService, stepsForFinished } from '../../studio/build/service.js';
import { MIN_RUSTC, detectToolchain } from '../../studio/build/toolchain.js';
import { PUBLIC_BUILD } from '../helpers/proBuild.js';
import { closeTestDb, createTestDb } from '../helpers/testDb.js';

vi.mock('../../../loadEnv.js', () => ({}));

let app;
let db;
const saved = Object.fromEntries(['APP_PASSWORD', 'AUTH_SECRET'].map((k) => [k, process.env[k]]));

beforeAll(async () => {
  for (const k of Object.keys(saved)) delete process.env[k];
  db = createTestDb();
  app = (await import('../../../server.js')).default;
});
afterAll(() => {
  closeTestDb(db);
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe.skipIf(!PUBLIC_BUILD)('the installer in a public build (runs only in a public build, where the installer is not in the build)', () => {
  const SENTENCE = 'Making an installer is not in this build. Export the app instead.';
  const id = crypto.randomUUID();

  it.each([
    ['get', '/api/studio/build/toolchain'],
    ['get', `/api/studio/apps/${id}/builds`],
    ['post', `/api/studio/apps/${id}/builds`],
    ['get', `/api/studio/builds/${id}`],
    ['get', `/api/studio/builds/${id}/events`],
    ['post', `/api/studio/builds/${id}/cancel`],
  ])('%s %s answers 403 feature_unavailable through the real app', async (method, url) => {
    const res = await request(app)[method](url).set('X-Forwarded-For', '203.0.113.9').send(method === 'post' ? {} : undefined);
    expect(res.status).toBe(403);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ code: 'feature_unavailable', feature: 'installer', error: SENTENCE });
  });

  it('the stub service builds nothing: no build is running, there is no history, starting and stopping refuse', async () => {
    const service = getBuildService();
    expect(getBuildService()).toBe(service);
    expect(createBuildService()).not.toBe(service);
    expect(service.isBuilding('x')).toBe(false);
    await expect(service.shutdown()).resolves.toBeUndefined();
    expect(service.list('x')).toEqual([]);
    expect([service.get('x'), service.subscribe('x', () => {}), service.storedSnapshot('x')]).toEqual([null, null, null]);
    for (const call of ['start', 'cancel']) {
      expect(() => service[call]({}), call).toThrow(FeatureUnavailableError);
    }
    await expect(detectToolchain()).rejects.toMatchObject({ feature: 'installer', status: 403, message: SENTENCE });
    expect(STEPS).toEqual([]);
    expect(stepsForFinished({ status: 'succeeded' })).toEqual([]);
  });

  it('Apps list and delete work with no installer state', async () => {
    const a = createApp({ name: 'Crew Roster' });
    expect(listApps().find((x) => x.id === a.id)).toMatchObject({ hasInstaller: false });
    expect(await request(app).delete(`/api/studio/apps/${a.id}`).set('X-Forwarded-For', '203.0.113.9')).toMatchObject({ status: 200 });
    const res = await request(app).get('/api/studio/apps').set('X-Forwarded-For', '203.0.113.9');
    expect(res.status).toBe(200);
    expect(res.body.data.find((x) => x.id === a.id)).toBeUndefined();
  });

  it('the doctor lists no build tools and never asks for them', async () => {
    const f = defaultDoctorFacade();
    expect(f.buildTools).toBe(false);
    let asked = false;
    const report = await runDoctor(
      {
        ...f,
        statfs: () => ({ bavail: 100 * 1024, bsize: 1024 * 1024 }),
        freemem: () => 6 * 1024 ** 3,
        totalmem: () => 16 * 1024 ** 3,
        probeWrite: () => {},
        readdir: () => ['chromium-1200'],
        portHolder: async (port) => ({ port, checked: true, free: true, pid: null, command: '', self: false }),
        detectToolchain: async () => {
          asked = true;
          return { items: [] };
        },
      },
      { dataDir: 'C:/data', ollamaProbe: async () => ({ state: 'ready', host: 'http://127.0.0.1:11434', models: ['m'] }), includeDevTools: false },
    );
    const ids = report.lines.map((l) => l.id);
    expect(ids).not.toContain('rustc');
    expect(ids).toEqual(expect.arrayContaining(['disk', 'memory', 'data-folder', 'ollama']));
    expect(asked).toBe(false);
    expect(MIN_RUSTC).toBe('1.77.2');
  });
});
