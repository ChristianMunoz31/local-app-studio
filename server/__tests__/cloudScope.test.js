// The cloud choke point: enforceCloudScope and createAiClient events(). A cloud call without a
// scope, or with a withheld category in it, throws before the transport; tool data of a withheld
// category (current turn or earlier local turns) is replaced before anything is sent; local
// clients are untouched.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../loadEnv.js', () => ({}));
vi.mock('../modules/studio.data.js', (orig) => import('./helpers/fixtureModules.js').then((m) => m.withFixtureCategories(orig)));

import { createAiClient } from '../ai/registry.js';
import { CLOUD_CATEGORY_DEFAULTS, CloudScopeError, createAiPolicy, enforceCloudScope, withheldToolResult } from '../ai/privacy.js';
import { classifyAiError } from '../ai/index.js';
import { historyToMessages } from '../agents/assistantAgent.js';
import { ASSISTANT_TOOLS } from '../agents/assistantTools.js';

const SECRET = 'SENTINEL_NOTES_scope1';
const cloud = (categories = {}) => createAiPolicy({ isCloud: true, categories: { ...CLOUD_CATEGORY_DEFAULTS, ...categories } });
const local = () => createAiPolicy({ isCloud: false });

const call = (id, name, args = {}) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const assistantCalls = (...calls) => ({ role: 'assistant', content: '', tool_calls: calls });
const tool = (id, content) => ({ role: 'tool', tool_call_id: id, content: typeof content === 'string' ? content : JSON.stringify(content) });
const scope = (extra = {}) => ({ categories: [], ...extra });

describe('enforceCloudScope: scope checks', () => {
  const messages = [{ role: 'user', content: 'hi' }];

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'alpha'],
    ['an empty object', {}],
    ['categories not an array', { categories: 'alpha' }],
    ['a non-string category', { categories: [1] }],
  ])('throws cloud_scope_missing for %s', (_label, bad) => {
    expect(() => enforceCloudScope({ messages, scope: bad, policy: cloud() })).toThrow(CloudScopeError);
    try {
      enforceCloudScope({ messages, scope: bad, policy: cloud() });
    } catch (err) {
      expect(err.code).toBe('cloud_scope_missing');
    }
  });

  it('throws cloud_scope_denied naming every withheld, internal or unknown category', () => {
    for (const bad of [['beta'], ['memory'], ['bogus'], ['alpha', 'beta']]) {
      let thrown;
      try {
        enforceCloudScope({ messages, scope: { categories: bad }, policy: cloud() });
      } catch (err) {
        thrown = err;
      }
      expect(thrown, bad.join()).toBeInstanceOf(CloudScopeError);
      expect(thrown.code).toBe('cloud_scope_denied');
    }
    try {
      enforceCloudScope({ messages, scope: { categories: ['alpha', 'beta', 'bogus', 'memory'] }, policy: cloud() });
    } catch (err) {
      expect(err.categories).toEqual(['beta']);
    }
  });

  it('accepts shared categories and returns them with the messages', () => {
    const out = enforceCloudScope({ messages, tools: [{ x: 1 }], scope: { categories: ['alpha'] }, policy: cloud() });
    expect(out.shared).toEqual(['alpha']);
    expect(out.tools).toEqual([{ x: 1 }]);
    expect(out.messages).toEqual(messages);
  });

  it('a category turned on by the user is accepted (settings are read at call time)', () => {
    expect(() => enforceCloudScope({ messages, scope: { categories: ['beta'] }, policy: cloud({ beta: true }) })).not.toThrow();
  });

  it('local returns the input unchanged and ignores the scope', () => {
    const tools = [{ x: 1 }];
    const out = enforceCloudScope({ messages, tools, scope: undefined, policy: local() });
    expect(out.messages).toBe(messages);
    expect(out.tools).toBe(tools);
    expect(enforceCloudScope({ messages, scope: { categories: ['beta', 'memory'] }, policy: local() }).messages).toBe(messages);
  });

  it('the denial classifies to a 403 with the fixed withheld copy', () => {
    const err = new CloudScopeError('cloud_scope_denied', ['beta']);
    expect(classifyAiError(err)).toEqual({
      code: 'cloud_scope_denied',
      message: "Your item notes aren't shared with cloud AI. You can change that in Settings > AI.",
      retryMs: null,
      httpStatus: 403,
    });
  });
});

