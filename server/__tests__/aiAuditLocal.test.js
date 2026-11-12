// Audit through the real server.js with NOTHING in the AI path mocked except the network: a fake
// Ollama behind node-fetch serves the model calls, the real audit sink writes to a real temp
// SQLite database. Each user request records exactly one llm row naming provider 'ollama', the
// local model that served it and a redacted, capped context, plus call count metadata.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
// Pro is on for this file (the Pro gate itself is covered in proGating.test.js).
vi.mock('../license/index.js', async (importOriginal) => (await import('./helpers/pro.js')).mockLicenseModule(importOriginal));
import request from 'supertest';

vi.mock('../../loadEnv.js', () => ({}));
vi.mock('node-fetch', () => ({ default: vi.fn() }));

import fetch from 'node-fetch';
import { installFakeOllama, textReply, toolReply } from './helpers/fakeOllama.js';
import { __resetAiForTests } from '../ai/index.js';
import { logAudit, resetAuditState } from '../audit.js';
import { setAuditSink } from '../auditHook.js';
import { closeTestDb, createTestDb, resetDb, rowsOf } from './helpers/testDb.js';

const CHAT = 'qwen2.5:3b';
const TOOLS = 'qwen2.5:7b';
const SECRET = 'gsk_AUDITSENTINEL0123456789abcdefghij';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYXVkaXQifQ.AUDITSENTINELsig0123456789';
const EMAIL = 'someone@example.com';
const ENV_KEYS = ['APP_PASSWORD', 'AUTH_SECRET', 'SECRETS_ENCRYPTION_KEY', 'APP_AI', 'OLLAMA_HOST'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

let app;
let db;
let ip = 0;
const nextIp = () => `198.51.100.${(ip += 1) % 250}`;
const sseParser = (res, cb) => {
  let d = '';
  res.on('data', (c) => (d += c));
  res.on('end', () => cb(null, d));
};
const post = (path, body, headers = {}) =>
  request(app).post(path).set('X-Forwarded-For', nextIp()).set(headers).send(body).buffer(true).parse(sseParser);
const rows = () => rowsOf(db, 'audit_log');
const metaOf = (row) => (typeof row.meta === 'string' ? JSON.parse(row.meta) : row.meta);

beforeAll(async () => {
  for (const k of ENV_KEYS) delete process.env[k];
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
  resetAuditState();
  resetDb(db);
  setAuditSink(logAudit);
  delete process.env.APP_AI;
  __resetAiForTests();
  fetch.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const CASES = [
  {
    name: 'POST /api/assistant/advice (JSON)',
    feature: 'assistant_advice',
    page: 'settings',
    model: CHAT,
    fire: () =>
      post('/api/assistant/advice', {
        page: 'settings',
        context: JSON.stringify({ note: `token ${JWT}`, apiKey: 'plain-api-key-zzz' }),
        messages: [{ role: 'user', content: `key ${SECRET} mail ${EMAIL}` }],
      }),
    secrets: [SECRET, JWT, EMAIL, 'plain-api-key-zzz'],
  },
  {
    name: 'POST /api/assistant/advice (SSE)',
    feature: 'assistant_advice',
    page: 'settings',
    model: CHAT,
    fire: () =>
      post(
        '/api/assistant/advice',
        { page: 'settings', context: '{"open":1}', messages: [{ role: 'user', content: `key ${SECRET}` }] },
        { Accept: 'text/event-stream' },
      ),
    secrets: [SECRET],
  },
  {
    name: 'POST /api/assistant (tool model)',
    feature: 'assistant',
    model: TOOLS,
    fire: () => post('/api/assistant', { prompt: `list my features, my key is ${SECRET}` }),
    secrets: [SECRET],
    minCalls: 2,
  },
  {
    name: 'POST /api/assistant with a page hint (tool model)',
    feature: 'assistant',
    page: 'settings',
    model: TOOLS,
    fire: () => post('/api/assistant', { prompt: `list my features, my key is ${SECRET}`, page: 'settings' }),
    secrets: [SECRET],
    minCalls: 2,
  },
];

describe('one audit row per AI request, naming the local provider and model', () => {
  it.each(CASES)('$name', async ({ feature, page, model, fire, secrets, minCalls = 1 }) => {
    installFakeOllama(fetch, {
      chat: (body) =>
        Array.isArray(body.tools) && body.tools.length && !body.messages.some((m) => m.role === 'tool')
          ? toolReply([{ name: 'list_features', arguments: {} }])
          : textReply('Here you go, friend.'),
    });
    const res = await fire();
    expect(res.status).toBe(200);

    // The audit write may land just after the response closes (SSE routes audit after streaming).
    await vi.waitFor(() => expect(rows()).toHaveLength(1));
    const [row] = rows();
    expect(row).toMatchObject({ kind: 'llm', feature, provider: 'ollama', model, status: 'ok' });
    if (page) expect(row.page).toBe(page);
    const meta = metaOf(row);
    expect(meta.calls).toBeGreaterThanOrEqual(minCalls);
    expect(Number(meta.ms)).toBeGreaterThanOrEqual(0);

    const stored = JSON.stringify(row);
    for (const s of secrets) expect(stored, `row leaked ${s}`).not.toContain(s);
    expect(stored).not.toMatch(/AUDITSENTINEL/);
    expect((row.context ?? '').length).toBeLessThanOrEqual(2000);
    for (const bad of ['gsk_', 'Authorization', 'X-Forwarded-For']) expect(stored).not.toContain(bad);
  });

  it('records the user prompt in the context rather than the model output', async () => {
    installFakeOllama(fetch, { chat: () => textReply('MODEL-OUTPUT-MARKER') });
    await post('/api/assistant', { prompt: 'what should I cook tonight', page: 'settings' });
    await vi.waitFor(() => expect(rows()).toHaveLength(1));
    // The page hint reaches the model only; the audit context is the bare prompt.
    expect(rows()[0].context).toBe('what should I cook tonight');
    expect(rows()[0].page).toBe('settings');
    expect(JSON.stringify(rows()[0])).not.toContain('MODEL-OUTPUT-MARKER');
  });

  it('a failing local model records status error once, with provider and model, and no provider text', async () => {
    installFakeOllama(fetch, {
      chat: () => ({ ok: false, status: 500, text: async () => 'upstream boom SECRETBODY', headers: { get: () => null } }),
    });
    const res = await post('/api/assistant', { prompt: 'hello' });
    expect(JSON.stringify(res.body)).not.toContain('SECRETBODY');
    await vi.waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0]).toMatchObject({ kind: 'llm', feature: 'assistant', provider: 'ollama', model: TOOLS, status: 'error' });
    expect(JSON.stringify(rows()[0])).not.toContain('SECRETBODY');
  });

  it('AI turned off (503) and rejected input write no row', async () => {
    installFakeOllama(fetch);
    const bad = await post('/api/assistant', { prompt: '   ' });
    expect(bad.status).toBe(400);
    const unknownPage = await post('/api/assistant', { prompt: 'hello', page: 'nope' });
    expect(unknownPage.status).toBe(400);
    process.env.APP_AI = '0';
    const off = await post('/api/assistant', { prompt: 'hello' });
    expect(off.status).toBe(503);
    expect(rows()).toHaveLength(0);
  });

  it('a long context is capped at 2000 characters in the stored row', async () => {
    installFakeOllama(fetch, { chat: () => textReply('ok') });
    await post('/api/assistant', { prompt: 'x'.repeat(4000) });
    await vi.waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0].context.length).toBeLessThanOrEqual(2000);
  });
});
