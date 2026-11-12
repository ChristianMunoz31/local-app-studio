// Diagnostics routes through a small Express app with fake probes: shapes, 400 envelopes, no-store and the ZIP download.
import express from 'express';
import { strFromU8, unzipSync } from 'fflate';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerDiagnosticsRoutes } from '../../diagnostics/routes.js';
import { logger, resetLogForTests, setSessionDebug } from '../../log.js';
import { closeTestDb, createTestDb, resetDb } from '../helpers/testDb.js';

const DOCTOR = {
  checkedAt: '2026-11-04T10:12:00.000Z',
  lines: [{ id: 'node', label: 'Node.js', status: 'found', detail: '24.15.0', action: '' }],
  counts: { found: 1, missing: 0, problem: 0 },
};

let db;
beforeAll(() => {
  db = createTestDb();
});
beforeEach(() => {
  resetDb(db);
  resetLogForTests();
});
afterEach(() => setSessionDebug(false));
afterAll(() => closeTestDb(db));

function makeApp(over = {}) {
  const doctor = vi.fn(async () => DOCTOR);
  const app = express();
  app.use(express.json());
  registerDiagnosticsRoutes(app, {
    dataDir: () => 'C:\\data',
    describe: async () => ({ available: true, model: 'llama3.2:3b', ai: { kind: 'local', host: null } }),
    listModels: async () => [{ name: 'llama3.2:3b' }],
    previewPort: () => 4433,
    doctor,
    now: () => new Date(2026, 10, 4, 10, 12),
    ...over,
  });
  return { app, doctor };
}

describe('GET /api/studio/diagnostics', () => {
  it('answers the documented shape', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/studio/diagnostics');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(Object.keys(d).sort()).toEqual(['dataFolder', 'debug', 'helper', 'log', 'mode', 'ports', 'recovered', 'versions']);
    expect(d.versions).toMatchObject({ node: process.versions.node, bundle: { sea: false, sha256: null } });
    expect(typeof d.versions.studio).toBe('string');
    expect(d.mode).toMatchObject({ app: 'studio' });
    expect(['stable', 'dev']).toContain(d.mode.channel);
    expect(typeof d.mode.desktop).toBe('boolean');
    expect(d.dataFolder).toBe('C:\\data');
    expect(d.ports.preview).toBe(4433);
    expect(Number.isInteger(d.ports.app)).toBe(true);
    expect(d.helper).toMatchObject({ state: 'ready', models: ['llama3.2:3b'], sentence: 'Ready' });
    expect(d.debug).toEqual({ env: false, session: false, on: false });
    expect(d.log).toMatchObject({ files: expect.any(Array), ring: expect.any(Number) });
    expect(d.recovered).toBeNull();
  });

  it('still answers when the helper check throws', async () => {
    const { app } = makeApp({ describe: async () => { throw new Error('boom'); } });
    const res = await request(app).get('/api/studio/diagnostics');
    expect(res.status).toBe(200);
    expect(res.body.data.helper.state).toBe('down');
  });
});

describe('GET /api/studio/diagnostics/doctor', () => {
  it('returns the doctor report and shares one concurrent run', async () => {
    const { app, doctor } = makeApp();
    const [a, b] = await Promise.all([request(app).get('/api/studio/diagnostics/doctor'), request(app).get('/api/studio/diagnostics/doctor')]);
    expect(a.body).toEqual({ data: DOCTOR });
    expect(b.body).toEqual({ data: DOCTOR });
    expect(doctor.mock.calls.length).toBeLessThanOrEqual(2);
    await request(app).get('/api/studio/diagnostics/doctor');
    expect(doctor.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('sends the envelope when the check fails', async () => {
    const { app } = makeApp({ doctor: async () => { throw new Error('boom'); } });
    const res = await request(app).get('/api/studio/diagnostics/doctor');
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ code: 'server_error', error: expect.any(String), action: expect.any(String), requestId: expect.any(String) });
  });
});

describe('GET /api/studio/diagnostics/logs', () => {
  it('returns lines filtered by level and limited', async () => {
    logger.info('t.one');
    logger.warn('t.two');
    logger.error('t.three');
    const { app } = makeApp();
    const all = await request(app).get('/api/studio/diagnostics/logs');
    expect(all.body.data.lines.map((l) => l.event)).toEqual(expect.arrayContaining(['t.one', 't.two', 't.three']));
    const warn = await request(app).get('/api/studio/diagnostics/logs?level=warn');
    expect(warn.body.data.lines.every((l) => ['warn', 'error', 'fatal'].includes(l.level))).toBe(true);
    expect(warn.body.data.lines.map((l) => l.event)).not.toContain('t.one');
    const one = await request(app).get('/api/studio/diagnostics/logs?limit=1');
    expect(one.body.data.lines).toHaveLength(1);
  });

  it.each(['limit=0', 'limit=501', 'limit=abc', 'limit=-1', 'level=loud', 'limit=1&limit=2', 'level=warn&level=error'])('refuses %s with 400 invalid_query', async (q) => {
    const { app } = makeApp();
    const res = await request(app).get(`/api/studio/diagnostics/logs?${q}`);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'invalid_query', action: expect.any(String), requestId: expect.any(String) });
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('POST /api/studio/diagnostics/debug', () => {
  it('turns the session toggle on and off', async () => {
    const { app } = makeApp();
    const on = await request(app).post('/api/studio/diagnostics/debug').send({ on: true });
    expect(on.body).toEqual({ data: { env: false, session: true, on: true } });
    const off = await request(app).post('/api/studio/diagnostics/debug').send({ on: false });
    expect(off.body.data.on).toBe(false);
  });

  it.each([{}, { on: 'yes' }, { on: 1 }, []])('refuses %j with 400 invalid_body', async (body) => {
    const { app } = makeApp();
    const res = await request(app).post('/api/studio/diagnostics/debug').send(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_body');
  });
});

describe('GET /api/studio/diagnostics/report', () => {
  it('downloads a ZIP with the documented headers', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .get('/api/studio/diagnostics/report')
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toBe('attachment; filename="local-app-studio-report-20261104-1012.zip"');
    expect(res.headers['cache-control']).toBe('no-store');
    const files = unzipSync(new Uint8Array(res.body));
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['README.txt', 'summary.txt', 'versions.json', 'doctor.txt', 'doctor.json', 'apps.json']));
    expect(strFromU8(files['doctor.txt'])).toContain('Found    Node.js');
  });
});
