import { afterEach, describe, expect, it } from 'vitest';
import { parseArgs } from '../../scripts/fakeOllama.js';
import {
  DEFAULT_MODELS,
  FAKE_MODEL_NAME,
  PLAIN_REPLY,
  TOOL_DONE_REPLY,
  defaultChatReply,
  asksAboutFeatures,
  startFakeOllama,
} from '../../scripts/lib/fakeOllamaServer.js';

const TOOLS = [{ type: 'function', function: { name: 'list_features', parameters: {} } }];
const post = (url, path, body) =>
  fetch(`${url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const ndjson = async (res) =>
  (await res.text())
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

describe('startFakeOllama', () => {
  let fake;
  afterEach(async () => {
    await fake?.close();
    fake = null;
  });

  it('binds loopback on a free port and refuses 11434 and non-loopback hosts', async () => {
    fake = await startFakeOllama();
    expect(fake.url).toBe(`http://127.0.0.1:${fake.port}`);
    expect(fake.port).not.toBe(11434);
    await expect(startFakeOllama({ port: 11434 })).rejects.toThrow(/11434/);
    await expect(startFakeOllama({ host: '0.0.0.0' })).rejects.toThrow(/loopback/);
    await expect(startFakeOllama({ host: '192.168.1.5' })).rejects.toThrow(/loopback/);
    await expect(startFakeOllama({ port: -1 })).rejects.toThrow(/port/);
  });

  it('answers version, tags (one small tool-capable model) and show', async () => {
    fake = await startFakeOllama();
    expect((await (await fetch(`${fake.url}/api/version`)).json()).version).toMatch(/fake/);
    const tags = await (await fetch(`${fake.url}/api/tags`)).json();
    expect(tags.models.map((m) => m.name)).toEqual([FAKE_MODEL_NAME]);
    expect(tags.models[0].capabilities).toContain('tools');
    const show = await (await post(fake.url, '/api/show', { model: FAKE_MODEL_NAME })).json();
    expect(show.capabilities).toContain('tools');
    expect(show.model_info['llama.context_length']).toBeGreaterThan(0);
    expect((await post(fake.url, '/api/show', { model: 'nope:1b' })).status).toBe(404);
  });

  it('answers anything else with 404 and records every request', async () => {
    fake = await startFakeOllama();
    expect((await fetch(`${fake.url}/api/unknown`)).status).toBe(404);
    expect((await fetch(`${fake.url}/`)).status).toBe(404);
    expect((await fetch(`${fake.url}/api/chat`)).status).toBe(404);
    await post(fake.url, '/api/show', { model: FAKE_MODEL_NAME });
    expect(fake.requests.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /api/unknown', 'GET /', 'GET /api/chat', 'POST /api/show']);
    expect(fake.requests[3].body).toEqual({ model: FAKE_MODEL_NAME });
  });

  it('streams a plain NDJSON chat reply that ends with done', async () => {
    fake = await startFakeOllama();
    const res = await post(fake.url, '/api/chat', { model: FAKE_MODEL_NAME, messages: [{ role: 'user', content: 'hello' }], stream: true });
    const frames = await ndjson(res);
    expect(frames.at(-1).done).toBe(true);
    expect(frames.slice(0, -1).map((f) => f.message.content).join('')).toBe(PLAIN_REPLY);
    expect(frames.some((f) => f.message.tool_calls)).toBe(false);
  });

  it('answers a non-streaming chat with one JSON object', async () => {
    fake = await startFakeOllama();
    const res = await post(fake.url, '/api/chat', { model: FAKE_MODEL_NAME, messages: [{ role: 'user', content: 'hello' }], stream: false });
    const body = await res.json();
    expect(body.done).toBe(true);
    expect(body.message.content).toBe(PLAIN_REPLY);
  });

  it('returns a list_features tool call for a question about features when the tool is offered', async () => {
    fake = await startFakeOllama();
    const messages = [{ role: 'user', content: 'Which features do I have?' }];
    const frames = await ndjson(await post(fake.url, '/api/chat', { model: FAKE_MODEL_NAME, messages, tools: TOOLS }));
    const call = frames.find((f) => f.message.tool_calls)?.message.tool_calls[0];
    expect(call.function).toEqual({ name: 'list_features', arguments: {} });
    const plain = await ndjson(await post(fake.url, '/api/chat', { model: FAKE_MODEL_NAME, messages })); // no tools offered
    expect(plain.some((f) => f.message.tool_calls)).toBe(false);
  });

  it('closes the loop after a tool result with fixed copy', async () => {
    fake = await startFakeOllama();
    const messages = [
      { role: 'user', content: 'list my features' },
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'list_features', arguments: {} } }] },
      { role: 'tool', content: '{"queued":true}' },
    ];
    const frames = await ndjson(await post(fake.url, '/api/chat', { model: FAKE_MODEL_NAME, messages, tools: TOOLS }));
    expect(frames.slice(0, -1).map((f) => f.message.content).join('')).toBe(TOOL_DONE_REPLY);
  });

  it('lets a chat hook override the reply and falls back when it returns undefined', async () => {
    fake = await startFakeOllama({ chat: (body) => (body.messages[0].content === 'custom' ? 'Custom reply.' : undefined) });
    const custom = await (await post(fake.url, '/api/chat', { stream: false, messages: [{ role: 'user', content: 'custom' }] })).json();
    expect(custom.message.content).toBe('Custom reply.');
    const other = await (await post(fake.url, '/api/chat', { stream: false, messages: [{ role: 'user', content: 'x' }] })).json();
    expect(other.message.content).toBe(PLAIN_REPLY);
  });

  it('keeps describe off by default: a chat with a schema gets the plain reply', async () => {
    fake = await startFakeOllama();
    const format = { type: 'object', properties: { tables: {} } };
    const body = { stream: false, format, messages: [{ role: 'user', content: 'The app: loans\nReply with its tables.' }] };
    expect((await (await post(fake.url, '/api/chat', body)).json()).message.content).toBe(PLAIN_REPLY);
  });

  it('with describe canned, routes a chat by its schema and the prompt words', async () => {
    fake = await startFakeOllama({ describe: 'canned' });
    const ask = async (format, content) =>
      (await (await post(fake.url, '/api/chat', { stream: false, format, messages: [{ role: 'user', content }] })).json()).message.content;
    const tables = JSON.parse(await ask({ type: 'object', properties: { tables: {} } }, 'The app: loans of tools\nReply with its tables.'));
    expect(tables.tables.map((t) => t.id)).toEqual(['things', 'people', 'loans']);
    const outline = JSON.parse(await ask({ type: 'object', properties: { nav: {} } }, 'Tables:\nx (X): name text\nThe app: a todo list'));
    expect(outline.pages.map((p) => p.id)).toEqual(['home', 'projects']);
    expect(await ask(undefined, 'hello')).toBe(PLAIN_REPLY);
  });

  it('lets a chat hook win over the canned answers, and refuses an unknown describe mode', async () => {
    fake = await startFakeOllama({ describe: 'canned', chat: () => 'Hook.' });
    const format = { type: 'object', properties: { tables: {} } };
    const res = await (await post(fake.url, '/api/chat', { stream: false, format, messages: [{ role: 'user', content: 'The app: x\nReply with its tables.' }] })).json();
    expect(res.message.content).toBe('Hook.');
    await expect(startFakeOllama({ describe: 'loud' })).rejects.toThrow(/describe/);
  });

  it('simulates a pull with canned frames, never downloading, and lists the model afterwards', async () => {
    fake = await startFakeOllama();
    const frames = await ndjson(await post(fake.url, '/api/pull', { model: 'llama3.2:1b', stream: true }));
    expect(frames.at(-1)).toEqual({ status: 'success' });
    expect(frames.some((f) => f.total === 1000)).toBe(true);
    const tags = await (await fetch(`${fake.url}/api/tags`)).json();
    expect(tags.models.map((m) => m.name)).toContain('llama3.2:1b');
  });

  it('can refuse pulls', async () => {
    fake = await startFakeOllama({ pull: 'refuse' });
    const res = await post(fake.url, '/api/pull', { model: 'llama3.2:1b' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/does not download/);
  });

  it('takes a custom model list and does not mutate the shared defaults', async () => {
    const custom = [{ name: 'tiny:1b', model: 'tiny:1b', capabilities: ['completion'], details: { context_length: 2048 } }];
    fake = await startFakeOllama({ models: custom });
    expect((await (await fetch(`${fake.url}/api/tags`)).json()).models.map((m) => m.name)).toEqual(['tiny:1b']);
    await fake.close();
    fake = await startFakeOllama();
    await post(fake.url, '/api/pull', { model: 'llama3.2:1b' });
    expect(DEFAULT_MODELS.map((m) => m.name)).toEqual([FAKE_MODEL_NAME]);
  });

  it('survives a malformed body', async () => {
    fake = await startFakeOllama();
    const res = await fetch(`${fake.url}/api/chat`, { method: 'POST', body: '{not json' });
    expect(res.status).toBe(200);
    expect((await ndjson(res)).at(-1).done).toBe(true);
  });
});

