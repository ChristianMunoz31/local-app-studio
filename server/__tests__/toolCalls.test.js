// Tool-call hygiene for small models: normalize, validate against ASSISTANT_TOOLS, and recover
// calls written as text (server/agents/toolCalls.js).
import { describe, expect, it } from 'vitest';
import { UNKNOWN_TOOL_SENTENCE, extractTextToolCalls, normalizeToolCalls, parseToolArgs, refuseTextToolCalls, validateToolArgs } from '../agents/toolCalls.js';
import { ASSISTANT_TOOLS } from '../agents/assistantTools.js';

// A test-local tool list: the pure functions are exercised with synthetic specs (studio mode offers only list_features).
const fn = (name, properties = {}, required = []) => ({
  type: 'function',
  function: { name, description: name, parameters: { type: 'object', properties, required, additionalProperties: false } },
});
const TOOLS = [
  fn('list_items', { status: { type: 'string', enum: ['active', 'done'] }, category: { type: 'string' } }),
  fn('list_item_notes'),
  fn('filter_items', { match: { type: 'object' } }),
  fn('save_record', { values: { type: 'object' } }, ['values']),
  fn('search_data', { query: { type: 'string' }, kinds: { type: 'array', items: { type: 'string', enum: ['items', 'notes'] } } }, ['query']),
  fn('add_item', { name: { type: 'string' }, category: { type: 'string' }, quantity: { type: 'integer' }, unitCost: { type: 'number' }, notes: { type: 'string' } }, ['name']),
];
const NAMES = TOOLS.map((t) => t.function.name);

describe('object arguments (B-14)', () => {
  it('turns a JSON string of an object into the object', () => {
    expect(validateToolArgs('filter_items', { match: '{"status":"active"}' }, TOOLS)).toEqual({ ok: true, args: { match: { status: 'active' } }, coerced: true });
    expect(validateToolArgs('filter_items', { match: { status: 'active' } }, TOOLS)).toEqual({ ok: true, args: { match: { status: 'active' } } });
  });

  it('refuses an array, a bare word, null content and a reserved key, with retry words', () => {
    for (const bad of ['[1]', 'active', '"x"']) {
      const v = validateToolArgs('filter_items', { match: bad }, TOOLS);
      expect(v.ok).toBe(false);
      expect(v.error).toBe('Argument "match" for filter_items must be an object. Nothing was read. Call filter_items again with match as an object, or without it.');
    }
    expect(validateToolArgs('filter_items', { match: { a: 1 } }, TOOLS).ok).toBe(true);
    expect(validateToolArgs('filter_items', { match: '{"__proto__":{"x":1}}' }, TOOLS)).toMatchObject({ ok: false, error: 'Tool arguments use a reserved key name.' });
    expect(validateToolArgs('filter_items', { match: '{"constructor":1}' }, TOOLS).ok).toBe(false);
  });

  it('a required object and a write tool get their own closing words', () => {
    expect(validateToolArgs('save_record', { values: 'x' }, TOOLS).error).toBe(
      'Argument "values" for save_record must be an object. Nothing was saved. Call save_record again with values as an object.',
    );
  });
});

describe('parseToolArgs / normalizeToolCalls', () => {
  it('accepts objects, JSON strings and empty values', () => {
    expect(parseToolArgs({ a: 1 })).toEqual({ ok: true, args: { a: 1 } });
    expect(parseToolArgs('{"a":1}')).toEqual({ ok: true, args: { a: 1 } });
    expect(parseToolArgs('')).toEqual({ ok: true, args: {} });
    expect(parseToolArgs(undefined)).toEqual({ ok: true, args: {} });
    expect(parseToolArgs('null')).toEqual({ ok: true, args: {} });
    expect(parseToolArgs('[1]').ok).toBe(false);
    expect(parseToolArgs('{bad').ok).toBe(false);
  });

  it('normalizes OpenAI-shaped calls and flags unparseable arguments', () => {
    expect(
      normalizeToolCalls([
        { id: 'c1', function: { name: ' list_items ', arguments: '{"status":"done"}' } },
        { function: { name: 'get_item_stats', arguments: '{oops' } },
        null,
      ]),
    ).toEqual([
      { id: 'c1', name: 'list_items', args: { status: 'done' } },
      { id: 'call_1', name: 'get_item_stats', args: {}, error: 'Tool arguments must be a JSON object.' },
    ]);
    expect(normalizeToolCalls(undefined)).toEqual([]);
  });
});

