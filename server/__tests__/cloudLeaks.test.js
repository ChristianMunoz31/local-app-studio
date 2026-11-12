// Security review fixes for cloud AI: consent and categories cannot be written outside the
// consent flow (importer, state route), earlier assistant and tool rows written by a local model
// never reach a cloud provider, advice threads are user-only under cloud, a long Assistant run stops
// when cloud is turned off or a category is withheld, consent is bound to the exact base URL and
// literal-IP SSRF ranges. Fake provider only (api.example.com, sk-test-fake); nothing real is contacted.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_BUILD } from './helpers/proBuild.js';
import request from 'supertest';
import { strToU8, zipSync } from 'fflate';

vi.mock('../../loadEnv.js', () => ({}));
vi.mock('node-fetch', () => ({ default: vi.fn() }));
// Fixture categories (alpha shared by default, beta not) and pages next to the real Studio tools.
vi.mock('../modules/studio.data.js', (orig) => import('./helpers/fixtureModules.js').then((m) => m.withFixtureCategories(orig, { keepReal: true })));
vi.mock('../../src/modules/studio.assistant.js', (orig) => import('./helpers/fixtureModules.js').then((m) => m.withFixturePages(orig)));

import fetch from 'node-fetch';
import { CLOUD_HOST, SENTINELS, configureCloud, installCloudAndOllama, resetCloud } from './helpers/fakeCloud.js';
import { scanModelCalls } from './helpers/modelCallScan.js';
import { closeTestDb, createTestDb, resetDb, rowsOf } from './helpers/testDb.js';
import { __resetAiForTests, getAiClient } from '../ai/index.js';
import { CLOUD_CONSENT_ACKS, clearCloudConsent, getCloudConsent, isConsentCurrent, updateCloudCategories } from '../ai/consent.js';
import { isPublicIp } from '../ai/cloudGuard.js';
import { applyPagePolicy, cloudHistoryUserRows, createAiPolicy } from '../ai/privacy.js';
import { listAudit } from '../audit.js';
import { validateCloudBaseUrl } from '../ai/settings.js';
import { historyToMessages } from '../agents/assistantAgent.js';
import { importZipBuffer } from '../import/importExport.js';
import { appendMessage, createConversation, getState, setState } from '../dataAccess.js';
import { __resetPendingActionsForTests } from '../agents/pendingActions.js';

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

const ISO = '2026-01-01T00:00:00.000Z';
const BASE = 'https://api.example.com/v1';
const goodConsent = (extra = {}) => ({ version: 1, host: CLOUD_HOST, baseUrl: BASE, acceptedAt: ISO, acknowledgements: [...CLOUD_CONSENT_ACKS], ...extra });

function exportZip(appStateRows) {
  const manifest = { format: 'local-app-studio-export', formatVersion: 1, tables: [{ id: 'app_state' }] };
  return zipSync({
    'manifest.json': strToU8(JSON.stringify(manifest)),
    'json/app_state.json': strToU8(JSON.stringify(appStateRows)),
  });
}
const row = (key, value) => ({ key, value, updated_at: ISO });

const sseParse = (r, cb) => {
  let d = '';
  r.on('data', (c) => (d += c));
  r.on('end', () => cb(null, d));
};
const frames = (text) =>
  text
    .split('\n\n')
    .filter((b) => b.startsWith('event:'))
    .map((b) => {
      const [e, d] = b.split('\n');
      return { event: e.slice(7), data: JSON.parse(d.slice(6)) };
    });
const assistant = (prompt, conversationId) =>
  request(app).post('/api/assistant').set('X-Forwarded-For', nextIp()).send({ prompt, conversationId }).buffer(true).parse(sseParse);

const call = (id, name, args = '{}') => ({ id, type: 'function', function: { name, arguments: args } });

