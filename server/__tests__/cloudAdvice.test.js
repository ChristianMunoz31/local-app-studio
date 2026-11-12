// Assistant page advice (POST /api/assistant/advice, JSON and SSE) on a cloud provider: a page whose
// category is withheld makes no model call, only the user's own messages are sent under cloud,
// and local Ollama gets everything.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_BUILD } from './helpers/proBuild.js';
import request from 'supertest';

vi.mock('../../loadEnv.js', () => ({}));
vi.mock('../modules/studio.data.js', (orig) => import('./helpers/fixtureModules.js').then((m) => m.withFixtureCategories(orig)));
vi.mock('../../src/modules/studio.assistant.js', (orig) => import('./helpers/fixtureModules.js').then((m) => m.withFixturePages(orig)));
vi.mock('node-fetch', () => ({ default: vi.fn() }));

import fetch from 'node-fetch';
import { textReply } from './helpers/fakeOllama.js';
import { CLOUD_HOST, SENTINELS, configureCloud, installCloudAndOllama, resetCloud } from './helpers/fakeCloud.js';
import { closeTestDb, createTestDb, resetDb } from './helpers/testDb.js';
import { MSG_CLOUD_DISABLED, __resetAiForTests, getAiClient, isAiQueueFull, withheldMessage } from '../ai/index.js';
import { CLOUD_CATEGORY_DEFAULTS, aiAuditMeta, createAiPolicy } from '../ai/privacy.js';
import { createAiClient } from '../ai/registry.js';
import { disableCloudAi } from '../aiSettingsRoutes.js';
import { generateAdvice, streamAdvice } from '../assistant/advisorService.js';

let app;
let db;
let ip = 0;
const nextIp = () => `192.0.2.${(ip += 1) % 250}`;
const saved = Object.fromEntries(['APP_PASSWORD', 'AUTH_SECRET', 'SECRETS_ENCRYPTION_KEY', 'APP_AI'].map((k) => [k, process.env[k]]));
const SSE = 'text/event-stream';

