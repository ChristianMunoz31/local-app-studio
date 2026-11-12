// Build routes: through the real app for the opt-in gate and limiter, through a small app with an injected service for the rest.
import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeTestDb, createTestDb, resetDb } from '../helpers/testDb.js';
import { __resetNetPolicyForTests, setNetworkFeature } from '../../netPolicy.js';
import { StudioError, createApp } from '../../studio/apps.js';
import { registerBuildRoutes } from '../../studio/buildRoutes.js';
import { studioGuard } from '../../studio/http.js';

vi.mock('../../../loadEnv.js', () => ({}));
// These tests are about the build routes with the installer in the build they run in (a public run has none: buildRoutesGate.test.js).
vi.mock('../../../src/proParts.js', () => ({ PRO_PARTS: { helper: true, installer: true, licensing: true, cloud: true } }));

let db;
let real;
let n = 0;
const ip = () => `10.8.${Math.floor(n / 250)}.${(n += 1) % 250}`;
const BUILD = {
  id: crypto.randomUUID(),
  appId: crypto.randomUUID(),
  status: 'succeeded',
  specRevision: 1,
  appVersion: '1.0.0',
  startedAt: '2026-11-02T10:00:00.000Z',
  finishedAt: '2026-11-02T10:05:00.000Z',
  durationMs: 300000,
  installerPath: 'C:\\Docs\\x.exe',
  installerSha256: 'a'.repeat(64),
  installerSizeBytes: 10,
  errorCode: null,
  message: null,
};
const REPORT = {
  ok: false,
  checkedAt: 'now',
  hostTriple: 'aarch64-pc-windows-msvc',
  items: [{ id: 'node', label: 'Node.js 24 or newer', status: 'found', required: true, path: 'C:\\node.exe', hint: '' }],
  node: { exe: 'C:\\node.exe', npmCli: 'C:\\npm-cli.js' },
  cargoBin: 'C:\\cargo\\bin',
  cargoHome: 'C:\\cargo',
  rustupHome: 'C:\\rustup',
};

function fakeService(overrides = {}) {
  return {
    start: vi.fn(() => ({ ...BUILD, status: 'running', finishedAt: null })),
    list: vi.fn(() => [BUILD]),
    get: vi.fn((id) => (id === BUILD.id ? BUILD : null)),
    cancel: vi.fn(async () => {
      throw new StudioError('build_not_running', 409, 'That build is not running.');
    }),
    subscribe: vi.fn(() => null),
    storedSnapshot: vi.fn((id) => (id === BUILD.id ? { build: BUILD, steps: [], lines: [], truncated: false, live: false } : null)),
    ...overrides,
  };
}

function miniApp(service, detect) {
  const app = express();
  app.use(express.json());
  app.use('/api/studio', studioGuard);
  registerBuildRoutes(app, { service, detect });
  return app;
}

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  delete process.env.AUTH_SECRET;
  db = createTestDb();
  real = (await import('../../../server.js')).default;
});
beforeEach(() => {
  resetDb(db);
  __resetNetPolicyForTests();
});
afterAll(() => closeTestDb(db));

describe('build routes through the real app', () => {
  it('answers 403 network_opt_in_required before anything else, with no-store and the 1200 budget', async () => {
    const app = createApp({ name: 'Crew Roster' });
    const res = await request(real)
      .post(`/api/studio/apps/${app.id}/builds`)
      .set('X-Forwarded-For', ip())
      .send({ baseRevision: 1 });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'network_opt_in_required', feature: 'build' });
    // the gate runs before the id and the body are looked at
    const bad = await request(real).post('/api/studio/apps/nope/builds').set('X-Forwarded-For', ip()).send({});
    expect(bad.status).toBe(403);
    const list = await request(real).get(`/api/studio/apps/${app.id}/builds`).set('X-Forwarded-For', ip());
    expect(list.body).toEqual({ data: [] });
    expect(list.headers['cache-control']).toBe('no-store');
    expect(list.headers['ratelimit-policy']).toMatch(/^1200;w=900/);
  });

  it('lets the start through the gate once App builds is on (400 for a bad body)', async () => {
    await setNetworkFeature('build', true);
    const app = createApp({ name: 'Crew Roster' });
    const res = await request(real).post(`/api/studio/apps/${app.id}/builds`).set('X-Forwarded-For', ip()).send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_request');
  });
});

