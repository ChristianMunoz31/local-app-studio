import { describe, expect, it } from 'vitest';
import type { Field, Table } from '@local-app-studio/runtime/spec/schema';
import { validateSpec } from '../validate';
import { EXAMPLE_OPTIONS, blankField, blankTable, fieldOfType, tableFromDraft, tableIssues, withField } from '../tableDraft';
import { specOf } from './bindFixtures';

const named = (id: string, label: string): Table => ({ id, label, titleField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] });

describe('blankTable', () => {
  it('is the Data step table: id new_table, label New table, one required Name that titles each record', () => {
    expect(blankTable([])).toEqual({ id: 'new_table', label: 'New table', titleField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] });
  });
  it('numbers the label and the id when New table is taken', () => {
    const one = blankTable([named('new_table', 'New table')]);
    expect(one).toMatchObject({ id: 'new_table_2', label: 'New table 2' });
    const two = blankTable([named('new_table', 'New table'), one]);
    expect(two).toMatchObject({ id: 'new_table_3', label: 'New table 3' });
  });
});

describe('blankField', () => {
  it('is the Data step field: id new_field, label New field, text, not required', () => {
    const table = named('t', 'T');
    expect(blankField(table)).toEqual({ id: 'new_field', label: 'New field', type: 'text', required: false });
    const next = { ...table, fields: [...table.fields, blankField(table)] };
    expect(blankField(next).id).toBe('new_field_2');
  });
});

describe('fieldOfType', () => {
  it('makes the id from the label, not required, with the extras of the type', () => {
    expect(fieldOfType('Due date', 'date', new Set(), [])).toEqual({ id: 'due_date', label: 'Due date', type: 'date', required: false });
    expect(fieldOfType('Due date', 'date', new Set(['due_date']), []).id).toBe('due_date_2');
    expect(fieldOfType('Status', 'select', new Set(), [], EXAMPLE_OPTIONS)).toMatchObject({ type: 'select', options: ['To do', 'Doing', 'Done'] });
    expect(fieldOfType('Status', 'select', new Set(), [])).toMatchObject({ options: ['Option 1'] });
    expect(fieldOfType('Crew', 'reference', new Set(), [{ id: 'crews' }, { id: 'people' }])).toMatchObject({ type: 'reference', table: 'crews' });
  });
  it('does not take a reserved field id', () => {
    expect(fieldOfType('Created at', 'date', new Set(), []).id).not.toBe('created_at');
  });
});

describe('tableFromDraft', () => {
  const text = (label: string): Field => ({ id: 'x', label, type: 'text', required: false });
  it('does not take a reserved table id', () => {
    expect(tableFromDraft({ label: 'Items', fields: [text('Name')] }, []).id).toBe('items_2');
  });
  it('makes unique field ids from the labels, in order', () => {
    const table = tableFromDraft({ label: 'Crews', fields: [text('Name'), text('Name')] }, []);
    expect(table.fields.map((f) => f.id)).toEqual(['name', 'name_2']);
    expect(table.id).toBe('crews');
  });
  it('avoids the ids of the tables it joins', () => {
    expect(tableFromDraft({ label: 'Crews', fields: [text('Name')] }, [named('crews', 'Crews')]).id).toBe('crews_2');
  });
  it('titles the table by the first text, long text or choice field, and by none when there is none', () => {
    const date: Field = { id: 'd', label: 'Date', type: 'date', required: false };
    const status = fieldOfType('Status', 'select', new Set(), [], EXAMPLE_OPTIONS);
    expect(tableFromDraft({ label: 'T', fields: [date, status, text('Name')] }, []).titleField).toBe('status');
    expect(tableFromDraft({ label: 'T', fields: [text('Name'), date] }, []).titleField).toBe('name');
    const none = tableFromDraft({ label: 'T', fields: [date] }, []);
    expect(none).not.toHaveProperty('titleField');
  });
  it('does not change its input', () => {
    const draft = { label: 'Crews', fields: [text('Name')] };
    const before = JSON.stringify(draft);
    tableFromDraft(draft, []);
    expect(JSON.stringify(draft)).toBe(before);
  });
});

describe('withField', () => {
  it('adds the field with the table own ids taken, and returns it', () => {
    const base = named('crews', 'Crews');
    const out = withField(base, 'Name', 'text', []);
    expect(out.field.id).toBe('name_2');
    expect(out.table.fields).toHaveLength(2);
    expect(base.fields).toHaveLength(1);
    expect(withField(base, 'Done', 'boolean', []).field).toEqual({ id: 'done', label: 'Done', type: 'boolean', required: false });
  });
});

describe('tableIssues', () => {
  const spec = specOf();
  const index = spec.tables.length;
  const issuesFor = (draft: { label: string; fields: Field[] }, tables: Table[] = spec.tables) => {
    const candidate = tableFromDraft(draft, tables);
    const all = [...tables, candidate];
    return { issues: tableIssues({ ...spec, tables }, all, tables.length), all };
  };
  const nameField: Field = { id: 'name', label: 'Name', type: 'text', required: true };

  it('has none for a good table', () => {
    expect(issuesFor({ label: 'Boats', fields: [nameField] }).issues).toEqual([]);
  });
  it('an empty table name has the validator message at the label', () => {
    const { issues, all } = issuesFor({ label: '', fields: [nameField] });
    expect(issues.length).toBeGreaterThan(0);
    const direct = validateSpec({ ...spec, tables: all }).issues.filter((i) => i.path === `tables.${index}.label`);
    expect(direct.length).toBeGreaterThan(0);
    expect(issues.filter((i) => i.path === `tables.${index}.label`)).toEqual(direct);
  });
  it('61 fields have the validator message at the fields', () => {
    const fields = Array.from({ length: 61 }, (_, n) => ({ ...nameField, id: `f${n}`, label: `F ${n}`, required: false }));
    const { issues } = issuesFor({ label: 'Wide', fields });
    expect(issues.some((i) => i.path === `tables.${index}.fields`)).toBe(true);
  });
  it('a 31st table has the validator message at tables', () => {
    const many = Array.from({ length: 30 }, (_, n) => named(`t${n}`, `T ${n}`));
    const { issues } = issuesFor({ label: 'One more', fields: [nameField] }, many);
    expect(issues.some((i) => i.path === 'tables')).toBe(true);
  });
  it('duplicate choices are reported inside the new table', () => {
    const status: Field = { id: 's', label: 'Status', type: 'select', options: ['a', 'a'], required: false };
    const { issues } = issuesFor({ label: 'Boats', fields: [nameField, status] });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.path.startsWith(`tables.${index}.`))).toBe(true);
  });
  it('a link to a missing table is reported inside the new table', () => {
    const link: Field = { id: 'l', label: 'Link', type: 'reference', table: 'nowhere', required: false };
    const { issues } = issuesFor({ label: 'Boats', fields: [nameField, link] });
    expect(issues.some((i) => i.path.startsWith(`tables.${index}.fields`))).toBe(true);
  });
  it('keeps only the issues at tables or the new table', () => {
    const broken = { ...spec, tables: spec.tables.map((t, n) => (n === 0 ? { ...t, label: '' } : t)) };
    const candidate = tableFromDraft({ label: 'Boats', fields: [nameField] }, broken.tables);
    expect(tableIssues(broken, [...broken.tables, candidate], broken.tables.length)).toEqual([]);
  });
});