// ---------------------------------------------------------------------------------------------
describe('C1: consent and categories are not writable outside the consent flow', () => {
  it('the importer skips every ai.cloud* key as protected and reports it', async () => {
    const result = importZipBuffer(
      exportZip([
        row('ai.cloudConsent', goodConsent()),
        row('ai.cloudCategories', { notes: true }),
        row('ai.cloudHint', { lastShownAt: ISO }),
        row('network.optIn', { cloudAi: true }),
        row('AI.CloudConsent', goodConsent()),
        row('theme', 'dark'),
      ]),
    );
    const t = result.tables.find((x) => x.id === 'app_state');
    expect(t.skippedReasons.protected).toBe(5);
    expect(t.inserted).toBe(1);
    const keys = rowsOf(db, 'app_state').map((r) => r.key);
    expect(keys).toContain('theme');
    expect(keys).not.toContain('ai.cloudConsent');
    expect(keys).not.toContain('AI.CloudConsent');
    // Rows that existed before the import (reset to empty values) are untouched.
    for (const key of ['ai.cloudCategories', 'ai.cloudHint', 'network.optIn']) expect(await getState(key, null), key).toEqual({});
  });

  it('an imported consent row cannot turn cloud on: getAiClient stays local', async () => {
    await configureCloud({ consent: false });
    importZipBuffer(exportZip([row('ai.cloudConsent', goodConsent({ baseUrl: 'https://api.example.com/v1' })), row('ai.cloudCategories', { notes: true })]));
    __resetAiForTests();
    installCloudAndOllama(fetch);
    expect(await getCloudConsent()).toBeNull();
    const client = await getAiClient({ purpose: 'chat' });
    expect(client.provider).toBe('ollama');
    expect(client.isCloud).toBeFalsy();
  });

  it('an imported ai.settings loses provider and cloud; the saved provider and endpoint stay', async () => {
    await configureCloud({ provider: 'ollama' });
    const result = importZipBuffer(
      exportZip([
        row('ai.settings', {
          provider: 'openai_compat',
          chatModel: 'llama3.2:3b',
          cloud: { baseUrl: 'https://evil.example.net/v1', model: 'gpt-evil', tokenParam: null },
        }),
      ]),
    );
    expect(result.tables[0].skippedReasons.protected).toBe(0);
    const settings = await getState('ai.settings', null);
    expect(settings.provider).toBe('ollama');
    expect(settings.cloud.baseUrl).toBe('https://api.example.com/v1');
    expect(settings.chatModel).toBe('llama3.2:3b');
    __resetAiForTests();
    installCloudAndOllama(fetch);
    expect((await getAiClient({ purpose: 'chat' })).provider).toBe('ollama');
  });

  it('with no saved ai.settings an import adds only the harmless model preference', async () => {
    importZipBuffer(exportZip([row('ai.settings', { provider: 'openai_compat', chatModel: 'llama3.2:3b', cloud: { baseUrl: 'https://api.example.com/v1' } })]));
    expect(await getState('ai.settings', null)).toEqual({ chatModel: 'llama3.2:3b' });
  });

  it.each(['ai.cloudConsent', 'ai.cloudCategories', 'ai.cloudHint', 'ai.settings', 'network.optIn'])('PUT /api/state/%s is refused with 403', async (key) => {
    const before = await getState(key, null);
    const res = await request(app)
      .put(`/api/state/${key}`)
      .set('X-Forwarded-For', nextIp())
      .send({ value: key === 'ai.cloudConsent' ? goodConsent() : { notes: true } });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'protected_key' });
    expect(await getState(key, null)).toEqual(before);
  });

  it('other keys are still writable through the state route', async () => {
    const res = await request(app).put('/api/state/theme').set('X-Forwarded-For', nextIp()).send({ value: 'dark' });
    expect(res.status).toBe(200);
  });

  it('a hand-written consent without the acknowledgements, a baseUrl or a valid acceptedAt is not current', () => {
    expect(isConsentCurrent(goodConsent(), CLOUD_HOST, BASE)).toBe(true);
    expect(isConsentCurrent(goodConsent({ baseUrl: undefined }), CLOUD_HOST, BASE)).toBe(false);
    expect(isConsentCurrent(goodConsent({ baseUrl: '' }), CLOUD_HOST, BASE)).toBe(false);
    expect(isConsentCurrent(goodConsent({ acknowledgements: [] }), CLOUD_HOST, BASE)).toBe(false);
    expect(isConsentCurrent(goodConsent({ acknowledgements: ['sends_data'] }), CLOUD_HOST, BASE)).toBe(false);
    expect(isConsentCurrent(goodConsent({ acknowledgements: ['pay_provider'] }), CLOUD_HOST, BASE)).toBe(false);
    expect(isConsentCurrent(goodConsent({ acceptedAt: '' }), CLOUD_HOST, BASE)).toBe(false);
    expect(isConsentCurrent(goodConsent({ acceptedAt: 'not a date' }), CLOUD_HOST, BASE)).toBe(false);
    expect(isConsentCurrent(goodConsent({ acceptedAt: undefined }), CLOUD_HOST, BASE)).toBe(false);
  });

  it('a stored consent row missing the acks leaves the registry on local', async () => {
    await configureCloud({ consent: { version: 1, host: CLOUD_HOST, baseUrl: BASE, acceptedAt: ISO } });
    installCloudAndOllama(fetch);
    expect((await getAiClient({ purpose: 'chat' })).provider).toBe('ollama');
  });
});

