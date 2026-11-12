import { describe, expect, it } from 'vitest';
import { appliedWords, applyRules, localDate, readRules, ruleProblems, ruleSentence, sameValue } from '../rules.ts';
import type { Rule, RuleTableInfo } from '../rules.ts';

const table = (rules: unknown, extra: RuleTableInfo['fields'] = []): RuleTableInfo => ({
  id: 'invoices',
  label: 'Invoices',
  fields: [
    { id: 'number', label: 'Number', type: 'text', autoNumber: { prefix: 'INV-' } } as never,
    { id: 'status', label: 'Status', type: 'select', options: ['Draft', 'Sent', 'Paid'], default: 'Draft' },
    { id: 'paid', label: 'Paid', type: 'boolean' },
    { id: 'paid_on', label: 'Paid on', type: 'date' },
    { id: 'due', label: 'Due', type: 'date' },
    { id: 'sent_at', label: 'Sent at', type: 'datetime' },
    { id: 'total', label: 'Total', type: 'real' },
    { id: 'note', label: 'Note', type: 'text' },
    ...extra,
  ],
  rules,
});
const PAID: Rule = { when: { field: 'paid', is: true }, then: [{ set: 'paid_on', to: 'today' }] };
const UNPAID: Rule = { when: { field: 'paid', is: false }, then: [{ set: 'paid_on', to: 'clear' }] };
const NOW = new Date(2026, 10, 11, 23, 30, 0);

describe('applyRules on a new record (POST)', () => {
  const t = table([PAID, UNPAID]);
  it('fires on the given value and sets today', () => {
    const r = applyRules({ table: t, before: null, given: { paid: true }, now: NOW });
    expect(r.changes).toEqual({ paid_on: '2026-11-11' });
    expect(r.applied).toEqual([{ field: 'paid_on', label: 'Paid on', to: 'today', words: 'Paid on was set to today.' }]);
  });
  it('fires on the field default', () => {
    const d = table([{ when: { field: 'status', is: 'Draft' }, then: [{ set: 'note', to: { value: 'new' } }] }]);
    expect(applyRules({ table: d, before: null, given: {}, now: NOW }).changes).toEqual({ note: 'new' });
  });
  it('does not fire on another value', () => {
    expect(applyRules({ table: t, before: null, given: { paid: null }, now: NOW }).applied).toEqual([]);
    expect(applyRules({ table: t, before: null, given: {}, now: NOW }).changes).toEqual({});
  });
  it('H1: paid_on null or empty lets the rule set it; a typed date wins', () => {
    for (const empty of [null, '']) {
      expect(applyRules({ table: t, before: null, given: { paid: true, paid_on: empty }, now: NOW }).changes).toEqual({ paid_on: '2026-11-11' });
    }
    const r = applyRules({ table: t, before: null, given: { paid: true, paid_on: '2026-01-02' }, now: NOW });
    expect(r.changes).toEqual({});
    expect(r.applied).toEqual([]);
  });
});

describe('applyRules on a change (PATCH)', () => {
  const t = table([PAID, UNPAID]);
  const stored = { paid: false, paid_on: null, due: '2026-12-01' };
  it('H1: a whole row form ticking Paid with unchanged paid_on and due sets Paid on', () => {
    const r = applyRules({ table: t, before: stored, given: { paid: true, paid_on: null, due: '2026-12-01' }, now: NOW });
    expect(r.changes).toEqual({ paid_on: '2026-11-11' });
  });
  it('H1: a whole row form unticking Paid with the unchanged stored date clears it', () => {
    const before = { paid: true, paid_on: '2026-11-11', due: '2026-12-01' };
    const r = applyRules({ table: t, before, given: { paid: false, paid_on: '2026-11-11', due: '2026-12-01' }, now: NOW });
    expect(r.changes).toEqual({ paid_on: null });
    expect(r.applied[0].words).toBe('Paid on was cleared.');
  });
  it('a PATCH resending Paid unchanged fires nothing', () => {
    const before = { paid: true, paid_on: '2026-11-11' };
    expect(applyRules({ table: t, before, given: { paid: true, paid_on: '2026-11-11' }, now: NOW }).applied).toEqual([]);
  });
  it('a PATCH that does not send the field fires nothing', () => {
    expect(applyRules({ table: t, before: stored, given: { due: '2027-01-01' }, now: NOW }).applied).toEqual([]);
  });
  it('H1: a new Paid on typed while ticking keeps the typed date', () => {
    const r = applyRules({ table: t, before: stored, given: { paid: true, paid_on: '2026-02-03' }, now: NOW });
    expect(r.changes).toEqual({});
  });
});

