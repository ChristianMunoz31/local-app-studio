// POST /api/assistant/advice through the real server.js with generateAdvice/streamAdvice mocked and
// a fake Ollama behind node-fetch (the route resolves the chat client before calling the service).
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../loadEnv.js', () => ({}));
vi.mock('../assistant/advisorService.js', () => ({ generateAdvice: vi.fn(), streamAdvice: vi.fn() }));
vi.mock('node-fetch', () => ({ default: vi.fn() }));

import fetch from 'node-fetch';
import { generateAdvice, streamAdvice } from '../assistant/advisorService.js';
import { installFakeOllama } from './helpers/fakeOllama.js';
import { __resetAiForTests } from '../ai/index.js';

const SENTINEL = `gsk_SENTINEL${'7'.repeat(24)}`;
const URL_PATH = '/api/assistant/advice';

let app;
let logs;
let ipCounter = 0;
const nextIp = () => `198.51.100.${(ipCounter += 1)}`;

const savedEncKey = process.env.SECRETS_ENCRYPTION_KEY;
afterAll(() => {
  if (savedEncKey === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
  else process.env.SECRETS_ENCRYPTION_KEY = savedEncKey;
});

beforeAll(async () => {
  delete process.env.SECRETS_ENCRYPTION_KEY;
  delete process.env.APP_PASSWORD;
  delete process.env.AUTH_SECRET;
  app = (await import('../../server.js')).default;
});

beforeEach(() => {
  generateAdvice.mockReset();
  streamAdvice.mockReset();
  delete process.env.APP_AI;
  __resetAiForTests();
  fetch.mockReset();
  installFakeOllama(fetch);
  logs = [
    vi.spyOn(console, 'error').mockImplementation(() => {}),
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
    vi.spyOn(console, 'log').mockImplementation(() => {}),
  ];
});

afterEach(() => {
  vi.restoreAllMocks();
});

const logged = () => JSON.stringify(logs.map((l) => l.mock.calls));
const post = (body, ip = nextIp()) => request(app).post(URL_PATH).set('X-Forwarded-For', ip).send(body);

describe('POST /api/assistant/advice', () => {
  it('returns { data } with no-store and passes the validated value to generateAdvice', async () => {
    generateAdvice.mockResolvedValue({ content: '- Do the thing', model: 'm1', provider: 'ollama', extra: 'dropped' });
    const res = await post({
      page: 'settings',
      pageLabel: 'Evil',
      context: '{"a":1}',
      messages: [{ role: 'user', content: 'hi', junk: true }],
    });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ data: { content: '- Do the thing', model: 'm1', provider: 'ollama' } });
    expect(generateAdvice).toHaveBeenCalledTimes(1);
    expect(generateAdvice).toHaveBeenCalledWith(
      {
        page: 'settings',
        pageLabel: 'Settings',
        context: '{"a":1}',
        messages: [{ role: 'user', content: 'hi' }],
      },
      { client: expect.objectContaining({ provider: 'ollama', model: 'qwen2.5:3b' }), signal: expect.any(AbortSignal) },
    );
  });

  it.each([
    ['unknown page', { page: 'nope' }, 400, 'unknown_page'],
    ['non-string context', { page: 'settings', context: 5 }, 400, 'invalid_context'],
    ['oversized context', { page: 'settings', context: 'x'.repeat(4001) }, 413, 'context_too_large'],
    ['bad role', { page: 'settings', messages: [{ role: 'system', content: 'x' }] }, 400, 'invalid_messages'],
    [
      'too many messages',
      { page: 'settings', messages: Array.from({ length: 13 }, () => ({ role: 'user', content: 'x' })) },
      413,
      'too_many_messages',
    ],
    ['long message', { page: 'settings', messages: [{ role: 'user', content: 'x'.repeat(4001) }] }, 413, 'message_too_long'],
  ])('rejects %s with the error envelope and never calls generateAdvice', async (_n, body, status, code) => {
    const res = await post(body);
    expect(res.status).toBe(status);
    expect(Object.keys(res.body).sort()).toEqual(['action', 'code', 'error', 'message', 'requestId']);
    expect(res.body.code).toBe(code);
    expect(typeof res.body.code).toBe('string');
    expect(generateAdvice).not.toHaveBeenCalled();
  });

  it('rejects an array body with 400 invalid_request', async () => {
    const res = await post([1, 2]);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_request');
    expect(generateAdvice).not.toHaveBeenCalled();
  });

  it('answers a body over 2 MB with 413 request_too_large and never logs it', async () => {
    const res = await request(app)
      .post(URL_PATH)
      .set('X-Forwarded-For', nextIp())
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ page: 'settings', context: SENTINEL + 'x'.repeat(3 * 1024 * 1024) }));
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ code: 'request_too_large' });
    expect(res.text).not.toContain(SENTINEL);
    expect(logged()).not.toContain(SENTINEL);
    expect(generateAdvice).not.toHaveBeenCalled();
  });

  it('answers malformed JSON with 400 invalid_body', async () => {
    const res = await request(app)
      .post(URL_PATH)
      .set('X-Forwarded-For', nextIp())
      .set('Content-Type', 'application/json')
      .send('{"page": "settings"');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'invalid_body' });
  });

  it('passes service errors through (status, code, publicMessage, retryAfterMs)', async () => {
    generateAdvice.mockRejectedValue(
      Object.assign(new Error('internal detail'), {
        httpStatus: 429,
        code: 'minute',
        publicMessage: 'Rate limited, try later.',
        retryAfterMs: 8000,
      }),
    );
    const res = await post({ page: 'settings' });
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: 'Rate limited, try later.', code: 'minute', retryAfterMs: 8000 });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).not.toContain('internal detail');
  });

  it('omits retryAfterMs when it is not finite', async () => {
    generateAdvice.mockRejectedValue(
      Object.assign(new Error('x'), { httpStatus: 502, code: 'unavailable', publicMessage: 'Upstream down.', retryAfterMs: null }),
    );
    const res = await post({ page: 'settings' });
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: 'Upstream down.', code: 'unavailable' });
    expect(res.body).not.toHaveProperty('retryAfterMs');
  });

  it('answers the shared ai_not_configured contract when AI is turned off, before calling the service', async () => {
    process.env.APP_AI = '0';
    const res = await post({ page: 'settings' });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'ai_not_configured', reason: 'ai_disabled', message: 'AI is turned off.' });
    expect(generateAdvice).not.toHaveBeenCalled();
  });

  it('answers 503 ollama_unavailable as JSON (even when a stream was asked for) when Ollama is down', async () => {
    installFakeOllama(fetch, { down: true });
    const res = await post({ page: 'settings' }).set('Accept', 'text/event-stream');
    expect(res.status).toBe(503);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.code).toBe('ollama_unavailable');
    expect(streamAdvice).not.toHaveBeenCalled();
  });

  it('streams delta events then done { content, model, provider } with Accept: text/event-stream', async () => {
    streamAdvice.mockImplementation(async (_value, { onDelta }) => {
      onDelta('- Do ');
      onDelta('the thing');
      return { content: '- Do the thing', model: 'qwen2.5:3b', provider: 'ollama' };
    });
    const res = await post({ page: 'settings' }).set('Accept', 'text/event-stream');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.text).toContain('event: delta\ndata: {"content":"- Do "}');
    expect(res.text).toContain('event: done\ndata: {"content":"- Do the thing","model":"qwen2.5:3b","provider":"ollama"}');
    expect(generateAdvice).not.toHaveBeenCalled();
  });

  it('streams a user-safe error event when the service fails mid-stream', async () => {
    streamAdvice.mockRejectedValue(
      Object.assign(new Error(`leak ${SENTINEL}`), { httpStatus: 504, code: 'timeout', publicMessage: 'Assistant took too long to answer. Try again.' }),
    );
    const res = await post({ page: 'settings' }).set('Accept', 'text/event-stream');
    const sent = res.text.split('event: error\ndata: ')[1]?.split('\n')[0] ?? '';
    expect(JSON.parse(sent)).toMatchObject({
      error: 'Assistant took too long to answer. Try again.',
      code: 'timeout',
      action: expect.any(String),
      requestId: expect.stringMatching(/^[0-9a-f]{16}$/),
    });
    expect(res.text).not.toContain(SENTINEL);
  });

  it.each([
    [504, 'timeout'],
    [502, 'unavailable'],
  ])('maps httpStatus %i / code %s', async (httpStatus, code) => {
    generateAdvice.mockRejectedValue(Object.assign(new Error('x'), { httpStatus, code, publicMessage: 'Safe text.' }));
    const res = await post({ page: 'settings' });
    expect(res.status).toBe(httpStatus);
    expect(res.body).toMatchObject({ error: 'Safe text.', code });
  });

  it('does not trust status/code on errors without a string publicMessage', async () => {
    generateAdvice.mockRejectedValue(Object.assign(new Error('x'), { httpStatus: 418, code: 'teapot', retryAfterMs: 5 }));
    const res = await post({ page: 'settings' });
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: 'Failed to get advice', code: 'server_error' });
  });

  it('clamps retryAfterMs to [0, 60000]', async () => {
    const mk = (retryAfterMs) =>
      Object.assign(new Error('x'), { httpStatus: 429, code: 'minute', publicMessage: 'Slow down.', retryAfterMs });
    generateAdvice.mockRejectedValueOnce(mk(9000000));
    expect((await post({ page: 'settings' })).body.retryAfterMs).toBe(60000);
    generateAdvice.mockRejectedValueOnce(mk(-5));
    expect((await post({ page: 'settings' })).body.retryAfterMs).toBe(0);
  });

  it('falls back to 500 when httpStatus is missing or below 400', async () => {
    generateAdvice.mockRejectedValue(Object.assign(new Error('x'), { httpStatus: 200, publicMessage: 'Oops.' }));
    const res = await post({ page: 'settings' });
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: 'Oops.', code: 'server_error' });
  });

  it('maps an unexpected error to a generic 500 with no secrets in the response or logs', async () => {
    generateAdvice.mockRejectedValue(new Error(`boom ${SENTINEL}`));
    const res = await post({ page: 'settings', context: 'ctx-secret-context', messages: [{ role: 'user', content: 'private question' }] });
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: 'Failed to get advice', code: 'server_error' });
    expect(res.text).not.toContain(SENTINEL);
    expect(logged()).not.toContain(SENTINEL);
    expect(logged()).not.toContain('ctx-secret-context');
    expect(logged()).not.toContain('private question');
  });
});

