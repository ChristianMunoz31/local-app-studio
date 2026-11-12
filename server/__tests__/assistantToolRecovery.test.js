// Tool-call recovery in the Assistant loop (runAssistant, real temp DB, scripted fake Ollama). Studio mode has one
// read tool (list_features) and no write tool, so a write the model invents or wraps inside a read call is never
// parked and never runs, and a recovered read tool call still runs. Recovered-write parking is covered for the
// runtime tools in runtime/assistantRuntime.test.js.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../loadEnv.js', () => ({}));
vi.mock('node-fetch', () => ({ default: vi.fn() }));

import fetch from 'node-fetch';
import { installFakeOllama, textReply, toolReply } from './helpers/fakeOllama.js';
import { __resetAiForTests, getAiClient } from '../ai/index.js';
import { __resetPendingActionsForTests } from '../agents/pendingActions.js';
import { runAssistant } from '../agents/assistantAgent.js';
import { UNKNOWN_TOOL_SENTENCE } from '../agents/toolCalls.js';
import { resetLogForTests, tail } from '../log.js';
import { closeTestDb, createTestDb, resetDb, rowsOf } from './helpers/testDb.js';

let db;
const saved = Object.fromEntries(['ASSISTANT_CONFIRM_WRITES', 'APP_AI'].map((k) => [k, process.env[k]]));

beforeAll(() => {
  db = createTestDb();
});
afterAll(() => {
  closeTestDb(db);
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
beforeEach(() => {
  resetDb(db);
  __resetAiForTests();
  __resetPendingActionsForTests();
  resetLogForTests();
  fetch.mockReset();
  for (const k of Object.keys(saved)) delete process.env[k];
  process.env.ASSISTANT_CONFIRM_WRITES = '0';
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const run = async (prompt, replies) => {
  installFakeOllama(fetch, { replies });
  const client = await getAiClient({ purpose: 'tools' });
  const evs = [];
  await runAssistant({ prompt, client, onEvent: (e) => evs.push(e) });
  return evs;
};
const confirms = (evs) => evs.filter((e) => e.type === 'confirm.required');

const toolStarts = (evs) => evs.filter((e) => e.type === 'tool.start').map((e) => e.name);
const noWrites = () => expect(rowsOf(db, 'studio_features')).toHaveLength(0);

describe('recovered and invented calls in studio mode', () => {
  it('recovers a list_features call from a copied tool list and runs it', async () => {
    const echo = '{"name":"list_features","arguments":{"query":"kpi"}}, {"type":"function","function":{"name":"add_item","descr';
    const evs = await run('find kpi', [textReply(echo), textReply('None yet.')]);
    expect(toolStarts(evs)).toEqual(['list_features']);
    expect(confirms(evs)).toHaveLength(0);
  });

  it('runs a native call whose arguments wrap a list_features call', async () => {
    const evs = await run('find kpi', [
      toolReply([{ name: 'list_features', arguments: { type: 'function', function: 'list_features', parameters: { query: 'kpi' } } }]),
      textReply('None yet.'),
    ]);
    expect(toolStarts(evs)).toEqual(['list_features']);
  });

  // A native reply whose tool_calls entries are not in the standard `{ function: { name, arguments } }` shape.
  const rawCalls = (tool_calls) => [
    { model: 'qwen2.5:7b', message: { role: 'assistant', content: '', tool_calls }, done: false },
    { model: 'qwen2.5:7b', message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 20, eval_count: 5 },
  ];

  it('writes nothing for a native add_item call with a top-level name (not nested under function)', async () => {
    const evs = await run('add a widget', [rawCalls([{ name: 'add_item', arguments: { name: 'Widget' } }]), textReply('Sorry, that failed.')]);
    expect(confirms(evs)).toHaveLength(0);
    noWrites();
  });

  it('writes nothing for a native call whose function is a plain string', async () => {
    const evs = await run('add a widget', [rawCalls([{ function: 'add_item', arguments: { name: 'Widget' } }]), textReply('Sorry, that failed.')]);
    expect(confirms(evs)).toHaveLength(0);
    noWrites();
  });

  it('never parks or runs an invented add_item call, even with direct writes on', async () => {
    const evs = await run('add a widget', [toolReply([{ name: 'add_item', arguments: { name: 'Direct' } }]), textReply('Sorry.')]);
    expect(confirms(evs)).toHaveLength(0);
    expect(evs.find((e) => e.type === 'tool.done').result.error).toBe('That tool is not available here, so nothing was done.');
    noWrites();
  });

  it('does not run a write wrapped inside a read call', async () => {
    const evs = await run('list my features', [
      toolReply([{ name: 'list_features', arguments: { type: 'function', function: 'add_item', parameters: { name: 'Sneaky' } } }]),
      textReply('Nothing to show.'),
    ]);
    expect(confirms(evs)).toHaveLength(0);
    noWrites();
  });
});

describe('a tool call written as text that is not a known tool', () => {
  it('is replaced by the fixed sentence and logged once; a known read tool is still recovered', async () => {
    const raw = '{"name": "run_command", "parameters": {"c": "dir C:\\""}}';
    const evs = await run('go ahead', [textReply(raw), textReply(raw)]);
    const final = evs.find((e) => e.type === 'final');
    expect(final.content).toBe(UNKNOWN_TOOL_SENTENCE);
    expect(toolStarts(evs)).toEqual([]);
    const lines = tail({ minLevel: 'warn' }).filter((r) => r.event === 'assistant.tool_refused' && r.reason === 'text_call');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0].name).toBe('run_command');
    expect(JSON.stringify(lines)).not.toContain('dir C');

    const ok = await run('find kpi', [textReply('{"name":"list_features","arguments":{"query":"kpi"}}'), textReply('None yet.')]);
    expect(toolStarts(ok)).toEqual(['list_features']);
    expect(ok.find((e) => e.type === 'final').content).toBe('None yet.');
  });

  it('keeps JSON-looking prose that names no tool', async () => {
    const evs = await run('count', [textReply('The flag is {"ok": true} as asked.')]);
    expect(evs.find((e) => e.type === 'final').content).toContain('{"ok": true}');
  });
});

describe('a reply that starts like a call stops streaming (RV26-48)', () => {
  const deltas = (evs) => evs.filter((e) => e.type === 'delta').map((e) => e.content).join('');
  it('sends no delta after {"name" or name( appears; the final event carries the guarded text', async () => {
    const a = await run('go', [textReply('Sure, here you go: {"name": "run_command", "parameters": {"c": "dir"}} done')]);
    expect(deltas(a)).not.toContain('{"name"');
    expect(deltas(a)).not.toContain('done');
    expect(a.find((e) => e.type === 'final').content).toBe(`Sure, here you go: ${UNKNOWN_TOOL_SENTENCE} done`);

    const b = await run('go', [textReply('Opening it. run_command("dir") finished all right')]);
    expect(deltas(b)).not.toContain('finished');
    expect(b.find((e) => e.type === 'final').content).toBe(`Opening it. ${UNKNOWN_TOOL_SENTENCE} finished all right`);
  });

  it('never shows an unclosed call (a missing last brace) as the answer', async () => {
    const raw = 'Sure. {"name": "run_command", "parameters": {"c": "dir"}';
    const evs = await run('go', [textReply(raw), textReply(raw)]);
    const final = evs.find((e) => e.type === 'final').content;
    expect(final).not.toContain('run_command');
    expect(final).not.toContain('{"name"');
    expect(toolStarts(evs)).toEqual([]);
  });
});
