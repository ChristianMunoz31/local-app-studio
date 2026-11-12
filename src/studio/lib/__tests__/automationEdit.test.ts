import { describe, expect, it } from 'vitest';
import type { Table } from '@local-app-studio/runtime/spec/schema';
import { addRule, removeBrokenRules, removeRule, ruleTargets, ruleWatchable, setAutoNumber } from '../automationEdit';

const invoices = (): Table => ({
  id: 'invoices',
  label: 'Invoices',
  titleField: 'number',
  fields: [
    { id: 'number', label: 'Number', type: 'text', required: false, default: 'x' },
    { id: 'count', label: 'Count', type: 'integer', required: false },
    { id: 'status', label: 'Status', type: 'select', required: false, options: ['Open', 'Paid'] },
    { id: 'paid_on', label: 'Paid on', type: 'date', required: false },
  ],
});

const paid = { when: { field: 'status', is: 'Paid' }, then: [{ set: 'paid_on', to: 'today' as const }] };

describe('setAutoNumber', () => {
  it('numbers a text field, drops its default and keeps only the given choices', () => {
    const next = setAutoNumber(invoices(), 'number', { prefix: 'INV-', start: 1001, width: 4 });
    expect(next.fields[0]).toEqual({ id: 'number', label: 'Number', type: 'text', required: false, autoNumber: { prefix: 'INV-', start: 1001, width: 4 } });
  });

  it('keeps only the start of a whole number field, and only one field is numbered', () => {
    const first = setAutoNumber(invoices(), 'number', {});
    const next = setAutoNumber(first, 'count', { prefix: 'A', start: 5, width: 3 });
    expect(next.fields[1]).toMatchObject({ autoNumber: { start: 5 } });
    expect(next.fields[0]).not.toHaveProperty('autoNumber');
  });

  it('turns numbering off with null and ignores a field that cannot be numbered', () => {
    expect(setAutoNumber(setAutoNumber(invoices(), 'number', {}), 'number', null).fields[0]).not.toHaveProperty('autoNumber');
    expect(setAutoNumber(invoices(), 'status', {}).fields[2]).not.toHaveProperty('autoNumber');
  });

  it('does not change the table it was given', () => {
    const table = invoices();
    setAutoNumber(table, 'number', {});
    expect(table.fields[0]).toHaveProperty('default', 'x');
  });
});

describe('rules', () => {
  it('adds a rule at the end and removes one by place, dropping an empty list', () => {
    const one = addRule(invoices(), paid);
    const two = addRule(one, { when: { field: 'status', is: 'Open' }, then: [{ set: 'paid_on', to: 'clear' }] });
    expect(two.rules).toHaveLength(2);
    expect(removeRule(two, 0).rules).toEqual([two.rules?.[1]]);
    expect(removeRule(one, 0)).not.toHaveProperty('rules');
    expect(one.rules).toHaveLength(1);
  });

  it('removes a rule that names a removed field and keeps the others', () => {
    const table = addRule(addRule(invoices(), paid), { when: { field: 'status', is: 'Open' }, then: [{ set: 'paid_on', to: 'clear' }] });
    const cut = { ...table, fields: table.fields.filter((f) => f.id !== 'status') };
    expect(removeBrokenRules(cut)).toEqual({ table: expect.not.objectContaining({ rules: expect.anything() }), removed: 2 });
    const noTarget = { ...table, fields: table.fields.filter((f) => f.id !== 'paid_on') };
    expect(removeBrokenRules(noTarget).removed).toBe(2);
  });

  it('shortens a rule that has one broken action and keeps its other actions', () => {
    const table = addRule(invoices(), {
      when: { field: 'status', is: 'Paid' },
      then: [
        { set: 'paid_on', to: 'today' },
        { set: 'count', to: { field: 'gone' } },
      ],
    });
    const fixed = removeBrokenRules(table);
    expect(fixed.removed).toBe(1);
    expect(fixed.table.rules?.[0].then).toEqual([{ set: 'paid_on', to: 'today' }]);
  });

  it('leaves a sound table as it is', () => {
    const table = addRule(invoices(), paid);
    expect(removeBrokenRules(table)).toEqual({ table, removed: 0 });
  });

  it('lists what a rule may watch and set', () => {
    const table = setAutoNumber(invoices(), 'number', {});
    expect(ruleWatchable(table).map((f) => f.id)).toEqual(['status']);
    expect(ruleTargets(table, 'status').map((f) => f.id)).toEqual(['count', 'paid_on']);
    expect(ruleTargets(table, null).map((f) => f.id)).toEqual(['count', 'status', 'paid_on']);
  });
});
