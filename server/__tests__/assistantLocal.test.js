// Assistant on the local tool model, through the real server.js and a real temp database, with a
// scripted fake Ollama behind node-fetch: delta streaming, tool validation, text-embedded
// tool calls, the one corrective retry and POST /api/assistant/actions. Studio mode has one read tool
// (list_features) and no write tool; the write-confirmation flow is covered in runtime/assistantRuntime.test.js.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../loadEnv.js', () => ({}));
vi.mock('node-fetch', () => ({ default: vi.fn() }));

import fetch from 'node-fetch';
import { installFakeOllama, textReply, toolReply } from './helpers/fakeOllama.js';
import { __resetAiForTests } from '../ai/index.js';
import { __resetPendingActionsForTests } from '../agents/pendingActions.js';
import { runAssistant } from '../agents/assistantAgent.js';
import { getAiClient } from '../ai/index.js';
import { SEED_FEATURES } from '../../src/catalog/features/index.ts';
import { createFeature } from '../studio/features/store.js';
import { closeTestDb, createTestDb, resetDb, rowsOf } from './helpers/testDb.js';

let app;
let db;
let ip = 0;
const nextIp = () => `198.51.100.${(ip += 1) % 250}`;
const saved = Object.fromEntries(['APP_PASSWORD', 'AUTH_SECRET', 'SECRETS_ENCRYPTION_KEY', 'ASSISTANT_CONFIRM_WRITES', 'APP_AI'].map((k) => [k, process.env[k]]));

