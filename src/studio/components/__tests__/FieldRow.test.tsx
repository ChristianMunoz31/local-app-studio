import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Field, SpecIssue } from '@local-app-studio/runtime/spec/schema';
import { changeFieldType } from '../../lib/fields';
import FieldRow from '../FieldRow';

afterEach(cleanup);

const field: Field = { id: 'size', label: 'Size', type: 'integer', required: false };
const others = [{ id: 'jobs', label: 'Jobs' }];

const renderRow = (onChange = vi.fn()) =>
  render(<FieldRow field={field} path="tables.0.fields.1" otherTables={others} issues={[]} onChange={onChange} onMove={vi.fn()} onDelete={vi.fn()} />);

describe('FieldRow', () => {
  it('changes the type through changeFieldType', () => {
    const onChange = vi.fn();
    renderRow(onChange);
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'select' } });
    expect(onChange).toHaveBeenCalledWith(changeFieldType(field, 'select', others));
  });

  it('tells Number and Decimal apart under the picker and keeps the option labels (P17-24)', () => {
    renderRow();
    expect(screen.getByText('Number holds whole numbers. Decimal holds amounts like 12.50.')).toBeTruthy();
    const options = [...(screen.getByLabelText('Type') as HTMLSelectElement).options].map((o) => o.textContent);
    expect(options).toContain('Number');
    expect(options).toContain('Decimal');
  });

  it('keeps the type hint and a type problem in one description of the picker', () => {
    const issue: SpecIssue = { path: 'tables.0.fields.1.type', code: 'type', message: 'Pick a type.' };
    render(<FieldRow field={field} path="tables.0.fields.1" otherTables={others} issues={[issue]} onChange={vi.fn()} onMove={vi.fn()} onDelete={vi.fn()} />);
    const ids = (screen.getByLabelText('Type').getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids).toHaveLength(2);
    expect(document.getElementById(ids[0])?.textContent).toBe('Number holds whole numbers. Decimal holds amounts like 12.50.');
    expect(document.getElementById(ids[1])).toBeTruthy();
    expect(screen.getByLabelText('Type').getAttribute('aria-invalid')).toBe('true');
  });

  it('shows no hint of its own when the parent shows one for all rows, and points at it', () => {
    render(<FieldRow field={field} path="tables.0.fields.1" otherTables={others} issues={[]} onChange={vi.fn()} onMove={vi.fn()} onDelete={vi.fn()} typeHintId="shared-hint" />);
    expect(screen.queryByText('Number holds whole numbers. Decimal holds amounts like 12.50.')).toBeNull();
    expect(screen.getByLabelText('Type').getAttribute('aria-describedby')).toBe('shared-hint');
  });

  it('has no id or default input', () => {
    renderRow();
    expect(screen.queryByLabelText(/^Field id/)).toBeNull();
    expect(screen.queryByLabelText(/default/i)).toBeNull();
    expect(screen.getByLabelText('Field name')).toBeTruthy();
    expect(screen.getByLabelText('Required')).toBeTruthy();
  });

  it('shows the inline editor only for its own type', () => {
    const show = (f: Field) => {
      cleanup();
      render(<FieldRow field={f} path="tables.0.fields.1" otherTables={others} issues={[]} onChange={vi.fn()} onMove={vi.fn()} onDelete={vi.fn()} />);
    };
    show(field);
    expect(screen.queryByLabelText('Choices (one per line)')).toBeNull();
    expect(screen.queryByLabelText('Links to')).toBeNull();
    show({ id: 'size', label: 'Size', type: 'select', required: false, options: ['A', 'B'] } as Field);
    expect(screen.getByLabelText('Choices (one per line)')).toBeTruthy();
    expect(screen.queryByLabelText('Links to')).toBeNull();
    show({ id: 'size', label: 'Size', type: 'reference', required: false, table: 'jobs' } as Field);
    expect(screen.getByLabelText('Links to')).toBeTruthy();
    expect(screen.queryByLabelText('Choices (one per line)')).toBeNull();
  });

  it('reflects every spec type as the matching picker value', () => {
    const types = ['text', 'longtext', 'integer', 'real', 'boolean', 'date', 'datetime'] as const;
    for (const type of types) {
      cleanup();
      render(<FieldRow field={{ id: 'f', label: 'F', type, required: false } as Field} path="tables.0.fields.0" otherTables={others} issues={[]} onChange={vi.fn()} onMove={vi.fn()} onDelete={vi.fn()} />);
      expect((screen.getByLabelText('Type') as HTMLSelectElement).value).toBe(type);
    }
  });

  it('turns Move up off on the first field and Move down off on the last', () => {
    const view = render(
      <FieldRow field={field} path="tables.0.fields.0" otherTables={others} issues={[]} onChange={vi.fn()} onMove={vi.fn()} onDelete={vi.fn()} first />,
    );
    expect((screen.getByRole('button', { name: 'Move Size up' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Move Size down' }) as HTMLButtonElement).disabled).toBe(false);
    view.unmount();
    render(<FieldRow field={field} path="tables.0.fields.1" otherTables={others} issues={[]} onChange={vi.fn()} onMove={vi.fn()} onDelete={vi.fn()} last />);
    expect((screen.getByRole('button', { name: 'Move Size up' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Move Size down' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('marks an input with a problem invalid and points it at the message', () => {
    const issues = [{ path: 'tables.0.fields.1.label', code: 'required', message: 'Give the field a name.' }];
    render(<FieldRow field={{ ...field, label: '' }} path="tables.0.fields.1" otherTables={others} issues={issues} onChange={vi.fn()} onMove={vi.fn()} onDelete={vi.fn()} />);
    const input = screen.getByLabelText('Field name');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const message = document.getElementById(input.getAttribute('aria-describedby') ?? '');
    expect(message?.textContent).toBe('Give the field a name.');
    expect(screen.getByLabelText('Type').getAttribute('aria-invalid')).toBeNull();
  });

  it('has no per row sentence about links; the Fields heading line says it once', () => {
    render(<FieldRow field={field} path="tables.0.fields.0" otherTables={[]} issues={[]} onChange={vi.fn()} onMove={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByText('Links need a second table.')).toBeNull();
  });
});

describe('FieldRow round 2 (S5, N8)', () => {
  it('points an input at exactly the paragraphs Errors renders when two problems read the same', () => {
    const one: SpecIssue = { path: 'tables.0.fields.1.label', code: 'a', message: 'Pick a name.' };
    const two: SpecIssue = { path: 'tables.0.fields.1.label', code: 'b', message: 'Pick a name.' };
    render(<FieldRow field={field} path="tables.0.fields.1" otherTables={others} issues={[one, two]} onChange={vi.fn()} onMove={vi.fn()} onDelete={vi.fn()} />);
    const ids = (screen.getByLabelText('Field name').getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids).toHaveLength(1);
    for (const id of ids) expect(document.getElementById(id)).toBeTruthy();
  });

  it('names an unnamed field by its place, never "Field " or "Move  up"', () => {
    render(<FieldRow field={{ ...field, label: '' }} position={2} path="tables.0.fields.1" otherTables={others} issues={[]} onChange={vi.fn()} onMove={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Field 2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Move Field 2 up' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Move Field 2 down' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete Field 2' })).toBeTruthy();
  });

  it('says "Untitled field" when it has no place either', () => {
    render(<FieldRow field={{ ...field, label: ' ' }} path="tables.0.fields.1" otherTables={others} issues={[]} onChange={vi.fn()} onMove={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Untitled field' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Move Untitled field up' })).toBeTruthy();
  });
});