describe('enforceCloudScope: tool results', () => {
  it('replaces a withheld tool result in the current turn and blanks the arguments of its call', () => {
    const messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'what did I write?' },
      assistantCalls(call('c1', 'read_both', { limit: 3 }), call('c2', 'read_alpha')),
      tool('c1', { beta: [{ beta: SECRET }] }),
      tool('c2', { alpha: [{ name: 'Desk lamp' }] }),
    ];
    const out = enforceCloudScope({ messages, scope: scope(), policy: cloud() });
    const text = JSON.stringify(out.messages);
    expect(text).not.toContain(SECRET);
    expect(out.messages[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: JSON.stringify(withheldToolResult('beta')) });
    expect(out.messages[4].content).toContain('Desk lamp');
    expect(out.messages[2].tool_calls[0].function.arguments).toBe('{}');
    expect(out.messages[2].tool_calls[1].function.arguments).toBe('{}');
    expect(out.shared).toEqual(['alpha']);
    expect(out.withheld).toEqual(['beta']);
  });

  it('keeps the arguments of calls whose category is shared', () => {
    const messages = [{ role: 'user', content: 'x' }, assistantCalls(call('c1', 'read_alpha', { status: 'active' })), tool('c1', { alpha: [] })];
    const out = enforceCloudScope({ messages, scope: scope(), policy: cloud() });
    expect(out.messages[1].tool_calls[0].function.arguments).toBe('{"status":"active"}');
  });

  it('every withheld tool is replaced, whichever category it maps to', () => {
    const cases = [['read_both', 'beta']];
    for (const [name, category] of cases) {
      const messages = [{ role: 'user', content: 'x' }, assistantCalls(call('c1', name)), tool('c1', { leak: SECRET })];
      const out = enforceCloudScope({ messages, scope: scope(), policy: cloud() });
      expect(JSON.stringify(out.messages), name).not.toContain(SECRET);
      expect(JSON.parse(out.messages[2].content)).toMatchObject({ not_shared: true, category });
    }
  });

  it('an orphan tool message (no matching call) and an unknown tool are replaced by the generic placeholder', () => {
    const orphan = enforceCloudScope({ messages: [{ role: 'user', content: 'x' }, tool('nope', { leak: SECRET })], scope: scope(), policy: cloud() });
    expect(JSON.stringify(orphan.messages)).not.toContain(SECRET);
    const unknown = enforceCloudScope({
      messages: [{ role: 'user', content: 'x' }, assistantCalls(call('c1', 'format_disk')), tool('c1', { leak: SECRET })],
      scope: scope(),
      policy: cloud(),
    });
    expect(JSON.stringify(unknown.messages)).not.toContain(SECRET);
    expect(JSON.parse(unknown.messages[2].content)).toMatchObject({ not_shared: true, category: null });
  });

  describe('a tool mapped to several categories (read_both: items and notes)', () => {
    const NAME_SECRET = 'SENTINEL_ITEMNAME_scope1';
    const rowsFor = () => [
      { role: 'user', content: 'what did I write?' },
      assistantCalls(call('c1', 'read_both', { limit: 3 })),
      tool('c1', { beta: [{ name: NAME_SECRET, beta: SECRET }] }),
    ];

    it('notes shared but items withheld: replaced by the items placeholder, args blanked, notes not counted as shared', () => {
      const out = enforceCloudScope({ messages: rowsFor(), scope: scope(), policy: cloud({ beta: true, alpha: false }) });
      expect(out.messages[2]).toEqual({ role: 'tool', tool_call_id: 'c1', content: JSON.stringify(withheldToolResult(['alpha'])) });
      expect(out.messages[1].tool_calls[0].function.arguments).toBe('{}');
      expect(out.withheld).toEqual(['alpha']);
      expect(out.shared).not.toContain('beta');
      expect(JSON.stringify(out.messages)).not.toContain(NAME_SECRET);
      expect(JSON.stringify(out.messages)).not.toContain(SECRET);
    });

    it('items off (notes off too): the multi placeholder names both', () => {
      const out = enforceCloudScope({ messages: rowsFor(), scope: scope(), policy: cloud({ alpha: false }) });
      expect(JSON.parse(out.messages[2].content)).toEqual(withheldToolResult(['alpha', 'beta']));
      expect(JSON.parse(out.messages[2].content).categories).toEqual(['alpha', 'beta']);
      expect(out.withheld).toEqual(['alpha', 'beta']);
    });

    it('notes shared and items shared: row and args kept, both counted as shared', () => {
      const out = enforceCloudScope({ messages: rowsFor(), scope: scope(), policy: cloud({ beta: true }) });
      expect(out.messages[2].content).toContain(SECRET);
      expect(out.messages[1].tool_calls[0].function.arguments).toBe('{"limit":3}');
      expect(out.shared).toEqual(['alpha', 'beta']);
      expect(out.withheld).toEqual([]);
    });

    it('an earlier turn that used it is dropped with only the denied category withheld', () => {
      const messages = [...rowsFor(), { role: 'assistant', content: `You wrote ${SECRET}.` }, { role: 'user', content: 'now' }];
      const out = enforceCloudScope({ messages, scope: scope(), policy: cloud({ beta: true, alpha: false }) });
      expect(out.messages).toEqual([{ role: 'user', content: 'now' }]);
      expect(out.withheld).toEqual(['alpha']);
    });
  });

  it('leaves the tool list alone', () => {
    const out = enforceCloudScope({ messages: [{ role: 'user', content: 'x' }], tools: ASSISTANT_TOOLS, scope: scope(), policy: cloud() });
    expect(out.tools).toBe(ASSISTANT_TOOLS);
  });
});

