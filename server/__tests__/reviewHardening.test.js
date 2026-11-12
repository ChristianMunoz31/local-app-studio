// Security-review hardening, unit level: prototype keys in tool arguments, text tool-call
// recovery limits, capped model-server bodies, bounded model
// probing, availability reasons, provider-aware errors and timeouts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node-fetch', () => ({ default: vi.fn() }));

import fetch from 'node-fetch';
import { Readable } from 'node:stream';
import { MODELS, installFakeOllama } from './helpers/fakeOllama.js';
import { extractTextToolCalls, normalizeToolCalls, parseToolArgs, validateToolArgs } from '../agents/toolCalls.js';
import { ollamaChatStream, toOllamaMessages } from '../ai/providers/ollama.js';
import { BodyTooLargeError, MAX_LINE_CHARS, readCappedText } from '../ai/bodyCap.js';
import { FRIENDLY, classifyLLMError } from '../ai/llmErrors.js';
import { MAX_PROBE_MODELS, aiEnvConfig, createAiClient, getOllamaHealth } from '../ai/registry.js';
import { __resetAiForTests, describeAi, getAiStatus } from '../ai/index.js';
import { AI_SETTINGS_KEY } from '../ai/settings.js';
import { setState } from '../dataAccess.js';

// A test-local write-style tool: studio mode offers no write tool, and these checks are about argument handling.
const ASSISTANT_TOOLS = [
  { type: 'function', function: { name: 'save_note', description: 'Save a note.', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false } } },
];
const TOOL_NAMES = ASSISTANT_TOOLS.map((t) => t.function.name);
const ENV_KEYS = ['APP_AI', 'OLLAMA_HOST', 'APP_AI_FIRST_TOKEN_TIMEOUT_MS', 'APP_AI_CONCURRENCY'];
let savedEnv;

beforeEach(async () => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  fetch.mockReset();
  __resetAiForTests();
  await setState(AI_SETTINGS_KEY, {});
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

describe('M1: prototype keys in tool arguments', () => {
  const PAYLOAD = '{"name":"save_note","arguments":{"__proto__":{"title":{"x":1},"due":123}}}';

  it('rejects the __proto__ payload recovered from text, so nothing can run', () => {
    const found = extractTextToolCalls(PAYLOAD, TOOL_NAMES);
    expect(found.calls).toHaveLength(1);
    expect(found.calls[0]).toMatchObject({ name: 'save_note', arguments: {} });
    expect(found.calls[0].error).toMatch(/reserved key/);
  });

  it('validateToolArgs rejects own __proto__ / constructor / prototype keys and never sees inherited props', () => {
    const args = JSON.parse('{"__proto__":{"title":{"x":1},"due":123}}');
    const v = validateToolArgs('save_note', args, ASSISTANT_TOOLS);
    expect(v.ok).toBe(false);
    for (const key of ['constructor', 'prototype']) {
      expect(validateToolArgs('save_note', { name: 'x', [key]: {} }, ASSISTANT_TOOLS).ok).toBe(false);
    }
    // A key named like an Object.prototype member is an unknown argument, not a schema hit.
    expect(validateToolArgs('save_note', { name: 'x', toString: 'y' }, ASSISTANT_TOOLS)).toMatchObject({ ok: false, error: expect.stringMatching(/Unknown argument "toString"/) });
    expect(Object.prototype.name).toBeUndefined();
  });

  it('rejects nested unsafe keys in native tool-call arguments', () => {
    const calls = normalizeToolCalls([{ function: { name: 'save_note', arguments: '{"body":"x","tags":[{"constructor":{"prototype":1}}]}' } }]);
    expect(calls[0].error).toMatch(/reserved key/);
    expect(parseToolArgs({ title: 'ok' })).toEqual({ ok: true, args: { title: 'ok' } });
  });

  it('strips unsafe keys (at any depth) from assistant tool-call history sent to Ollama', () => {
    const [msg] = toOllamaMessages([
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'c1', function: { name: 'save_note', arguments: '{"__proto__":{"polluted":1},"title":"t","nested":{"constructor":{"a":1},"b":2}}' } }],
      },
    ]);
    const args = msg.tool_calls[0].function.arguments;
    expect(Object.getPrototypeOf(args)).toBe(Object.prototype);
    expect(Object.hasOwn(args, '__proto__')).toBe(false);
    expect(args).toEqual({ title: 't', nested: { b: 2 } });
    expect({}.polluted).toBeUndefined();
  });
});

