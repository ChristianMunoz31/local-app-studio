// Adversarial tests for multi-category cloud privacy entries (arrays of category ids). Expectations
// come from an independent reference model of the contract, not from the implementation.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../loadEnv.js', () => ({}));
vi.mock('../modules/studio.data.js', (orig) => import('./helpers/fixtureModules.js').then((m) => m.withFixtureCategories(orig)));

import {
  CLOUD_CATEGORY_IDS,
  CloudScopeError,
  applyPagePolicy,
  categoryList,
  cloudHistoryUserRows,
  createAiPolicy,
  enforceCloudScope,
  withheldToolResult,
} from '../ai/privacy.js';

const COMBOS = [
  { alpha: true, beta: true },
  { alpha: true, beta: false },
  { alpha: false, beta: true },
  { alpha: false, beta: false },
];
const label = (c) => `items=${c.alpha} notes=${c.beta}`;
const cloud = (categories, extra = {}) => createAiPolicy({ isCloud: true, categories, ...extra });
const order = (ids) => CLOUD_CATEGORY_IDS.filter((id) => ids.includes(id));
const denied = (combo, need) => order(need.filter((id) => !combo[id]));

// Reference model: categories each thing requires.
const TOOL_NEEDS = {
  read_alpha: ['alpha'],
  read_both: ['alpha', 'beta'],
  read_public: [],
};

describe('categoryList', () => {
  it('normalizes strings, dedupes, orders, and rejects malformed', () => {
    expect(categoryList('alpha')).toEqual(['alpha']);
    expect(categoryList(['beta', 'alpha', 'beta'])).toEqual(['alpha', 'beta']);
    expect(categoryList(['beta'])).toEqual(['beta']);
    for (const bad of [[], ['x'], ['alpha', 'x'], ['alpha', null], [['alpha']], {}, 5, undefined, null, true]) {
      expect(categoryList(bad)).toBeUndefined();
    }
  });
});

describe('withheldToolResult with lists', () => {
  it('one id equals the string form, 2+ ids give categories and null category', () => {
    expect(withheldToolResult(['beta'])).toEqual(withheldToolResult('beta'));
    const multi = withheldToolResult(['beta', 'alpha', 'alpha']);
    expect(multi.not_shared).toBe(true);
    expect(multi.category).toBeNull();
    expect(multi.categories).toEqual(['alpha', 'beta']);
    expect(typeof multi.message).toBe('string');
    expect(multi.message).toMatch(/items/);
    expect(multi.message).toMatch(/notes/);
  });
  it('unknown or empty lists give the generic placeholder', () => {
    for (const v of [[], ['bogus'], null, undefined]) {
      const r = withheldToolResult(v);
      expect(r.not_shared).toBe(true);
      expect(r.category).toBeNull();
      expect(r.categories).toBeUndefined();
    }
  });
});

describe('policy.toolDecision matrix', () => {
  for (const combo of COMBOS) {
    describe(label(combo), () => {
      const policy = cloud(combo);

      for (const [name, need] of Object.entries(TOOL_NEEDS)) {
        it(`${name}`, () => {
          const d = policy.toolDecision(name, { x: 1 });
          const den = denied(combo, need);
          expect(d.allowed).toBe(den.length === 0);
          expect(d.withheld).toEqual(den);
          expect(d.categories).toEqual(den.length ? [] : order(need));
          expect(d.args).toEqual({ x: 1 });
        });
      }

      it('unknown tool and inherited names are refused with withheld []', () => {
        for (const n of ['nope', '', 'constructor', '__proto__', 'toString', undefined, 5]) {
          const d = policy.toolDecision(n, {});
          expect(d).toMatchObject({ allowed: false, categories: [], withheld: [] });
        }
      });

    });
  }

  it('local allows everything unchanged', () => {
    const local = createAiPolicy({ isCloud: false, categories: { alpha: false, beta: false } });
    for (const n of ['read_both', 'read_alpha', 'read_public', 'nope']) {
      expect(local.toolDecision(n, { x: 1 })).toMatchObject({ allowed: true, args: { x: 1 }, categories: [], withheld: [] });
    }
    expect(local.pageDecision('home').allowed).toBe(true);
  });
});