describe('enforceCloudScope: earlier local turns', () => {
  // A turn answered locally with the item-notes tool, then an ordinary turn built on it.
  const earlier = [
    { role: 'user', content: 'tell me about my notes' },
    assistantCalls(call('h1', 'read_both')),
    tool('h1', { beta: [{ beta: SECRET }] }),
    { role: 'assistant', content: `You wrote about ${SECRET}.` },
    { role: 'user', content: 'summarize that in five words' },
    { role: 'assistant', content: `Short: ${SECRET} summary.` },
  ];

  it('drops a turn that used a withheld tool entirely, user message and answer included', () => {
    const messages = [{ role: 'system', content: 'sys' }, ...earlier.slice(0, 4), { role: 'user', content: 'how many items do I have?' }];
    const out = enforceCloudScope({ messages, scope: scope(), policy: cloud() });
    expect(out.messages).toEqual([{ role: 'system', content: 'sys' }, { role: 'user', content: 'how many items do I have?' }]);
    expect(out.withheld).toEqual(['beta']);
  });

  it('also drops every later earlier turn, which may have been answered from the withheld data', () => {
    const messages = [{ role: 'system', content: 'sys' }, ...earlier, { role: 'user', content: 'and now?' }];
    const out = enforceCloudScope({ messages, scope: scope(), policy: cloud() });
    expect(JSON.stringify(out.messages)).not.toContain(SECRET);
    expect(out.messages.map((m) => m.role)).toEqual(['system', 'user']);
  });

  it('keeps earlier turns that came before the withheld one and turns that used shared tools', () => {
    const shared = [
      { role: 'user', content: 'items?' },
      assistantCalls(call('s1', 'read_alpha')),
      tool('s1', { alpha: [{ name: 'Desk lamp' }] }),
      { role: 'assistant', content: 'One item: Desk lamp.' },
    ];
    const messages = [...shared, ...earlier, { role: 'user', content: 'now' }];
    const out = enforceCloudScope({ messages, scope: scope(), policy: cloud() });
    expect(out.messages.slice(0, 4)).toEqual(shared);
    expect(out.messages).toHaveLength(5);
    expect(JSON.stringify(out.messages)).not.toContain(SECRET);
  });

  it('keeps everything when the earlier tool category is now shared', () => {
    const messages = [...earlier.slice(0, 4), { role: 'user', content: 'now' }];
    const out = enforceCloudScope({ messages, scope: scope(), policy: cloud({ beta: true }) });
    expect(out.messages).toHaveLength(5);
  });

  it('works on real persisted history (assistant tool rows, confirmations, replaced tool rows)', () => {
    const rows = [
      { role: 'user', content: 'what notes did I write?' },
      { role: 'assistant', content: '', toolCalls: [call('p1', 'read_both')] },
      { role: 'tool', toolCallId: 'p1', content: JSON.stringify({ beta: [{ beta: SECRET }] }) },
      { role: 'assistant', content: `Entry: ${SECRET}` },
    ];
    const messages = [{ role: 'system', content: 'sys' }, ...historyToMessages(rows), { role: 'user', content: 'hello' }];
    const out = enforceCloudScope({ messages, scope: scope(), policy: cloud() });
    expect(JSON.stringify(out.messages)).not.toContain(SECRET);
    expect(out.messages.at(-1)).toEqual({ role: 'user', content: 'hello' });
  });

  it('a tool call to an unknown tool in an earlier turn taints that turn too', () => {
    const messages = [{ role: 'user', content: 'a' }, assistantCalls(call('u1', 'format_disk')), tool('u1', { x: SECRET }), { role: 'user', content: 'b' }];
    const out = enforceCloudScope({ messages, scope: scope(), policy: cloud() });
    expect(JSON.stringify(out.messages)).not.toContain(SECRET);
  });

  it('leading system messages are kept; system rows inside a tainted turn are dropped', () => {
    const messages = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'a' }, assistantCalls(call('x1', 'read_both')), tool('x1', {}), { role: 'system', content: 'nudge' }, { role: 'user', content: 'b' }];
    const out = enforceCloudScope({ messages, scope: scope(), policy: cloud() });
    expect(out.messages.filter((m) => m.role === 'system').map((m) => m.content)).toEqual(['sys']);
  });
});