describe('validateToolArgs', () => {
  it('validates the studio list_features tool', () => {
    expect(validateToolArgs('list_features', { query: 'kpi' }, ASSISTANT_TOOLS)).toEqual({ ok: true, args: { query: 'kpi' } });
    expect(validateToolArgs('list_features', {}, ASSISTANT_TOOLS)).toEqual({ ok: true, args: {} });
    expect(validateToolArgs('list_features', { limit: 5 }, ASSISTANT_TOOLS).error).toMatch(/Unknown argument "limit".*Allowed: query/);
    expect(validateToolArgs('list_items', {}, ASSISTANT_TOOLS)).toEqual({ ok: false, error: 'That tool is not available here, so nothing was done.', reason: 'unknown_tool' });
  });

  it('accepts valid args', () => {
    expect(validateToolArgs('add_item', { name: 'Buy milk', category: 'food', quantity: 2, unitCost: 3.5 }, TOOLS)).toEqual({
      ok: true,
      args: { name: 'Buy milk', category: 'food', quantity: 2, unitCost: 3.5 },
    });
  });

  it('rejects unknown tools, unknown args, missing required args, bad types and bad enums', () => {
    expect(validateToolArgs('drop_tables', {}, TOOLS)).toEqual({ ok: false, error: 'That tool is not available here, so nothing was done.', reason: 'unknown_tool' });
    expect(validateToolArgs('add_item', {}, TOOLS)).toMatchObject({ ok: false, reason: 'invalid_args' });
    expect(validateToolArgs('list_items', { status: 'active', includeDone: true }, TOOLS).error).toMatch(/Unknown argument "includeDone".*Allowed: status, category/);
    expect(validateToolArgs('add_item', {}, TOOLS).error).toMatch(/Missing required argument "name"/);
    expect(validateToolArgs('add_item', { name: 5 }, TOOLS).error).toMatch(/must be a string/);
    expect(validateToolArgs('list_items', { status: 'archived' }, TOOLS).error).toMatch(/must be one of: active, done/);
    expect(validateToolArgs('search_data', { query: 'x', kinds: ['items', 'emails'] }, TOOLS).error).toMatch(/invalid item/);
    expect(validateToolArgs('list_items', [], TOOLS).ok).toBe(false);
  });

  it('coerces numeric and boolean strings, and drops null or empty optional args', () => {
    expect(validateToolArgs('add_item', { name: 'x', quantity: '3' }, TOOLS)).toEqual({ ok: true, args: { name: 'x', quantity: 3 } });
    expect(validateToolArgs('add_item', { name: 'x', unitCost: '2.5' }, TOOLS)).toEqual({ ok: true, args: { name: 'x', unitCost: 2.5 } });
    expect(validateToolArgs('add_item', { name: 'x', quantity: '2.5' }, TOOLS).ok).toBe(false);
    expect(validateToolArgs('add_item', { name: 'x', category: null, notes: '' }, TOOLS)).toEqual({ ok: true, args: { name: 'x' } });
    expect(validateToolArgs('add_item', { name: '' }, TOOLS).ok).toBe(true); // required but present; the data layer rejects empties
  });
});

describe('extractTextToolCalls', () => {
  it('reads <tool_call> blocks and strips them from the text', () => {
    const out = extractTextToolCalls('Sure.\n<tool_call>\n{"name": "list_items", "arguments": {}}\n</tool_call>', NAMES);
    expect(out).toEqual({ calls: [{ name: 'list_items', arguments: {} }], text: 'Sure.', malformed: false });
  });

  it('repairs a missing opening tag', () => {
    const out = extractTextToolCalls('{"name": "list_items", "arguments": {"status": "done"}}\n</tool_call>', NAMES);
    expect(out.calls).toEqual([{ name: 'list_items', arguments: { status: 'done' } }]);
    expect(out.text).toBe('');
  });

  it('flags broken JSON or an invented tool inside tags as malformed', () => {
    expect(extractTextToolCalls('{"name": "list_items", "arguments": {"status: 1}}\n</tool_call>', NAMES)).toMatchObject({ calls: [], malformed: true, text: '' });
    expect(extractTextToolCalls('<tool_call>{"name":"send_email","arguments":{}}</tool_call>', NAMES)).toMatchObject({ calls: [], malformed: true });
    expect(extractTextToolCalls('<tool_call>{"name":"list_items"', NAMES)).toMatchObject({ calls: [], malformed: true, text: '' });
  });

  it('reads fenced json blocks, bare JSON objects and arrays, with arguments or parameters', () => {
    expect(extractTextToolCalls('```json\n{"name":"list_items","arguments":{"status":"done"}}\n```', NAMES).calls).toEqual([
      { name: 'list_items', arguments: { status: 'done' } },
    ]);
    expect(extractTextToolCalls('{"name":"list_item_notes","parameters":{}}', NAMES).calls).toEqual([{ name: 'list_item_notes', arguments: {} }]);
    expect(extractTextToolCalls('[{"name":"list_item_notes"},{"name":"list_items","arguments":"{}"}]', NAMES).calls).toHaveLength(2);
  });

  it('leaves ordinary answers (including unrelated JSON and code) alone', () => {
    const plain = 'You have 3 items. Here is JSON: ```json\n{"a":1}\n```';
    expect(extractTextToolCalls(plain, NAMES)).toEqual({ calls: [], text: plain, malformed: false });
    expect(extractTextToolCalls('{"name":"Bob"}', NAMES)).toEqual({ calls: [], text: '{"name":"Bob"}', malformed: false });
    expect(extractTextToolCalls('', NAMES)).toEqual({ calls: [], text: '', malformed: false });
  });

  it('flags an unparseable bare call as malformed', () => {
    expect(extractTextToolCalls('{"name": "list_items", "arguments": {', NAMES).malformed).toBe(false); // no closing brace: not a JSON reply
    expect(extractTextToolCalls('{"name": "list_items", "arguments": {x}}', NAMES).malformed).toBe(true);
  });
});

