// The /api/data rate budget: the global limiter skips it and the runtime module's own limiter counts it instead.
import express from 'express';
import rateLimit from 'express-rate-limit';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetAppModeCache } from '../../appMode.js';
import { isModuleBudgetPath, mountModuleAiLimiters, mountModuleLimiters } from '../../modules/index.js';

const reqFor = (url) => {
  const [baseUrl, ...rest] = ['/api', url.slice('/api'.length)];
  return { baseUrl, path: rest.join('') };
};

describe('isModuleBudgetPath (runtime mode)', () => {
  it.each([
    ['/api/data', true],
    ['/api/data/', true],
    ['/api/data/crews', true],
    ['/api/data/crews/abc/stats', true],
    ['/API/Data/Crews', true],
    ['/api/dataset', false],
    ['/api/database', false],
    ['/api/state', false],
    ['/api/assistant', false],
    ['/api', false],
  ])('%s -> %s', (url, expected) => {
    expect(isModuleBudgetPath(reqFor(url), 'runtime')).toBe(expected);
  });

  it('reads baseUrl plus path, like the global limiter mounted at /api sees a request', () => {
    expect(isModuleBudgetPath({ baseUrl: '/api', path: '/data/x' }, 'runtime')).toBe(true);
    expect(isModuleBudgetPath({ baseUrl: '', path: '/api/data/x' }, 'runtime')).toBe(true);
    expect(isModuleBudgetPath({}, 'runtime')).toBe(false);
  });

  it('has no budget paths in studio mode', () => {
    expect(isModuleBudgetPath(reqFor('/api/data/crews'), 'studio')).toBe(false);
  });
});

describe('global limiter skip plus the module limiter (runtime mode)', () => {
  const saved = process.env.APP_MODE;
  beforeEach(() => {
    process.env.APP_MODE = 'runtime';
    resetAppModeCache();
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = saved;
    resetAppModeCache();
  });

  const makeApp = () => {
    const app = express();
    const globalLimiter = rateLimit({
      windowMs: 60_000,
      max: 2,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => isModuleBudgetPath(req),
      message: { error: 'Too many requests, please try again later.', code: 'rate_limited' },
    });
    app.use('/api', globalLimiter);
    mountModuleLimiters(app, rateLimit);
    app.use('/api', (req, res) => res.json({ ok: true }));
    return app;
  };

  it('counts other /api paths against the global cap but not /api/data', async () => {
    const app = makeApp();
    for (let i = 0; i < 8; i += 1) expect((await request(app).get('/api/data/crews')).status).toBe(200);
    expect((await request(app).get('/api/state')).status).toBe(200);
    expect((await request(app).get('/api/state')).status).toBe(200);
    const blocked = await request(app).get('/api/state');
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'Too many requests, please try again later.', code: 'rate_limited' });
    expect((await request(app).get('/api/data/crews')).status).toBe(200);
  });

  it('gives /api/data its own 3000 per 15 minutes budget (reported in the rate limit headers)', async () => {
    const res = await request(makeApp()).get('/api/data/crews');
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-policy']).toMatch(/^3000;w=900/);
  });
});

describe('mountModuleAiLimiters', () => {
  it('mounts one limiter per AI POST path of the active modules (Studio Describe)', () => {
    const app = express();
    const paths = [];
    mountModuleAiLimiters(app, (path) => {
      paths.push(path);
      return (req, res, next) => next();
    });
    expect(paths).toEqual(['/api/studio/apps/:id/describe']);
  });
});
