// Audit rows for cloud AI record where data went (kind, host) and which category NAMES were
// shared or withheld, never content. A sentinel planted in withheld data, and the API key, must
// never appear in any audit row, whatever route wrote it.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_BUILD } from './helpers/proBuild.js';
// Pro is on for this file (the Pro gate itself is covered in proGating.test.js).
vi.mock('../license/index.js', async (importOriginal) => (await import('./helpers/pro.js')).mockLicenseModule(importOriginal));
import request from 'supertest';

vi.mock('../../loadEnv.js', () => ({}));
vi.mock('node-fetch', () => ({ default: vi.fn() }));
// Fixture categories and pages next to the real list_features tool (Studio has no Assistant pages of its own).
vi.mock('../modules/studio.data.js', (orig) => import('./helpers/fixtureModules.js').then((m) => m.withFixtureCategories(orig, { keepReal: true })));
vi.mock('../../src/modules/studio.assistant.js', (orig) => import('./helpers/fixtureModules.js').then((m) => m.withFixturePages(orig)));

import fetch from 'node-fetch';
import { textReply, toolReply } from './helpers/fakeOllama.js';
import { CLOUD_HOST, CLOUD_KEY, SENTINELS, configureCloud, installCloudAndOllama, resetCloud } from './helpers/fakeCloud.js';
import { closeTestDb, createTestDb, resetDb, rowsOf } from './helpers/testDb.js';
import { seedFeature } from './helpers/seedFeature.js';
import { aiAuditMeta } from '../ai/privacy.js';
import { createAiClient } from '../ai/registry.js';
import { normalizeAuditEvent } from '../audit.js';

let app;
let db;
let ip = 0;
const nextIp = () => `192.0.2.${(ip += 1) % 250}`;
const saved = Object.fromEntries(['APP_PASSWORD', 'AUTH_SECRET', 'SECRETS_ENCRYPTION_KEY', 'APP_AI'].map((k) => [k, process.env[k]]));

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

const post = (path, body, headers = {}) => {
  const req = request(app).post(path).set('X-Forwarded-For', nextIp());
  for (const [k, v] of Object.entries(headers)) req.set(k, v);
  return req.send(body);
};
const rows = (feature) => rowsOf(db, 'audit_log').filter((r) => (feature ? r.feature === feature : true));
const everything = () => JSON.stringify(rowsOf(db, 'audit_log'));
const expectClean = () => {
  const all = everything();
  for (const s of Object.values(SENTINELS)) expect(all, s).not.toContain(s);
  expect(all).not.toContain(CLOUD_KEY);
};
const askAssistant = (prompt, extra = {}) =>
  request(app)
    .post('/api/assistant')
    .set('X-Forwarded-For', nextIp())
    .send({ prompt, ...extra })
    .buffer(true)
    .parse((r, cb) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => cb(null, d));
    });

