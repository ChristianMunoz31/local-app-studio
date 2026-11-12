// Cloud-off build, gap pass: the stored/env cloud key is never read, the registry never builds a cloud
// client (even with the opt-in env), the aiLan gate and the model download stay as in a default build.
// Real server.js on a temp database, APP_CLOUD_AI stubbed to `off`. No real network.
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_BUILD } from './helpers/proBuild.js';
import request from 'supertest';

vi.mock('../../loadEnv.js', () => ({}));
vi.mock('node-fetch', () => ({ default: vi.fn() }));
vi.mock('../secrets/index.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getSecret: vi.fn(actual.getSecret), peekSecret: vi.fn(actual.peekSecret) };
});
vi.mock('../secrets/crypto.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, decryptSecret: vi.fn(actual.decryptSecret) };
});

import fetch from 'node-fetch';
import { getSecret, peekSecret } from '../secrets/index.js';
import { decryptSecret, encryptSecret, last4 } from '../secrets/crypto.js';
import { CLOUD_HOST, CLOUD_KEY, configureCloud, installCloudAndOllama, resetCloud } from './helpers/fakeCloud.js';
import { installFakeOllama } from './helpers/fakeOllama.js';
import { closeTestDb, createTestDb, resetDb } from './helpers/testDb.js';
import { getAiClient, getAiStatus } from '../ai/index.js';
import { AI_SETTINGS_KEY } from '../ai/settings.js';
import { NETWORK_STATE_KEY, __resetNetPolicyForTests, isEnabled, listNetworkFeatures } from '../netPolicy.js';
import { getState, setState } from '../dataAccess.js';
import { __configureSecretsForTests, __resetSecretsForTests } from '../secrets/getSecret.js';
import { splitSseChunks, parseSseChunk } from '../../src/utils/sse.js';

const KEY_NAME = 'AI_CLOUD_API_KEY';
let app;
let db;
let ip = 0;
const nextIp = () => `203.0.113.${(ip += 1) % 250}`;
const call = (method, path, body) => {
  const r = request(app)[method](path).set('X-Forwarded-For', nextIp());
  return body === undefined ? r : r.send(body);
};
const saved = Object.fromEntries(['APP_PASSWORD', 'AUTH_SECRET', 'SECRETS_ENCRYPTION_KEY', 'APP_AI', 'OLLAMA_HOST'].map((k) => [k, process.env[k]]));
const off = () => vi.stubEnv('APP_CLOUD_AI', 'off');
const asksForCloudKey = (mock) => mock.mock.calls.some(([name]) => name === KEY_NAME);
const decryptsCloudKey = () => decryptSecret.mock.calls.some(([, name]) => name === KEY_NAME);

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
  getSecret.mockClear();
  peekSecret.mockClear();
  decryptSecret.mockClear();
  await resetCloud();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  __resetSecretsForTests();
});

/** A secrets store holding a real encrypted cloud key, so a decrypt would really happen. */
function storeEncryptedCloudKey() {
  const key = randomBytes(32);
  const enc = encryptSecret(CLOUD_KEY, KEY_NAME, key);
  const row = { name: KEY_NAME, ciphertext: enc.ciphertext, iv: enc.iv, auth_tag: enc.authTag, last4: last4(CLOUD_KEY), updated_at: '2026-01-01T00:00:00.000Z' };
  __configureSecretsForTests({
    env: { SECRETS_ENCRYPTION_KEY: key.toString('base64'), [KEY_NAME]: CLOUD_KEY },
    store: { list: async () => [row], upsert: async () => {}, remove: async () => {} },
  });
}

describe('the saved cloud key is never read in a cloud-off build', () => {
  it.skipIf(PUBLIC_BUILD)('control: a default build does read it (so the spies below can fail) (needs the cloud provider, which is not in a public build)', async () => {
    installCloudAndOllama(fetch);
    await configureCloud();
    storeEncryptedCloudKey();
    await call('get', '/api/secrets');
    await call('get', '/api/settings/ai');
    expect(decryptsCloudKey()).toBe(true);
    expect(asksForCloudKey(getSecret)).toBe(true);
  });

  it('no decrypt, no getSecret, no peekSecret for it across the AI, status and secrets surfaces', async () => {
    installCloudAndOllama(fetch);
    await configureCloud();
    storeEncryptedCloudKey();
    off();
    const list = await call('get', '/api/secrets');
    expect(list.status).toBe(200);
    expect(list.body.secrets.map((s) => s.name)).not.toContain(KEY_NAME);
    expect((await call('get', '/api/settings/ai')).status).toBe(200);
    expect((await call('post', '/api/settings/ai/cloud/disable')).status).toBe(200);
    const client = await getAiClient({ purpose: 'chat' });
    await client.complete({ messages: [{ role: 'user', content: 'hi' }] });
    await getAiStatus();
    expect(decryptsCloudKey()).toBe(false);
    expect(asksForCloudKey(getSecret)).toBe(false);
    expect(asksForCloudKey(peekSecret)).toBe(false);
    expect(JSON.stringify(list.body)).not.toContain(CLOUD_KEY);
  });

  it('the AI_CLOUD_API_KEY env fallback is not used either: nothing carries it and no cloud host is contacted', async () => {
    const { cloud } = installCloudAndOllama(fetch);
    await configureCloud();
    off();
    expect(process.env[KEY_NAME]).toBe(CLOUD_KEY);
    const status = await call('get', '/api/settings/ai');
    expect(status.body.data.cloud.keySaved).toBe(false);
    expect(JSON.stringify(status.body)).not.toContain(CLOUD_KEY);
    const client = await getAiClient({ purpose: 'chat' });
    await client.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(cloud.requests).toEqual([]);
    expect(fetch.mock.calls.some(([url, init]) => String(url).includes(CLOUD_HOST) || JSON.stringify(init?.headers ?? {}).includes(CLOUD_KEY))).toBe(false);
  });
});

