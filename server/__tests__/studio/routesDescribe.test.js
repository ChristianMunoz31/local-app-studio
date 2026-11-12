// Route 8 with a scripted runDescribe: errors before the stream, event order, forced app block, abort and audit.
import crypto from 'node:crypto';
import http from 'node:http';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../loadEnv.js', () => ({}));
vi.mock('node-fetch', () => ({ default: vi.fn() }));
vi.mock('../../studio/describe/pipeline.js', async (importOriginal) => ({ ...(await importOriginal()), runDescribe: vi.fn() }));

import fetch from 'node-fetch';
import { __resetAiForTests } from '../../ai/index.js';
import { DescribeError, runDescribe } from '../../studio/describe/pipeline.js';
import { createApp } from '../../studio/apps.js';
import { installFakeOllama } from '../helpers/fakeOllama.js';
import { configureCloud, installCloudAndOllama, resetCloud } from '../helpers/fakeCloud.js';
import { closeTestDb, createTestDb, resetDb, rowsOf } from '../helpers/testDb.js';
import { PUBLIC_BUILD } from '../helpers/proBuild.js';

let app;
let db;
let n = 0;
const nextIp = () => `203.0.113.${(n += 1) % 250}`;
const saved = Object.fromEntries(['APP_PASSWORD', 'AUTH_SECRET', 'APP_AI'].map((k) => [k, process.env[k]]));

const sseParse = (res, cb) => {
  let text = '';
  res.setEncoding('utf8');
  res.on('data', (d) => {
    text += d;
  });
  res.on('end', () => cb(null, text));
};
const events = (text) =>
  text
    .split('\n\n')
    .filter((b) => b.startsWith('event:'))
    .map((b) => {
      const [e, d] = b.split('\n');
      return [e.slice(7), JSON.parse(d.slice(6))];
    });
const post = (id, body, ip = nextIp()) =>
  request(app).post(`/api/studio/apps/${id}/describe`).set('X-Forwarded-For', ip).buffer(true).parse(sseParse).send(body);
const body = (over = {}) => ({ mode: 'edit', instruction: 'Add a crews table', baseRevision: 1, ...over });
const proposalFor = (record, mutate = () => {}) => {
  const proposal = structuredClone(record.spec);
  proposal.app.name = 'Model Renamed';
  mutate(proposal);
  return proposal;
};

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
beforeEach(() => {
  resetDb(db);
  __resetAiForTests();
  fetch.mockReset();
  runDescribe.mockReset();
  delete process.env.APP_AI;
  installFakeOllama(fetch);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  await resetCloud();
  vi.restoreAllMocks();
});