describe('wrappers and schema echoes inside the arguments', () => {
  it('unwraps a call wrapper nested in the arguments (one level, string or object function) and marks it recovered', () => {
    const out = normalizeToolCalls([
      { id: 'a', function: { name: 'list_items', arguments: { type: 'function', function: 'list_items', parameters: { status: 'done' } } } },
      { id: 'b', function: { name: 'list_items', arguments: JSON.stringify({ function: { name: 'list_items', parameters: { status: 'active' } } }) } },
      { id: 'c', function: { name: '', arguments: { name: 'list_items', arguments: { category: 'tools' } } } },
    ]);
    expect(out).toEqual([
      { id: 'a', name: 'list_items', args: { status: 'done' }, recovered: true },
      { id: 'b', name: 'list_items', args: { status: 'active' }, recovered: true },
      { id: 'c', name: 'list_items', args: { category: 'tools' }, recovered: true },
    ]);
  });

  it('drops a schema echo as arguments, then validates (required arguments stay required)', () => {
    const echo = { type: 'object', properties: { status: { type: 'string' } } };
    const [list] = normalizeToolCalls([{ function: { name: 'list_items', arguments: echo } }]);
    expect(list).toMatchObject({ args: {}, recovered: true });
    expect(validateToolArgs('list_items', list.args, TOOLS).ok).toBe(true);
    const [search] = normalizeToolCalls([{ function: { name: 'search_data', arguments: { type: 'function', function: 'search_data', parameters: echo } } }]);
    expect(search.args).toEqual({});
    expect(validateToolArgs('search_data', search.args, TOOLS)).toMatchObject({ ok: false, error: expect.stringContaining('query') });
  });

  it('flags top-level and string-function call shapes as recovered (the agent parks writes)', () => {
    const out = normalizeToolCalls([
      { name: 'add_item', arguments: { name: 'a' } },
      { function: 'add_item', arguments: { name: 'b' } },
    ]);
    expect(out.map((c) => [c.name, c.args, c.recovered])).toEqual([
      ['add_item', { name: 'a' }, true],
      ['add_item', { name: 'b' }, true],
    ]);
  });

  it('leaves ordinary arguments alone and does not mark them recovered', () => {
    const [c] = normalizeToolCalls([{ function: { name: 'add_item', arguments: { name: 'name it', category: 'tools' } } }]);
    expect(c).toEqual({ id: 'call_0', name: 'add_item', args: { name: 'name it', category: 'tools' } });
  });
});

