// The Automations section of a table (DESIGN-phase28.md F1): one action per added rule, the value through DefaultEditor, a
// several action rule shown in words with Remove only, and the one press fix for a rule that names a removed field.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SpecIssue, Table } from '@local-app-studio/runtime/spec/schema';
import type { ChangeMeta } from '../../lib/tableChange';
import TableAutomations from '../TableAutomations';

afterEach(cleanup);

const invoices = (): Table => ({
  id: 'invoices',
  label: 'Invoices',
  titleField: 'number',
  fields: [
    { id: 'number', label: 'Number', type: 'text', required: false },
    { id: 'paid', label: 'Paid', type: 'boolean', required: false },
    { id: 'status', label: 'Status', type: 'select', required: false, options: ['Open', 'Paid'] },
    { id: 'paid_on', label: 'Paid on', type: 'date', required: false },
    { id: 'note', label: 'Note', type: 'text', required: false },
  ],
});

function Harness({ initial, issues = [], log }: { initial: Table; issues?: SpecIssue[]; log: (next: Table, meta?: ChangeMeta) => void }) {
  const [table, setTable] = useState(initial);
  return (
    <TableAutomations
      table={table}
      index={0}
      issues={issues}
      onChange={(next, meta) => {
        log(next, meta);
        setTable(next);
      }}
    />
  );
}

const pick = (label: string, value: string): void => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};