describe('L2: text tool calls only when they are the whole reply', () => {
  const call = '{"name":"save_note","arguments":{"name":"Buy milk"}}';

  it('keeps the small-model shape: bare JSON with only a closing tag', () => {
    expect(extractTextToolCalls(`${call}\n</tool_call>`, TOOL_NAMES).calls).toEqual([{ name: 'save_note', arguments: { name: 'Buy milk' } }]);
    expect(extractTextToolCalls(`<tool_call>\n${call}\n</tool_call>`, TOOL_NAMES).calls).toHaveLength(1);
  });

  it('accepts a fenced block or bare JSON only when it is the entire reply', () => {
    expect(extractTextToolCalls('```json\n' + call + '\n```', TOOL_NAMES).calls).toHaveLength(1);
    expect(extractTextToolCalls(call, TOOL_NAMES).calls).toHaveLength(1);
    const mixed = extractTextToolCalls('Your note says:\n```json\n' + call + '\n```\nAnything else?', TOOL_NAMES);
    expect(mixed.calls).toEqual([]);
    expect(mixed.malformed).toBe(true);
  });

  it('does not repair a closing tag that follows prose', () => {
    const r = extractTextToolCalls(`Sure, here it is ${call}</tool_call>`, TOOL_NAMES);
    expect(r.calls).toEqual([]);
    expect(r.malformed).toBe(true);
    expect(r.text).not.toMatch(/tool_call/);
  });

  it('a fenced block that is not a known call stays ordinary text', () => {
    const r = extractTextToolCalls('Example:\n```json\n{"a":1}\n```', TOOL_NAMES);
    expect(r).toMatchObject({ calls: [], malformed: false });
  });
});

describe('M4: bodies from a model server are capped', () => {
  it('cuts an NDJSON stream that never sends a newline', async () => {
    let pulled = 0;
    const chunk = Buffer.alloc(64 * 1024, 'a');
    const body = Readable.from(
      (function* gen() {
        while (pulled < 1000) {
          pulled += 1;
          yield chunk;
        }
      })(),
    );
    fetch.mockResolvedValue({ ok: true, status: 200, body, headers: { get: () => null } });
    const it = ollamaChatStream({ host: 'http://127.0.0.1:11434', model: 'm', messages: [{ role: 'user', content: 'x' }], numCtx: 2048 });
    await expect((async () => {
      for await (const ev of it) void ev;
    })()).rejects.toBeInstanceOf(BodyTooLargeError);
    // Stopped right after the cap, not after the whole 64 MB.
    expect(pulled * chunk.length).toBeLessThan(MAX_LINE_CHARS + 20 * chunk.length);
  });

  it('reads error bodies with a byte cap', async () => {
    const res = { body: Readable.from([Buffer.alloc(5000, 'x'), Buffer.alloc(5000, 'y')]), headers: { get: () => null } };
    const text = await readCappedText(res, 6000, { truncate: true });
    expect(text).toHaveLength(6000);
    await expect(readCappedText({ body: Readable.from([Buffer.alloc(10, 'z')]), headers: { get: () => '999999' } }, 100)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it('complete() stops accumulating at the content cap', async () => {
    const huge = 'z'.repeat(200_000);
    let yielded = 0;
    const client = createAiClient({
      provider: 'ollama',
      model: 'm',
      purpose: 'chat',
      numCtx: 8192,
      transport: async function* t() {
        for (let i = 0; i < 20; i += 1) {
          yielded += 1;
          yield { type: 'token', text: huge };
        }
        yield { type: 'done', usage: null, finishReason: 'stop' };
      },
    });
    const { content } = await client.complete({ messages: [{ role: 'user', content: 'x' }] });
    expect(content.length).toBe(512 * 1024);
    expect(yielded).toBeLessThan(20);
  });
});

describe('L6: model probing is bounded', () => {
  it('runs /api/show at most 4 at a time and considers at most MAX_PROBE_MODELS models', async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ name: `m${i}:1b`, size: 1, digest: `d${i}`, details: { parameter_size: '1B' } }));
    let active = 0;
    let peak = 0;
    let shows = 0;
    fetch.mockImplementation(async (url) => {
      const { pathname } = new URL(url);
      const json = (b) => ({ ok: true, status: 200, json: async () => b, headers: { get: () => null } });
      if (pathname === '/api/version') return json({ version: '1' });
      if (pathname === '/api/tags') return json({ models: many });
      if (pathname === '/api/show') {
        shows += 1;
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 2));
        active -= 1;
        return json({ capabilities: ['completion'], model_info: {} });
      }
      throw new Error('unexpected');
    });
    const health = await getOllamaHealth('http://127.0.0.1:11434', { fresh: true });
    expect(health.models).toHaveLength(MAX_PROBE_MODELS);
    expect(shows).toBe(MAX_PROBE_MODELS);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });
});