// ---- enforceCloudScope ----
const S = {
  listItems: 'SENT_LISTITEMS_a1',
  notesItem: 'SENT_NOTESITEM_b2',
  notesText: 'SENT_NOTESTEXT_c3',
  stats: 'SENT_STATS_d4',
  argNotes: 'SENT_ARGNOTES_h8',
  argItems: 'SENT_ARGITEMS_i9',
  argUnknown: 'SENT_ARGUNKNOWN_j0',
  unknownRow: 'SENT_UNKNOWNROW_k1',
};
// sentinel -> categories required to send it ('never' can never be satisfied)
const SENTINEL_NEEDS = {
  [S.listItems]: ['alpha'],
  [S.notesItem]: ['alpha', 'beta'],
  [S.notesText]: ['alpha', 'beta'],
  [S.stats]: ['alpha'],
  [S.argNotes]: ['alpha', 'beta'],
  [S.argItems]: ['alpha'],
  [S.argUnknown]: ['never'],
  [S.unknownRow]: ['never'],
};

const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const toolRow = (id, content) => ({ role: 'tool', tool_call_id: id, content: typeof content === 'string' ? content : JSON.stringify(content) });

function currentTurn() {
  return [
    { role: 'system', content: 'You are Assistant.' },
    { role: 'user', content: 'show me stuff' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        call('t1', 'read_alpha', { filter: S.argItems }),
        call('t2', 'read_both', { item: S.argNotes }),
        call('t3', 'read_alpha', {}),
        call('t5', 'mystery_tool', { x: S.argUnknown }),
      ],
    },
    toolRow('t1', { alpha: [{ name: S.listItems }] }),
    toolRow('t2', { beta: [{ item: S.notesItem, text: S.notesText }] }),
    toolRow('t3', { stats: S.stats }),
    toolRow('t5', { secret: S.unknownRow }),
  ];
}

const sentinelsIn = (out) => Object.keys(SENTINEL_NEEDS).filter((s) => JSON.stringify(out.messages).includes(s));

describe('enforceCloudScope', () => {
  for (const combo of COMBOS) {
    describe(label(combo), () => {
      const policy = cloud(combo);

      it('current turn: no denied sentinel leaks; exact shared and withheld', () => {
        const input = currentTurn();
        const snapshot = JSON.stringify(input);
        const out = enforceCloudScope({ messages: input, scope: { categories: [] }, policy });
        expect(JSON.stringify(input)).toBe(snapshot); // input not mutated
        const present = sentinelsIn(out);
        for (const s of Object.keys(SENTINEL_NEEDS)) {
          const ok = SENTINEL_NEEDS[s].every((c) => combo[c] === true);
          if (!ok) expect(present, `${s} must be absent`).not.toContain(s);
        }
        // allowed row content is retained
        for (const s of [S.listItems, S.stats]) if (combo.alpha) expect(present).toContain(s);
        if (combo.alpha && combo.beta) for (const s of [S.notesItem, S.notesText, S.argNotes]) expect(present).toContain(s);
        // the unknown tool is never passed through
        expect(present).not.toContain(S.unknownRow);
        expect(present).not.toContain(S.argUnknown);

        const exShared = new Set();
        const exWithheld = new Set();
        const consider = (need) => {
          const d = denied(combo, need);
          if (d.length) d.forEach((c) => exWithheld.add(c));
          else need.forEach((c) => exShared.add(c));
        };
        consider(['alpha']); // read_alpha
        consider(['alpha', 'beta']); // read_both
        consider(['alpha']); // read_alpha
        expect(out.shared).toEqual(order([...exShared]));
        expect(out.withheld).toEqual(order([...exWithheld]));
        for (const c of out.shared) expect(combo[c]).toBe(true);
        if (!combo.alpha) expect(out.shared).toEqual([]);
        // rows keep role order and tool ids
        expect(out.messages.map((m) => m.role)).toEqual(input.map((m) => m.role));
        expect(out.messages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id)).toEqual(['t1', 't2', 't3', 't5']);
        // a withheld multi-category row names exactly the denied categories
        const t2 = JSON.parse(out.messages.find((m) => m.tool_call_id === 't2').content);
        const den = denied(combo, ['alpha', 'beta']);
        if (den.length) {
          expect(t2.not_shared).toBe(true);
          expect(t2.categories ?? [t2.category]).toEqual(den);
        }
      });

      it('earlier tainted turn is dropped whole; final user kept', () => {
        const earlier = currentTurn().slice(1); // user + assistant + tool rows
        const messages = [{ role: 'system', content: 'sys' }, ...earlier, { role: 'assistant', content: 'SENT_REPLY_FROM_DATA' }, { role: 'user', content: 'final question' }];
        const out = enforceCloudScope({ messages, scope: { categories: [] }, policy });
        for (const s of Object.keys(SENTINEL_NEEDS)) {
          if (!SENTINEL_NEEDS[s].every((c) => combo[c] === true)) expect(JSON.stringify(out.messages)).not.toContain(s);
        }
        // the unknown tool taints the earlier turn in every combo, so its reply is gone
        expect(JSON.stringify(out.messages)).not.toContain('SENT_REPLY_FROM_DATA');
        expect(out.messages[0]).toEqual({ role: 'system', content: 'sys' });
        expect(out.messages.at(-1)).toEqual({ role: 'user', content: 'final question' });
        for (const c of out.shared) expect(combo[c]).toBe(true);
        for (const c of out.withheld) expect(combo[c]).toBe(false);
      });

      it('scope.categories naming a denied category throws', () => {
        for (const cats of [['alpha'], ['beta'], ['alpha', 'beta']]) {
          const bad = order(cats.filter((c) => !combo[c]));
          const run = () => enforceCloudScope({ messages: currentTurn(), scope: { categories: cats }, policy });
          if (bad.length) {
            let err;
            try {
              run();
            } catch (e) {
              err = e;
            }
            expect(err).toBeInstanceOf(CloudScopeError);
            expect(err.code).toBe('cloud_scope_denied');
            expect(err.categories).toEqual(bad);
          } else {
            expect(run().shared).toEqual(expect.arrayContaining(cats));
          }
        }
      });
    });
  }

  it('unknown or non-string scope categories are denied or missing', () => {
    const p = cloud({ alpha: true, beta: true });
    let err;
    try {
      enforceCloudScope({ messages: [], scope: { categories: ['bogus'] }, policy: p });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CloudScopeError);
    expect(err.code).toBe('cloud_scope_denied');
    expect(err.categories).toEqual([]);
    for (const scope of [undefined, null, {}, { categories: 'alpha' }, { categories: [1] }]) {
      let e2;
      try {
        enforceCloudScope({ messages: [], scope, policy: p });
      } catch (e) {
        e2 = e;
      }
      expect(e2?.code, JSON.stringify(scope)).toBe('cloud_scope_missing');
    }
  });

  it('tool row with no matching declared call is replaced', () => {
    const p = cloud({ alpha: true, beta: true });
    const messages = [
      { role: 'user', content: 'q' },
      { role: 'tool', tool_call_id: 'orphan', content: 'SENT_ORPHAN' },
    ];
    const out = enforceCloudScope({ messages, scope: { categories: [] }, policy: p });
    expect(JSON.stringify(out.messages)).not.toContain('SENT_ORPHAN');
  });

  it('local policy returns the input unchanged', () => {
    const messages = currentTurn();
    const tools = [{ type: 'function' }];
    const out = enforceCloudScope({ messages, tools, scope: undefined, policy: createAiPolicy({ isCloud: false }) });
    expect(out.messages).toBe(messages);
    expect(out.tools).toBe(tools);
    expect(out.shared).toEqual([]);
    expect(out.withheld).toEqual([]);
  });
});