// ---------------------------------------------------------------------------------------------
describe.skipIf(PUBLIC_BUILD)('H1 H2 H3 M1: earlier local assistant and tool rows never reach the cloud (needs the cloud provider, which is not in a public build)', () => {
  it('a 31+ row history whose window starts mid-turn after a local read_both turn', async () => {
    const conv = await createConversation({ title: 't' });
    await appendMessage(conv.id, { role: 'user', content: 'what notes did I write?' });
    await appendMessage(conv.id, { role: 'assistant', content: '', toolCalls: [call('h1', 'read_both')] });
    await appendMessage(conv.id, { role: 'tool', content: JSON.stringify({ notes: [{ notes: SENTINELS.notes }] }), toolCallId: 'h1' });
    await appendMessage(conv.id, { role: 'assistant', content: `You wrote: ${SENTINELS.notes}` });
    // 28 more rows: the 30-row window now begins at the tool row, in the middle of that turn.
    for (let i = 0; i < 14; i += 1) {
      await appendMessage(conv.id, { role: 'user', content: `filler question ${i}` });
      await appendMessage(conv.id, { role: 'assistant', content: `filler answer ${i}` });
    }
    await configureCloud();
    const { cloud } = installCloudAndOllama(fetch, { replies: ['Fine.'] });
    const res = await assistant('how many items do I have?', conv.id);
    expect(res.status).toBe(200);
    expect(cloud.requests.length).toBeGreaterThan(0);
    for (const s of Object.values(SENTINELS)) expect(cloud.sent(), s).not.toContain(s);
    // The withheld turn is outside the window but still taints it: nothing after it is sent.
    expect(cloud.sent()).not.toContain('filler question');
    expect(cloud.sent()).not.toContain('filler answer');
  });

  it('a clean 31+ row conversation still sends the windowed earlier prompts', async () => {
    const conv = await createConversation({ title: 't' });
    for (let i = 0; i < 16; i += 1) {
      await appendMessage(conv.id, { role: 'user', content: `clean question ${i}` });
      await appendMessage(conv.id, { role: 'assistant', content: `clean answer ${i}` });
    }
    await configureCloud();
    const { cloud } = installCloudAndOllama(fetch, { replies: ['Fine.'] });
    await assistant('how many items do I have?', conv.id);
    expect(cloud.sent()).toContain('clean question 15');
    expect(cloud.sent()).not.toContain('clean answer');
  });

  it('only windowed prompts strictly before a tainted turn are sent, none after', async () => {
    const conv = await createConversation({ title: 't' });
    for (let i = 0; i < 3; i += 1) {
      await appendMessage(conv.id, { role: 'user', content: `early question ${i}` });
      await appendMessage(conv.id, { role: 'assistant', content: `early answer ${i}` });
    }
    await appendMessage(conv.id, { role: 'user', content: 'private turn prompt' });
    await appendMessage(conv.id, { role: 'assistant', content: '', toolCalls: [call('p1', 'read_both')] });
    await appendMessage(conv.id, { role: 'tool', content: '{"ok":true}', toolCallId: 'p1' });
    await appendMessage(conv.id, { role: 'user', content: 'after the private turn' });
    await configureCloud();
    const { cloud } = installCloudAndOllama(fetch, { replies: ['Fine.'] });
    await assistant('how many items do I have?', conv.id);
    expect(cloud.sent()).toContain('early question 2');
    expect(cloud.sent()).not.toContain('private turn prompt');
    expect(cloud.sent()).not.toContain('after the private turn');
  });

  it('a local two-category turn whose result the assistant quoted, then a cloud turn', async () => {
    const conv = await createConversation({ title: 't' });
    await appendMessage(conv.id, { role: 'user', content: 'find my notes about sleep' });
    await appendMessage(conv.id, { role: 'assistant', content: '', toolCalls: [call('s1', 'read_both', '{"query":"sleep"}')] });
    await appendMessage(conv.id, { role: 'tool', content: JSON.stringify({ results: [{ kind: 'note', title: 'Day', meta: SENTINELS.notes }] }), toolCallId: 's1' });
    await appendMessage(conv.id, { role: 'assistant', content: `Your note says: "${SENTINELS.notes}"` });
    await configureCloud();
    const { cloud } = installCloudAndOllama(fetch, { replies: ['Fine.'] });
    await assistant('and what else is there?', conv.id);
    expect(cloud.requests.length).toBeGreaterThan(0);
    expect(cloud.sent()).not.toContain(SENTINELS.notes);
    // The turn needed beta, which is withheld, so its prompt is withheld too.
    expect(cloud.sent()).not.toContain('find my notes about sleep');
  });

  describe('historyToMessages', () => {
    const rows = [
      { role: 'tool', content: '{"a":1}', toolCallId: 'x' },
      { role: 'assistant', content: 'cut-off reply' },
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: '', toolCalls: [call('c1', 'read_alpha')] },
      { role: 'tool', content: '{"items":[]}', toolCallId: 'c1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
    ];
    it('drops every row before the first user row, whatever the provider', () => {
      const out = historyToMessages(rows);
      expect(out[0]).toEqual({ role: 'user', content: 'q1' });
      expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'user']);
      expect(historyToMessages(rows.slice(0, 2))).toEqual([]);
    });
    it('under cloud keeps only user messages', () => {
      expect(historyToMessages(rows, { cloud: true })).toEqual([
        { role: 'user', content: 'q1' },
        { role: 'user', content: 'q2' },
      ]);
    });
  });
});

