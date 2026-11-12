// Through the real server.js: with AI turned off (APP_AI=0) every AI route answers the shared
// ai_not_configured contract before streaming and without any outbound call; with Ollama down
// it answers 503 ollama_unavailable as JSON (never an event stream). Every feature route that calls
// the internet answers network_opt_in_required. Also: no cron route, gate order.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
// Pro is on for this file (the Pro gate itself is covered in proGating.test.js).
vi.mock('../license/index.js', async (importOriginal) => (await import('./helpers/pro.js')).mockLicenseModule(importOriginal));
import request from 'supertest';

vi.mock('../../loadEnv.js', () => ({}));
vi.mock('node-fetch', () => ({ default: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })) }));

import fetch from 'node-fetch';

const AI_BODY = { code: 'ai_not_configured', reason: 'ai_disabled', error: 'AI is turned off.', message: 'AI is turned off.' };
const KEYS = [
  'APP_AI',
  'OLLAMA_HOST',
  'AI_CLOUD_API_KEY',
  'APP_PASSWORD',
  'AUTH_SECRET',
  'SECRETS_ENCRYPTION_KEY',
  'APP_NETWORK_OPTIN',
];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

let app;
let n = 0;
const ip = () => `198.51.100.${(n += 1)}`;
const post = (path, body) => request(app).post(path).set('X-Forwarded-For', ip()).send(body);
const get = (path) => request(app).get(path).set('X-Forwarded-For', ip());

beforeAll(async () => {
  for (const k of KEYS) delete process.env[k];
  app = (await import('../../server.js')).default;
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
beforeEach(async () => {
  fetch.mockClear();
  vi.stubGlobal('fetch', vi.fn());
  (await import('../ai/index.js')).__resetAiForTests();
});

const messages = [{ role: 'user', content: 'hi' }];
const AI_ROUTES = [
  ['/api/assistant', { prompt: 'what is due today' }],
  ['/api/assistant', { prompt: 'what is due today', page: 'settings' }],
  ['/api/assistant/advice', { page: 'settings', context: '{}', messages }],
];
// Confirming a proposed change runs no model: gated by APP_AI only, never by Ollama health.
const ACTIONS_ROUTE = ['/api/assistant/actions/00000000000000000000000000000000', { approve: true }];

describe('AI routes with AI turned off (APP_AI=0)', () => {
  beforeEach(() => {
    process.env.APP_AI = '0';
  });
  afterEach(() => {
    delete process.env.APP_AI;
  });

  it.each([...AI_ROUTES, ACTIONS_ROUTE])('POST %s answers 503 ai_not_configured as JSON and calls nothing', async (path, body) => {
    const res = await post(path, body);
    expect(res.status).toBe(503);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toMatchObject(AI_BODY);
    expect(fetch).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('keeps the status endpoints honest about availability', async () => {
    for (const path of ['/api/assistant/status']) {
      expect((await get(path)).body).toMatchObject({
        available: false,
        provider: 'ollama',
        model: null,
        code: 'ai_not_configured',
        reason: 'ai_disabled',
      });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('AI routes with Ollama not running', () => {
  beforeEach(() => {
    fetch.mockImplementation(async () => {
      throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), { code: 'ECONNREFUSED' });
    });
  });
  afterEach(() => {
    fetch.mockReset();
    fetch.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  });

  it.each(AI_ROUTES)('POST %s answers 503 ollama_unavailable as JSON, not a stream', async (path, body) => {
    const res = await post(path, body);
    expect(res.status).toBe(503);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['content-type']).not.toMatch(/event-stream/);
    expect(res.body.code).toBe('ollama_unavailable');
    expect(res.body.reason).toBe('ollama_unavailable');
    expect(res.body.message).toMatch(/can't reach Ollama at http:\/\/127\.0\.0\.1:11434/);
    for (const [url] of fetch.mock.calls) expect(String(url)).toMatch(/^http:\/\/127\.0\.0\.1:11434\/api\//);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('confirming a change does not probe Ollama: an unknown token is a plain 404', async () => {
    const [path, body] = ACTIONS_ROUTE;
    const res = await post(path, body);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('action_not_found');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports reason ollama_unavailable on the status endpoints', async () => {
    const res = await get('/api/assistant/status');
    expect(res.body).toMatchObject({ available: false, code: 'ollama_unavailable', reason: 'ollama_unavailable' });
  });
});

describe('feature routes that call the internet, while opted out', () => {
  it('GET /api/settings/updates/check is 403 network_opt_in_required and makes no request', async () => {
    const res = await get('/api/settings/updates/check');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'network_opt_in_required', feature: 'updates' });
    expect(typeof res.body.message).toBe('string');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('pre-enabling through APP_NETWORK_OPTIN opens the route', async () => {
    process.env.APP_NETWORK_OPTIN = 'updates';
    try {
      const res = await get('/api/settings/updates/check');
      expect(res.status).toBe(200);
      expect(res.body.code).not.toBe('network_opt_in_required');
    } finally {
      delete process.env.APP_NETWORK_OPTIN;
    }
  });
});

describe('removed hosting routes', () => {
  it('has no cron endpoint', async () => {
    expect((await get('/api/cron/daily')).status).toBe(404);
  });

  it('answers unmatched API paths with a JSON 404, not the app shell', async () => {
    const res = await get('/api/not-a-route');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toMatchObject({ code: 'not_found' });
  });
});
