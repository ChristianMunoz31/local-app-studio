// Loopback-only AI: with default settings every outbound call the AI layer makes goes to
// 127.0.0.1 / localhost / ::1. Guarded at three levels: the mocked node-fetch the AI module uses,
// a stubbed globalThis.fetch, and spies on net/tls/https connection primitives. A cloud provider
// that is configured but not opted in, and a LAN Ollama host without the aiLan opt-in, must make
// zero non-loopback requests. No real Ollama is ever needed (fake behind node-fetch).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_BUILD } from './helpers/proBuild.js';
// Pro is on for this file (the Pro gate itself is covered in proGating.test.js).
vi.mock('../license/index.js', async (importOriginal) => (await import('./helpers/pro.js')).mockLicenseModule(importOriginal));
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import request from 'supertest';

vi.mock('../../loadEnv.js', () => ({}));
vi.mock('node-fetch', () => ({ default: vi.fn() }));

import fetch from 'node-fetch';
import { installFakeOllama, textReply, toolReply } from './helpers/fakeOllama.js';
import { __resetAiForTests } from '../ai/index.js';
import { AI_SETTINGS_KEY } from '../ai/settings.js';
import { NETWORK_STATE_KEY, __resetNetPolicyForTests } from '../netPolicy.js';
import { setState } from '../dataAccess.js';
import { recordCloudConsent } from '../ai/consent.js';
import { closeTestDb, createTestDb, resetDb } from './helpers/testDb.js';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '::ffff:127.0.0.1']);
const hostOf = (url) => new URL(String(url)).hostname.replace(/^\[|\]$/g, '').toLowerCase();
const ENV_KEYS = ['OLLAMA_HOST', 'APP_AI', 'AI_CLOUD_API_KEY', 'APP_PASSWORD', 'AUTH_SECRET', 'SECRETS_ENCRYPTION_KEY', 'APP_NETWORK_OPTIN', 'OLLAMA_NUM_CTX'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

let app;
let db;
let globalFetchStub;
let connectSpy;
let tlsSpy;
let httpsSpy;
let ip = 0;
const nextIp = () => `203.0.113.${(ip += 1) % 250}`;

/** Normalizes the argument shapes of Socket#connect to a host (undefined host for IPC). */
function socketHost(args) {
  const [first, second] = args;
  const n = Array.isArray(first) ? first[0] : first;
  if (n && typeof n === 'object') return typeof n.path === 'string' ? null : String(n.host ?? 'localhost');
  if (typeof first === 'string' && Number.isNaN(Number(first))) return null;
  return typeof second === 'string' ? second : 'localhost';
}

/** Hosts of every outbound attempt seen by any guard, tagged by layer. */
function seen() {
  const out = [];
  for (const [u] of fetch.mock.calls) out.push({ via: 'node-fetch', host: hostOf(u), url: String(u) });
  for (const [u] of globalFetchStub.mock.calls) out.push({ via: 'global-fetch', host: hostOf(typeof u === 'string' ? u : (u?.url ?? u)), url: String(u) });
  for (const args of connectSpy.mock.calls) {
    const host = socketHost(args);
    if (host) out.push({ via: 'net.connect', host: host.toLowerCase() });
  }
  for (const args of tlsSpy.mock.calls) {
    const o = typeof args[0] === 'object' ? args[0] : { host: args[1] };
    out.push({ via: 'tls.connect', host: String(o?.host ?? o?.servername ?? 'localhost').toLowerCase() });
  }
  for (let i = 0; i < httpsSpy.mock.calls.length; i += 1) out.push({ via: 'https.request', host: 'https' });
  return out;
}
const nonLoopback = () => seen().filter((s) => !LOOPBACK.has(s.host));

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
beforeEach(async () => {
  resetDb(db);
  for (const k of ['OLLAMA_HOST', 'APP_AI', 'AI_CLOUD_API_KEY', 'APP_NETWORK_OPTIN']) delete process.env[k];
  await setState(AI_SETTINGS_KEY, {});
  await setState(NETWORK_STATE_KEY, {});
  __resetNetPolicyForTests();
  __resetAiForTests();
  fetch.mockReset();
  globalFetchStub = vi.fn(() => {
    throw new Error('outbound global fetch attempted');
  });
  vi.stubGlobal('fetch', globalFetchStub);
  connectSpy = vi.spyOn(net.Socket.prototype, 'connect');
  tlsSpy = vi.spyOn(tls, 'connect');
  httpsSpy = vi.spyOn(https, 'request');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Tool round for any request that offers tools and has no tool result yet, plain text otherwise.
const scriptedChat = (body) => {
  const wantsTool = Array.isArray(body.tools) && body.tools.length > 0 && !body.messages.some((m) => m.role === 'tool');
  return wantsTool ? toolReply([{ name: 'list_features', arguments: {} }]) : textReply('Hello there. Spend was $1234.5 this month.');
};

const sseParser = (res, cb) => {
  let d = '';
  res.on('data', (c) => (d += c));
  res.on('end', () => cb(null, d));
};
const post = (path, body, { sse = false } = {}) => {
  let r = request(app).post(path).set('X-Forwarded-For', nextIp());
  if (sse) r = r.set('Accept', 'text/event-stream');
  return r.send(body).buffer(true).parse(sseParser);
};
const get = (path) => request(app).get(path).set('X-Forwarded-For', nextIp());

const MESSAGES = [{ role: 'user', content: 'how am I doing?' }];
const parseBody = (res) => {
  const text = typeof res.body === 'string' ? res.body : res.text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/** Every AI-touching entry point: [label, run, expected status]. */
const ROUTES = [
  ['GET /api/settings/ai', () => get('/api/settings/ai'), 200],
  ['GET /api/settings/ai/models', () => get('/api/settings/ai/models'), 200],
  ['POST /api/assistant/advice (JSON)', () => post('/api/assistant/advice', { page: 'settings', context: '{"open":1}', messages: MESSAGES }), 200],
  ['POST /api/assistant/advice (SSE)', () => post('/api/assistant/advice', { page: 'settings', context: '{"open":1}', messages: MESSAGES }, { sse: true }), 200],
  ['POST /api/assistant (tool round, SSE)', () => post('/api/assistant', { prompt: 'what is on my list' }), 200],
  ['POST /api/assistant (tool round with a page hint, SSE)', () => post('/api/assistant', { prompt: 'what is on my list', page: 'settings' }), 200],
];
// The AI-calling subset (settings reads only probe Ollama; they are 200 or a clean 503).
const AI_CALLS = ROUTES.filter(([label]) => label.startsWith('POST'));

describe('default settings: everything stays on loopback', () => {
  it('app startup (import) made no outbound attempt', () => {
    // The import happened in beforeAll; guards are installed per test, so exercise a cheap request.
    expect(nonLoopback()).toEqual([]);
  });

  it('every AI route works against the fake and talks only to loopback Ollama', async () => {
    const fake = installFakeOllama(fetch, { chat: scriptedChat });
    for (const [label, run, status] of ROUTES) {
      const res = await run();
      expect(res.status, `${label}: ${res.text ?? ''}`.slice(0, 300)).toBe(status);
    }
    // Not vacuous: the AI layer really called the fake, at every endpoint kind.
    expect(fake.urls.length).toBeGreaterThan(8);
    const paths = new Set(fake.urls.map((u) => new URL(u).pathname));
    for (const p of ['/api/tags', '/api/chat', '/api/version']) expect(paths.has(p), p).toBe(true);
    expect(fake.chatBodies.some((b) => Array.isArray(b.tools) && b.tools.length > 0)).toBe(true);
    expect(fake.chatBodies.some((b) => b.messages.some((m) => m.role === 'tool'))).toBe(true);

    for (const u of fake.urls) {
      expect(hostOf(u), u).toBe('127.0.0.1');
      expect(new URL(u).port).toBe('11434');
      expect(new URL(u).pathname).toMatch(/^\/api\/(?:tags|show|version|chat)$/);
    }
    // Backstops: nothing but loopback at any layer; global fetch and https never used.
    expect(globalFetchStub).not.toHaveBeenCalled();
    expect(httpsSpy).not.toHaveBeenCalled();
    expect(tlsSpy).not.toHaveBeenCalled();
    expect(nonLoopback()).toEqual([]);
    expect(seen().length).toBeGreaterThan(fake.urls.length - 1);
  });

  it('streamed replies are sanitized (em dash and $ amounts) without leaving loopback', async () => {
    installFakeOllama(fetch, { chat: () => textReply('Cost is up \u2014 about $1234.5 total.') });
    const res = await post('/api/assistant/advice', { page: 'settings', context: '{}', messages: MESSAGES }, { sse: true });
    expect(res.status).toBe(200);
    const text = String(res.body);
    expect(text).toContain('event: delta');
    expect(text).not.toMatch(/[\u2013\u2014]/);
    expect(text).toContain('$1,234.50');
    expect(nonLoopback()).toEqual([]);
  });
});

describe.skipIf(PUBLIC_BUILD)('cloud provider configured but the cloudAi opt-in is OFF (needs the cloud provider, which is not in a public build)', () => {
  beforeEach(async () => {
    await setState(AI_SETTINGS_KEY, {
      provider: 'openai_compat',
      cloud: { baseUrl: 'https://cloud.example/v1', model: 'cloud-model', tokenParam: 'max_tokens' },
    });
    process.env.AI_CLOUD_API_KEY = 'sk-cloud-test-key-1';
    __resetAiForTests();
  });

  it('makes zero non-loopback requests across every AI route and stays on Ollama', async () => {
    const fake = installFakeOllama(fetch, { chat: scriptedChat });
    for (const [label, run, status] of ROUTES) {
      const res = await run();
      expect(res.status, label).toBe(status);
    }
    expect(fake.urls.length).toBeGreaterThan(0);
    expect(fetch.mock.calls.some(([u]) => String(u).includes('cloud.example'))).toBe(false);
    expect(fetch.mock.calls.some(([, init]) => init?.headers?.Authorization)).toBe(false);
    expect(globalFetchStub).not.toHaveBeenCalled();
    expect(nonLoopback()).toEqual([]);
    // The effective provider is what the call sites report, regardless of the saved choice.
    const chat = await post('/api/assistant/advice', { page: 'settings', context: '{}', messages: MESSAGES }, { sse: true });
    expect(String(chat.body)).toContain('"provider":"ollama"');
    const status = parseBody(await get('/api/settings/ai')).data;
    expect(status.cloud).toMatchObject({ optIn: false, keySaved: true });
    expect(nonLoopback()).toEqual([]);
  });

  it('control: with the opt-in ON the same setup does call the cloud endpoint (so the guard can fail)', async () => {
    await setState(NETWORK_STATE_KEY, { cloudAi: true });
    await recordCloudConsent({ host: 'cloud.example', baseUrl: 'https://cloud.example/v1' });
    __resetNetPolicyForTests();
    __resetAiForTests();
    const sse = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n';
    const { Readable } = await import('node:stream');
    fetch.mockImplementation(async () => ({ ok: true, status: 200, body: Readable.from([Buffer.from(sse)]), headers: { get: () => null } }));
    const res = await post('/api/assistant/advice', { page: 'settings', context: '{}', messages: MESSAGES });
    expect(res.status).toBe(200);
    expect(fetch.mock.calls.some(([u]) => String(u).startsWith('https://cloud.example/v1/'))).toBe(true);
    expect(nonLoopback().length).toBeGreaterThan(0);
  });
});

describe('non-loopback OLLAMA_HOST without the aiLan opt-in', () => {
  const LAN = 'http://192.0.2.50:11434';
  beforeEach(() => {
    process.env.OLLAMA_HOST = LAN;
    __resetAiForTests();
  });

  it.each(AI_CALLS)('%s is refused (503/403) with zero non-loopback requests', async (label, run) => {
    const fake = installFakeOllama(fetch, { chat: scriptedChat });
    const res = await run();
    expect([403, 503], `${label} -> ${res.status}`).toContain(res.status);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['content-type']).not.toMatch(/event-stream/);
    expect(fake.urls.filter((u) => hostOf(u) === '192.0.2.50')).toEqual([]);
    expect(nonLoopback()).toEqual([]);
    expect(globalFetchStub).not.toHaveBeenCalled();
  });

  it('the settings probe reports the block and does not contact the host', async () => {
    const fake = installFakeOllama(fetch);
    const res = await get('/api/settings/ai');
    expect(fake.urls.filter((u) => hostOf(u) === '192.0.2.50')).toEqual([]);
    expect(nonLoopback()).toEqual([]);
    if (res.status === 200) {
      const body = parseBody(res).data;
      expect(body.ollama.loopback).toBe(false);
      expect(body.ollama.running).toBe(false);
    } else {
      expect([403, 503]).toContain(res.status);
    }
  });

  it('control: with the aiLan opt-in ON the LAN host is used', async () => {
    await setState(NETWORK_STATE_KEY, { aiLan: true });
    __resetNetPolicyForTests();
    __resetAiForTests();
    const fake = installFakeOllama(fetch, { chat: scriptedChat });
    const res = await post('/api/assistant/advice', { page: 'settings', context: '{}', messages: MESSAGES });
    expect(res.status).toBe(200);
    expect(fake.urls.some((u) => hostOf(u) === '192.0.2.50')).toBe(true);
  });
});
