// The final error handler answers every /api error with no-store, and its message branch matches paths the way
// Express routes them (case-insensitive, trailing slash ignored, '/api/data' exact or as a folder only).
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../loadEnv.js', () => ({}));

let app;
let n = 0;
const bad = (path) =>
  request(app)
    .post(path)
    .set('X-Forwarded-For', `198.51.100.${(n += 1)}`)
    .set('Content-Type', 'application/json')
    .send('{"a":');

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  delete process.env.AUTH_SECRET;
  app = (await import('../../server.js')).default;
});

describe('final error handler on /api', () => {
  it('marks a body-parser 400 as no-store even where the no-store middleware does not apply', async () => {
    const res = await bad('/api/assistant/advice');
    expect(res.status).toBe(400);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('adds the readable message for /api/data in any case and with a trailing slash', async () => {
    for (const p of ['/api/data/t', '/API/Data/t', '/api/data', '/api/data/', '/api/DATA/']) {
      const res = await bad(p);
      expect(res.status, p).toBe(400);
      expect(res.body.message, p).toMatch(/could not be read/);
      expect(res.headers['cache-control'], p).toBe('no-store');
    }
  });

  it('does not treat /api/database as /api/data', async () => {
    const res = await bad('/api/database');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'That request could not be read.', code: 'invalid_body' });
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
