// A cloud-off build (APP_CLOUD_AI=off): the server answers as if the cloud provider did not exist.
// Through the real server.js on a temp database, with APP_CLOUD_AI stubbed to `off`; leftover cloud
// state from an earlier cloud build is ignored and never deleted. No real network.
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_BUILD } from './helpers/proBuild.js';
import request from 'supertest';

vi.mock('../../loadEnv.js', () => ({}));
vi.mock('node-fetch', () => ({ default: vi.fn() }));
vi.mock('../ai/providers/openaiCompat.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, openaiCompatChatStream: vi.fn(actual.openaiCompatChatStream) };
});

import fetch from 'node-fetch';
import { openaiCompatChatStream } from '../ai/providers/openaiCompat.js';
import { CLOUD_BASE_URL, CLOUD_HOST, CLOUD_KEY, configureCloud, installCloudAndOllama, resetCloud } from './helpers/fakeCloud.js';
import { closeTestDb, createTestDb, resetDb } from './helpers/testDb.js';
import { featureUnavailableBody } from '../buildFeatures.js';
import { getAiClient, getAiStatus, getCloudHint, isCloudStillAllowed } from '../ai/index.js';
import { getCloudConsent } from '../ai/consent.js';
import { getAiSettings } from '../ai/settings.js';
import { NETWORK_STATE_KEY, __resetNetPolicyForTests, assertNetworkEnabled, isEnabled, requireNetwork } from '../netPolicy.js';
import { getState } from '../dataAccess.js';
import { __configureSecretsForTests, __resetSecretsForTests } from '../secrets/getSecret.js';

const BODY = { error: 'feature_unavailable', code: 'feature_unavailable', feature: 'cloudAi', message: 'This build contains no cloud provider.' };
const ENVELOPE = { code: 'feature_unavailable', feature: 'cloudAi', error: BODY.message, message: BODY.message };
const ACKS = ['sends_data', 'pay_provider'];

let app;
let db;
let ip = 0;
const nextIp = () => `198.51.100.${(ip += 1) % 250}`;
const call = (method, path, body) => {
  const r = request(app)[method](path).set('X-Forwarded-For', nextIp());
  return body === undefined ? r : r.send(body);
};
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
  openaiCompatChatStream.mockClear();
  await resetCloud();
  installCloudAndOllama(fetch);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const off = () => vi.stubEnv('APP_CLOUD_AI', 'off');
const stored = async () => (await getState(NETWORK_STATE_KEY, null)) ?? {};

describe('GET /api/app/info', () => {
  it('says the cloud provider is absent', async () => {
    off();
    const res = await call('get', '/api/app/info');
    expect(res.body.data.cloudAi).toBe('absent');
  });

  it.skipIf(PUBLIC_BUILD)('says it is present in a default build (needs the cloud provider, which is not in a public build)', async () => {
    const res = await call('get', '/api/app/info');
    expect(res.body.data.cloudAi).toBe('present');
  });
});