describe('advice', () => {
  it.skipIf(PUBLIC_BUILD)('a blocked cloud page records the host and the withheld name, and none of the page context (needs the cloud provider, which is not in a public build)', async () => {
    await configureCloud({ categories: { alpha: false } });
    installCloudAndOllama(fetch);
    const res = await post('/api/assistant/advice', { page: 'alpha_page', context: JSON.stringify({ body: SENTINELS.items }), messages: [{ role: 'user', content: 'how am I doing?' }] });
    expect(res.body.data.blocked).toBe(true);
    const [row] = rows('assistant_advice');
    expect(row).toMatchObject({ kind: 'llm', provider: 'openai_compat', status: 'ok' });
    expect(row.meta).toEqual({ calls: 0, ms: expect.any(Number), ai_kind: 'cloud', ai_host: CLOUD_HOST, shared: [], withheld: ['alpha'] });
    expect(row.context).not.toContain(SENTINELS.items);
    expectClean();
  });

  it.skipIf(PUBLIC_BUILD)('a cloud page records the context that was sent, with the shared name (needs the cloud provider, which is not in a public build)', async () => {
    await configureCloud();
    installCloudAndOllama(fetch, { replies: ['- ok'] });
    const context = JSON.stringify({ counts: { total: 3 }, 'total value in dollars': 42 });
    await post('/api/assistant/advice', { page: 'alpha_page', context, messages: [{ role: 'user', content: 'what now?' }] });
    const [row] = rows('assistant_advice');
    expect(row.meta).toMatchObject({ ai_kind: 'cloud', ai_host: CLOUD_HOST, calls: 1, shared: ['alpha'], withheld: [] });
    expect(row.context).toContain('total');
    expect(row.context).toContain('what now?');
    expectClean();
  });

  it.skipIf(PUBLIC_BUILD)('a failed cloud call still records only what was sent (needs the cloud provider, which is not in a public build)', async () => {
    await configureCloud();
    fetch.mockRejectedValue(Object.assign(new Error(`down ${SENTINELS.memory}`), { code: 'ECONNREFUSED' }));
    const context = JSON.stringify({ counts: { total: 2 } });
    const res = await post('/api/assistant/advice', { page: 'alpha_page', context, messages: [{ role: 'user', content: 'q' }] });
    expect(res.status).toBeGreaterThanOrEqual(500);
    const [row] = rows('assistant_advice');
    expect(row.status).toBe('error');
    expect(row.meta).toMatchObject({ ai_kind: 'cloud', ai_host: CLOUD_HOST });
    expect(row.context).toContain('total');
    expectClean();
  });

  it('a local call records only ai_kind local: no host, no category lists', async () => {
    installCloudAndOllama(fetch, { ollama: { replies: [textReply('- fine')] } });
    await post('/api/assistant/advice', { page: 'alpha_page', context: JSON.stringify({ body: 'local text' }), messages: [{ role: 'user', content: 'q' }] });
    const [row] = rows('assistant_advice');
    expect(row.meta).toEqual({ calls: 1, ms: expect.any(Number), ai_kind: 'local' });
    expect(row.context).toContain('local text');
  });
});

describe('assistant', () => {
  it.skipIf(PUBLIC_BUILD)('a cloud turn records the host and the names of what was shared and withheld (needs the cloud provider, which is not in a public build)', async () => {
    seedFeature({ description: `Number row ${SENTINELS.notes}` });
    await configureCloud();
    installCloudAndOllama(fetch, { replies: [{ toolCalls: [{ name: 'read_both' }, { name: 'list_features' }] }, 'Done.'] });
    await askAssistant('what is going on?');
    const [row] = rows('assistant');
    expect(row).toMatchObject({ kind: 'llm', provider: 'openai_compat', context: 'what is going on?', status: 'ok' });
    expect(row.meta).toMatchObject({ calls: 2, ai_kind: 'cloud', ai_host: CLOUD_HOST, shared: ['features'], withheld: ['beta'] });
    expect(everything()).not.toContain(SENTINELS.notes);
    expectClean();
  });

  it.skipIf(PUBLIC_BUILD)('with beta shared too, a two-category tool records both of its categories as shared (needs the cloud provider, which is not in a public build)', async () => {
    await configureCloud({ categories: { beta: true } });
    installCloudAndOllama(fetch, { replies: [{ toolCalls: [{ name: 'read_both' }] }, 'Done.'] });
    await askAssistant('what is going on?');
    expect(rows('assistant')[0].meta).toMatchObject({ ai_kind: 'cloud', shared: ['alpha', 'beta'], withheld: [] });
  });

  it.skipIf(PUBLIC_BUILD)('with beta shared but alpha withheld, a two-category tool records alpha as withheld and beta as not shared (needs the cloud provider, which is not in a public build)', async () => {
    await configureCloud({ categories: { beta: true, alpha: false } });
    installCloudAndOllama(fetch, { replies: [{ toolCalls: [{ name: 'read_both' }] }, 'No access.'] });
    await askAssistant('what did I write?');
    const meta = rows('assistant')[0].meta;
    expect(meta).toMatchObject({ ai_kind: 'cloud', shared: [], withheld: ['alpha'] });
    expect(meta.shared).not.toContain('beta');
  });

  it.skipIf(PUBLIC_BUILD)('a refused tool alone is still recorded as withheld even when no further call shared anything (needs the cloud provider, which is not in a public build)', async () => {
    await configureCloud({ categories: { features: false } });
    installCloudAndOllama(fetch, { replies: [{ toolCalls: [{ name: 'list_features' }] }, 'No access.'] });
    await askAssistant('what features did I save?');
    expect(rows('assistant')[0].meta).toMatchObject({ ai_kind: 'cloud', shared: [], withheld: ['features'] });
  });

  it('a local turn records only ai_kind local', async () => {
    seedFeature({ description: 'local entry' });
    installCloudAndOllama(fetch, { ollama: { replies: [toolReply([{ name: 'list_features', arguments: {} }]), textReply('You saved one.')] } });
    await askAssistant('what did I save?');
    expect(rows('assistant')[0].meta).toEqual({ calls: 2, ms: expect.any(Number), ai_kind: 'local' });
  });
});