// ---------------------------------------------------------------------------------------------
describe('H3: advice threads under cloud', () => {
  const advise = (body) => request(app).post('/api/assistant/advice').set('X-Forwarded-For', nextIp()).send(body);
  const THREAD = [
    { role: 'user', content: 'what are my notes?' },
    { role: 'assistant', content: `Your item notes: ${SENTINELS.notes}` },
    { role: 'user', content: 'and today?' },
  ];

  it.skipIf(PUBLIC_BUILD)('an items thread holding a local notes answer never sends the assistant message (needs the cloud provider, which is not in a public build)', async () => {
    await configureCloud();
    const { cloud } = installCloudAndOllama(fetch, { replies: ['Fine.'] });
    const res = await advise({ page: 'alpha_page', context: '{"counts":{"total":1}}', messages: THREAD });
    expect(res.status).toBe(200);
    expect(cloud.sent()).not.toContain(SENTINELS.notes);
    expect(cloud.sent()).toContain('what are my notes?');
    expect(cloud.sent()).toContain('and today?');
    expect(cloud.bodies[0].messages.map((m) => m.role)).toEqual(['system', 'user']);
  });

  it('applyPagePolicy: user messages only, joined, under cloud', () => {
    const policy = createAiPolicy({ isCloud: true, categories: null });
    const single = applyPagePolicy({ page: 'alpha_page', context: '{}', messages: THREAD }, policy);
    expect(single.messages).toEqual([{ role: 'user', content: 'what are my notes?\n\nand today?' }]);
  });

  it('local advice is unfiltered', () => {
    const policy = createAiPolicy({ isCloud: false });
    expect(applyPagePolicy({ page: 'alpha_page', context: '{}', messages: THREAD }, policy).messages).toEqual(THREAD);
  });
});

// ---------------------------------------------------------------------------------------------
describe('L1: consent is bound to the exact base URL', () => {
  const putCloud = (body) => request(app).put('/api/settings/ai/cloud').set('X-Forwarded-For', nextIp()).send(body);

  it.skipIf(PUBLIC_BUILD)('a new path on the same host clears consent and goes back to local (needs the cloud provider, which is not in a public build)', async () => {
    await configureCloud();
    installCloudAndOllama(fetch);
    const res = await putCloud({ baseUrl: 'https://api.example.com/v2' });
    expect(res.status).toBe(200);
    expect(res.body.data.cloud.consent.current).toBe(false);
    expect(res.body.data.provider).toBe('ollama');
    expect(await getCloudConsent()).toBeNull();
  });

  it.skipIf(PUBLIC_BUILD)('saving the same URL again (even with a trailing slash) keeps consent (needs the cloud provider, which is not in a public build)', async () => {
    await configureCloud();
    installCloudAndOllama(fetch);
    const res = await putCloud({ baseUrl: 'https://api.example.com/v1/' });
    expect(res.status).toBe(200);
    expect(res.body.data.cloud.consent.current).toBe(true);
    expect(res.body.data.provider).toBe('openai_compat');
  });

  it.skipIf(PUBLIC_BUILD)('enable stores the normalized base URL, and a consent for another path is not current (needs the cloud provider, which is not in a public build)', async () => {
    await configureCloud({ consent: false, provider: 'ollama' });
    installCloudAndOllama(fetch);
    const res = await request(app)
      .post('/api/settings/ai/cloud/enable')
      .set('X-Forwarded-For', nextIp())
      .send({ version: 1, host: CLOUD_HOST, baseUrl: BASE, acknowledgements: [...CLOUD_CONSENT_ACKS] });
    expect(res.status).toBe(200);
    const consent = await getCloudConsent();
    expect(consent.baseUrl).toBe('https://api.example.com/v1');
    expect(isConsentCurrent(consent, CLOUD_HOST, 'https://api.example.com/v1')).toBe(true);
    expect(isConsentCurrent(consent, CLOUD_HOST, 'https://api.example.com/other')).toBe(false);
  });

  it('a stored consent for one path does not cover a saved base URL with another', async () => {
    await configureCloud({ consent: goodConsent({ baseUrl: 'https://api.example.com/v0' }) });
    installCloudAndOllama(fetch);
    expect((await getAiClient({ purpose: 'chat' })).provider).toBe('ollama');
  });
});

