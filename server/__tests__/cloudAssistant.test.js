// Assistant (POST /api/assistant) on a cloud provider: tools whose category is withheld never run and
// answer with a placeholder, tool results and history never leak a
// withheld category, the stream says where it runs and carries one notice, and local Ollama is
// unaffected. Fake provider behind a mocked node-fetch; nothing real is contacted.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_BUILD } from './helpers/proBuild.js';
// Pro is on for this file (the Pro gate itself is covered in proGating.test.js).
vi.mock('../license/index.js', async (importOriginal) => (await import('./helpers/pro.js')).mockLicenseModule(importOriginal));
import request from 'supertest';

vi.mock('../../loadEnv.js', () => ({}));
vi.mock('node-fetch', () => ({ default: vi.fn() }));
// Fixture pages and categories next to the real list_features tool (Studio has no Assistant pages of its own).
vi.mock('../modules/studio.data.js', (orig) => import('./helpers/fixtureModules.js').then((m) => m.withFixtureCategories(orig, { keepReal: true })));
vi.mock('../../src/modules/studio.assistant.js', (orig) => import('./helpers/fixtureModules.js').then((m) => m.withFixturePages(orig)));

import fetch from 'node-fetch';
import { textReply, toolReply } from './helpers/fakeOllama.js';
import { CLOUD_HOST, SENTINELS, configureCloud, installCloudAndOllama, resetCloud } from './helpers/fakeCloud.js';
import { closeTestDb, createTestDb, resetDb, rowsOf } from './helpers/testDb.js';
import { seedFeature } from './helpers/seedFeature.js';
import { __resetPendingActionsForTests } from '../agents/pendingActions.js';
import { OUT_OF_STEPS_MESSAGE, runAssistant } from '../agents/assistantAgent.js';
import { executeTool } from '../agents/assistantTools.js';
import { CloudScopeError, MSG_CLOUD_DISABLED, createAiPolicy, withheldMessage, withheldToolResult } from '../ai/privacy.js';
import { classifyAiError, getAiClient } from '../ai/index.js';
import { appendMessage, createConversation } from '../dataAccess.js';
import { acquireConversationRun, releaseConversationRun } from '../agents/runLock.js';

let app;
let db;
let ip = 0;
const nextIp = () => `203.0.113.${(ip += 1) % 250}`;
const saved = Object.fromEntries(['APP_PASSWORD', 'AUTH_SECRET', 'SECRETS_ENCRYPTION_KEY', 'ASSISTANT_CONFIRM_WRITES', 'APP_AI'].map((k) => [k, process.env[k]]));

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
  __resetPendingActionsForTests();
  await resetCloud();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const events = (text) =>
  text
    .split('\n\n')
    .filter((b) => b.startsWith('event:'))
    .map((b) => {
      const [e, d] = b.split('\n');
      return { event: e.slice(7), data: JSON.parse(d.slice(6)) };
    });

const ask = async (prompt, extra = {}) => {
  const res = await request(app)
    .post('/api/assistant')
    .set('X-Forwarded-For', nextIp())
    .send({ prompt, ...extra })
    .buffer(true)
    .parse((r, cb) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => cb(null, d));
    });
  return { res, ev: events(res.body) };
};

// One saved feature whose description carries a sentinel: the "features" category is shared by default.
const seedPersonal = () => seedFeature({ description: `Number row ${SENTINELS.items}` });

