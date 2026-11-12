// server.js wiring of the one error envelope: request id in and out, CORS exposure, and the final handler's mapping.
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../loadEnv.js', () => ({}));

const ENVELOPE_KEYS = ['action', 'code', 'error', 'message', 'requestId'];
let app;

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  delete process.env.AUTH_SECRET;
  app = (await import('../../server.js')).default;
});

describe('server.js error envelope wiring', () => {
  it('answers an unmatched /api path with the 404 envelope and the same id in the header', async () => {
    const res = await request(app).get('/api/no-such-route');
    expect(res.status).toBe(404);
    expect(Object.keys(res.body).sort()).toEqual(ENVELOPE_KEYS);
    expect(res.body).toMatchObject({ code: 'not_found', error: 'That was not found.' });
    expect(res.body.requestId).toMatch(/^[0-9a-f]{16}$/);
    expect(res.headers['x-request-id']).toBe(res.body.requestId);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('keeps a well formed incoming X-Request-Id and replaces a malformed one', async () => {
    const kept = await request(app).get('/api/no-such-route').set('X-Request-Id', 'abc-1234-def');
    expect(kept.body.requestId).toBe('abc-1234-def');
    expect(kept.headers['x-request-id']).toBe('abc-1234-def');
    const replaced = await request(app).get('/api/no-such-route').set('X-Request-Id', 'bad id!');
    expect(replaced.body.requestId).toMatch(/^[0-9a-f]{16}$/);
  });

  it('answers a disallowed Host with the 421 envelope before anything else', async () => {
    const res = await request(app).get('/api/no-such-route').set('Host', 'evil.example.com:4321');
    expect(res.status).toBe(421);
    expect(res.body).toMatchObject({ code: 'host_not_allowed' });
    expect(res.headers['x-request-id']).toBe(res.body.requestId);
  });

  it('answers a disallowed Origin with origin_not_allowed', async () => {
    const res = await request(app).get('/api/auth/status').set('Origin', 'http://evil.example.com');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'origin_not_allowed' });
  });

  it('exposes X-Request-Id to an allowed cross-origin page', async () => {
    const res = await request(app).get('/api/auth/status').set('Origin', 'http://localhost:5174');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-expose-headers']).toMatch(/X-Request-Id/i);
  });

  it('maps a malformed JSON body to invalid_body and a too large one to request_too_large', async () => {
    const bad = await request(app).post('/api/assistant').set('Content-Type', 'application/json').send('{"prompt":');
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ code: 'invalid_body' });
    const big = await request(app)
      .post('/api/assistant')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ prompt: 'x'.repeat(3 * 1024 * 1024) }));
    expect(big.status).toBe(413);
    expect(big.body).toMatchObject({ code: 'request_too_large' });
  });
});