beforeAll(async () => {
  for (const k of Object.keys(saved)) delete process.env[k];
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

/** Parse an SSE body into [{ event, data }]. */
const events = (text) =>
  text
    .split('\n\n')
    .filter((b) => b.startsWith('event:'))
    .map((b) => {
      const [e, d] = b.split('\n');
      return { event: e.slice(7), data: JSON.parse(d.slice(6)) };
    });

const ask = (prompt, extra = {}) =>
  request(app).post('/api/assistant').set('X-Forwarded-For', nextIp()).send({ prompt, ...extra }).buffer(true).parse((res, cb) => {
    let d = '';
    res.on('data', (c) => (d += c));
    res.on('end', () => cb(null, d));
  });

const seedFeatures = () => {
  for (const id of ['kpi_row', 'search_list']) {
    const def = structuredClone(SEED_FEATURES.find((f) => f.id === id));
    delete def.version;
    delete def.updatedAt;
    createFeature(def);
  }
};

describe('POST /api/assistant', () => {
  it('runs a read tool, streams deltas, and finishes with sanitized final content', async () => {
    seedFeatures();
    const fake = installFakeOllama(fetch, {
      replies: [toolReply([{ name: 'list_features', arguments: {} }]), textReply('You have 2 features, Number row and Search list. Total: $1234.5.')],
    });
    const res = await ask("what features do I have, is the total 1234.5?");
    expect(res.status).toBe(200);
    const ev = events(res.body);
    const types = ev.map((e) => e.event);
    expect(types[0]).toBe('meta');
    expect(ev[0].data).toEqual({ type: 'meta', ai: { kind: 'local', host: null } });
    expect(types[1]).toBe('thinking');
    expect(types).toContain('tool.start');
    expect(types).toContain('delta');
    const final = ev.find((e) => e.event === 'final').data.content;
    expect(final).toBe('You have 2 features, Number row and Search list. Total: $1,234.50.');
    const deltas = ev.filter((e) => e.event === 'delta' && e.data.round === 1).map((e) => e.data.content).join('');
    expect(deltas.trim()).toBe(final);
    expect(ev.find((e) => e.event === 'tool.done').data.result.features).toHaveLength(2);
    expect(ev.at(-1)).toMatchObject({ event: 'run.done', data: { model: 'qwen2.5:7b', writes: 0, pending: 0 } });
    // The second round carries the tool result back as a named tool message.
    expect(fake.chatBodies[1].messages.at(-1)).toMatchObject({ role: 'tool', tool_name: 'list_features' });
    expect(fake.chatBodies[0].tools.map((t) => t.function.name)).toEqual(['list_features']);
    for (const u of fake.urls) expect(u).toMatch(/^http:\/\/127\.0\.0\.1:11434\/api\//);
  });

  it('answers invalid tool arguments with an error result instead of running the tool', async () => {
    installFakeOllama(fetch, { replies: [toolReply([{ name: 'list_features', arguments: { query: 'kpi', includeDone: true } }]), textReply('Sorry.')] });
    const ev = events((await ask('which features are open?')).body);
    const done = ev.find((e) => e.event === 'tool.done');
    expect(done.data.result.error).toMatch(/Unknown argument "includeDone"/);
  });

  it('recovers a tool call written as text and never shows the raw call', async () => {
    seedFeatures();
    installFakeOllama(fetch, {
      replies: [textReply('{"name": "list_features", "arguments": {}}\n</tool_call>', { tokens: ['{"name": "list_features", ', '"arguments": {}}\n</tool_call>'] }), textReply('Two features.')],
    });
    const ev = events((await ask('features?')).body);
    expect(ev.filter((e) => e.event === 'tool.start').map((e) => e.data.name)).toEqual(['list_features']);
    expect(ev.filter((e) => e.event === 'delta' && e.data.round === 0)).toHaveLength(0);
    expect(ev.find((e) => e.event === 'final').data.content).toBe('Two features.');
  });

  it('retries once with a corrective nudge on an empty reply, then gives a safe answer for a broken call', async () => {
    const fake = installFakeOllama(fetch, { replies: [textReply(''), textReply('{"name": "list_features", "arguments": {"days: 1}}\n</tool_call>')] });
    const ev = events((await ask('features please?')).body);
    expect(fake.chatBodies).toHaveLength(2);
    expect(fake.chatBodies[1].messages.at(-1)).toMatchObject({ role: 'system' });
    const final = ev.find((e) => e.event === 'final').data.content;
    expect(final).not.toMatch(/list_features|tool_call/);
  });

  it('refuses a write tool the model invents: studio mode has none, so nothing is parked or written', async () => {
    installFakeOllama(fetch, { replies: [toolReply([{ name: 'add_item', arguments: { name: 'Milk frother' } }]), textReply('Sorry.')] });
    const ev = events((await ask('add a milk frother')).body);
    expect(ev.find((e) => e.event === 'confirm.required')).toBeUndefined();
    expect(ev.find((e) => e.event === 'tool.done').data.result.error).toBe('That tool is not available here, so nothing was done.');
    expect(ev.at(-1).data).toMatchObject({ pending: 0, writes: 0 });
  });

  it('a model failure mid-run becomes a classified error event, never provider text', async () => {
    installFakeOllama(fetch, { chat: () => ({ ok: false, status: 500, text: async () => 'INTERNAL gsk_LEAKYLEAKYLEAKY', headers: { get: () => null } }) });
    const res = await ask('hi');
    const err = events(res.body).find((e) => e.event === 'error').data;
    expect(err).toMatchObject({ type: 'error', code: 'unknown' });
    expect(res.body).not.toContain('LEAKY');
  });

  it('the actions route validates its body', async () => {
    installFakeOllama(fetch);
    const res = await request(app).post('/api/assistant/actions/abc').set('X-Forwarded-For', nextIp()).send({ approve: 'yes' });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown page with 400 unknown_page and records no audit row', async () => {
    const fake = installFakeOllama(fetch);
    for (const page of ['nope', 42, '__proto__', 'constructor']) {
      const res = await request(app).post('/api/assistant').set('X-Forwarded-For', nextIp()).send({ prompt: 'hello', page });
      expect(res.status, String(page)).toBe(400);
      expect(res.body).toMatchObject({ error: 'Unknown page', code: 'unknown_page' });
    }
    expect(fake.chatBodies).toHaveLength(0);
    expect(rowsOf(db, 'audit_log')).toHaveLength(0);
  });

  it('tells the model which page the user is on, but stores and audits only the bare prompt', async () => {
    const conv = (await request(app).post('/api/assistant/conversations').set('X-Forwarded-For', nextIp()).send({})).body.id;
    const fake = installFakeOllama(fetch, { replies: [textReply('Sure thing.')] });
    const res = await ask('what is new', { conversationId: conv, page: 'settings' });
    expect(res.status).toBe(200);
    const userTurn = fake.chatBodies[0].messages.filter((m) => m.role === 'user').at(-1);
    expect(userTurn.content).toBe("(I'm on the Settings page.)\nwhat is new");

    const msgs = (await request(app).get(`/api/assistant/conversations/${conv}/messages`).set('X-Forwarded-For', nextIp())).body;
    expect(msgs.find((m) => m.role === 'user').content).toBe('what is new');

    await vi.waitFor(() => expect(rowsOf(db, 'audit_log')).toHaveLength(1));
    expect(rowsOf(db, 'audit_log')[0]).toMatchObject({ feature: 'assistant', page: 'settings', context: 'what is new' });
  });

  it('sends the prompt unchanged when no page is given', async () => {
    const fake = installFakeOllama(fetch, { replies: [textReply('Hi.')] });
    await ask('plain question');
    expect(fake.chatBodies[0].messages.filter((m) => m.role === 'user').at(-1).content).toBe('plain question');
  });
});

describe('runAssistant', () => {
  it('ignores an inherited-key page instead of looking up a label for it', async () => {
    const fake = installFakeOllama(fetch, { replies: [textReply('Ok.')] });
    const client = await getAiClient({ purpose: 'tools' });
    await runAssistant({ prompt: 'hello', page: 'constructor', client });
    expect(fake.chatBodies[0].messages.filter((m) => m.role === 'user').at(-1).content).toBe('hello');
  });

  it('uses the "ran out of steps" message without dashes after MAX_ROUNDS', async () => {
    process.env.ASSISTANT_MAX_ROUNDS = '1';
    try {
      installFakeOllama(fetch, { replies: [toolReply([{ name: 'list_features', arguments: {} }]), textReply('')] });
      const client = await getAiClient({ purpose: 'tools' });
      const out = await runAssistant({ prompt: 'features', client });
      expect(out.finalAnswer).toBe('I gathered information but ran out of steps. Ask me to continue.');
      expect(out).toMatchObject({ provider: 'ollama', model: 'qwen2.5:7b', calls: 2 });
    } finally {
      delete process.env.ASSISTANT_MAX_ROUNDS;
    }
  });
});