describe('a withheld tool never runs and never reaches the provider', () => {
  it.skipIf(PUBLIC_BUILD)('list_features with features withheld answers with the placeholder, streams meta and one notice before final (needs the cloud provider, which is not in a public build)', async () => {
    seedPersonal();
    await configureCloud({ categories: { features: false } });
    const { cloud } = installCloudAndOllama(fetch, { replies: [{ toolCalls: [{ name: 'list_features' }] }, 'I cannot see your features.'] });
    const { res, ev } = await ask('what features did I save?');
    expect(res.status).toBe(200);

    const types = ev.map((e) => e.event);
    expect(types[0]).toBe('meta');
    expect(ev[0].data).toEqual({ type: 'meta', ai: { kind: 'cloud', host: CLOUD_HOST } });
    const done = ev.find((e) => e.event === 'tool.done').data;
    expect(done.name).toBe('list_features');
    expect(done.result).toEqual(withheldToolResult('features'));
    const notices = ev.filter((e) => e.event === 'notice');
    expect(notices).toHaveLength(1);
    expect(notices[0].data).toEqual({ type: 'notice', code: 'cloud_withheld', categories: ['features'], message: withheldMessage(['features']) });
    expect(types.indexOf('notice')).toBeLessThan(types.indexOf('final'));
    expect(ev.at(-1)).toMatchObject({ event: 'run.done', data: { ai: { kind: 'cloud', host: CLOUD_HOST }, writes: 0, pending: 0 } });

    // Two provider calls; the second carries the placeholder, and no sentinel is in either.
    expect(cloud.requests).toHaveLength(2);
    const second = cloud.bodies[1].messages.at(-1);
    expect(second).toMatchObject({ role: 'tool' });
    expect(JSON.parse(second.content)).toMatchObject({ not_shared: true, category: 'features' });
    for (const s of Object.values(SENTINELS)) expect(cloud.sent(), s).not.toContain(s);
    expect(cloud.requests.every((r) => r.url === `https://${CLOUD_HOST}/v1/chat/completions`)).toBe(true);
  });

  it.skipIf(PUBLIC_BUILD)('a shared tool runs normally and its data goes to the provider (needs the cloud provider, which is not in a public build)', async () => {
    seedPersonal();
    await configureCloud();
    const { cloud } = installCloudAndOllama(fetch, { replies: [{ toolCalls: [{ name: 'list_features' }] }, 'One feature.'] });
    const { ev } = await ask('features?');
    expect(ev.find((e) => e.event === 'tool.done').data.result.features).toHaveLength(1);
    expect(ev.filter((e) => e.event === 'notice')).toHaveLength(0);
    expect(cloud.sent()).toContain(SENTINELS.items);
  });

  it.skipIf(PUBLIC_BUILD)('turning a category on in settings lets the tool run (policy is read per request) (needs the cloud provider, which is not in a public build)', async () => {
    seedPersonal();
    await configureCloud({ categories: { features: false } });
    installCloudAndOllama(fetch, { replies: [{ toolCalls: [{ name: 'list_features' }] }, 'Nothing yet.'] });
    const first = await ask('features?');
    expect(first.ev.find((e) => e.event === 'tool.done').data.result).toMatchObject({ not_shared: true });

    await configureCloud({ categories: { features: true } });
    fetch.mockReset();
    const { cloud } = installCloudAndOllama(fetch, { replies: [{ toolCalls: [{ name: 'list_features' }] }, 'You saved one.'] });
    const { ev } = await ask('features?');
    expect(ev.find((e) => e.event === 'tool.done').data.result.features).toHaveLength(1);
    expect(cloud.sent()).toContain(SENTINELS.items);
    expect(ev.filter((e) => e.event === 'notice')).toHaveLength(0);
  });

  it('a removed Items tool name is refused under cloud: nothing runs and nothing is parked', async () => {
    await configureCloud();
    installCloudAndOllama(fetch, { replies: [{ toolCalls: [{ name: 'add_item', arguments: { name: 'Kettle' } }] }, 'Cannot do that.'] });
    const { ev } = await ask('add a kettle');
    expect(ev.filter((e) => e.event === 'confirm.required')).toHaveLength(0);
    expect(ev.at(-1).data).toMatchObject({ pending: 0, writes: 0 });
  });
});