// ---------------------------------------------------------------------------------------------
describe.skipIf(PUBLIC_BUILD)('L2: a long Assistant run re-checks the cloud gate and categories before every round (needs the cloud provider, which is not in a public build)', () => {
  const afterFirstCloudCall = (cloud, action) => {
    const original = fetch.getMockImplementation();
    let fired = false;
    fetch.mockImplementation(async (url, init) => {
      const out = await original(url, init);
      if (!fired && cloud.requests.length === 1) {
        fired = true;
        await action();
      }
      return out;
    });
  };

  it('stops with cloud_scope_denied when a category the turn used is withheld mid-run', async () => {
    await configureCloud();
    const { cloud } = installCloudAndOllama(fetch, { replies: [{ toolCalls: [{ name: 'read_alpha' }] }, 'All done.'] });
    afterFirstCloudCall(cloud, () => updateCloudCategories({ alpha: false }));
    const ev = frames((await assistant('what is on my list?')).body);
    expect(cloud.requests).toHaveLength(1);
    const err = ev.find((e) => e.event === 'error');
    expect(err.data.code).toBe('cloud_scope_denied');
    expect(err.data.message).toBe("Your items aren't shared with cloud AI. You can change that in Settings > AI.");
    expect(ev.some((e) => e.event === 'final')).toBe(false);
  });

  it('stops when cloud is turned off (consent cleared) mid-run, without falling back to local', async () => {
    await configureCloud();
    const { cloud } = installCloudAndOllama(fetch, { replies: [{ toolCalls: [{ name: 'read_alpha' }] }, 'All done.'] });
    afterFirstCloudCall(cloud, () => clearCloudConsent());
    const ev = frames((await assistant('totals?')).body);
    expect(cloud.requests).toHaveLength(1);
    const err = ev.find((e) => e.event === 'error');
    expect(err.data.code).toBe('cloud_disabled');
    expect(err.data.message).toBe('Cloud AI was turned off, so nothing was sent. Try again to use the AI on this computer.');
    expect(ev.some((e) => e.event === 'final')).toBe(false);
  });

  it('a run whose gate and categories hold is unaffected', async () => {
    await configureCloud();
    const { cloud } = installCloudAndOllama(fetch, { replies: [{ toolCalls: [{ name: 'read_alpha' }] }, 'All done.'] });
    const ev = frames((await assistant('what is on my list?')).body);
    expect(cloud.requests).toHaveLength(2);
    expect(ev.some((e) => e.event === 'final')).toBe(true);
    expect(ev.some((e) => e.event === 'error')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
describe('L3: literal-IP ranges that look public but are not', () => {
  it.each([
    '192.88.99.1',
    '100::1',
    'fec0::1',
    'fec0:0:0:1::5',
    '64:ff9b:1::1',
    '64:ff9b::a00:1',
    '64:ff9b::10.0.0.1',
    '::ffff:0:a00:1',
    '::ffff:0:10.0.0.1',
    '::ffff:0:7f00:1',
    '0:0:0:0:ffff:0:c0a8:1',
    '0:0:0:0:0:ffff:a00:1',
  ])('%s is not public', (addr) => {
    expect(isPublicIp(addr)).toBe(false);
  });

  it.each(['::ffff:0:808:808', '::ffff:8.8.8.8', '2606:4700:4700::1111', '8.8.8.8'])('%s stays public', (addr) => {
    expect(isPublicIp(addr)).toBe(true);
  });

  it.each([
    'https://192.88.99.1/v1',
    'https://[100::1]/v1',
    'https://[fec0::1]/v1',
    'https://[64:ff9b:1::1]/v1',
    'https://[64:ff9b::a00:1]/v1',
    'https://[::ffff:0:a00:1]/v1',
  ])('validateCloudBaseUrl refuses %s and cloudConfig stays local', async (baseUrl) => {
    expect(validateCloudBaseUrl(baseUrl)).toEqual({ ok: false, reason: 'private_address' });
    await configureCloud({ baseUrl });
    installCloudAndOllama(fetch);
    const client = await getAiClient({ purpose: 'chat' });
    expect(client.provider).toBe('ollama');
    expect(fetch.mock.calls.some(([u]) => String(u).includes('example'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
describe('M2: the scope scan in aiBoundary', () => {
  const problems = (src) => scanModelCalls(src).problems;
  it('accepts an object literal with a real scope key', () => {
    expect(scanModelCalls('ai.complete({ messages, scope: { categories: [] } });')).toEqual({ calls: 1, problems: [] });
    expect(problems("await ai['chatWithTools']({ messages, 'scope': prep.scope })")).toEqual([]);
    expect(problems('for await (const e of ai.stream({ messages, scope })) {}')).toEqual([]);
  });
  it('flags a missing scope, even when the word appears elsewhere', () => {
    expect(problems('ai.complete({ messages, maxTokens: 10 });')).toHaveLength(1);
    expect(problems('// scope: here\nai.complete({ messages }); /* scope */')).toHaveLength(1);
    expect(problems("ai.complete({ messages, note: 'scope' })")).toHaveLength(1);
    expect(problems('ai.complete({ messages, [scope]: 1 })')).toHaveLength(1);
  });
  it('flags scope: undefined, void 0, and a non-literal first argument', () => {
    expect(problems('ai.complete({ messages, scope: undefined })')).toHaveLength(1);
    expect(problems('ai.stream({ messages, scope: void 0 })')).toHaveLength(1);
    expect(problems('ai.complete(opts)')).toHaveLength(1);
    expect(problems('ai.complete({ ...opts })')).toHaveLength(1);
    expect(problems('ai.complete()')).toHaveLength(1);
  });
  it('sees bracket access and optional calls', () => {
    expect(problems("ai['complete']({ messages })")).toHaveLength(1);
    expect(problems('ai.stream?.({ messages })')).toHaveLength(1);
    expect(problems('ai[`chatWithTools`](opts)')).toHaveLength(1);
  });
  it('ignores unrelated calls and mentions in strings or comments', () => {
    expect(scanModelCalls("x.then(() => 1); const s = 'ai.complete(opts)'; // ai.complete(opts)")).toEqual({ calls: 0, problems: [] });
  });
});

// ---------------------------------------------------------------------------------------------
describe('re-review: withheld local turns never send their user prompt to the cloud', () => {
  const seedTurn = async (conv, prompt, name, args) => {
    await appendMessage(conv.id, { role: 'user', content: prompt });
    await appendMessage(conv.id, { role: 'assistant', content: '', toolCalls: [call(`c-${name}`, name, args)] });
    await appendMessage(conv.id, { role: 'tool', content: '{"ok":true}', toolCallId: `c-${name}` });
    await appendMessage(conv.id, { role: 'assistant', content: 'Done.' });
  };

  (PUBLIC_BUILD ? it.skip : it).each([
    ['read_both', `show me my notes about ${SENTINELS.notes}`, 'read_both', '{}'],
    ['removed search_data tool', `look everywhere for ${SENTINELS.notes}`, 'search_data', '{"query":"q"}'],
    ['removed list_items tool', `find ${SENTINELS.notes}`, 'list_items', '{oops'],
  ])('a local %s turn, then a cloud turn (needs the cloud provider, which is not in a public build)', async (_label, prompt, name, args) => {
    const conv = await createConversation({ title: 't' });
    await seedTurn(conv, prompt, name, args);
    await configureCloud();
    const { cloud } = installCloudAndOllama(fetch, { replies: ['Fine.'] });
    const res = await assistant('how many items do I have?', conv.id);
    expect(res.status).toBe(200);
    expect(cloud.requests.length).toBeGreaterThan(0);
    expect(cloud.sent()).not.toContain(prompt);
    for (const sentinel of Object.values(SENTINELS)) expect(cloud.sent(), sentinel).not.toContain(sentinel);
  });

  it.skipIf(PUBLIC_BUILD)('positive control: an allowed items turn keeps its user prompt (needs the cloud provider, which is not in a public build)', async () => {
    const conv = await createConversation({ title: 't' });
    await seedTurn(conv, 'what is on my list?', 'read_alpha', '{}');
    await configureCloud();
    const { cloud } = installCloudAndOllama(fetch, { replies: ['Fine.'] });
    await assistant('and now?', conv.id);
    expect(cloud.sent()).toContain('what is on my list?');
    expect(cloud.sent()).not.toContain('Done.');
  });

  it('the withheld turn and every later turn are dropped, earlier clean turns stay', () => {
    const policy = createAiPolicy({ isCloud: true, categories: null });
    const rows = [
      { role: 'user', content: 'clean one' },
      { role: 'assistant', content: '', toolCalls: [call('a', 'read_alpha')] },
      { role: 'user', content: 'private one' },
      { role: 'assistant', content: '', toolCalls: [call('b', 'read_both')] },
      { role: 'user', content: 'later one' },
      { role: 'assistant', content: 'plain reply' },
    ];
    expect(cloudHistoryUserRows(rows, policy).map((r) => r.content)).toEqual(['clean one']);
  });

  it('a read_both turn needs both of its categories: beta shared with alpha withheld still drops it', () => {
    const rows = [
      { role: 'user', content: 'private one' },
      { role: 'assistant', content: '', toolCalls: [call('a', 'read_both')] },
      { role: 'user', content: 'later one' },
    ];
    const sent = (categories) => cloudHistoryUserRows(rows, createAiPolicy({ isCloud: true, categories })).map((r) => r.content);
    expect(sent({ beta: true, alpha: false })).toEqual([]);
    expect(sent({ beta: true })).toEqual(['private one', 'later one']);
  });

  it('an unknown tool taints its turn; a tool with no private data does not; string or object arguments both parse', () => {
    const policy = createAiPolicy({ isCloud: true, categories: null });
    const unknown = [{ role: 'user', content: 'u' }, { role: 'assistant', content: '', toolCalls: [call('a', 'mystery_tool')] }];
    expect(cloudHistoryUserRows(unknown, policy)).toEqual([]);
    const ok = [
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: '', toolCalls: [call('a', 'read_public', '{"q":"x"}')] },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'b', function: { name: 'read_public', arguments: { q: 'x' } } }] },
    ];
    expect(cloudHistoryUserRows(ok, policy).map((r) => r.content)).toEqual(['u1', 'u2']);
  });

  it('M1: string, object or undecodable tool_calls taint; null is clean unless a tool row is orphaned', () => {
    const policy = createAiPolicy({ isCloud: true, categories: null });
    const turn = (toolCalls, extra = []) => [
      { role: 'user', content: 'p' },
      { role: 'assistant', content: '', toolCalls },
      ...extra,
      { role: 'user', content: 'q' },
    ];
    const sent = (rows) => cloudHistoryUserRows(rows, policy).map((r) => r.content);
    // A double-encoded value decodes to a string: parsed once, then judged like an array.
    expect(sent(turn(JSON.stringify([call('a', 'read_both')])))).toEqual([]);
    expect(sent(turn(JSON.stringify([call('a', 'read_alpha')])))).toEqual(['p', 'q']);
    expect(sent(turn('{not json'))).toEqual([]);
    expect(sent(turn(JSON.stringify(JSON.stringify([call('a', 'read_alpha')]))))).toEqual([]);
    // An object (not an array) cannot be inspected.
    expect(sent(turn({ id: 'a', function: { name: 'read_alpha' } }))).toEqual([]);
    // null with no tool row is a plain reply.
    expect(sent(turn(null))).toEqual(['p', 'q']);
    // null with a tool row nobody declared: provenance unknown.
    expect(sent(turn(null, [{ role: 'tool', content: '{}', toolCallId: 'x' }]))).toEqual([]);
    expect(sent(turn(null, [{ role: 'tool', content: '{}' }]))).toEqual([]);
    // A tool row that answers a call declared in the same turn is fine.
    expect(sent(turn([call('a', 'read_alpha')], [{ role: 'tool', content: '{}', toolCallId: 'a' }]))).toEqual(['p', 'q']);
    // A declaration in an earlier turn does not cover a later turn's tool row.
    const split = [
      { role: 'user', content: 'p' },
      { role: 'assistant', content: '', toolCalls: [call('a', 'read_alpha')] },
      { role: 'user', content: 'q' },
      { role: 'tool', content: '{}', toolCallId: 'a' },
    ];
    expect(sent(split)).toEqual(['p']);
  });

  it('M2: a user row directly followed by another user row shares the next turn fate', () => {
    const policy = createAiPolicy({ isCloud: true, categories: null });
    const sent = (rows) => cloudHistoryUserRows(rows, policy).map((r) => r.content);
    // Runs X and Y interleave: X user, Y user, X assistant (withheld tool).
    const tainted = [
      { role: 'user', content: 'X private' },
      { role: 'user', content: 'Y innocent' },
      { role: 'assistant', content: '', toolCalls: [call('a', 'read_both')] },
      { role: 'user', content: 'later' },
    ];
    expect(sent(tainted)).toEqual([]);
    const clean = [
      { role: 'user', content: 'X' },
      { role: 'user', content: 'Y' },
      { role: 'assistant', content: 'plain' },
      { role: 'user', content: 'later' },
    ];
    expect(sent(clean)).toEqual(['X', 'Y', 'later']);
    // An earlier clean turn survives a tainted interleaved pair.
    expect(sent([{ role: 'user', content: 'ok' }, { role: 'assistant', content: 'r' }, ...tainted])).toEqual(['ok']);
  });

  it('L1: historyToMessages with whole-conversation rows drops windowed prompts after a withheld turn', () => {
    const policy = createAiPolicy({ isCloud: true, categories: null });
    const full = [
      { id: '1', role: 'user' },
      { id: '2', role: 'assistant', toolCalls: [call('a', 'read_both')] },
      { id: '3', role: 'tool', toolCallId: 'a' },
      { id: '4', role: 'user' },
      { id: '5', role: 'assistant', toolCalls: null },
    ];
    const windowed = [
      { id: '3', role: 'tool', content: '{}', toolCallId: 'a' },
      { id: '4', role: 'user', content: 'after' },
      { id: '5', role: 'assistant', content: 'r' },
    ];
    expect(historyToMessages(windowed, { cloud: true, policy })).toEqual([{ role: 'user', content: 'after' }]);
    expect(historyToMessages(windowed, { cloud: true, policy, taintRows: full })).toEqual([]);
  });

  it('historyToMessages under cloud applies the policy, and a local client keeps everything', () => {
    const policy = createAiPolicy({ isCloud: true, categories: null });
    const rows = [
      { role: 'user', content: 'p' },
      { role: 'assistant', content: '', toolCalls: [call('a', 'read_both')] },
    ];
    expect(historyToMessages(rows, { cloud: true, policy })).toEqual([]);
    expect(historyToMessages(rows).map((m) => m.role)).toEqual(['user', 'assistant']);
  });
});

// ---------------------------------------------------------------------------------------------
describe('re-review: imported ai.settings cannot repoint the Ollama host', () => {
  it('ollamaHost from the archive is ignored and the saved one is kept', async () => {
    await setState('ai.settings', { provider: 'ollama', ollamaHost: 'http://192.168.0.5:11434' });
    importZipBuffer(exportZip([row('ai.settings', { chatModel: 'llama3.2:3b', ollamaHost: 'http://203.0.113.9:11434' })]));
    const settings = await getState('ai.settings', null);
    expect(settings.ollamaHost).toBe('http://192.168.0.5:11434');
    expect(settings.chatModel).toBe('llama3.2:3b');
  });

  it('with no saved host, an imported one is not added', async () => {
    importZipBuffer(exportZip([row('ai.settings', { chatModel: 'llama3.2:3b', ollamaHost: 'http://203.0.113.9:11434' })]));
    expect(await getState('ai.settings', null)).toEqual({ chatModel: 'llama3.2:3b' });
  });
});

// ---------------------------------------------------------------------------------------------
describe('re-review: turning cloudAi off in Network settings ends the cloud setup', () => {
  const putNetwork = (body) => request(app).put('/api/settings/network').set('X-Forwarded-For', nextIp()).send(body);

  it('clears consent, returns the provider to ollama and writes a disabled audit row', async () => {
    await configureCloud();
    const res = await putNetwork({ id: 'cloudAi', enabled: false });
    expect(res.status).toBe(200);
    expect(await getCloudConsent()).toBeNull();
    expect((await getState('ai.settings', null)).provider).toBe('ollama');
    const rows = (await listAudit({ limit: 100 })).entries.filter((e) => e.feature === 'cloud_ai_consent');
    expect(rows.map((r) => r.meta.action)).toEqual(['disabled']);
    __resetAiForTests();
    installCloudAndOllama(fetch);
    expect((await getAiClient({ purpose: 'chat' })).provider).toBe('ollama');
  });

  it.skipIf(PUBLIC_BUILD)('turning it on, or another feature off, does not touch consent (needs the cloud provider, which is not in a public build)', async () => {
    await configureCloud();
    expect((await putNetwork({ id: 'cloudAi', enabled: true })).status).toBe(200);
    expect((await putNetwork({ id: 'updates', enabled: false })).status).toBe(200);
    expect(await getCloudConsent()).not.toBeNull();
    expect((await getState('ai.settings', null)).provider).toBe('openai_compat');
  });
});