describe('M6/L4/L5: availability reasons and status', () => {
  it('describeAi reports ai_disabled without probing when APP_AI=0', async () => {
    process.env.APP_AI = '0';
    expect(await describeAi('chat')).toMatchObject({ available: false, code: 'ai_not_configured', reason: 'ai_disabled' });
    const status = await getAiStatus();
    expect(status).toMatchObject({ enabled: false, effectiveProvider: 'ollama', ollama: { running: false, error: null } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('distinguishes no_model, no_tool_model and network_opt_in_required', async () => {
    installFakeOllama(fetch, { models: [] });
    expect(await describeAi('chat')).toMatchObject({ code: 'ai_not_configured', reason: 'no_model' });
    __resetAiForTests();
    // A chat-capable model without tools support.
    const moondreamChat = { ...MODELS[2], capabilities: ['completion'] };
    installFakeOllama(fetch, { models: [moondreamChat] });
    expect(await describeAi('tools')).toMatchObject({ code: 'ai_not_configured', reason: 'no_tool_model' });
    __resetAiForTests();
    process.env.OLLAMA_HOST = 'http://192.0.2.10:11434';
    expect(await describeAi('chat')).toMatchObject({ code: 'ollama_unavailable', reason: 'network_opt_in_required' });
  });

  it('reports ollama_unavailable when Ollama is down, and the effective provider when up', async () => {
    installFakeOllama(fetch, { down: true });
    expect(await describeAi('chat')).toMatchObject({ code: 'ollama_unavailable', reason: 'ollama_unavailable' });
    __resetAiForTests();
    installFakeOllama(fetch);
    expect(await describeAi('chat')).toMatchObject({ available: true, provider: 'ollama', effectiveProvider: 'ollama' });
  });
});

describe('L7: provider-aware unavailable copy', () => {
  it('names Ollama for local failures and the cloud endpoint for cloud ones', () => {
    const local = classifyLLMError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }));
    expect(local).toMatchObject({ scope: 'unavailable', friendly: FRIENDLY.unavailable });
    expect(local.friendly).toMatch(/Ollama/);
    const cloud = classifyLLMError(Object.assign(new Error('Cloud AI request failed'), { code: 'unavailable', provider: 'openai_compat' }));
    expect(cloud).toMatchObject({ scope: 'unavailable', friendly: FRIENDLY.unavailable_cloud });
    const cloudDns = classifyLLMError(Object.assign(new Error('x'), { code: 'ENOTFOUND', provider: 'openai_compat' }));
    expect(cloudDns.friendly).toBe(FRIENDLY.unavailable_cloud);
    for (const text of Object.values(FRIENDLY)) expect(text).not.toMatch(/[\u2013\u2014]/);
  });
});

describe('L8 and timeout defaults', () => {
  it('defaults the first-token timeout to 300 s', () => {
    expect(aiEnvConfig({}).firstTokenMs).toBe(300_000);
  });

  const slowTransport = async function* t({ signal }) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 60);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    });
    yield { type: 'token', text: 'ok' };
    yield { type: 'done', usage: null, finishReason: 'stop' };
  };

  it('does not apply the first-token timer to a non-streaming (cloud tool) round', async () => {
    process.env.APP_AI_FIRST_TOKEN_TIMEOUT_MS = '20';
    const client = createAiClient({
      provider: 'openai_compat',
      model: 'm',
      purpose: 'tools',
      numCtx: 8192,
      transport: slowTransport,
      authorizeSend: async () => ({}),
      firstTokenApplies: ({ tools }) => !(Array.isArray(tools) && tools.length),
    });
    const tools = [ASSISTANT_TOOLS[0]];
    const scope = { categories: [] };
    const { message } = await client.chatWithTools({ messages: [{ role: 'user', content: 'x' }], tools, scope });
    expect(message.content).toBe('ok');
    // Streaming calls on the same client still have it.
    await expect(client.complete({ messages: [{ role: 'user', content: 'x' }], scope })).rejects.toMatchObject({ code: 'timeout', timeoutKind: 'first_token' });
  });
});