describe('network features', () => {
  it('lists cloudAi as unavailable and off, even when pre-enabled and stored on', async () => {
    off();
    vi.stubEnv('APP_NETWORK_OPTIN', 'cloudAi');
    await configureCloud();
    vi.stubEnv('APP_NETWORK_OPTIN', 'cloudAi');
    __resetNetPolicyForTests();
    const res = await call('get', '/api/settings/network');
    const byId = Object.fromEntries(res.body.features.map((f) => [f.id, f]));
    expect(byId.cloudAi).toMatchObject({ available: false, enabled: false });
    for (const id of ['aiLan', 'updates', 'license']) expect(byId[id].available).toBe(true);
    expect(await isEnabled('cloudAi')).toBe(false);
  });

  it.skipIf(PUBLIC_BUILD)('lists every feature as available in a default build (needs the cloud provider, which is not in a public build)', async () => {
    const res = await call('get', '/api/settings/network');
    expect(res.body.features.every((f) => f.available === true)).toBe(true);
  });

  it('refuses to turn cloudAi on with the exact 403 body and leaves the state alone', async () => {
    off();
    const before = await stored();
    const res = await call('put', '/api/settings/network', { id: 'cloudAi', enabled: true });
    expect(res.status).toBe(403);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject(ENVELOPE);
    expect(await stored()).toEqual(before);
  });

  it('still allows turning cloudAi off, and other features on', async () => {
    off();
    expect((await call('put', '/api/settings/network', { id: 'cloudAi', enabled: false })).status).toBe(200);
    const other = await call('put', '/api/settings/network', { id: 'updates', enabled: true });
    expect(other.status).toBe(200);
    expect(other.body.features.find((f) => f.id === 'updates').enabled).toBe(true);
  });

  it('isEnabled, assertNetworkEnabled and requireNetwork all say the build has no cloud provider', async () => {
    off();
    await configureCloud();
    expect(await isEnabled('cloudAi')).toBe(false);
    await expect(assertNetworkEnabled('cloudAi')).rejects.toMatchObject({ name: 'FeatureUnavailableError', status: 403, feature: 'cloudAi', body: BODY });
    const res = { req: { originalUrl: '/api/settings/ai/cloud' }, set: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await requireNetwork('cloudAi')({}, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'feature_unavailable', feature: 'cloudAi', message: featureUnavailableBody('cloudAi').message }),
    );
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
});

describe('AI settings routes', () => {
  const cloudWrites = [
    ['put', '/api/settings/ai/cloud', { baseUrl: CLOUD_BASE_URL, model: 'cloud-model' }],
    ['put', '/api/settings/ai/cloud-categories', { categories: { features: false } }],
    ['post', '/api/settings/ai/cloud/enable', { version: 1, host: CLOUD_HOST, baseUrl: CLOUD_BASE_URL, acknowledgements: ACKS }],
    ['post', '/api/settings/ai/cloud-hint', { event: 'shown' }],
    ['put', '/api/settings/ai/provider', { provider: 'openai_compat' }],
  ];

  it.each(cloudWrites)('%s %s answers 403 feature_unavailable', async (method, path, body) => {
    off();
    const res = await call(method, path, body);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject(ENVELOPE);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it.each(cloudWrites.slice(0, 4))('%s %s refuses before it validates a malformed body', async (method, path) => {
    off();
    for (const bad of [{}, { junk: true }, 'not json object']) {
      const res = await call(method, path, bad);
      expect(res.status, JSON.stringify(bad)).toBe(403);
      expect(res.body).toMatchObject(ENVELOPE);
    }
  });

  it('PUT /provider still validates first, and still accepts ollama', async () => {
    off();
    expect((await call('put', '/api/settings/ai/provider', { provider: 'nope' })).status).toBe(400);
    const ok = await call('put', '/api/settings/ai/provider', { provider: 'ollama' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.provider).toBe('ollama');
  });

  it('POST /cloud/disable stays 200', async () => {
    off();
    const res = await call('post', '/api/settings/ai/cloud/disable');
    expect(res.status).toBe(200);
    expect(res.body.data.cloud.build).toBe('absent');
  });

  it.skipIf(PUBLIC_BUILD)('GET reports cloud.build absent and provider ollama even after a full cloud setup (needs the cloud provider, which is not in a public build)', async () => {
    await configureCloud();
    expect((await call('get', '/api/settings/ai')).body.data).toMatchObject({ provider: 'openai_compat', cloud: { build: 'present', active: true } });
    off();
    const { data } = (await call('get', '/api/settings/ai')).body;
    expect(data.provider).toBe('ollama');
    expect(data.effectiveProvider).toBe('ollama');
    expect(data.cloud).toEqual({
      build: 'absent',
      optIn: false,
      keySaved: false,
      baseUrl: null,
      host: null,
      model: null,
      tokenParam: 'max_tokens',
      ready: false,
      consent: { current: false, acceptedAt: null, host: null, version: null },
      consentVersion: 1,
      categories: { features: true },
      active: false,
    });
    expect(JSON.stringify(data)).not.toContain(CLOUD_KEY);
  });

  it('leftover cloud state is ignored, not deleted', async () => {
    await configureCloud();
    off();
    await call('get', '/api/settings/ai');
    await call('post', '/api/settings/ai/cloud/disable');
    // disable is the one cloud write allowed: it ends the setup like in any build.
    expect((await getAiSettings()).provider).toBe('ollama');
    expect((await getAiSettings()).cloud.baseUrl).toBe(CLOUD_BASE_URL);
  });
});

describe('the AI registry', () => {
  it('falls back to Ollama for a fully configured leftover cloud setup and never calls the transport', async () => {
    await configureCloud();
    off();
    const client = await getAiClient({ purpose: 'chat' });
    expect(client.provider).toBe('ollama');
    expect(client.isCloud).toBe(false);
    await client.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(openaiCompatChatStream).not.toHaveBeenCalled();
    expect(fetch.mock.calls.some(([url]) => String(url).includes(CLOUD_HOST))).toBe(false);
    expect(await isCloudStillAllowed()).toBe(false);
    expect((await getAiStatus()).cloud.build).toBe('absent');
  });

  it('shows no cloud hint', async () => {
    off();
    expect(await getCloudHint({ ai: { kind: 'local' }, available: true, totalmem: () => 1024 ** 3, state: { lastShownAt: null } })).toEqual({ show: false, reason: null });
  });
});

describe('secrets', () => {
  let decryptWarn;
  beforeEach(() => {
    __resetSecretsForTests();
    const rows = new Map([
      ['AI_CLOUD_API_KEY', { name: 'AI_CLOUD_API_KEY', ciphertext: 'AAAA', iv: 'AAAA', auth_tag: 'AAAA', last4: 'wxyz', updated_at: '2026-01-01T00:00:00.000Z' }],
    ]);
    __configureSecretsForTests({
      env: { SECRETS_ENCRYPTION_KEY: randomBytes(32).toString('base64'), AI_CLOUD_API_KEY: CLOUD_KEY },
      store: {
        list: async () => [...rows.values()],
        upsert: async (row) => rows.set(row.name, row),
        remove: async (name) => rows.delete(name),
      },
    });
    decryptWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => __resetSecretsForTests());

  it('never decrypts the stored cloud key and never lists it', async () => {
    off();
    const res = await call('get', '/api/secrets');
    expect(res.status).toBe(200);
    expect(res.body.secrets.map((s) => s.name)).not.toContain('AI_CLOUD_API_KEY');
    expect(decryptWarn.mock.calls.flat().join(' ')).not.toContain('AI_CLOUD_API_KEY');
    expect(JSON.stringify(res.body)).not.toContain(CLOUD_KEY);
  });

  it('answers 404 unknown_secret on every secrets route for the cloud key', async () => {
    off();
    const put = await call('put', '/api/secrets/AI_CLOUD_API_KEY', { value: `sk-${'a'.repeat(30)}` });
    const del = await call('delete', '/api/secrets/AI_CLOUD_API_KEY');
    const test = await call('post', '/api/secrets/AI_CLOUD_API_KEY/test');
    for (const res of [put, del, test]) {
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('unknown_secret');
    }
  });

  it.skipIf(PUBLIC_BUILD)('lists the cloud key in a default build (needs the cloud provider, which is not in a public build)', async () => {
    const res = await call('get', '/api/secrets');
    expect(res.body.secrets.map((s) => s.name)).toContain('AI_CLOUD_API_KEY');
  });
});

describe('what a cloud-off build still does', () => {
  it('keeps the Ollama on another machine opt-in, the audit log and the network activity log', async () => {
    off();
    expect((await call('put', '/api/settings/network', { id: 'aiLan', enabled: true })).status).toBe(200);
    expect(await isEnabled('aiLan')).toBe(true);
    expect((await call('get', '/api/audit')).status).toBe(200);
    expect((await call('get', '/api/privacy/network-activity')).status).toBe(200);
  });

  it('keeps the user-clicked model download route reachable', async () => {
    off();
    const res = await call('post', '/api/settings/ai/pull', { model: 'not-a-suggested-model' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_model');
  });

  it('leaves the consent record in place', async () => {
    await configureCloud();
    off();
    await call('get', '/api/settings/ai');
    expect(await getCloudConsent()).not.toBeNull();
  });
});
