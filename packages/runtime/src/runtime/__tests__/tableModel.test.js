import { describe, expect, it } from 'vitest';
import { columnsOf, conditionFromDraft, nextSort, opsFor, namedTitleField, referenceText, searchFieldsOf } from '../data/tableModel.js';

const table = {
  id: 'crews',
  label: 'Crews',
  fields: [
    { id: 'name', label: 'Name', type: 'text' },
    { id: 'notes', label: 'Notes', type: 'longtext' },
    { id: 'size', label: 'Size', type: 'integer' },
  ],
};

describe('tableModel', () => {
  it('lists the fields and the two runtime columns', () => {
    expect(columnsOf(table).map((c) => c.id)).toEqual(['name', 'notes', 'size', 'created_at', 'updated_at']);
    expect(searchFieldsOf(table)).toEqual(['name', 'notes']);
    expect(namedTitleField(table)).toBe('name');
    expect(namedTitleField({ ...table, titleField: 'notes' })).toBe('notes');
    expect(namedTitleField({ ...table, titleField: 'ghost' })).toBe('name');
    expect(namedTitleField({ fields: [{ id: 'n', type: 'integer' }] })).toBeNull();
  });

  it('offers ordering operators only where they make sense', () => {
    expect(opsFor('integer')).toContain('gte');
    expect(opsFor('select')).toEqual(['eq', 'ne']);
    expect(opsFor('boolean')).toEqual(['eq', 'ne']);
  });

  it('turns a draft into a typed condition', () => {
    const d = (value) => ({ field: 'f', op: 'eq', value });
    expect(conditionFromDraft(d('3'), { type: 'integer' })).toEqual({ field: 'f', op: 'eq', value: 3 });
    expect(conditionFromDraft(d('3.5'), { type: 'integer' })).toBeNull();
    expect(conditionFromDraft(d('2.5'), { type: 'real' })).toEqual({ field: 'f', op: 'eq', value: 2.5 });
    expect(conditionFromDraft(d('true'), { type: 'boolean' })).toEqual({ field: 'f', op: 'eq', value: true });
    expect(conditionFromDraft(d(''), { type: 'text' })).toBeNull();
    expect(conditionFromDraft(d('x'), { type: 'text' })).toEqual({ field: 'f', op: 'eq', value: 'x' });
    expect(conditionFromDraft(d('2026-01-02T03:04'), { type: 'datetime' }).value).toMatch(/^2026-01-0\dT\d\d:\d\d:00\.000Z$/);
    expect(conditionFromDraft(d('nope'), { type: 'datetime' })).toBeNull();
  });

  it('cycles the sort and shows reference titles', () => {
    expect(nextSort(null, 'name')).toEqual({ field: 'name', dir: 'asc' });
    expect(nextSort({ field: 'name', dir: 'asc' }, 'name')).toEqual({ field: 'name', dir: 'desc' });
    expect(nextSort({ field: 'name', dir: 'desc' }, 'name')).toBeNull();
    expect(nextSort({ field: 'name', dir: 'desc' }, 'size')).toEqual({ field: 'size', dir: 'asc' });
    expect(referenceText({ people: { a: 'Ann' } }, 'people', 'a')).toBe('Ann');
    expect(referenceText({}, 'people', 'zz')).toBe('zz');
    expect(referenceText({}, 'people', null)).toBe('');
  });
});
