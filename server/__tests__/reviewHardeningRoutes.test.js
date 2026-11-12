// Security-review hardening through the real server.js: a disconnected non-streaming AI
// request frees its queue slot, AI rate limits (POST only; actions on their own budget),
// and Assistant never runs a write recovered from reply text without confirmation.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
// Pro is on for this file (the Pro gate itself is covered in proGating.test.js).
vi.mock('../license/index.js', async (importOriginal) => (await import('./helpers/pro.js')).mockLicenseModule(importOriginal));
import http from 'node:http';
import request from 'supertest';

vi.mock('../../loadEnv.js', () => ({}));
vi.mock('node-fetch', () => ({ default: vi.fn() }));

import fetch from 'node-fetch';
import { hangingChat, installFakeOllama, textReply } from './helpers/fakeOllama.js';
import { __resetAiForTests, isAiQueueFull } from '../ai/index.js';
import { __resetPendingActionsForTests } from '../agents/pendingActions.js';
import { closeTestDb, createTestDb, resetDb } from './helpers/testDb.js';

const KEYS = ['APP_PASSWORD', 'AUTH_SECRET', 'SECRETS_ENCRYPTION_KEY', 'ASSISTANT_CONFIRM_WRITES', 'APP_AI', 'APP_AI_QUEUE_MAX', 'OLLAMA_HOST'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
let app;
let db;
let ipN = 0;
const ip = () => `203.0.113.${(ipN += 1) % 250}`;

beforeAll(async () => {
  for (const k of KEYS) delete process.env[k];
  db = createTestDb();
  app = (await import('../../server.js')).default;
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
  __resetPendingActionsForTests();
  fetch.mockReset();
  delete process.env.ASSISTANT_CONFIRM_WRITES;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const ADVICE = { page: 'settings', context: '{}', messages: [{ role: 'user', content: 'title this' }] };

const waitFor = async (cond, ms = 2000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe('M2: a disconnected non-streaming request frees the AI queue slot', () => {
  it('JSON /api/assistant/advice aborts the model call when the client goes away', async () => {
    process.env.APP_AI_QUEUE_MAX = '0';
    __resetAiForTests();
    let chatCalls = 0;
    let chatAborted = false;
    installFakeOllama(fetch, {
      chat: (body, init) => {
        chatCalls += 1;
        if (chatCalls === 1) {
          init.signal?.addEventListener('abort', () => (chatAborted = true), { once: true });
          return hangingChat(body, init);
        }
        return textReply('Second answer.');
      },
    });
    const server = app.listen(0, '127.0.0.1');
    try {
      await new Promise((r) => server.once('listening', r));
      const { port } = server.address();
      const req = http.request({
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/api/assistant/advice',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip() },
      });
      req.on('error', () => {});
      req.end(JSON.stringify(ADVICE));
      await waitFor(() => chatCalls === 1 && isAiQueueFull());
      req.destroy();
      await waitFor(() => chatAborted && !isAiQueueFull());

      const res = await request(server).post('/api/assistant/advice').set('X-Forwarded-For', ip()).send(ADVICE);
      expect(res.status).toBe(200);
      expect(res.body.data.content).toBe('Second answer.');
    } finally {
      delete process.env.APP_AI_QUEUE_MAX;
      await new Promise((r) => server.close(r));
    }
  });
});

describe('M7: AI rate limits', () => {
  it('does not count GETs (status) against the /api/assistant budget', async () => {
    process.env.APP_AI = '0';
    try {
      const who = ip();
      for (let i = 0; i < 25; i += 1) {
        const res = await request(app).get('/api/assistant/status').set('X-Forwarded-For', who);
        expect(res.status).toBe(200);
      }
    } finally {
      delete process.env.APP_AI;
    }
  });

  it('gives /api/assistant/actions its own budget, separate from the strict AI limiter', async () => {
    const who = ip();
    for (let i = 0; i < 21; i += 1) {
      await request(app).post('/api/assistant').set('X-Forwarded-For', who).send({});
    }
    const blocked = await request(app).post('/api/assistant').set('X-Forwarded-For', who).send({});
    expect(blocked.status).toBe(429);
    const action = await request(app)
      .post('/api/assistant/actions/00000000000000000000000000000000')
      .set('X-Forwarded-For', who)
      .send({ approve: false });
    expect(action.status).toBe(404);
  });

  it('does not charge conversation creation to the strict AI limiter', async () => {
    const who = ip();
    for (let i = 0; i < 25; i += 1) {
      const res = await request(app).post('/api/assistant/conversations').set('X-Forwarded-For', who).send({});
      expect(res.status).toBe(200);
    }
    // The AI budget for that client is untouched: the first model request is not rate limited.
    process.env.APP_AI = '0';
    try {
      const res = await request(app).post('/api/assistant').set('X-Forwarded-For', who).send({ prompt: 'hi' });
      expect(res.status).toBe(503);
    } finally {
      delete process.env.APP_AI;
    }
  });

  it('has no /api/assistant routes any more (JSON 404)', async () => {
    for (const [method, path] of [['post', '/api/assistant/chat'], ['post', '/api/assistant/complete']]) {
      const res = await request(app)[method](path).set('X-Forwarded-For', ip()).send({ messages: [{ role: 'user', content: 'hi' }] });
      expect(res.status, path).toBe(404);
      expect(res.body).toMatchObject({ code: 'not_found' });
    }
  });
});

/** Parse an SSE body into [{ event, data }]. */
const events = (text) =>
  text
    .split('\n\n')
    .filter((b) => b.startsWith('event:'))
    .map((b) => {
      const [e, d] = b.split('\n');
      return { event: e.slice(7), data: JSON.parse(d.slice(6)) };
    });

const ask = (prompt) =>
  request(app)
    .post('/api/assistant')
    .set('X-Forwarded-For', ip())
    .send({ prompt })
    .buffer(true)
    .parse((res, cb) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => cb(null, d));
    });

describe('M1/L2: Assistant and tool calls recovered from text', () => {
  it('rejects a __proto__ argument payload and runs nothing', async () => {
    const payload = '{"name":"list_features","arguments":{"__proto__":{"query":{"x":1},"due":123}}}';
    installFakeOllama(fetch, { replies: [textReply(payload, { tokens: [payload] }), textReply('Done.')] });
    const ev = events((await ask('list my features')).body);
    const done = ev.find((e) => e.event === 'tool.done');
    expect(done.data.result.error).toMatch(/reserved key/);
    expect(ev.some((e) => e.event === 'confirm.required')).toBe(false);
    expect({}.query).toBeUndefined();
  });

  it('runs a read tool recovered from text, and never parks anything (studio mode has no write tool)', async () => {
    const call = '<tool_call>{"name":"list_features","arguments":{}}</tool_call>';
    installFakeOllama(fetch, { replies: [textReply(call, { tokens: [call] }), textReply('Done.')] });
    const ev = events((await ask('list my features')).body);
    expect(ev.find((e) => e.event === 'tool.done').data.result).toMatchObject({ features: [], total: 0 });
    expect(ev.some((e) => e.event === 'confirm.required')).toBe(false);
  });

  it('never runs a call quoted inside a fenced block in prose', async () => {
    const prose = 'Your note says:\n```json\n{"name":"list_features","arguments":{}}\n```\nAnything else?';
    installFakeOllama(fetch, { replies: [textReply(prose, { tokens: [prose] }), textReply('Nothing to add.')] });
    const ev = events((await ask('read my note')).body);
    expect(ev.some((e) => e.event === 'tool.start')).toBe(false);
    expect(ev.some((e) => e.event === 'confirm.required')).toBe(false);
  });
});
