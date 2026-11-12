import { describe, expect, it } from 'vitest';
import type { Table } from '@local-app-studio/runtime/spec/schema';
import { fieldNeedsOf, needWords, newTableDraft, suggestedLabel } from '../partFields';

const people: Table = { id: 'people', label: 'People', titleField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] };

/** "Name", "Status (select)": label and type of each field, in order. */
const shape = (type: string, tables: Table[] = []): string[] => newTableDraft(type, tables).fields.map((f) => `${f.label}:${f.type}`);

describe('fieldNeedsOf', () => {
  it('reads the required field binds that name types, in the bind order', () => {
    expect(fieldNeedsOf('Checklist')).toEqual([{ prop: 'field', types: ['boolean'] }]);
    expect(fieldNeedsOf('Timeline')[0]).toMatchObject({ prop: 'dateField', types: ['date', 'datetime'] });
    expect(fieldNeedsOf('Chart')[0]).toMatchObject({ prop: 'groupBy', types: ['select', 'boolean', 'date', 'datetime', 'reference'] });
    expect(fieldNeedsOf('ReferencePicker')[0].types).toEqual(['reference']);
  });
  it('is empty for a part with no required field and for a part with no data bind', () => {
    expect(fieldNeedsOf('DataTable')).toEqual([]);
    expect(fieldNeedsOf('Heading')).toEqual([]);
    expect(fieldNeedsOf('Nope')).toEqual([]);
  });
});

describe('needWords', () => {
  it('names the first type of each need', () => {
    expect(needWords([{ prop: 'field', types: ['boolean'] }])).toBe('a yes or no field');
    expect(needWords([{ prop: 'a', types: ['date', 'datetime'] }, { prop: 'b', types: ['select'] }])).toBe('a date field and a choice field');
  });
  it('follows the Data step names: number, decimal, link', () => {
    expect(needWords([{ prop: 'a', types: ['integer'] }])).toBe('a number field');
    expect(needWords([{ prop: 'a', types: ['real'] }])).toBe('a decimal field');
    expect(needWords([{ prop: 'a', types: ['reference'] }])).toBe('a link field');
  });
  it('is empty for no needs', () => {
    expect(needWords([])).toBe('');
  });
});

describe('suggestedLabel', () => {
  it('names a field by its type', () => {
    expect(suggestedLabel('boolean', [])).toBe('Done');
    expect(suggestedLabel('select', [])).toBe('Status');
    expect(suggestedLabel('date', [])).toBe('Date');
    expect(suggestedLabel('datetime', [])).toBe('Date and time');
    expect(suggestedLabel('integer', [])).toBe('Amount');
    expect(suggestedLabel('real', [])).toBe('Amount');
    expect(suggestedLabel('text', [])).toBe('Name');
    expect(suggestedLabel('longtext', [])).toBe('Notes');
  });
  it('names a link by the table it links to', () => {
    expect(suggestedLabel('reference', [people], 'people')).toBe('People');
    expect(suggestedLabel('reference', [people])).toBe('People');
  });
});

describe('newTableDraft', () => {
  it('starts with a blank label', () => {
    expect(newTableDraft('DataTable', []).label).toBe('');
  });
  it('lists only Name for a part that shows records', () => {
    for (const type of ['DataTable', 'RecordList', 'FilterBar', 'SearchBox', 'SortControl', 'RecordDetail']) expect(shape(type), type).toEqual(['Name:text']);
  });
  it('adds the field the part needs', () => {
    expect(shape('Checklist')).toEqual(['Name:text', 'Done:boolean']);
    expect(shape('Chart')).toEqual(['Name:text', 'Status:select']);
    expect(shape('Timeline')).toEqual(['Name:text', 'Date:date']);
  });
  it('gives a choice the three example choices', () => {
    const status = newTableDraft('Chart', []).fields[1];
    expect(status.type === 'select' && status.options).toEqual(['To do', 'Doing', 'Done']);
  });
  it('adds a number for a part that measures one', () => {
    expect(shape('ProgressBar')).toEqual(['Name:text', 'Amount:integer']);
    expect(shape('StatCard')).toEqual(['Name:text', 'Amount:integer']);
  });
  it('adds Notes for a form', () => {
    expect(shape('RecordForm')).toEqual(['Name:text', 'Notes:longtext']);
    expect(shape('QuickAdd')).toEqual(['Name:text', 'Notes:longtext']);
  });
  it('links a ReferencePicker to the first table, and has only Name when there is none', () => {
    expect(shape('ReferencePicker', [people])).toEqual(['Name:text', 'People:reference']);
    const link = newTableDraft('ReferencePicker', [people]).fields[1];
    expect(link.type === 'reference' && link.table).toBe('people');
    expect(shape('ReferencePicker')).toEqual(['Name:text']);
  });
  it('makes the title field required', () => {
    expect(newTableDraft('Checklist', []).fields[0]).toEqual({ id: 'name', label: 'Name', type: 'text', required: true });
  });
});