describe.skipIf(PUBLIC_BUILD)('before the stream (needs the helper route, which is not in a public build)', () => {
  it('answers 400 for a bad body and 404 for an unknown app', async () => {
    const a = createApp({ name: 'Crew Roster' });
    for (const bad of [{ mode: 'x' }, { instruction: '   ' }, { instruction: 'x'.repeat(2001) }, { baseRevision: 0 }, { baseRevision: '1' }]) {
      const res = await post(a.id, body(bad));
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect((await post(crypto.randomUUID(), body())).status).toBe(404);
    expect((await post('nope', body())).status).toBe(404);
    expect(runDescribe).not.toHaveBeenCalled();
  });

  it('answers 409 for a broken stored spec and a stale revision', async () => {
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO apps (id, name, slug, spec) VALUES (?, ?, ?, ?)').run(id, 'Broken App', 'broken-app', '{}');
    const broken = await post(id, body());
    expect(broken.status).toBe(409);
    expect(JSON.parse(broken.body).code).toBe('spec_invalid');
    const a = createApp({ name: 'Crew Roster' });
    const stale = await post(a.id, body({ baseRevision: 5 }));
    expect(stale.status).toBe(409);
    expect(JSON.parse(stale.body)).toMatchObject({ code: 'revision_conflict', revision: 1 });
  });

  it('answers 503 when AI is off and 503 when Ollama is down', async () => {
    const a = createApp({ name: 'Crew Roster' });
    process.env.APP_AI = '0';
    __resetAiForTests();
    expect((await post(a.id, body())).status).toBe(503);
    delete process.env.APP_AI;
    __resetAiForTests();
    installFakeOllama(fetch, { down: true });
    const res = await post(a.id, body());
    expect(res.status).toBe(503);
    expect(JSON.parse(res.body).code).toBe('ollama_unavailable');
  });

  it('answers 409 describe_local_only and makes no cloud call when a cloud tools client is configured', async () => {
    const a = createApp({ name: 'Crew Roster' });
    await configureCloud();
    const { cloud } = installCloudAndOllama(fetch);
    const res = await post(a.id, body());
    expect(res.status).toBe(409);
    expect(res.headers['content-type']).not.toMatch(/text\/event-stream/);
    expect(JSON.parse(res.body)).toMatchObject({ code: 'describe_local_only' });
    expect(cloud.requests).toHaveLength(0);
    expect(runDescribe).not.toHaveBeenCalled();
  });
});

describe.skipIf(PUBLIC_BUILD)('the stream (needs the helper route, which is not in a public build)', () => {
  it('sends meta, progress, proposal and done, with the app block forced to the base', async () => {
    const a = createApp({ name: 'Crew Roster' });
    runDescribe.mockImplementation(async ({ onProgress }) => {
      onProgress({ step: 'tables', round: 0, status: 'running' });
      return {
        proposal: proposalFor(a),
        fallbacks: [{ step: 'page', pageId: 'home', message: 'Could not generate this part.' }],
        steps: [{ step: 'tables' }, { step: 'page' }],
      };
    });
    const res = await post(a.id, body());
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    const list = events(res.body);
    expect(list.map(([e]) => e)).toEqual(['meta', 'progress', 'proposal', 'done']);
    expect(list[0][1].ai).toMatchObject({ kind: 'local' });
    const [, proposal] = list[2];
    expect(proposal.proposal.app).toEqual(a.spec.app);
    expect(proposal).toMatchObject({ baseRevision: 1, steps: 2, fallbacks: [{ part: 'page', pageId: 'home' }] });
    const call = runDescribe.mock.calls[0][0];
    expect(call.scope.categories).toEqual([]);
    expect(call.signal).toBeInstanceOf(AbortSignal);
    expect(call).toMatchObject({ mode: 'edit', instruction: 'Add a crews table' });
    const row = rowsOf(db, 'apps')[0];
    expect(row.revision).toBe(1);
    expect(row.spec).toEqual(a.spec);
    const audit = rowsOf(db, 'audit_log').filter((r) => r.feature === 'studio_describe');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ kind: 'llm', status: 'ok', provider: 'ollama' });
  });

  it('sends proposal_invalid for a proposal that fails the checks', async () => {
    const a = createApp({ name: 'Crew Roster' });
    runDescribe.mockResolvedValue({ proposal: proposalFor(a, (p) => (p.pages[0].layout.children[0].type = 'Nope')), fallbacks: [], steps: [] });
    const list = events((await post(a.id, body())).body);
    expect(list.map(([e]) => e)).toEqual(['meta', 'error', 'done']);
    expect(list[1][1].code).toBe('proposal_invalid');
    expect(rowsOf(db, 'audit_log').find((r) => r.feature === 'studio_describe').status).toBe('error');
  });

  it('sends the pipeline public message and a classified AI error', async () => {
    const a = createApp({ name: 'Crew Roster' });
    runDescribe.mockRejectedValueOnce(new DescribeError('could_not_generate'));
    const first = events((await post(a.id, body())).body);
    expect(first[1]).toEqual([
      'error',
      expect.objectContaining({
        code: 'could_not_generate',
        message: expect.stringContaining('could not finish'),
        error: expect.stringContaining('could not finish'),
        action: expect.any(String),
        requestId: expect.stringMatching(/^[0-9a-f]{16}$/),
      }),
    ]);
    runDescribe.mockRejectedValueOnce(Object.assign(new Error('secret provider text'), { status: 500 }));
    const second = events((await post(a.id, body())).body);
    expect(second[1][0]).toBe('error');
    expect(JSON.stringify(second)).not.toContain('secret provider text');
  });

  it('aborts the signal when the client disconnects', async () => {
    const a = createApp({ name: 'Crew Roster' });
    let signal;
    runDescribe.mockImplementation(
      ({ signal: s }) =>
        new Promise((resolve, reject) => {
          signal = s;
          s.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
        }),
    );
    const server = http.createServer(app).listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    try {
      const payload = JSON.stringify(body());
      const req = http.request({
        host: '127.0.0.1',
        port: server.address().port,
        path: `/api/studio/apps/${a.id}/describe`,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), 'x-forwarded-for': nextIp() },
      });
      req.on('error', () => {});
      req.on('response', (res) => res.once('data', () => req.destroy()));
      req.end(payload);
      const end = Date.now() + 5000;
      while (!signal?.aborted && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
      expect(signal?.aborted).toBe(true);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  it('answers 429 on the 21st request in a window', async () => {
    const a = createApp({ name: 'Crew Roster' });
    runDescribe.mockResolvedValue({ proposal: a.spec, fallbacks: [], steps: [] });
    const ip = '198.51.100.77';
    for (let i = 0; i < 20; i += 1) expect((await post(a.id, body(), ip)).status).toBe(200);
    expect((await post(a.id, body(), ip)).status).toBe(429);
  });
});