describe('history and the page hint', () => {
  it.skipIf(PUBLIC_BUILD)('earlier turns that used a withheld tool locally are dropped before the cloud sees the conversation (needs the cloud provider, which is not in a public build)', async () => {
    const conv = await createConversation({ title: 'earlier' });
    await appendMessage(conv.id, { role: 'user', content: 'what notes did I write?' });
    await appendMessage(conv.id, { role: 'assistant', content: '', toolCalls: [{ id: 'h1', type: 'function', function: { name: 'read_both', arguments: '{}' } }] });
    await appendMessage(conv.id, { role: 'tool', content: JSON.stringify({ notes: [{ notes: SENTINELS.notes }] }), toolCallId: 'h1' });
    await appendMessage(conv.id, { role: 'assistant', content: `You wrote: ${SENTINELS.notes}` });
    await appendMessage(conv.id, { role: 'user', content: 'thanks, summarize that' });
    await appendMessage(conv.id, { role: 'assistant', content: `Summary of ${SENTINELS.notes}` });
    await configureCloud();
    const { cloud } = installCloudAndOllama(fetch, { replies: ['Sure.'] });
    const { ev } = await ask('how many items do I have?', { conversationId: conv.id });
    expect(ev.at(-1).event).toBe('run.done');
    expect(cloud.sent()).not.toContain(SENTINELS.notes);
    expect(cloud.sent()).toContain('how many items do I have?');
  });

  it.skipIf(PUBLIC_BUILD)('earlier user messages stay in the conversation, earlier assistant rows do not (needs the cloud provider, which is not in a public build)', async () => {
    const conv = await createConversation({ title: 'earlier' });
    await appendMessage(conv.id, { role: 'user', content: 'plain earlier question' });
    await appendMessage(conv.id, { role: 'assistant', content: 'plain earlier answer' });
    await configureCloud();
    const { cloud } = installCloudAndOllama(fetch, { replies: ['Sure.'] });
    await ask('follow up', { conversationId: conv.id });
    expect(cloud.sent()).toContain('plain earlier question');
    expect(cloud.sent()).not.toContain('plain earlier answer');
  });

  it.skipIf(PUBLIC_BUILD)('the page hint is sent for a shared page and left out for a withheld one (needs the cloud provider, which is not in a public build)', async () => {
    await configureCloud();
    const a = installCloudAndOllama(fetch, { replies: ['ok'] });
    await ask('hello', { page: 'alpha_page' });
    expect(a.cloud.sent()).toContain("I'm on the Alpha page");
    await configureCloud({ categories: { alpha: false } });
    fetch.mockReset();
    const b = installCloudAndOllama(fetch, { replies: ['ok'] });
    await ask('hello', { page: 'alpha_page' });
    expect(b.cloud.sent()).not.toContain('Alpha page');
    expect(b.cloud.sent()).toContain('hello');
  });

  it('local Ollama still gets the page hint for any page', async () => {
    await configureCloud({ categories: { alpha: false }, consent: false });
    const side = installCloudAndOllama(fetch, { ollama: { replies: [textReply('ok')] } });
    await ask('hello', { page: 'alpha_page' });
    expect(JSON.stringify(side.local.chatBodies)).toContain("I'm on the Alpha page");
  });
});

describe('local Ollama is unaffected', () => {
  it('every category works, the stream says local, and no notice is sent', async () => {
    seedPersonal();
    const side = installCloudAndOllama(fetch, { ollama: { replies: [toolReply([{ name: 'list_features', arguments: {} }]), textReply('You saved one.')] } });
    const { ev } = await ask('what did I write?');
    expect(ev[0]).toMatchObject({ event: 'meta', data: { ai: { kind: 'local', host: null } } });
    expect(ev.find((e) => e.event === 'tool.done').data.result.features).toHaveLength(1);
    expect(ev.filter((e) => e.event === 'notice')).toHaveLength(0);
    expect(ev.at(-1).data.ai).toEqual({ kind: 'local', host: null });
    expect(JSON.stringify(side.local.chatBodies[1])).toContain(SENTINELS.items);
    expect(side.cloud.requests).toHaveLength(0);
  });

  it('a consent-less cloud setup runs locally with all categories and sends nothing to the host', async () => {
    seedPersonal();
    await configureCloud({ consent: false });
    const side = installCloudAndOllama(fetch, { ollama: { replies: [toolReply([{ name: 'list_features', arguments: {} }]), textReply('One feature.')] } });
    const { ev } = await ask('notes?');
    expect(ev[0].data.ai.kind).toBe('local');
    expect(ev.find((e) => e.event === 'tool.done').data.result.features).toHaveLength(1);
    expect(side.cloud.requests).toHaveLength(0);
  });
});

describe('the second layer in executeTool', () => {
  it('honours ctx.policy: a withheld tool returns the placeholder without touching the database', async () => {
    seedPersonal();
    const withheld = createAiPolicy({ isCloud: true, categories: { features: false } });
    expect(await executeTool('list_features', {}, { policy: withheld })).toEqual(withheldToolResult('features'));
    const shared = createAiPolicy({ isCloud: true, categories: {} });
    expect((await executeTool('list_features', {}, { policy: shared })).features).toHaveLength(1);
    expect(rowsOf(db, 'studio_features')).toHaveLength(1);
  });

  it('a tool that is no longer offered is refused under cloud and does not run', async () => {
    const policy = createAiPolicy({ isCloud: true, categories: {} });
    const ctx = { writeCount: 0, writeCap: 3, policy };
    expect(await executeTool('add_item', { name: 'late' }, ctx)).toMatchObject({ not_shared: true });
    expect(ctx.writeCount).toBe(0);
  });
});

