// server/log.js requestContext(): header in and out, one http.request record, route templates, open responses.
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configureLog, currentRequest, currentRequestId, newRequestId, openResponses, requestContext, resetLogForTests, tail } from '../log.js';

let seen;
function makeApp() {
  const app = express();
  app.use(requestContext());
  const router = express.Router();
  router.get('/things/:id', (req, res) => {
    seen = { id: currentRequestId(), current: currentRequest(), open: openResponses().size };
    res.json({ ok: true });
  });
  router.put('/things/:id', (req, res) => {
    res.locals.errorCode = 'revision_conflict';
    res.status(409).json({ code: 'revision_conflict' });
  });
  router.get('/boom', (req, res) => res.status(500).end());
  app.use('/api', router);
  return app;
}

beforeEach(() => {
  resetLogForTests();
  configureLog({ role: 'studio', env: {} });
  seen = null;
});
afterEach(() => resetLogForTests());

const records = () => tail().filter((r) => r.event === 'http.request');

describe('requestContext', () => {
  it('creates an id, returns it in the header and exposes it inside the handler', async () => {
    const res = await request(makeApp()).get('/api/things/7?secret=1');
    const id = res.headers['x-request-id'];
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(seen.id).toBe(id);
    expect(seen.current).toEqual({ id, res: expect.anything(), route: 'GET /api/things/:id' });
    expect(seen.open).toBe(1);
    expect(openResponses().size).toBe(0);
  });

  it('keeps a valid incoming id and replaces an invalid one', async () => {
    const app = makeApp();
    expect((await request(app).get('/api/things/1').set('X-Request-Id', 'client-id-12345')).headers['x-request-id']).toBe('client-id-12345');
    for (const bad of ['short', 'has space in it here', 'x'.repeat(65), 'bad/char/here123']) {
      const res = await request(app).get('/api/things/1').set('X-Request-Id', bad);
      expect(res.headers['x-request-id']).not.toBe(bad);
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it('logs one record per request with the route template, never the raw URL or query', async () => {
    const app = makeApp();
    await request(app).put('/api/things/99?token=abc').send({ x: 1 });
    const recs = records();
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ level: 'warn', route: 'PUT /api/things/:id', status: 409, code: 'revision_conflict', role: 'studio' });
    expect(typeof recs[0].durationMs).toBe('number');
    // The time, the duration and the hex request id can contain "99" or "abc" by chance: check every other field.
    const rest = Object.fromEntries(Object.entries(recs[0]).filter(([k]) => !['time', 'requestId', 'durationMs'].includes(k)));
    expect(JSON.stringify(rest)).not.toContain('99');
    expect(JSON.stringify(rest)).not.toContain('abc');
  });

  it('uses (unmatched) for a route nothing handled', async () => {
    await request(makeApp()).get('/nowhere');
    expect(records()[0]).toMatchObject({ route: 'GET (unmatched)', status: 404, level: 'warn' });
  });

  it('keeps successful GETs at debug (dropped unless debug), other successes at info, 5xx at error', async () => {
    const app = makeApp();
    await request(app).get('/api/things/1');
    expect(records()).toHaveLength(0);
    await request(app).get('/api/boom');
    expect(records()[0]).toMatchObject({ level: 'error', status: 500 });
    resetLogForTests();
    configureLog({ env: { APP_DEBUG: '1' } });
    await request(app).get('/api/things/1');
    expect(records()[0]).toMatchObject({ level: 'debug', status: 200 });
  });
});

describe('newRequestId', () => {
  it('is 16 hex characters and unique', () => {
    const a = newRequestId();
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(newRequestId()).not.toBe(a);
  });
});