describe('TableAutomations', () => {
  it('adds one rule that sets a date to today and shows it in words', () => {
    const log = vi.fn();
    render(<Harness initial={invoices()} log={log} />);
    expect(screen.getByRole('button', { name: 'Add an automation' })).toHaveProperty('disabled', true);
    pick('When this field changes', 'status');
    pick('To this', 'Paid');
    pick('Fill in this field', 'paid_on');
    pick('With', 'today');
    fireEvent.click(screen.getByRole('button', { name: 'Add an automation' }));
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0].rules).toEqual([{ when: { field: 'status', is: 'Paid' }, then: [{ set: 'paid_on', to: 'today' }] }]);
    expect(log.mock.calls[0][1]).toMatchObject({ label: 'Added an automation' });
    expect(screen.getByText('When Status becomes Paid, set Paid on to today.')).toBeTruthy();
  });

  it('adds a rule for a tick box and a typed value through the default editor', () => {
    const log = vi.fn();
    render(<Harness initial={invoices()} log={log} />);
    pick('When this field changes', 'paid');
    pick('To this', 'true');
    pick('Fill in this field', 'note');
    pick('With', 'value');
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'Thanks' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add an automation' }));
    expect(log.mock.calls[0][0].rules).toEqual([{ when: { field: 'paid', is: true }, then: [{ set: 'note', to: { value: 'Thanks' } }] }]);
    expect(screen.getByText('When Paid is ticked, set Note to Thanks.')).toBeTruthy();
  });

  it('offers neither the watched field nor the numbered one, and refuses a copy that does not fit', () => {
    const table = invoices();
    table.fields[0] = { id: 'number', label: 'Number', type: 'text', required: false, autoNumber: {} };
    render(<Harness initial={table} log={vi.fn()} />);
    pick('When this field changes', 'status');
    expect(screen.queryByRole('option', { name: 'Number' })).toBeNull();
    expect(screen.getAllByRole('option', { name: 'Status' })).toHaveLength(1);
    pick('To this', 'Open');
    pick('Fill in this field', 'note');
    pick('With', 'field');
    pick('Copy from', 'paid_on');
    expect(screen.getByText(/cannot run as it is written/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add an automation' })).toHaveProperty('disabled', true);
  });

  it('removes a rule, and shows a several action rule in words with Remove only', () => {
    const table = invoices();
    table.rules = [
      {
        when: { field: 'status', is: 'Paid' },
        then: [
          { set: 'paid_on', to: 'today' },
          { set: 'note', to: 'clear' },
        ],
      },
    ];
    const log = vi.fn();
    render(<Harness initial={table} log={log} />);
    expect(screen.getByText('When Status becomes Paid, set Paid on to today, and clear Note.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Remove the automation/ }));
    expect(log.mock.calls[0][0]).not.toHaveProperty('rules');
    expect(log.mock.calls[0][1]).toMatchObject({ label: 'Removed an automation' });
  });

  it('says in plain words that an automation names a removed field and removes it in one press', () => {
    const table = invoices();
    table.rules = [{ when: { field: 'status', is: 'Paid' }, then: [{ set: 'gone', to: 'today' }] }];
    const issues: SpecIssue[] = [{ path: 'tables.0.rules.0.then.0.set', code: 'rule_field_missing', message: 'This automation names a field this table does not have.' }];
    const log = vi.fn();
    render(<Harness initial={table} issues={issues} log={log} />);
    expect(screen.getAllByText(/names a field this table (does not have|no longer has)/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/gone/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove this automation' }));
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).not.toHaveProperty('rules');
    expect(log.mock.calls[0][1]).toMatchObject({ label: 'Removed an automation', notice: 'Removed an automation.' });
  });

  it('asks for a choice or tick box when the table has none', () => {
    const table = invoices();
    table.fields = table.fields.filter((f) => f.type === 'text');
    render(<Harness initial={table} log={vi.fn()} />);
    expect(screen.getByText('Add a choice or tick box field to this table to start an automation.')).toBeTruthy();
  });

  it('keeps Add off until a tick box state is chosen, not only for a choice field', () => {
    render(<Harness initial={invoices()} log={vi.fn()} />);
    pick('When this field changes', 'paid');
    pick('Fill in this field', 'paid_on');
    pick('With', 'today');
    expect(screen.getByRole('button', { name: 'Add an automation' })).toHaveProperty('disabled', true);
    pick('To this', 'false');
    expect(screen.getByRole('button', { name: 'Add an automation' })).toHaveProperty('disabled', false);
  });

  it('removes only the broken row that was pressed, and offers one press for all when two or more are broken', () => {
    const table = invoices();
    table.rules = [
      { when: { field: 'status', is: 'Paid' }, then: [{ set: 'gone', to: 'today' }] },
      { when: { field: 'status', is: 'Open' }, then: [{ set: 'gone2', to: 'today' }] },
      { when: { field: 'paid', is: true }, then: [{ set: 'note', to: 'clear' }] },
    ];
    const issues: SpecIssue[] = [
      { path: 'tables.0.rules.0.then.0.set', code: 'rule_field_missing', message: 'x' },
      { path: 'tables.0.rules.1.then.0.set', code: 'rule_field_missing', message: 'x' },
    ];
    const log = vi.fn();
    render(<Harness initial={table} issues={issues} log={log} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove this automation' })[0]);
    expect(log.mock.calls[0][0].rules).toHaveLength(2);
    expect(log.mock.calls[0][0].rules[0].when.field).toBe('status');
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Automations' }));
  });

  it('removes every broken automation with the separate button', () => {
    const table = invoices();
    table.rules = [
      { when: { field: 'status', is: 'Paid' }, then: [{ set: 'gone', to: 'today' }] },
      { when: { field: 'status', is: 'Open' }, then: [{ set: 'gone2', to: 'today' }] },
    ];
    const issues: SpecIssue[] = [
      { path: 'tables.0.rules.0.then.0.set', code: 'rule_field_missing', message: 'x' },
      { path: 'tables.0.rules.1.then.0.set', code: 'rule_field_missing', message: 'x' },
    ];
    const log = vi.fn();
    render(<Harness initial={table} issues={issues} log={log} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove all broken automations' }));
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).not.toHaveProperty('rules');
    expect(log.mock.calls[0][1]).toMatchObject({ notice: 'Removed 2 automations.' });
  });

  it('keeps one status element mounted and moves focus to When this field changes after Add', () => {
    render(<Harness initial={invoices()} log={vi.fn()} />);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    pick('When this field changes', 'status');
    pick('To this', 'Paid');
    pick('Fill in this field', 'paid_on');
    fireEvent.click(screen.getByRole('button', { name: 'Add an automation' }));
    expect(document.activeElement).toBe(screen.getByLabelText('When this field changes'));
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });
});