describe('one run per conversation', () => {
  it('answers 409 conversation_busy before any SSE headers while a run holds the conversation, then frees it', async () => {
    const conv = await createConversation({ title: 't' });
    await configureCloud();
    installCloudAndOllama(fetch, { replies: ['Hello.'] });
    expect(acquireConversationRun(conv.id)).toBe(true);
    try {
      const busy = await request(app).post('/api/assistant').set('X-Forwarded-For', nextIp()).send({ prompt: 'hi', conversationId: conv.id });
      expect(busy.status).toBe(409);
      expect(busy.headers['content-type']).toMatch(/json/);
      expect(busy.body).toMatchObject({ code: 'conversation_busy' });
      expect(typeof busy.body.message).toBe('string');
      expect(rowsOf(db, 'assistant_messages')).toHaveLength(0);
    } finally {
      releaseConversationRun(conv.id);
    }
    const ok = await ask('hi', { conversationId: conv.id });
    expect(ok.res.status).toBe(200);
  });

  it('releases the conversation after a finished run so the next one is accepted', async () => {
    const conv = await createConversation({ title: 't' });
    await configureCloud();
    installCloudAndOllama(fetch, { replies: ['One.', 'Two.'] });
    expect((await ask('first', { conversationId: conv.id })).res.status).toBe(200);
    expect((await ask('second', { conversationId: conv.id })).res.status).toBe(200);
  });
});

describe('a cloud client without a cloudTarget', () => {
  it('fails closed before any model round (cloud_disabled), never falling back to the generic gate', async () => {
    await configureCloud();
    installCloudAndOllama(fetch, { replies: ['Hello.'] });
    const chatWithTools = vi.fn();
    const client = {
      provider: 'openai_compat',
      model: 'cloud-model',
      isCloud: true,
      cloudTarget: null,
      policy: createAiPolicy({ isCloud: true, categories: {} }),
      ai: { kind: 'cloud', host: CLOUD_HOST },
      stats: { calls: 0 },
      chatWithTools,
    };
    await expect(runAssistant({ prompt: 'hi', client })).rejects.toMatchObject({ code: 'cloud_disabled' });
    expect(chatWithTools).not.toHaveBeenCalled();
  });
});

describe('the final no-tools pass', () => {
  it('a refused cloud send surfaces cloud_disabled with the fixed copy, not the out-of-steps answer', async () => {
    const prevRounds = process.env.ASSISTANT_MAX_ROUNDS;
    process.env.ASSISTANT_MAX_ROUNDS = '1';
    try {
      await configureCloud();
      installCloudAndOllama(fetch, { replies: ['unused'] });
      const real = await getAiClient({ purpose: 'tools' });
      let calls = 0;
      // Round one asks for a tool; the final pass is refused by authorizeSend (cloud turned off in between).
      const chatWithTools = vi.fn(async () => {
        calls += 1;
        if (calls === 1) return { message: { content: '', tool_calls: [{ function: { name: 'list_features', arguments: {} } }] } };
        throw new CloudScopeError('cloud_disabled');
      });
      const client = { ...real, chatWithTools };
      const sent = [];
      const err = await runAssistant({ prompt: 'hi', client, onEvent: (e) => sent.push(e) }).catch((e) => e);

      expect(err).toBeInstanceOf(CloudScopeError);
      expect(chatWithTools).toHaveBeenCalledTimes(2);
      expect(sent.some((e) => e.type === 'final')).toBe(false);
      // The route turns this into the SSE error event.
      const c = classifyAiError(err);
      expect({ code: c.code, message: c.message }).toEqual({ code: 'cloud_disabled', message: MSG_CLOUD_DISABLED });
      expect(c.message).not.toBe(OUT_OF_STEPS_MESSAGE);
    } finally {
      if (prevRounds === undefined) delete process.env.ASSISTANT_MAX_ROUNDS;
      else process.env.ASSISTANT_MAX_ROUNDS = prevRounds;
    }
  });

  it('any other failure of the final pass still answers with the out-of-steps message', async () => {
    const prevRounds = process.env.ASSISTANT_MAX_ROUNDS;
    process.env.ASSISTANT_MAX_ROUNDS = '1';
    try {
      await configureCloud();
      installCloudAndOllama(fetch, { replies: ['unused'] });
      const real = await getAiClient({ purpose: 'tools' });
      let calls = 0;
      const chatWithTools = vi.fn(async () => {
        calls += 1;
        if (calls === 1) return { message: { content: '', tool_calls: [{ function: { name: 'list_features', arguments: {} } }] } };
        throw new Error('provider exploded');
      });
      const out = await runAssistant({ prompt: 'hi', client: { ...real, chatWithTools } });
      expect(out.finalAnswer).toBe(OUT_OF_STEPS_MESSAGE);
    } finally {
      if (prevRounds === undefined) delete process.env.ASSISTANT_MAX_ROUNDS;
      else process.env.ASSISTANT_MAX_ROUNDS = prevRounds;
    }
  });
});