describe.skipIf(PUBLIC_BUILD)('consent changes (needs the cloud provider, which is not in a public build)', () => {
  it('enable, categories and disable are audited with names only and never the key', async () => {
    await configureCloud({ consent: false, optIn: false, provider: 'ollama' });
    installCloudAndOllama(fetch);
    await request(app).put('/api/settings/ai/cloud-categories').set('X-Forwarded-For', nextIp()).send({ categories: { features: false } });
    await post('/api/settings/ai/cloud/enable', { version: 1, host: CLOUD_HOST, baseUrl: `https://${CLOUD_HOST}/v1`, acknowledgements: ['sends_data', 'pay_provider'] });
    await post('/api/settings/ai/cloud/disable', {});
    const metas = rows('cloud_ai_consent')
      .map((r) => r.meta)
      .sort((a, b) => a.action.localeCompare(b.action));
    expect(metas.map((m) => m.action)).toEqual(['categories', 'disabled', 'enabled']);
    expect(metas.find((m) => m.action === 'enabled')).toEqual({ action: 'enabled', ai_host: CLOUD_HOST, version: 1 });
    expect(metas.find((m) => m.action === 'categories').withheld).toContain('features');
    expectClean();
  });
});

describe('aiAuditMeta and the audit sanitiser', () => {
  const client = (kind, host, report) => ({ ai: { kind, host }, dataReport: () => report });

  it('local and lan record the kind alone', () => {
    expect(aiAuditMeta(client('local', null, { shared: ['features'], withheld: [] }))).toEqual({ ai_kind: 'local' });
    expect(aiAuditMeta(client('lan', '192.0.2.50', { shared: ['features'], withheld: [] }))).toEqual({ ai_kind: 'lan' });
    expect(aiAuditMeta(null)).toEqual({ ai_kind: 'local' });
    expect(aiAuditMeta({})).toEqual({ ai_kind: 'local' });
  });

  it('cloud records the host and the category names', () => {
    expect(aiAuditMeta(client('cloud', CLOUD_HOST, { shared: ['features'], withheld: ['alpha'] }))).toEqual({
      ai_kind: 'cloud',
      ai_host: CLOUD_HOST,
      shared: ['features'],
      withheld: ['alpha'],
    });
  });

  it('a real cloud client reports the names it accumulated', async () => {
    const transport = async function* () {
      yield { type: 'token', text: 'ok' };
      yield { type: 'done', usage: null, finishReason: 'stop' };
    };
    const real = createAiClient({ provider: 'openai_compat', kind: 'cloud', aiHost: CLOUD_HOST, model: 'm', purpose: 'chat', numCtx: 8192, transport, authorizeSend: async () => ({}) });
    await real.complete({ messages: [{ role: 'user', content: 'x' }], scope: { categories: ['features'], withheld: ['alpha'] } });
    expect(aiAuditMeta(real)).toEqual({ ai_kind: 'cloud', ai_host: CLOUD_HOST, shared: ['features'], withheld: ['alpha'] });
  });

  it('refuses to build a cloud client without authorizeSend', () => {
    const transport = async function* () {};
    expect(() => createAiClient({ provider: 'openai_compat', model: 'm', purpose: 'chat', numCtx: 8192, transport })).toThrow(/authorizeSend/);
  });

  it('the sanitiser keeps those fields, clips a long host to 100 characters and drops free text in the lists', () => {
    const host = `${'a'.repeat(30)}.${'b'.repeat(30)}.example.com`;
    const row = normalizeAuditEvent({
      kind: 'llm',
      feature: 'assistant_advice',
      status: 'ok',
      meta: { ai_kind: 'cloud', ai_host: host, shared: ['features', 'my private diary entry', 'alpha'], withheld: ['alpha'] },
    });
    expect(row.meta).toEqual({ ai_kind: 'cloud', ai_host: host, shared: ['features', 'alpha'], withheld: ['alpha'] });
    const long = normalizeAuditEvent({ kind: 'llm', feature: 'assistant_advice', meta: { ai_host: 'ab.'.repeat(60) } });
    expect(long.meta.ai_host).toHaveLength(100);
  });
});