describe('rate limiter wiring', () => {
  it('shares the strict /api/assistant limiter: 20 ok, 21st is 429, and POST /api/assistant is also 429', async () => {
    generateAdvice.mockResolvedValue({ content: 'ok', model: 'm', provider: 'p' });
    const ip = '203.0.113.50';
    for (let i = 0; i < 20; i += 1) {
      const res = await post({ page: 'settings' }, ip);
      expect(res.status).toBe(200);
    }
    const limited = await post({ page: 'settings' }, ip);
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ error: 'Too many requests, please try again later.', code: 'rate_limited' });

    const assistant = await request(app).post('/api/assistant').set('X-Forwarded-For', ip).send({ message: 'hi' });
    expect(assistant.status).toBe(429);
    expect(assistant.body.code).toBe('rate_limited');
    expect(generateAdvice).toHaveBeenCalledTimes(20);
  });

  it('counts path variants (case, trailing slash) against the same strict counter', async () => {
    generateAdvice.mockResolvedValue({ content: 'ok', model: 'm', provider: 'p' });
    const ip = '203.0.113.51';
    const paths = [URL_PATH, '/API/ASSISTANT/ADVICE', '/api/assistant/advice/', URL_PATH];
    for (let i = 0; i < 20; i += 1) {
      const res = await request(app).post(paths[i % paths.length]).set('X-Forwarded-For', ip).send({ page: 'settings' });
      expect(res.status).toBe(200);
    }
    for (const p of paths) {
      const res = await request(app).post(p).set('X-Forwarded-For', ip).send({ page: 'settings' });
      expect(res.status).toBe(429);
      expect(res.body.code).toBe('rate_limited');
    }
    expect(generateAdvice).toHaveBeenCalledTimes(20);
  });
});