describe('build routes with an injected service', () => {
  beforeEach(async () => {
    await setNetworkFeature('build', true);
  });

  it('answers 404 for malformed or unknown ids', async () => {
    const app = miniApp(fakeService());
    expect((await request(app).get('/api/studio/apps/nope/builds')).status).toBe(404);
    expect((await request(app).post('/api/studio/apps/nope/builds').send({ baseRevision: 1 })).status).toBe(404);
    const a = await request(app).get('/api/studio/builds/nope');
    expect(a.status).toBe(404);
    expect(a.body.code).toBe('build_not_found');
    expect((await request(app).get(`/api/studio/builds/${crypto.randomUUID()}`)).body.code).toBe('build_not_found');
    expect((await request(app).get(`/api/studio/builds/${crypto.randomUUID()}/events`)).status).toBe(404);
    expect((await request(app).post('/api/studio/builds/nope/cancel')).status).toBe(404);
    expect((await request(app).get(`/api/studio/apps/${crypto.randomUUID()}/builds`)).body.code).toBe('app_not_found');
  });

  it('answers 400 for a bad body', async () => {
    const service = fakeService();
    const app = miniApp(service);
    const row = createApp({ name: 'Crew Roster' });
    for (const body of [{}, { baseRevision: '1' }, { baseRevision: 0 }, { baseRevision: 1.5 }]) {
      const res = await request(app).post(`/api/studio/apps/${row.id}/builds`).send(body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_request');
    }
    expect(service.start).not.toHaveBeenCalled();
  });

  it('starts with 201 and the record, and maps service errors', async () => {
    const service = fakeService();
    const app = miniApp(service);
    const row = createApp({ name: 'Crew Roster' });
    const res = await request(app).post(`/api/studio/apps/${row.id}/builds`).send({ baseRevision: 1 });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'running', installerSizeBytes: 10 });
    expect(service.start).toHaveBeenCalledWith({ appId: row.id, baseRevision: 1 });
    service.start.mockImplementationOnce(() => {
      throw new StudioError('build_busy', 409, 'Another build is running.', { buildId: BUILD.id, appId: row.id });
    });
    const busy = await request(app).post(`/api/studio/apps/${row.id}/builds`).send({ baseRevision: 1 });
    expect(busy.status).toBe(409);
    expect(busy.body).toMatchObject({ code: 'build_busy', buildId: BUILD.id });
  });

  it('lists in the service order and gets one build', async () => {
    const service = fakeService({ list: vi.fn(() => [{ ...BUILD, id: 'b' }, { ...BUILD, id: 'a' }]) });
    const app = miniApp(service);
    const row = createApp({ name: 'Crew Roster' });
    const res = await request(app).get(`/api/studio/apps/${row.id}/builds`);
    expect(res.body.data.map((b) => b.id)).toEqual(['b', 'a']);
    expect(res.headers['cache-control']).toBe('no-store');
    const one = await request(app).get(`/api/studio/builds/${BUILD.id}`);
    expect(one.body).toEqual({ data: BUILD });
  });

  it('answers 409 build_not_running when cancelling a build that is not running', async () => {
    const res = await request(miniApp(fakeService())).post(`/api/studio/builds/${BUILD.id}/cancel`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('build_not_running');
    const ok = fakeService({ cancel: vi.fn(async () => ({ ...BUILD, status: 'cancelled' })) });
    const done = await request(miniApp(ok)).post(`/api/studio/builds/${BUILD.id}/cancel`);
    expect(done.body.data.status).toBe('cancelled');
    expect(ok.cancel).toHaveBeenCalledWith(BUILD.id);
  });

  it('streams a snapshot then end for a finished build', async () => {
    const res = await request(miniApp(fakeService())).get(`/api/studio/builds/${BUILD.id}/events`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    const events = res.text.split('\n\n').filter((b) => b.startsWith('event:'));
    expect(events.map((e) => e.split('\n')[0])).toEqual(['event: snapshot', 'event: end']);
    const snapshot = JSON.parse(events[0].split('\n')[1].slice(6));
    expect(snapshot).toMatchObject({ type: 'snapshot', live: false, lines: [], truncated: false });
    expect(snapshot.build.id).toBe(BUILD.id);
  });

  it('replays the snapshot and forwards live events until end', async () => {
    let listener;
    const unsubscribe = vi.fn();
    const live = { ...BUILD, status: 'running', finishedAt: null };
    const service = fakeService({
      subscribe: vi.fn((id, fn) => {
        listener = fn;
        setImmediate(() => {
          fn({ type: 'log', seq: 2, step: 'npm-ci', line: 'hello' });
          fn({ type: 'end', build: BUILD });
        });
        return {
          snapshot: { build: live, steps: [], lines: [{ seq: 1, step: 'npm-ci', line: 'first' }], truncated: false, live: true },
          unsubscribe,
        };
      }),
    });
    const res = await request(miniApp(service)).get(`/api/studio/builds/${BUILD.id}/events`);
    expect(listener).toBeTypeOf('function');
    const names = res.text
      .split('\n\n')
      .filter((b) => b.startsWith('event:'))
      .map((e) => e.split('\n')[0]);
    expect(names).toEqual(['event: snapshot', 'event: log', 'event: end']);
    expect(res.text).toContain('"line":"first"');
    expect(res.text).toContain('"line":"hello"');
  });

  it('strips the internal toolchain fields', async () => {
    const detect = vi.fn(async () => REPORT);
    const app = miniApp(fakeService(), detect);
    const res = await request(app).get('/api/studio/build/toolchain');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual(['checkedAt', 'hostTriple', 'items', 'ok']);
    expect(JSON.stringify(res.body)).not.toContain('npm-cli');
    await request(app).get('/api/studio/build/toolchain');
    expect(detect).toHaveBeenCalledTimes(1);
    await request(app).get('/api/studio/build/toolchain?refresh=1');
    expect(detect).toHaveBeenCalledTimes(2);
  });
});
