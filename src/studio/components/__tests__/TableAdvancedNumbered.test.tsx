// "Numbered automatically" under More options (DESIGN-phase28.md 8, Lane C).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Table } from '@local-app-studio/runtime/spec/schema';
import type { ChangeMeta } from '../../lib/tableChange';
import TableAdvanced from '../TableAdvanced';

afterEach(cleanup);

const invoices = (): Table => ({
  id: 'invoices',
  label: 'Invoices',
  titleField: 'number',
  fields: [
    { id: 'number', label: 'Number', type: 'text', required: false, default: 'x' },
    { id: 'count', label: 'Count', type: 'integer', required: false },
    { id: 'when', label: 'When', type: 'date', required: false },
  ],
});

function Harness({ initial, log }: { initial: Table; log: (next: Table, meta?: ChangeMeta) => void }) {
  const [table, setTable] = useState(initial);
  return (
    <TableAdvanced
      table={table}
      index={0}
      issues={[]}
      usedByPages={[]}
      onChange={(next, meta) => {
        log(next, meta);
        setTable(next);
      }}
    />
  );
}

const open = (): void => {
  fireEvent.click(screen.getByText('More options'));
};

describe('TableAdvanced numbered automatically', () => {
  it('offers the choice on text and whole number fields only', () => {
    render(<Harness initial={invoices()} log={vi.fn()} />);
    open();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });

  it('numbers a text field: removes the default, says so, and shows an example from the choices', () => {
    const log = vi.fn();
    render(<Harness initial={invoices()} log={log} />);
    open();
    fireEvent.click(screen.getByRole('checkbox', { name: /Numbered automatically: Number/ }));
    expect(log.mock.calls[0][0].fields[0]).not.toHaveProperty('default');
    expect(log.mock.calls[0][0].fields[0]).toHaveProperty('autoNumber', {});
    expect(log.mock.calls[0][1]).toMatchObject({ notice: 'A numbered field has no default.' });
    expect(screen.getAllByText(/A numbered field has no default/).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Before the number'), { target: { value: 'INV-' } });
    fireEvent.change(screen.getByLabelText('Starts at'), { target: { value: '1001' } });
    fireEvent.change(screen.getByLabelText('Digits'), { target: { value: '4' } });
    expect(screen.getByText('For example: INV-1001, INV-1002, INV-1003')).toBeTruthy();
    expect(log.mock.calls.at(-1)?.[0].fields[0].autoNumber).toEqual({ prefix: 'INV-', start: 1001, width: 4 });
  });

  it('numbers a whole number field with a start only', () => {
    render(<Harness initial={invoices()} log={vi.fn()} />);
    open();
    fireEvent.click(screen.getByRole('checkbox', { name: /Numbered automatically: Count/ }));
    expect(screen.getByLabelText('Starts at')).toBeTruthy();
    expect(screen.queryByLabelText('Before the number')).toBeNull();
    expect(screen.queryByLabelText('Digits')).toBeNull();
  });

  it('turns it off again, and disables the other fields while one is numbered', () => {
    const log = vi.fn();
    render(<Harness initial={invoices()} log={log} />);
    open();
    fireEvent.click(screen.getByRole('checkbox', { name: /Numbered automatically: Number/ }));
    expect(screen.getByRole('checkbox', { name: /Numbered automatically: Count/ })).toHaveProperty('disabled', true);
    expect(screen.getByText('Only one field of a table can be numbered. Number already is.')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: /Numbered automatically: Number/ }));
    expect(log.mock.calls.at(-1)?.[0].fields[0]).not.toHaveProperty('autoNumber');
    expect(screen.getByRole('checkbox', { name: /Numbered automatically: Count/ })).toHaveProperty('disabled', false);
  });

  it('writes a datetime default as local time converted to ISO, and shows it back as the same local time', () => {
    const table: Table = { ...invoices(), fields: [{ id: 'at', label: 'At', type: 'datetime', required: false }] };
    const log = vi.fn();
    render(<Harness initial={table} log={log} />);
    open();
    fireEvent.change(screen.getByLabelText('Default for At'), { target: { value: '2026-03-01T09:00' } });
    expect(log.mock.calls[0][0].fields[0].default).toBe(new Date('2026-03-01T09:00').toISOString());
    expect((screen.getByLabelText('Default for At') as HTMLInputElement).value).toBe('2026-03-01T09:00');
    fireEvent.change(screen.getByLabelText('Default for At'), { target: { value: '' } });
    expect(log.mock.calls[1][0].fields[0]).not.toHaveProperty('default');
  });
});
