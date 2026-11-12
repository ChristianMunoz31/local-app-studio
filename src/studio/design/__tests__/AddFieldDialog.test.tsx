// The Add a field dialog: the part fixes the type, the Data step's rules apply, Add field hands the field over.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSpec, Field, FieldType } from '@local-app-studio/runtime/spec/schema';
import { baseSpec } from '../../__tests__/fixtures';
import AddFieldDialog from '../AddFieldDialog';

afterEach(cleanup);

const CAP_SENTENCE = 'A table may have at most 60 fields.';
// The two rules an empty name fails, in plain words (P17-09: no validator sentence reaches the screen).
const EMPTY_NAME_MESSAGES = ['This needs at least 1 characters.', 'This cannot start or end with a space, or hold a hidden character.'];

const twoTables = (): AppSpec => {
  const spec = baseSpec();
  spec.tables.push({ id: 'tasks', label: 'Tasks', titleField: 'title', fields: [{ id: 'title', label: 'Title', type: 'text', required: true }] });
  return spec;
};

function open(spec: AppSpec, tables: string[], type: FieldType = 'boolean', onAdd: (table: string, field: Field) => string | null = vi.fn(() => null)) {
  const onCancel = vi.fn();
  render(<AddFieldDialog partName="Checklist" spec={spec} tables={tables} initialTable={tables[0]} type={type} onAdd={onAdd} onCancel={onCancel} />);
  return { onAdd, onCancel };
}

describe('AddFieldDialog', () => {
  it('starts on the suggested name with the type fixed by the part', async () => {
    open(baseSpec(), ['crews']);
    expect(screen.getByRole('dialog', { name: 'Add a field for Checklist' })).toBeTruthy();
    const name = screen.getByLabelText('Field name') as HTMLInputElement;
    expect(name.value).toBe('Done');
    await waitFor(() => expect(document.activeElement).toBe(name));
    expect(screen.getByText('Type: Yes or no')).toBeTruthy();
    expect(screen.queryByLabelText('Table')).toBeNull();
  });

  it('shows the Table select only with two or more tables, and adds to the one picked', () => {
    const { onAdd } = open(twoTables(), ['crews', 'tasks']);
    const select = screen.getByLabelText('Table') as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual(['Crews', 'Tasks']);
    fireEvent.change(select, { target: { value: 'tasks' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    const [table, field] = (onAdd as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Field];
    expect(table).toBe('tasks');
    expect(field).toMatchObject({ id: 'done', label: 'Done', type: 'boolean' });
  });

  it('starts a choice field with the three example choices', () => {
    const { onAdd } = open(baseSpec(), ['crews'], 'select');
    expect((screen.getByLabelText('Choices (one per line)') as HTMLTextAreaElement).value).toBe('To do\nDoing\nDone');
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    const field = (onAdd as ReturnType<typeof vi.fn>).mock.calls[0][1] as Field;
    expect(field).toMatchObject({ label: 'Status', type: 'select', options: ['To do', 'Doing', 'Done'] });
  });

  it('shows the validator message for an empty name and adds nothing', async () => {
    const { onAdd } = open(baseSpec(), ['crews']);
    const name = screen.getByLabelText('Field name') as HTMLInputElement;
    fireEvent.change(name, { target: { value: '' } });
    // Nothing is marked before the first Add field press (like the New table dialog).
    expect(name.getAttribute('aria-invalid')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    expect(name.getAttribute('aria-invalid')).toBe('true');
    // The message is tied to the input and says it in plain words.
    const described = (name.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent);
    expect(described).toEqual(EMPTY_NAME_MESSAGES);
    expect(onAdd).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(name));
  });

  it('says so when the table is full (60 fields)', () => {
    const spec = baseSpec();
    spec.tables[0].fields = Array.from({ length: 60 }, (_, i) => ({ id: `f${i}`, label: `F${i}`, type: 'text' as const, required: false }));
    const { onAdd } = open(spec, ['crews']);
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    expect(onAdd).not.toHaveBeenCalled();
    // No control is marked for it, so it is announced in an alert, in the validator's own words.
    expect(screen.getByRole('alert').textContent).toBe(CAP_SENTENCE);
  });

  it('keeps the dialog and shows a refusal as an alert; Cancel closes', () => {
    const { onCancel } = open(baseSpec(), ['crews'], 'boolean', vi.fn(() => 'That table already has a field with that name.'));
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    expect(screen.getByRole('alert').textContent).toBe('That table already has a field with that name.');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('takes a refusal away as soon as an input changes, and shows a repeated one again as a new alert', () => {
    open(twoTables(), ['crews', 'tasks'], 'boolean', vi.fn(() => 'That table already has a field with that name.'));
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    const first = screen.getByRole('alert');
    expect(first.textContent).toBe('That table already has a field with that name.');
    fireEvent.change(screen.getByLabelText('Table'), { target: { value: 'tasks' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    const again = screen.getByRole('alert');
    expect(again.textContent).toBe('That table already has a field with that name.');
    // The same words come back in a new element, so a screen reader announces them again.
    expect(again).not.toBe(first);
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    expect(screen.getByRole('alert')).not.toBe(again);
  });

  const threeTables = (): AppSpec => {
    const spec = twoTables();
    spec.tables.push({ id: 'notes', label: 'Notes', titleField: 'title', fields: [{ id: 'title', label: 'Title', type: 'text', required: true }] });
    return spec;
  };

  it('does not link a table to itself after the Table select moves to the table that was linked', () => {
    const { onAdd } = open(threeTables(), ['crews', 'tasks', 'notes'], 'reference');
    fireEvent.change(screen.getByLabelText('Links to'), { target: { value: 'tasks' } });
    fireEvent.change(screen.getByLabelText('Table'), { target: { value: 'tasks' } });
    const link = screen.getByLabelText('Links to') as HTMLSelectElement;
    expect([...link.options].map((o) => o.value)).toEqual(['crews', 'notes']);
    expect(link.value).toBe('crews');
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    const [table, field] = (onAdd as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Field];
    expect(table).toBe('tasks');
    expect(field).toMatchObject({ type: 'reference', table: 'crews' });
  });

  it('follows the Table while the name is untouched, and keeps a name that was typed', () => {
    open(threeTables(), ['crews', 'tasks', 'notes'], 'reference');
    const name = screen.getByLabelText('Field name') as HTMLInputElement;
    expect(name.value).toBe('Tasks');
    fireEvent.change(screen.getByLabelText('Table'), { target: { value: 'tasks' } });
    expect(name.value).toBe('Crews');
    fireEvent.change(name, { target: { value: 'Owner' } });
    fireEvent.change(screen.getByLabelText('Table'), { target: { value: 'notes' } });
    expect(name.value).toBe('Owner');
  });

  it('refuses a table id the draft does not have instead of using the first table', () => {
    const { onAdd } = open(baseSpec(), ['gone']);
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Pick a table of this app.');
  });
});