describe('actions', () => {
  it('today is the local date at 23:30 and at 00:30', () => {
    expect(localDate(new Date(2026, 0, 31, 23, 30))).toBe('2026-01-31');
    expect(localDate(new Date(2026, 0, 31, 0, 30))).toBe('2026-01-31');
    expect(localDate(new Date(2026, 1, 1, 0, 30))).toBe('2026-02-01');
    expect(localDate(new Date(2026, 11, 9))).toBe('2026-12-09');
  });
  it('now is an ISO date time; clear is null; a literal and a copy', () => {
    const t = table([
      { when: { field: 'status', is: 'Sent' }, then: [{ set: 'sent_at', to: 'now' }, { set: 'note', to: { value: 'sent' } }, { set: 'paid_on', to: { field: 'due' } }, { set: 'total', to: 'clear' }] },
    ]);
    const r = applyRules({ table: t, before: null, given: { status: 'Sent', due: '2026-12-01', total: 5 }, now: NOW });
    expect(r.changes).toEqual({ sent_at: NOW.toISOString(), note: 'sent', paid_on: '2026-12-01' });
    expect(r.applied.map((a) => a.to)).toEqual(['now', 'value', 'field']);
    expect(r.applied[2].words).toBe('Paid on was copied from Due.');
    expect(r.applied[1].words).toBe('Note was set to sent.');
  });
  it('clear sets null when the person left the field alone', () => {
    const t = table([{ when: { field: 'status', is: 'Sent' }, then: [{ set: 'total', to: 'clear' }] }]);
    const r = applyRules({ table: t, before: { status: 'Draft', total: 5 }, given: { status: 'Sent' }, now: NOW });
    expect(r.changes).toEqual({ total: null });
  });
  it('a copy of an empty field clears the target', () => {
    const t = table([{ when: { field: 'status', is: 'Sent' }, then: [{ set: 'paid_on', to: { field: 'due' } }] }]);
    const r = applyRules({ table: t, before: { status: 'Draft', paid_on: '2026-01-01', due: null }, given: { status: 'Sent' }, now: NOW });
    expect(r.changes).toEqual({ paid_on: null });
  });
  it('the last action on a field wins and applied keeps one entry', () => {
    const t = table([
      { when: { field: 'paid', is: true }, then: [{ set: 'paid_on', to: 'today' }] },
      { when: { field: 'status', is: 'Paid' }, then: [{ set: 'paid_on', to: { field: 'due' } }] },
    ]);
    const r = applyRules({ table: t, before: null, given: { paid: true, status: 'Paid', due: '2026-12-24' }, now: NOW });
    expect(r.changes).toEqual({ paid_on: '2026-12-24' });
    expect(r.applied).toHaveLength(1);
    expect(r.applied[0].to).toBe('field');
  });
  it('no chain: a rule does not see another rule change', () => {
    const t = table([
      { when: { field: 'paid', is: true }, then: [{ set: 'status', to: { value: 'Paid' } }] },
      { when: { field: 'status', is: 'Paid' }, then: [{ set: 'note', to: { value: 'chained' } }] },
    ]);
    const r = applyRules({ table: t, before: null, given: { paid: true }, now: NOW });
    expect(r.changes).toEqual({ status: 'Paid' });
  });
  it('never sets a key the person changed', () => {
    const t = table([{ when: { field: 'paid', is: true }, then: [{ set: 'note', to: { value: 'auto' } }] }]);
    expect(applyRules({ table: t, before: null, given: { paid: true, note: 'mine' }, now: NOW }).changes).toEqual({});
  });
  it('a table with no rules or a malformed list changes nothing', () => {
    for (const rules of [undefined, null, 'x', [{}], [{ when: 1 }]]) {
      expect(applyRules({ table: table(rules), before: null, given: { paid: true }, now: NOW })).toEqual({ changes: {}, applied: [] });
    }
  });
  it('words of a boolean literal are Yes and No', () => {
    expect(appliedWords('Paid', { value: true })).toBe('Paid was set to Yes.');
    expect(appliedWords('Paid', { value: false })).toBe('Paid was set to No.');
    expect(appliedWords('Total', { value: 5 })).toBe('Total was set to 5.');
    expect(appliedWords('Due', 'now')).toBe('Due was set to now.');
  });
});