describe('createAiClient: the single choke point', () => {
  const transportSpy = () => {
    const calls = [];
    const transport = async function* (opts) {
      calls.push(opts);
      yield { type: 'token', text: 'ok' };
      yield { type: 'done', usage: null, finishReason: 'stop' };
    };
    return { transport, calls };
  };
  const cloudClient = (categories) => {
    const spy = transportSpy();
    const client = createAiClient({
      provider: 'openai_compat',
      kind: 'cloud',
      aiHost: 'api.example.com',
      policy: cloud(categories),
      model: 'm',
      purpose: 'chat',
      numCtx: 8192,
      transport: spy.transport,
      authorizeSend: async () => ({}),
    });
    return { client, ...spy };
  };
  const msgs = [{ role: 'user', content: 'hi' }];

  it('complete, stream and chatWithTools all throw before the transport without a scope', async () => {
    const { client, calls } = cloudClient();
    await expect(client.complete({ messages: msgs })).rejects.toMatchObject({ code: 'cloud_scope_missing' });
    await expect(
      (async () => {
        for await (const ev of client.stream({ messages: msgs })) void ev;
      })(),
    ).rejects.toMatchObject({ code: 'cloud_scope_missing' });
    await expect(client.chatWithTools({ messages: msgs, tools: ASSISTANT_TOOLS })).rejects.toMatchObject({ code: 'cloud_scope_missing' });
    expect(calls).toHaveLength(0);
    expect(client.stats.calls).toBe(0);
  });

  it('refuses a withheld category in the scope before the transport', async () => {
    const { client, calls } = cloudClient();
    await expect(client.complete({ messages: msgs, scope: { categories: ['beta'] } })).rejects.toMatchObject({ code: 'cloud_scope_denied', categories: ['beta'] });
    expect(calls).toHaveLength(0);
  });

  it('sends the filtered messages to the transport and keeps the data report (names only)', async () => {
    const { client, calls } = cloudClient();
    const messages = [
      { role: 'user', content: 'notes?' },
      assistantCalls(call('c1', 'read_both')),
      tool('c1', { beta: [{ beta: SECRET }] }),
    ];
    const out = await client.chatWithTools({ messages, tools: ASSISTANT_TOOLS, scope: { categories: ['alpha'], withheld: [] } });
    expect(out.message.content).toBe('ok');
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls[0].messages)).not.toContain(SECRET);
    expect(calls[0].tools).toBe(ASSISTANT_TOOLS);
    expect(client.dataReport()).toEqual({ shared: ['alpha'], withheld: ['beta'] });
    expect(client.ai).toEqual({ kind: 'cloud', host: 'api.example.com' });
    expect(client.isCloud).toBe(true);
  });

  it('a cloud client built without a policy defaults to the cloud defaults, never to allow-all', async () => {
    const spy = transportSpy();
    const client = createAiClient({ provider: 'openai_compat', model: 'm', purpose: 'chat', numCtx: 8192, transport: spy.transport, authorizeSend: async () => ({}) });
    await expect(client.complete({ messages: msgs, scope: { categories: ['beta'] } })).rejects.toMatchObject({ code: 'cloud_scope_denied' });
    expect(spy.calls).toHaveLength(0);
  });

  it('a local client needs no scope and receives every message untouched', async () => {
    const spy = transportSpy();
    const client = createAiClient({ provider: 'ollama', model: 'm', purpose: 'chat', numCtx: 8192, host: 'http://127.0.0.1:11434', transport: spy.transport });
    const messages = [{ role: 'user', content: 'x' }, assistantCalls(call('c1', 'read_both')), tool('c1', { beta: [{ beta: SECRET }] })];
    await client.chatWithTools({ messages, tools: ASSISTANT_TOOLS });
    expect(JSON.stringify(spy.calls[0].messages)).toContain(SECRET);
    expect(client.ai).toEqual({ kind: 'local', host: null });
    expect(client.isCloud).toBe(false);
    expect(client.dataReport()).toEqual({ shared: [], withheld: [] });
  });

  it('a LAN Ollama client is treated as local: every category passes', async () => {
    const spy = transportSpy();
    const client = createAiClient({ provider: 'ollama', kind: 'lan', aiHost: '192.0.2.50', model: 'm', purpose: 'chat', numCtx: 8192, transport: spy.transport });
    await client.complete({ messages: [{ role: 'user', content: SECRET }], scope: { categories: ['beta'] } });
    expect(JSON.stringify(spy.calls[0].messages)).toContain(SECRET);
    expect(client.ai).toEqual({ kind: 'lan', host: '192.0.2.50' });
  });
});