beforeAll(async () => {
  for (const k of Object.keys(saved)) delete process.env[k];
  db = createTestDb();
  app = (await import('../../server.js')).default;
});
afterAll(async () => {
  await resetCloud();
  closeTestDb(db);
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
beforeEach(async () => {
  resetDb(db);
  fetch.mockReset();
  await resetCloud();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const advise = (body, { sse = false } = {}) => {
  const req = request(app).post('/api/assistant/advice').set('X-Forwarded-For', nextIp());
  if (sse) req.set('Accept', SSE);
  return req.send(body);
};
const frames = (text) =>
  text
    .split('\n\n')
    .filter((b) => b.startsWith('event:'))
    .map((b) => {
      const [e, d] = b.split('\n');
      return { event: e.slice(7), data: JSON.parse(d.slice(6)) };
    });

const ITEMS_CONTEXT = JSON.stringify({ alpha: [{ name: SENTINELS.items }] });
const HISTORY = [
  { role: 'user', content: 'earlier question' },
  { role: 'assistant', content: `earlier answer mentioning ${SENTINELS.notes}` },
  { role: 'user', content: 'the real question' },
];

describe.skipIf(PUBLIC_BUILD)('a page whose category is withheld (needs the cloud provider, which is not in a public build)', () => {
  it('JSON: blocked, deterministic copy, no model call, nothing sent', async () => {
    await configureCloud({ categories: { alpha: false } });
    const { cloud } = installCloudAndOllama(fetch);
    const res = await advise({ page: 'alpha_page', context: ITEMS_CONTEXT, messages: [{ role: 'user', content: 'how am I doing?' }] });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      content: withheldMessage(['alpha']),
      model: 'cloud-model',
      provider: 'openai_compat',
      ai: { kind: 'cloud', host: CLOUD_HOST },
      withheld: ['alpha'],
      notice: withheldMessage(['alpha']),
      blocked: true,
    });
    expect(res.body.data.content).toBe("Your items aren't shared with cloud AI. You can change that in Settings > AI.");
    expect(cloud.requests).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('SSE: meta first, no deltas, done carries the notice as the content', async () => {
    await configureCloud({ categories: { alpha: false } });
    const { cloud } = installCloudAndOllama(fetch);
    const res = await advise({ page: 'alpha_page', context: '{"plan":1}', messages: [] }, { sse: true });
    const ev = frames(res.text);
    expect(ev.map((e) => e.event)).toEqual(['meta', 'done']);
    expect(ev[0].data).toEqual({ ai: { kind: 'cloud', host: CLOUD_HOST } });
    expect(ev[1].data).toMatchObject({ content: withheldMessage(['alpha']), notice: withheldMessage(['alpha']), blocked: true, withheld: ['alpha'], provider: 'openai_compat' });
    expect(ev[1].data.content).toBe(ev[1].data.notice);
    expect(cloud.requests).toHaveLength(0);
  });

  it('home has no category: always shared, even with every category off', async () => {
    await configureCloud({ categories: { alpha: false, beta: false } });
    const { cloud } = installCloudAndOllama(fetch, { replies: ['ok'] });
    expect((await advise({ page: 'home', context: '{"x":1}', messages: [] })).body.data.blocked).toBe(false);
    expect(cloud.requests).toHaveLength(1);
  });

  it('a page id the server does not know is a 400, never a model call', async () => {
    await configureCloud();
    const { cloud } = installCloudAndOllama(fetch, { replies: ['ok'] });
    const ok = await advise({ page: 'alpha_page', context: '{}', messages: [] });
    expect(ok.body.data.blocked).toBe(false);
    const unknown = await advise({ page: 'not-a-page', context: '{}', messages: [] });
    expect(unknown.status).toBe(400);
    expect(cloud.requests).toHaveLength(1);
  });
});

describe.skipIf(PUBLIC_BUILD)('a page that is shared (needs the cloud provider, which is not in a public build)', () => {
  it('JSON: calls the provider with the page context and reports the cloud source', async () => {
    await configureCloud();
    const { cloud } = installCloudAndOllama(fetch, { replies: ['- Order the screws today.'] });
    const res = await advise({ page: 'alpha_page', context: '{"open":[{"name":"Order screws"}]}', messages: [{ role: 'user', content: 'what first?' }] });
    expect(res.body.data).toEqual({
      content: '- Order the screws today.',
      model: 'cloud-model',
      provider: 'openai_compat',
      ai: { kind: 'cloud', host: CLOUD_HOST },
      withheld: [],
      notice: null,
      blocked: false,
    });
    expect(cloud.sent()).toContain('Order screws');
  });

  it('SSE: meta first, deltas, then done with the new fields', async () => {
    await configureCloud();
    installCloudAndOllama(fetch, { replies: ['One two three'] });
    const res = await advise({ page: 'alpha_page', context: '{}', messages: [] }, { sse: true });
    const ev = frames(res.text);
    expect(ev[0]).toEqual({ event: 'meta', data: { ai: { kind: 'cloud', host: CLOUD_HOST } } });
    expect(ev.some((e) => e.event === 'delta')).toBe(true);
    expect(ev.at(-1)).toEqual({
      event: 'done',
      data: { content: 'One two three', model: 'cloud-model', provider: 'openai_compat', ai: { kind: 'cloud', host: CLOUD_HOST }, withheld: [], notice: null, blocked: false },
    });
  });

  it('settings has no category: always shared, even with every category off', async () => {
    await configureCloud({ categories: { alpha: false, beta: false } });
    const { cloud } = installCloudAndOllama(fetch, { replies: ['ok'] });
    expect((await advise({ page: 'settings', context: '{"t":1}', messages: [] })).body.data.blocked).toBe(false);
    expect(cloud.requests).toHaveLength(1);
  });
});

describe.skipIf(PUBLIC_BUILD)('history under cloud (needs the cloud provider, which is not in a public build)', () => {
  it('sends only the user messages, joined into one, and never an earlier assistant answer', async () => {
    await configureCloud();
    const { cloud } = installCloudAndOllama(fetch, { replies: ['- Start with the cheapest.'] });
    const res = await advise({ page: 'alpha_page', context: JSON.stringify({ counts: { total: 2 } }), messages: HISTORY });
    expect(res.body.data).toMatchObject({ blocked: false, withheld: [], notice: null, content: '- Start with the cheapest.' });
    const sent = cloud.sent();
    expect(sent).not.toContain(SENTINELS.notes);
    expect(sent).not.toContain('earlier answer');
    expect(sent).toContain('earlier question');
    expect(sent).toContain('the real question');
    const userTurns = cloud.bodies[0].messages.filter((m) => m.role === 'user');
    expect(userTurns).toHaveLength(1);
  });
});

describe('local Ollama is unaffected', () => {
  it('sends the full context, history and every page, with no notice', async () => {
    const side = installCloudAndOllama(fetch, { ollama: { replies: [textReply('- Fine.')] } });
    const res = await advise({ page: 'alpha_page', context: ITEMS_CONTEXT, messages: HISTORY });
    expect(res.body.data).toMatchObject({ content: '- Fine.', provider: 'ollama', ai: { kind: 'local', host: null }, withheld: [], notice: null, blocked: false });
    const sent = JSON.stringify(side.local.chatBodies);
    expect(sent).toContain(SENTINELS.items);
    expect(sent).toContain('earlier answer');
    expect(side.cloud.requests).toHaveLength(0);
  });

  it('SSE meta reports local', async () => {
    installCloudAndOllama(fetch, { ollama: { chat: () => textReply('Hi there') } });
    const ev = frames((await advise({ page: 'alpha_page', context: '{}', messages: [] }, { sse: true })).text);
    expect(ev[0]).toEqual({ event: 'meta', data: { ai: { kind: 'local', host: null } } });
  });
});

describe.skipIf(PUBLIC_BUILD)('the service directly (needs the cloud provider, which is not in a public build)', () => {
  const input = (page, context = '{}') => ({ page, pageLabel: page, context, messages: [{ role: 'user', content: 'q' }] });

  it('an explicit scope skips the page policy (the caller owns the filtering)', async () => {
    await configureCloud();
    const { cloud } = installCloudAndOllama(fetch, { replies: ['Explained.'] });
    const client = await getAiClient({ purpose: 'chat' });
    // items would be filtered by the page policy; with a scope the caller owns the filtering.
    const out = await generateAdvice(input('alpha_page', '{"findings":[]}'), { client, scope: { categories: ['alpha'], withheld: ['beta'] } });
    expect(out).toMatchObject({ content: 'Explained.', withheld: ['beta'], blocked: false, notice: withheldMessage(['beta']) });
    expect(cloud.sent()).toContain('findings');
  });

  it('a scope naming a withheld category fails with a 403 before anything is sent', async () => {
    await configureCloud();
    const { cloud } = installCloudAndOllama(fetch);
    const client = await getAiClient({ purpose: 'chat' });
    const err = await generateAdvice(input('alpha_page'), { client, scope: { categories: ['beta'] } }).catch((e) => e);
    expect(err).toMatchObject({ httpStatus: 403, code: 'cloud_scope_denied', publicMessage: withheldMessage(['beta']) });
    expect(cloud.requests).toHaveLength(0);
  });

  it('streamAdvice on a blocked page resolves without a delta', async () => {
    await configureCloud({ categories: { alpha: false } });
    installCloudAndOllama(fetch);
    const client = await getAiClient({ purpose: 'chat' });
    const onDelta = vi.fn();
    const out = await streamAdvice(input('alpha_page'), { client, onDelta });
    expect(out).toMatchObject({ blocked: true, calls: 0, content: withheldMessage(['alpha']) });
    expect(onDelta).not.toHaveBeenCalled();
  });

  it('an error carries the context that was actually sent, for the audit row', async () => {
    await configureCloud();
    fetch.mockRejectedValue(Object.assign(new Error('boom'), { code: 'ECONNREFUSED' }));
    const client = await getAiClient({ purpose: 'chat' });
    const err = await generateAdvice(input('alpha_page', JSON.stringify({ counts: { total: 4 } })), { client }).catch((e) => e);
    expect(err.sentContext).toBeTypeOf('string');
    expect(err.sentContext).toContain('total');
  });
});

describe('a page mapped to several categories (policy fixture injected into the client)', () => {
  const input = { page: 'both', pageLabel: 'Both', context: '{"rows":[1]}', messages: [{ role: 'user', content: 'q' }] };
  const fixtureClient = (categories) => {
    const transportCalls = [];
    const transport = async function* (opts) {
      transportCalls.push(opts);
      yield { type: 'token', text: '- ok' };
      yield { type: 'done', usage: null, finishReason: 'stop' };
    };
    const policy = createAiPolicy({
      isCloud: true,
      categories: { ...CLOUD_CATEGORY_DEFAULTS, ...categories },
      pageCategories: { both: ['beta', 'alpha'] },
    });
    const client = createAiClient({ provider: 'openai_compat', kind: 'cloud', aiHost: CLOUD_HOST, model: 'm', purpose: 'chat', numCtx: 8192, policy, transport, authorizeSend: async () => ({}) });
    return { client, transportCalls };
  };

  it('allowed: the call goes out and the audit meta lists both categories as shared', async () => {
    const { client, transportCalls } = fixtureClient({ beta: true });
    const out = await generateAdvice(input, { client });
    expect(out).toMatchObject({ blocked: false, withheld: [], notice: null });
    expect(transportCalls).toHaveLength(1);
    expect(aiAuditMeta(client)).toEqual({ ai_kind: 'cloud', ai_host: CLOUD_HOST, shared: ['alpha', 'beta'], withheld: [] });
  });

  it('blocked under the defaults: no call, and the audit meta names only the denied category', async () => {
    const { client, transportCalls } = fixtureClient({});
    const out = await generateAdvice(input, { client });
    expect(out).toMatchObject({ blocked: true, withheld: ['beta'], calls: 0, content: withheldMessage(['beta']) });
    expect(transportCalls).toHaveLength(0);
    expect(aiAuditMeta(client)).toEqual({ ai_kind: 'cloud', ai_host: CLOUD_HOST, shared: [], withheld: ['beta'] });
  });
});

describe.skipIf(PUBLIC_BUILD)('cloud turned off while an advice stream is queued (needs the cloud provider, which is not in a public build)', () => {
  it('SSE: error cloud_disabled with fixed copy, a clean close, and nothing reached the cloud', async () => {
    const savedMax = process.env.APP_AI_QUEUE_MAX;
    process.env.APP_AI_QUEUE_MAX = '1';
    try {
      await configureCloud();
      installCloudAndOllama(fetch);
      const answer = fetch.getMockImplementation();
      let openGate;
      const gate = new Promise((resolve) => {
        openGate = resolve;
      });
      let cloudRequests = 0;
      fetch.mockImplementation(async (url, init) => {
        if (new URL(String(url)).hostname !== CLOUD_HOST) return answer(url, init);
        cloudRequests += 1;
        await gate; // holds the single queue slot
        return answer(url, init);
      });
      const holder = (await getAiClient({ purpose: 'chat' })).complete({ messages: [{ role: 'user', content: 'hold' }], scope: { categories: [] } });
      await vi.waitFor(() => expect(cloudRequests).toBe(1));

      // The stream starts while cloud is on, then waits in the queue behind `holder`.
      const pending = advise({ page: 'alpha_page', context: '{"plan":1}', messages: [{ role: 'user', content: 'hi' }] }, { sse: true }).then((r) => r);
      await vi.waitFor(() => expect(isAiQueueFull()).toBe(true));

      await disableCloudAi();
      openGate();
      await holder.catch(() => {});
      const res = await pending;

      const ev = frames(res.text);
      expect(ev.map((e) => e.event)).toEqual(['meta', 'error']);
      expect(ev[1].data).toMatchObject({ error: MSG_CLOUD_DISABLED, code: 'cloud_disabled' });
      expect(res.text.trimEnd().endsWith('}')).toBe(true);
      expect(cloudRequests).toBe(1); // the holder only
    } finally {
      if (savedMax === undefined) delete process.env.APP_AI_QUEUE_MAX;
      else process.env.APP_AI_QUEUE_MAX = savedMax;
      __resetAiForTests();
    }
  });
});