// ---- cloudHistoryUserRows ----
const historyRows = (toolCalls, extraTool = true) => [
  { role: 'user', content: 'u0' },
  { role: 'assistant', content: 'plain answer', toolCalls: null },
  { role: 'user', content: 'u1' },
  { role: 'assistant', content: '', toolCalls },
  ...(extraTool ? [{ role: 'tool', toolCallId: 'c1', content: 'data' }] : []),
  { role: 'assistant', content: 'answer' },
  { role: 'user', content: 'u2' },
];
const hist = (rows, policy) => cloudHistoryUserRows(rows, policy).map((r) => r.content);

describe('cloudHistoryUserRows taint', () => {
  for (const combo of COMBOS) {
    describe(label(combo), () => {
      const policy = cloud(combo);
      const cases = [
        ...Object.entries(TOOL_NEEDS).map(([n, need]) => [n, need]),
      ];
      for (const [name, need] of cases) {
        it(`${name}`, () => {
          const rows = historyRows([call('c1', name, {})]);
          const bad = denied(combo, need).length > 0;
          expect(hist(rows, policy)).toEqual(bad ? ['u0'] : ['u0', 'u1', 'u2']);
        });
      }
      it('unknown tool taints this and all later turns', () => {
        expect(hist(historyRows([call('c1', 'mystery', {})]), policy)).toEqual(['u0']);
      });
    });
  }

  it('fail closed on untrusted tool_calls values and orphan tool rows', () => {
    const p = cloud({ alpha: true, beta: true });
    expect(hist(historyRows('{not json'), p)).toEqual(['u0']);
    expect(hist(historyRows({ a: 1 }), p)).toEqual(['u0']);
    expect(hist(historyRows([call('c1', 'read_alpha', {})]), p)).toEqual(['u0', 'u1', 'u2']);
    expect(hist(historyRows(JSON.stringify([call('c1', 'read_alpha', {})])), p)).toEqual(['u0', 'u1', 'u2']);
    expect(hist(historyRows([call('other', 'read_alpha', {})]), p)).toEqual(['u0']); // tool row c1 undeclared
    const bad = call('c1', 'read_alpha', {});
    bad.function.arguments = '{oops';
    expect(hist(historyRows([bad]), p)).toEqual(['u0', 'u1', 'u2']); // arguments are never inspected: the tool name decides
  });

  it('empty and non-array input', () => {
    const p = cloud({ alpha: true, beta: true });
    expect(cloudHistoryUserRows([], p)).toEqual([]);
    expect(cloudHistoryUserRows(null, p)).toEqual([]);
    expect(cloudHistoryUserRows([{ role: 'assistant', content: 'x' }], p)).toEqual([]);
  });
});