describe('extractTextToolCalls: a copied tool list', () => {
  const echo =
    '{"type":"function","function":{"name":"list_items","description":"List items","parameters":{"type":"object","properties":{"status":{"type":"string"}}}}}, {"type":"function","function":{"name":"get_weather","descr';

  it('takes the first complete object as the call and drops the echoed schema', () => {
    expect(extractTextToolCalls(echo, NAMES)).toEqual({ calls: [{ name: 'list_items', arguments: {} }], text: '', malformed: false });
  });

  it('keeps braces inside strings from ending the object early', () => {
    const text = '{"name":"search_data","arguments":{"query":"a } b"}}, {"name":"list_items';
    expect(extractTextToolCalls(text, NAMES).calls).toEqual([{ name: 'search_data', arguments: { query: 'a } b' } }]);
  });

  it('recovers when the object is followed by the rest of a copied list', () => {
    for (const tail of ['', '  ', ', {"type":"function"', ' {"type":"function"', ' ]', ' [1']) {
      const text = `{"name":"list_items","arguments":{}}${tail}`;
      expect(extractTextToolCalls(text, NAMES).calls).toEqual([{ name: 'list_items', arguments: {} }]);
    }
  });

  it('ignores a first object that is not a known tool, and an unfinished one', () => {
    expect(extractTextToolCalls('{"name":"Bob"} is my friend', NAMES).calls).toEqual([]);
    expect(extractTextToolCalls('{"type":"function","function":{"name":"list_items","descr', NAMES).calls).toEqual([]);
  });

  it('reads a write the same way (the agent parks it)', () => {
    expect(extractTextToolCalls('{"name":"add_item","arguments":{"name":"x"}}, {"type":"fun', NAMES).calls).toEqual([{ name: 'add_item', arguments: { name: 'x' } }]);
  });

  it('never runs JSON that is followed by prose (quoted from a note, say)', () => {
    for (const text of [
      '{"name":"add_item","arguments":{"name":"x"}} trailing',
      '{"name":"list_items","arguments":{}} is what the note says.',
      '{"name":"search_data","arguments":{"query":"a } b"}} and then some more',
    ]) {
      expect(extractTextToolCalls(text, NAMES).calls).toEqual([]);
    }
  });
});

describe('refuseTextToolCalls (an unknown tool written as text)', () => {
  const S = UNKNOWN_TOOL_SENTENCE;
  it('replaces the tutor reply, a fenced block and a part of a reply', () => {
    const raw = '{"name": "run_command", "parameters": {"c": "dir C:\\""}}';
    expect(refuseTextToolCalls(raw, NAMES)).toEqual({ text: S, names: ['run_command'] });
    const fenced = ['```json', '{"function":"rm","args":{}}', '```'].join('\n');
    expect(refuseTextToolCalls(fenced, NAMES)).toEqual({ text: S, names: ['rm'] });
    expect(refuseTextToolCalls('Sure. {"name":"x","arguments":{}} Done.', NAMES).text).toBe(`Sure. ${S} Done.`);
  });
  it('refuses the three bypasses: a missing last brace, other keys and call syntax (RV26-46)', () => {
    expect(refuseTextToolCalls('{"name":"run_command","parameters":{"c":"C:/x"}', NAMES)).toEqual({ text: S, names: ['run_command'] });
    expect(refuseTextToolCalls('Sure. {"name":"run_command","parameters":{"c":"x"}', NAMES).text).toBe(`Sure. ${S}`);
    expect(refuseTextToolCalls('{"tool":"run_command","input":{"c":"x"}}', NAMES)).toEqual({ text: S, names: ['run_command'] });
    expect(refuseTextToolCalls('{"tool":"run_command","command":"dir"', NAMES).names).toEqual(['run_command']);
    expect(refuseTextToolCalls('{"name":"run_command","command":"dir"}', NAMES).names).toEqual(['run_command']);
    expect(refuseTextToolCalls('Running run_command("dir C:") now.', NAMES)).toEqual({ text: `Running ${S} now.`, names: ['run_command'] });
    expect(refuseTextToolCalls(['```', 'run_command("dir")', '```'].join('\n'), NAMES)).toEqual({ text: S, names: ['run_command'] });
  });
  it('refuses call syntax whose argument holds the letter n or a backslash (RV26-56)', () => {
    expect(refuseTextToolCalls('run_command("notepad")', NAMES)).toEqual({ text: S, names: ['run_command'] });
    expect(refuseTextToolCalls("open_file('C:\\new')", NAMES)).toEqual({ text: S, names: ['open_file'] });
  });
  it('keeps prose parentheses, code that names no tool, known tools and plain keys', () => {
    for (const text of [
      'Call me (if you can) later.',
      'Use print("hi") to show it.',
      ['```python', 'print("hi")', 'value = load_rows("a")', 'print(value)', '```'].join('\n'),
      'list_items("active") is a read.',
      '{"tool":"hammer","input":3}',
      '{"command":"dir"}',
      '{"name":"Ana","command":"x"}',
    ]) {
      expect(refuseTextToolCalls(text, NAMES)).toEqual({ text, names: [] });
    }
  });
  it('keeps a known tool and JSON that names no tool', () => {
    for (const text of ['{"name":"list_items","arguments":{}}', '{"name":"Ana","age":4}', 'Totals: {"count": 3}', 'Plain words.']) {
      expect(refuseTextToolCalls(text, NAMES)).toEqual({ text, names: [] });
    }
  });
});