describe('the registry never builds a cloud client', () => {
  it('even with a full stored setup and APP_NETWORK_OPTIN=cloudAi', async () => {
    const { cloud } = installCloudAndOllama(fetch);
    await configureCloud();
    off();
    vi.stubEnv('APP_NETWORK_OPTIN', 'cloudAi');
    __resetNetPolicyForTests();
    for (const purpose of ['chat', 'tools']) {
      const client = await getAiClient({ purpose });
      expect(client.provider).toBe('ollama');
      expect(client.isCloud).toBe(false);
      await client.complete({ messages: [{ role: 'user', content: 'hi' }] });
    }
    expect(await isEnabled('cloudAi')).toBe(false);
    expect((await getAiStatus()).cloud.build).toBe('absent');
    expect(cloud.requests).toEqual([]);
    expect(asksForCloudKey(getSecret)).toBe(false);
  });

  it.skipIf(PUBLIC_BUILD)('control: the same setup in a default build does build the cloud client (needs the cloud provider, which is not in a public build)', async () => {
    installCloudAndOllama(fetch);
    await configureCloud();
    const client = await getAiClient({ purpose: 'chat' });
    expect(client.provider).toBe('openai_compat');
    expect(client.isCloud).toBe(true);
  });
});

describe.skipIf(PUBLIC_BUILD)('default builds are unchanged (needs the cloud provider, which is not in a public build)', () => {
  it('listNetworkFeatures reports every feature available', async () => {
    const { features } = await listNetworkFeatures();
    expect(features.map((f) => f.id)).toContain('cloudAi');
    expect(features.every((f) => f.available === true)).toBe(true);
  });

  it('the AI status says the cloud build is present', async () => {
    installFakeOllama(fetch);
    expect((await getAiStatus()).cloud.build).toBe('present');
  });
});

describe('the Ollama on another machine opt-in', () => {
  const LAN = 'http://192.168.1.20:11434';

  it('is gated by aiLan (network_opt_in_required), not by the missing cloud provider', async () => {
    off();
    installFakeOllama(fetch);
    const res = await call('put', '/api/settings/ai/host', { host: LAN });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'network_opt_in_required', feature: 'aiLan' });
    expect(res.body.code).not.toBe('feature_unavailable');
    expect(fetch.mock.calls.some(([u]) => String(u).includes('192.168'))).toBe(false);
  });

  it('opt in, then the host is accepted (200)', async () => {
    off();
    installFakeOllama(fetch);
    expect((await call('put', '/api/settings/network', { id: 'aiLan', enabled: true })).status).toBe(200);
    const ok = await call('put', '/api/settings/ai/host', { host: LAN });
    expect(ok.status).toBe(200);
    expect(ok.body.data.ollama).toMatchObject({ host: LAN, loopback: false });
  });

  it('a saved remote host without the opt-in is not contacted', async () => {
    off();
    const state = installFakeOllama(fetch);
    await setState(AI_SETTINGS_KEY, { ollamaHost: LAN });
    await setState(NETWORK_STATE_KEY, {});
    __resetNetPolicyForTests();
    await getAiStatus();
    expect(state.urls.some((u) => u.includes('192.168'))).toBe(false);
    expect((await getState(NETWORK_STATE_KEY, null)) ?? {}).toEqual({});
  });
});

describe('POST /api/settings/ai/pull behaves the same as in a default build', () => {
  const eventNames = (text) =>
    splitSseChunks(text)[0]
      .map(parseSseChunk)
      .filter(Boolean)
      .map(({ event }) => event);

  const run = async () => {
    fetch.mockReset();
    const state = installFakeOllama(fetch);
    const res = await call('post', '/api/settings/ai/pull', { model: 'llama3.2:3b' });
    return { res, state };
  };

  it('streams progress to done and calls only the loopback Ollama', async () => {
    const def = await run();
    off();
    const cloudOff = await run();
    expect(cloudOff.res.status).toBe(def.res.status);
    expect(cloudOff.res.status).toBe(200);
    expect(cloudOff.res.headers['content-type']).toContain('text/event-stream');
    expect(eventNames(cloudOff.res.text)).toEqual(eventNames(def.res.text));
    expect(eventNames(cloudOff.res.text)).toContain('done');
    expect(cloudOff.state.pullBodies).toEqual(def.state.pullBodies);
    expect(cloudOff.state.pullBodies).toHaveLength(1);
    expect(fetch.mock.calls.every(([u]) => new URL(String(u)).hostname === '127.0.0.1')).toBe(true);
  });

  it('keeps its validation: an unknown model is 400 invalid_model in both builds', async () => {
    installFakeOllama(fetch);
    const def = await call('post', '/api/settings/ai/pull', { model: 'evil:latest' });
    off();
    const cloudOff = await call('post', '/api/settings/ai/pull', { model: 'evil:latest' });
    expect(cloudOff.status).toBe(def.status);
    expect({ ...cloudOff.body, requestId: null }).toEqual({ ...def.body, requestId: null });
    expect(cloudOff.body.code).toBe('invalid_model');
  });
});
