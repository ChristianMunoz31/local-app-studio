// The New table dialog: the part's fields come pre-filled, the Data step's rules and messages apply, Make table hands over the table.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Table } from '@local-app-studio/runtime/spec/schema';
import { baseSpec } from '../../__tests__/fixtures';
import { newTableDraft } from '../../lib/partFields';
import NewTableDialog from '../NewTableDialog';

afterEach(cleanup);

function open(overrides: { type?: string; onMake?: (table: Table) => string | null; onCancel?: () => void; needsLink?: boolean } = {}) {
  const spec = baseSpec();
  const onMake = overrides.onMake ?? vi.fn(() => null);
  const onCancel = overrides.onCancel ?? vi.fn();
  render(
    <NewTableDialog
      partName="Checklist"
      spec={spec}
      initial={newTableDraft(overrides.type ?? 'Checklist', spec.tables)}
      needsLink={overrides.needsLink}
      onMake={onMake}
      onCancel={onCancel}
    />,
  );
  return { onMake, onCancel };
}

const nameBox = (): HTMLInputElement => screen.getByLabelText('Table name') as HTMLInputElement;
const makeButton = (): HTMLElement => screen.getByRole('button', { name: 'Make table' });

describe('NewTableDialog', () => {
  it('is a dialog named for the part, with the focus in Table name', async () => {
    open();
    expect(screen.getByRole('dialog', { name: 'New table for Checklist' })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(nameBox()));
    expect(nameBox().placeholder).toBe('For example: Crews');
    expect(screen.getByText('The first field names each record.')).toBeTruthy();
  });

  it('starts with the fields the part needs: Name and Done for a Checklist', () => {
    open();
    expect(screen.getByRole('group', { name: 'Field Name' })).toBeTruthy();
    const done = screen.getByRole('group', { name: 'Field Done' });
    expect((within(done).getByLabelText('Type') as HTMLSelectElement).value).toBe('boolean');
  });

  it('shows the validator message for an empty name and puts the focus there, without making the table', async () => {
    const { onMake } = open();
    fireEvent.click(makeButton());
    expect(onMake).not.toHaveBeenCalled();
    expect(nameBox().getAttribute('aria-invalid')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(nameBox()));
    const message = document.getElementById((nameBox().getAttribute('aria-describedby') ?? '').split(' ')[0]);
    expect((message?.textContent ?? '').length).toBeGreaterThan(0);
  });

  it('says "Give the table a name." for an empty name, once, with no validator words (P17-09)', () => {
    open();
    fireEvent.click(makeButton());
    const dialog = screen.getByRole('dialog', { name: 'New table for Checklist' });
    expect(within(dialog).getAllByText('Give the table a name.')).toHaveLength(1);
    expect(dialog.textContent).not.toMatch(/Too small|Invalid string|pattern|characters/);
  });

  it('says a name of only spaces is empty too, and a field name that is empty in plain words', () => {
    open();
    fireEvent.change(nameBox(), { target: { value: '   ' } });
    fireEvent.click(makeButton());
    expect(screen.getAllByText('Give the table a name.')).toHaveLength(1);
    const name = screen.getByRole('group', { name: 'Field Name' });
    fireEvent.change(within(name).getByLabelText('Field name'), { target: { value: '' } });
    fireEvent.click(makeButton());
    expect(within(name).getByText('This needs at least 1 characters.')).toBeTruthy();
    expect(screen.getByRole('dialog').textContent).not.toMatch(/Too small|Invalid string|expected string/);
  });

  it('adds a field named New field, and deletes and retypes the pre-filled ones', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    expect(screen.getByRole('group', { name: 'Field New field' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete field New field' }));
    expect(screen.queryByRole('group', { name: 'Field New field' })).toBeNull();
    const done = screen.getByRole('group', { name: 'Field Done' });
    fireEvent.change(within(done).getByLabelText('Type'), { target: { value: 'select' } });
    expect(within(done).getByLabelText('Choices (one per line)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete field Done' }));
    expect(screen.queryByRole('group', { name: 'Field Done' })).toBeNull();
  });

  it('makes the table with ids from the names', () => {
    const { onMake } = open();
    fireEvent.change(nameBox(), { target: { value: 'Tasks' } });
    fireEvent.click(makeButton());
    expect(onMake).toHaveBeenCalledTimes(1);
    const made = (onMake as ReturnType<typeof vi.fn>).mock.calls[0][0] as Table;
    expect(made.id).toBe('tasks');
    expect(made.label).toBe('Tasks');
    expect(made.fields.map((f) => f.id)).toEqual(['name', 'done']);
    expect(made.titleField).toBe('name');
  });

  it('keeps the dialog and shows the refusal as an alert', () => {
    const { onMake } = open({ onMake: vi.fn(() => 'This page already has 8 lists. Remove one in Page settings first.') });
    fireEvent.change(nameBox(), { target: { value: 'Tasks' } });
    fireEvent.click(makeButton());
    expect(onMake).toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('This page already has 8 lists. Remove one in Page settings first.');
    expect(screen.getByRole('dialog', { name: 'New table for Checklist' })).toBeTruthy();
  });

  it('calls onCancel from Cancel', () => {
    const { onCancel } = open();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('says a linked record picker needs a second table when the app has none', () => {
    open({ needsLink: true });
    expect(screen.getByText('A linked record picker needs a link to another table. Make a second table after this one.')).toBeTruthy();
  });

  it('makes a unique id for a name the app already has', () => {
    const { onMake } = open();
    fireEvent.change(nameBox(), { target: { value: 'Crews' } });
    fireEvent.click(makeButton());
    expect((onMake as ReturnType<typeof vi.fn>).mock.calls[0][0].id).toBe('crews_2');
  });

  it('announces a problem of the whole table (too many fields) in an alert when Make table is pressed', () => {
    const spec = baseSpec();
    const initial = { label: 'Big', fields: Array.from({ length: 61 }, (_, i) => ({ id: `f${i}`, label: `F${i}`, type: 'text' as const, required: false })) };
    const onMake = vi.fn(() => null);
    render(<NewTableDialog partName="Checklist" spec={spec} initial={initial} onMake={onMake} onCancel={vi.fn()} />);
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(makeButton());
    expect(onMake).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('A table may have at most 60 fields.');
  });

  it('keeps the first-field hint in the name box description, together with an error', () => {
    open();
    const hint = screen.getByText('The first field names each record.');
    expect(nameBox().getAttribute('aria-describedby')).toBe(hint.id);
    fireEvent.click(makeButton());
    const ids = (nameBox().getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids).toContain(hint.id);
    expect(ids.length).toBeGreaterThan(1);
  });

  it('shows the Number and Decimal hint once for the table, and every Type picker points at it', () => {
    open();
    const hint = screen.getByText('Number holds whole numbers. Decimal holds amounts like 12.50.');
    const pickers = screen.getAllByLabelText('Type');
    expect(pickers.length).toBeGreaterThan(1);
    for (const picker of pickers) expect(picker.getAttribute('aria-describedby')).toContain(hint.id);
  });
});