describe('ruleSentence', () => {
  const t = table([]);
  it('reads a select and a tick box', () => {
    expect(ruleSentence(t, { when: { field: 'status', is: 'Paid' }, then: [{ set: 'paid_on', to: 'today' }] })).toBe('When Status becomes Paid, set Paid on to today.');
    expect(ruleSentence(t, PAID)).toBe('When Paid is ticked, set Paid on to today.');
    expect(ruleSentence(t, UNPAID)).toBe('When Paid is unticked, clear Paid on.');
  });
  it('joins actions with and', () => {
    const r: Rule = {
      when: { field: 'status', is: 'Sent' },
      then: [{ set: 'sent_at', to: 'now' }, { set: 'status', to: { value: 'Archived' } }, { set: 'total', to: { field: 'due' } }],
    };
    expect(ruleSentence(t, r)).toBe('When Status becomes Sent, set Sent at to now, and set Status to Archived, and set Total to the value of Due.');
  });
});

describe('readRules and ruleProblems', () => {
  it('drops a malformed rule and a rule the checks refuse, keeps the rest', () => {
    const bad: Rule = { when: { field: 'nope', is: true }, then: [{ set: 'paid_on', to: 'today' }] };
    const kept = readRules(table([PAID, bad, 7, { when: {}, then: [] }, UNPAID]));
    expect(kept).toEqual([PAID, UNPAID]);
  });
  it('drops a second rule that sets the same field for the same when', () => {
    const dup: Rule = { when: { field: 'paid', is: true }, then: [{ set: 'paid_on', to: 'clear' }] };
    expect(readRules(table([PAID, dup]))).toEqual([PAID]);
  });
  it('never lets a rule set the numbered field', () => {
    const r: Rule = { when: { field: 'paid', is: true }, then: [{ set: 'number', to: { value: 'X' } }] };
    expect(readRules(table([r]))).toEqual([]);
    expect(ruleProblems(table([]), r, 'number')).toEqual([{ at: 'then.0.set', code: 'rule_not_allowed' }]);
  });
  it('reads at most 20 rules', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ when: { field: 'status', is: i % 2 ? 'Sent' : 'Paid' }, then: [{ set: `f${i}`, to: 'clear' }] }));
    const extra = many.map((_, i) => ({ id: `f${i}`, label: `F${i}`, type: 'text' }));
    expect(readRules(table(many, extra))).toHaveLength(20);
  });
});

describe('sameValue', () => {
  it('null and undefined are equal, others compare as text', () => {
    expect(sameValue(null, undefined)).toBe(true);
    expect(sameValue(undefined, null)).toBe(true);
    expect(sameValue(null, '')).toBe(false);
    expect(sameValue(1, '1')).toBe(true);
    expect(sameValue(true, 'true')).toBe(true);
    expect(sameValue('2026-01-01', '2026-01-02')).toBe(false);
    expect(sameValue(0, null)).toBe(false);
  });
});
