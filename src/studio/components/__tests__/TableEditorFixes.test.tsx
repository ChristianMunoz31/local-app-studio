// Critique fixes in the table editor: Move says what it did and keeps the focus, rows keep their identity, saved ids stay taken, Enter in IME.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Table } from '@local-app-studio/runtime/spec/schema';
import type { ChangeMeta } from '../../lib/tableChange';
import FieldRow from '../FieldRow';
import TableEditor from '../TableEditor';

afterEach(cleanup);

const saved = (): Table => ({
  id: 'jobs',
  label: 'Jobs',
  titleField: 'name',
  fields: [
    { id: 'name', label: 'Name', type: 'text', required: true },
    { id: 'size', label: 'Size', type: 'integer', required: false },
    { id: 'new_field', label: 'Old extra', type: 'text', required: false },
  ],
});

function Harness({ initial, savedTable, log }: { initial: Table; savedTable: Table; log: (next: Table, meta?: ChangeMeta) => void }) {
  const [table, setTable] = useState(initial);
  return (
    <TableEditor
      table={table}
      index={0}
      tables={[table]}
      issues={[]}
      onChange={(next, meta) => {
        log(next, meta);
        setTable(next);
      }}
      onDelete={vi.fn()}
      onAddTable={vi.fn()}
      savedTables={[savedTable]}
    />
  );
}

describe('TableEditor critique fixes', () => {
  it('Move field says what it did and keeps the focus on a button that still works', () => {
    const log = vi.fn();
    render(<Harness initial={saved()} savedTable={saved()} log={log} />);
    fireEvent.click(screen.getByRole('button', { name: 'Move Size up' }));
    expect(log.mock.calls[0][1]?.notice).toBe('Moved Size up.');
    // Size is first now: its Move up is off, so the focus is on Move down.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move Size down' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move Size down' }));
    expect(log.mock.calls[1][1]?.notice).toBe('Moved Size down.');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move Size down' }));
  });

  it('a row keeps its identity while its name is typed (the inside name follows the label)', () => {
    const log = vi.fn();
    const initial: Table = { ...saved(), fields: [...saved().fields.slice(0, 2), { id: 'new_field', label: 'New field', type: 'text', required: false }] };
    render(<Harness initial={initial} savedTable={{ ...saved(), fields: saved().fields.slice(0, 2) }} log={log} />);
    const box = screen.getAllByLabelText('Field name')[2] as HTMLInputElement;
    box.focus();
    fireEvent.change(box, { target: { value: 'Budget' } });
    expect(screen.getAllByLabelText('Field name')[2]).toBe(box);
    expect(document.activeElement).toBe(box);
  });

  it('Delete field moves the focus to the field now in its place', () => {
    render(<Harness initial={saved()} savedTable={saved()} log={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete field Size' }));
    expect(document.activeElement).toBe(screen.getAllByLabelText('Field name')[1]);
  });

  it('M4: a new field does not take the id of a saved field that the draft has deleted', () => {
    const log = vi.fn();
    const draft: Table = { ...saved(), fields: saved().fields.slice(0, 2) };
    render(<Harness initial={draft} savedTable={saved()} log={log} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    const next = log.mock.calls[0][0] as Table;
    expect(next.fields[2].id).toBe('new_field_2');
  });

  it('M4: a new table name does not take the id of a saved table that was deleted', () => {
    const log = vi.fn();
    const added: Table = { id: 'new_table', label: 'New table', titleField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] };
    const gone: Table = { ...added, id: 'orders', label: 'Orders' };
    render(<TableEditor table={added} index={0} tables={[added]} issues={[]} onChange={log} onDelete={vi.fn()} onAddTable={vi.fn()} savedTables={[gone]} />);
    fireEvent.change(screen.getByLabelText('Table name'), { target: { value: 'Orders' } });
    expect((log.mock.calls[0][0] as Table).id).toBe('orders_2');
  });
});

describe('FieldRow Enter', () => {
  const row = (onEnter: () => void) =>
    render(
      <FieldRow
        field={{ id: 'a', label: 'A', type: 'text', required: false }}
        path="tables.0.fields.0"
        otherTables={[]}
        issues={[]}
        onChange={vi.fn()}
        onMove={vi.fn()}
        onDelete={vi.fn()}
        onEnter={onEnter}
      />,
    );

  it('adds a field on Enter', () => {
    const onEnter = vi.fn();
    row(onEnter);
    fireEvent.keyDown(screen.getByLabelText('Field name'), { key: 'Enter' });
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it('ignores the Enter that ends an input method composition', () => {
    const onEnter = vi.fn();
    row(onEnter);
    fireEvent.keyDown(screen.getByLabelText('Field name'), { key: 'Enter', isComposing: true });
    expect(onEnter).not.toHaveBeenCalled();
  });
});