describe('defaultChatReply', () => {
  it('detects questions about features', () => {
    for (const t of ['which features do I have', 'Show my Feature library', 'list features']) expect(asksAboutFeatures(t), t).toBe(true);
    for (const t of ['what is on my list', 'how many apps do I have', 'add milk', '']) expect(asksAboutFeatures(t), t).toBe(false);
  });

  it('answers a features question with a no-argument read call and never echoes computed numbers', () => {
    const reply = defaultChatReply({ messages: [{ role: 'user', content: 'list my features' }], tools: TOOLS });
    expect(reply.tool_calls[0].function).toEqual({ name: 'list_features', arguments: {} });
    expect(PLAIN_REPLY).not.toMatch(/\d/);
    expect(TOOL_DONE_REPLY).not.toMatch(/\d/);
  });
});

describe('fakeOllama CLI args', () => {
  it('defaults to a free port, parses --port and refuses 11434', () => {
    expect(parseArgs([])).toEqual({ port: 0, plain: false });
    expect(parseArgs(['--port', '47001'])).toEqual({ port: 47001, plain: false });
    expect(parseArgs(['--plain'])).toEqual({ port: 0, plain: true });
    expect(() => parseArgs(['--port', '11434'])).toThrow(/11434/);
    expect(() => parseArgs(['--port'])).toThrow(/--port/);
    expect(() => parseArgs(['--port', 'abc'])).toThrow(/--port/);
    expect(() => parseArgs(['--bogus'])).toThrow(/Unknown argument/);
  });
});