// ---- pages ----
const PAGES = {
  one: 'alpha',
  both: ['alpha', 'beta'],
  rev: ['beta', 'alpha', 'beta'],
  onlyNotes: ['beta'],
  open: null,
  empty: [],
  unknownInList: ['alpha', 'bogus'],
  nullInList: ['alpha', null],
  number: 5,
  object: { a: 1 },
};
const MALFORMED = ['empty', 'unknownInList', 'nullInList', 'number', 'object', 'missing', 'constructor'];

describe('pageDecision and applyPagePolicy', () => {
  for (const combo of COMBOS) {
    describe(label(combo), () => {
      const policy = cloud(combo, { pageCategories: PAGES });
      it('valid entries', () => {
        expect(policy.pageDecision('open')).toEqual({ allowed: true, mode: 'public', categories: [], withheld: [] });
        const check = (page, need) => {
          const d = policy.pageDecision(page);
          const den = denied(combo, need);
          expect(d.allowed, page).toBe(den.length === 0);
          expect(d.withheld, page).toEqual(den);
          expect(d.categories, page).toEqual(order(need));
          expect(d.mode).toBe('single');
        };
        check('one', ['alpha']);
        check('both', ['alpha', 'beta']);
        check('rev', ['alpha', 'beta']);
        check('onlyNotes', ['beta']);
      });
      it('malformed or missing entries are refused with withheld []', () => {
        for (const page of MALFORMED) {
          const d = policy.pageDecision(page);
          expect(d.allowed, page).toBe(false);
          expect(d.withheld, page).toEqual([]);
          expect(d.categories, page).toEqual([]);
        }
        for (const page of [undefined, null, 7, {}]) expect(policy.pageDecision(page).allowed).toBe(false);
      });
      it('applyPagePolicy withholds context and history when denied', () => {
        const input = {
          page: 'both',
          context: 'SENT_CTX',
          messages: [
            { role: 'user', content: 'a' },
            { role: 'assistant', content: 'SENT_ASSIST' },
            { role: 'user', content: 'b' },
          ],
        };
        const out = applyPagePolicy(input, policy);
        const den = denied(combo, ['alpha', 'beta']);
        if (den.length) {
          expect(out).toEqual({ allowed: false, context: '', messages: [], categories: [], withheld: den });
        } else {
          expect(out.allowed).toBe(true);
          expect(out.context).toBe('SENT_CTX');
          expect(out.categories).toEqual(['alpha', 'beta']);
          expect(out.withheld).toEqual([]);
          expect(JSON.stringify(out.messages)).not.toContain('SENT_ASSIST');
          expect(out.messages).toEqual([{ role: 'user', content: 'a\n\nb' }]);
        }
      });
      it('applyPagePolicy refuses malformed pages without leaking context', () => {
        for (const page of MALFORMED) {
          const out = applyPagePolicy({ page, context: 'SENT_CTX', messages: [{ role: 'user', content: 'x' }] }, policy);
          expect(out).toEqual({ allowed: false, context: '', messages: [], categories: [], withheld: [] });
        }
      });
    });
  }

  it('local policy: everything allowed and input returned unchanged', () => {
    const local = createAiPolicy({ isCloud: false, categories: { alpha: false, beta: false }, pageCategories: PAGES });
    for (const page of Object.keys(PAGES)) expect(local.pageDecision(page).allowed, page).toBe(true);
    const input = { page: 'both', context: 'c', messages: [{ role: 'assistant', content: 'keep' }] };
    const out = applyPagePolicy(input, local);
    expect(out.allowed).toBe(true);
    expect(out.context).toBe('c');
    expect(out.messages).toBe(input.messages);
    expect(out.withheld).toEqual([]);
  });

  it('a page entry naming an unknown string category is refused under cloud, withheld holds only known ids', () => {
    const p = cloud({ alpha: true, beta: true }, { pageCategories: { weird: 'bogus' } });
    const d = p.pageDecision('weird');
    expect(d.allowed).toBe(false);
    for (const c of d.withheld) expect(CLOUD_CATEGORY_IDS).toContain(c);
  });
});
