// Every outbound path that had no audit row now writes one names-only row (feature id, host, result).
// All requests go through fakes: node-fetch is mocked and injected fetchImpls answer; no network.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeTestDb, createTestDb, resetDb, rowsOf } from './helpers/testDb.js';
import { installFakeOllama } from './helpers/fakeOllama.js';
import '../audit.js';

vi.mock('../../loadEnv.js', () => ({}));
// A real releases repo: the shipped config is the placeholder, which is never queried.
vi.mock('../../scripts/release/releaseConfig.js', async (importOriginal) => ({
  ...(await importOriginal()),
  RELEASE_CONFIG: Object.freeze({ sourceRepo: 'acme/notes', releasesRepo: 'acme/notes-releases' }),
}));

vi.mock('node-fetch', () => ({ default: vi.fn() }));

import fetch from 'node-fetch';
import { __resetNetPolicyForTests } from '../netPolicy.js';
import { checkForUpdate, __resetUpdateCacheForTests } from '../updateCheck.js';
import { NETWORK_COALESCE_MS, __resetNetworkCoalesceForTests, recordNetworkCall, statusFromHttp } from '../networkCall.js';
import { __resetAiForTests } from '../ai/index.js';
import { getOllamaHealth } from '../ai/registry.js';

let db;
const savedOptIn = process.env.APP_NETWORK_OPTIN;

beforeAll(async () => {
  db = createTestDb();
  process.env.APP_NETWORK_OPTIN = 'updates,license,aiLan';
});
afterAll(() => {
  closeTestDb(db);
  if (savedOptIn === undefined) delete process.env.APP_NETWORK_OPTIN;
  else process.env.APP_NETWORK_OPTIN = savedOptIn;
});
beforeEach(() => {
  resetDb(db);
  __resetNetPolicyForTests();
  __resetUpdateCacheForTests();
  __resetNetworkCoalesceForTests();
  __resetAiForTests();
  vi.mocked(fetch).mockReset();
});

// Same-millisecond rows have no stable created_at order, so read in insert (rowid) order.
const netRows = () =>
  rowsOf(db, 'audit_log')
    .filter((r) => r.feature === 'network_call')
    .map((r) => ({ status: r.status, context: r.context, ...r.meta }));

describe('outbound audit rows', () => {
  it('updates: a real request writes a row, a cached answer does not', async () => {
    const ok = {
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => JSON.stringify({ tag_name: 'v0.0.1', html_url: 'https://github.com/acme/notes-releases/releases/tag/v0.0.1', published_at: '2020-01-01T00:00:00Z' }),
    };
    const fetchImpl = vi.fn(async () => ok);
    await checkForUpdate({ fetchImpl, currentVersion: '9.9.9', channel: 'stable' });
    await checkForUpdate({ fetchImpl, currentVersion: '9.9.9', channel: 'stable' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(netRows()).toEqual([{ status: 'ok', context: null, net_feature: 'updates', net_host: 'api.github.com' }]);
  });

  it('updates: 404, 5xx, a timeout and a thrown error are failures; a 200 is ok', async () => {
    const release = {
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => JSON.stringify({ tag_name: 'v0.0.1', html_url: 'https://github.com/acme/notes-releases/releases/tag/v0.0.1', published_at: '2020-01-01T00:00:00Z' }),
    };
    const answers = [
      async () => ({ ok: false, status: 404, headers: new Map(), text: async () => '{}' }),
      async () => ({ ok: false, status: 503, headers: new Map(), text: async () => '{}' }),
      async () => {
        throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
      },
      async () => {
        throw new Error('offline');
      },
      async () => release,
    ];
    for (const fetchImpl of answers) {
      __resetUpdateCacheForTests();
      await checkForUpdate({ fetchImpl, currentVersion: '9.9.9', channel: 'stable' });
    }
    expect(netRows().map((r) => r.status)).toEqual(['error', 'error', 'error', 'error', 'ok']);
  });
});

describe('shared result rule', () => {
  it('statusFromHttp: 2xx and 3xx are ok, 4xx, 5xx and anything else are errors', () => {
    expect([200, 204, 301, 302, 399].map(statusFromHttp)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    expect([199, 400, 401, 404, 429, 500, 503, undefined, null, 'x', NaN].map(statusFromHttp)).toEqual(Array(11).fill('error'));
  });

  it('recordNetworkCall drops anything that is not a netPolicy feature or model_pull', async () => {
    await recordNetworkCall('assistant', 'https://example.com', 'ok');
    await recordNetworkCall('network_call', 'https://example.com', 'ok');
    await recordNetworkCall('__proto__', 'https://example.com', 'ok');
    await recordNetworkCall('model_pull', 'https://registry.ollama.example', 'ok');
    await recordNetworkCall('cloudAi', 'https://api.example.com/v1', 'ok');
    expect(netRows().map((r) => r.net_feature)).toEqual(['model_pull', 'cloudAi']);
  });
});

describe('aiLan health probes', () => {
  const LAN = 'http://192.168.1.20:11434';
  afterAll(() => vi.useRealTimers());

  it('writes one row per host and never one for loopback', async () => {
    installFakeOllama(vi.mocked(fetch));
    await getOllamaHealth('http://127.0.0.1:11434', { fresh: true });
    await getOllamaHealth('http://localhost:11434', { fresh: true });
    expect(netRows()).toEqual([]);
    await getOllamaHealth(LAN, { fresh: true });
    await getOllamaHealth('http://192.168.1.21:11434', { fresh: true });
    expect(netRows()).toEqual([
      { status: 'ok', context: null, net_feature: 'aiLan', net_host: '192.168.1.20' },
      { status: 'ok', context: null, net_feature: 'aiLan', net_host: '192.168.1.21' },
    ]);
  });

  it('coalesces repeated probes to one row per host per 15 minutes', async () => {
    installFakeOllama(vi.mocked(fetch));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-01T10:00:00Z'));
    await getOllamaHealth(LAN, { fresh: true });
    await getOllamaHealth(LAN, { fresh: true });
    vi.setSystemTime(Date.now() + NETWORK_COALESCE_MS - 1000);
    await getOllamaHealth(LAN, { fresh: true });
    expect(netRows()).toHaveLength(1);
    vi.setSystemTime(Date.now() + 2000);
    await getOllamaHealth(LAN, { fresh: true });
    expect(netRows()).toHaveLength(2);
    vi.useRealTimers();
  });

  it('records a failed probe as an error', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('connect ECONNREFUSED'));
    const health = await getOllamaHealth(LAN, { fresh: true });
    expect(health.running).toBe(false);
    expect(netRows()).toEqual([{ status: 'error', context: null, net_feature: 'aiLan', net_host: '192.168.1.20' }]);
  });
});
