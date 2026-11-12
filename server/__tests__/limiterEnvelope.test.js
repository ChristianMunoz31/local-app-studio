// A rate limiter answers with the one error envelope, in the app's own limiters and in limiterHandler().
import express from 'express';
import rateLimit from 'express-rate-limit';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { limiterHandler } from '../errors.js';
import { requestContext } from '../log.js';

vi.mock('../../loadEnv.js', () => ({}));

const ENVELOPE_KEYS = ['action', 'code', 'error', 'message', 'requestId'];

describe('limiterHandler', () => {
  const makeApp = (handlerOpts) => {
    const app = express();
    app.use(requestContext());
    app.use(
      '/api',
      rateLimit({ windowMs: 60_000, max: 1, standardHeaders: true, legacyHeaders: false, handler: limiterHandler(handlerOpts) }),
    );
    app.get('/api/x', (req, res) => res.json({ ok: true }));
    return app;
  };

  it('answers the second request with a 429 envelope that carries the request id and the limiter headers', async () => {
    const app = makeApp();
    expect((await request(app).get('/api/x')).status).toBe(200);
    const res = await request(app).get('/api/x');
    expect(res.status).toBe(429);
    expect(Object.keys(res.body).sort()).toEqual(ENVELOPE_KEYS);
    expect(res.body.code).toBe('rate_limited');
    expect(res.body.error).toBe('Too many requests in a short time.');
    expect(res.body.action).toBe('Wait a few minutes, then try again.');
    expect(res.body.message).toBe(res.body.error);
    expect(res.body.requestId).toMatch(/^[0-9a-f]{16}$/);
    expect(res.headers['x-request-id']).toBe(res.body.requestId);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['ratelimit-limit']).toBeDefined();
  });

  it('keeps the sentence the call site passes', async () => {
    const app = makeApp({ message: 'Too many exports, please try again later.' });
    await request(app).get('/api/x');
    const res = await request(app).get('/api/x');
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('Too many exports, please try again later.');
    expect(res.body.code).toBe('rate_limited');
  });
});

describe('the app login limiter', () => {
  let app;
  beforeAll(async () => {
    app = (await import('../../server.js')).default;
  });

  it('answers the eleventh attempt with the 429 envelope and its own sentence', async () => {
    let last;
    for (let i = 0; i < 11; i += 1) last = await request(app).post('/api/login').send({ password: 'x' });
    expect(last.status).toBe(429);
    expect(last.body.code).toBe('rate_limited');
    expect(last.body.error).toBe('Too many login attempts, please try again later.');
    expect(last.body.action).toBe('Wait a few minutes, then try again.');
    expect(last.body.requestId).toBe(last.headers['x-request-id']);
    expect(last.headers['cache-control']).toBe('no-store');
  });
});
