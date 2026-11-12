// Properties of applyRules (phase 28): over random rule sets and writes, the result never changes a key the person changed,
// never sets the numbered field, gives the same answer for the same input, and fires nothing new when its own result is stored
// and the same values are sent again.
import { describe, expect, it } from 'vitest';
import { applyRules, readRules, sameValue } from '../rules.ts';
import type { Rule, RuleTableInfo } from '../rules.ts';

const FIELDS: RuleTableInfo['fields'] = [
  { id: 'num', label: 'Num', type: 'text', autoNumber: { prefix: 'N-' } } as never,
  { id: 'status', label: 'Status', type: 'select', options: ['a', 'b', 'c'], default: 'a' },
  { id: 'flag', label: 'Flag', type: 'boolean' },
  { id: 'd1', label: 'D1', type: 'date' },
  { id: 'd2', label: 'D2', type: 'date' },
  { id: 't1', label: 'T1', type: 'datetime' },
  { id: 'n1', label: 'N1', type: 'real' },
  { id: 'x1', label: 'X1', type: 'text' },
  { id: 'x2', label: 'X2', type: 'text', required: true },
];
const NUMBERED = 'num';

let seed = 4242;
const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = <T,>(items: readonly T[]): T => items[Math.floor(rnd() * items.length)];

const whens = (): Rule['when'] => (rnd() < 0.5 ? { field: 'status', is: pick(['a', 'b', 'c']) } : { field: 'flag', is: rnd() < 0.5 });
const actions = (): Rule['then'] => {
  const options: Rule['then'] = [
    { set: 'd1', to: 'today' },
    { set: 'd2', to: 'today' },
    { set: 't1', to: 'now' },
    { set: 'd1', to: 'clear' },
    { set: 'n1', to: 'clear' },
    { set: 'x1', to: 'clear' },
    { set: 'x1', to: { value: 'auto' } },
    { set: 'n1', to: { value: 7 } },
    { set: 'd2', to: { field: 'd1' } },
    { set: 'x1', to: { field: 'x2' } },
    { set: 'x1', to: { field: 'status' } },
    { set: 'num', to: { value: 'N-1' } },
    { set: 'status', to: { value: 'b' } },
  ];
  return Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => pick(options));
};
const randomValue = (id: string): unknown => {
  switch (id) {
    case 'status':
      return pick(['a', 'b', 'c']);
    case 'flag':
      return rnd() < 0.5;
    case 'd1':
    case 'd2':
      return pick(['2026-01-01', '2026-06-30', '2026-12-31']);
    case 't1':
      return '2026-01-01T09:00:00.000Z';
    case 'n1':
      return pick([0, 1.5, 7]);
    default:
      return pick(['p', 'q', 'auto']);
  }
};
const randomRow = (): Record<string, unknown> => {
  const row: Record<string, unknown> = {};
  for (const f of FIELDS) if (f.id !== NUMBERED && rnd() < 0.6) row[f.id] = rnd() < 0.15 ? null : randomValue(f.id);
  return row;
};

describe('applyRules properties', () => {
  it('holds over random rule sets and writes', () => {
    const now = new Date(2026, 4, 5, 12, 0, 0);
    let fired = 0;
    for (let round = 0; round < 400; round += 1) {
      const raw = Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => ({ when: whens(), then: actions() }));
      const table: RuleTableInfo = { id: 't', label: 'T', fields: FIELDS, rules: raw };
      const rules = readRules(table);
      for (const rule of rules) for (const a of rule.then) expect(a.set).not.toBe(NUMBERED);
      for (let w = 0; w < 6; w += 1) {
        const given = randomRow();
        const before: Record<string, unknown> | null = rnd() < 0.5 ? null : { ...randomRow(), num: 'N-1' };
        const input = { table, before, given, now };
        const first = applyRules(input);
        const again = applyRules(input);
        expect(again).toEqual(first);
        const own = (key: string): boolean =>
          before === null ? Object.hasOwn(given, key) && given[key] !== null && given[key] !== '' : Object.hasOwn(given, key) && !sameValue(given[key], before[key]);
        for (const key of Object.keys(first.changes)) {
          expect(own(key), `${key} was the person's own value`).toBe(false);
          expect(key).not.toBe(NUMBERED);
        }
        expect(first.applied.map((a) => a.field).sort()).toEqual(Object.keys(first.changes).sort());
        if (before !== null) {
          // The same values sent again against the row as stored after this write fire nothing new.
          const stored = { ...before, ...given, ...first.changes };
          const second = applyRules({ table, before: stored, given, now });
          expect(second.applied).toEqual([]);
          expect(second.changes).toEqual({});
        }
        if (first.applied.length > 0) fired += 1;
      }
    }
    expect(fired).toBeGreaterThan(100);
  });
});
