import { describe, expect, it } from 'vitest';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { REMOVE_DATA, dataRemovals } from '../dataRemovals';
import { specOf } from './bindFixtures';

const before = specOf();
const without = (edit: (s: AppSpec) => AppSpec): AppSpec => edit(structuredClone(before));

describe('dataRemovals', () => {
  it('names a removed table', () => {
    const after = without((s) => ({ ...s, tables: s.tables.filter((t) => t.id !== 'people'), pages: s.pages }));
    expect(dataRemovals(before, after)).toContain('Removes the table "People" and its data.');
  });
  it('names a removed field', () => {
    const after = without((s) => ({ ...s, tables: s.tables.map((t) => (t.id === 'crews' ? { ...t, fields: t.fields.filter((f) => f.id !== 'size') } : t)) }));
    const out = dataRemovals(before, after);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/Size/);
  });
  it('names a changed type and a removed choice', () => {
    const typed = without((s) => ({ ...s, tables: s.tables.map((t) => (t.id === 'crews' ? { ...t, fields: t.fields.map((f) => (f.id === 'size' ? { id: 'size', label: 'Size', type: 'text' as const, required: false } : f)) } : t)) }));
    expect(dataRemovals(before, typed).length).toBeGreaterThan(0);
    const choice = without((s) => ({
      ...s,
      tables: s.tables.map((t) => (t.id === 'crews' ? { ...t, fields: t.fields.map((f) => (f.type === 'select' ? { ...f, options: ['open'] } : f)) } : t)),
    }));
    expect(dataRemovals(before, choice).length).toBeGreaterThan(0);
  });
  it('gives none for a layout, theme or table-add change', () => {
    const layout = without((s) => ({ ...s, theme: { ...s.theme, radius: 'lg' as const }, pages: s.pages.map((p) => (p.id === 'home' ? { ...p, title: 'Start' } : p)) }));
    expect(dataRemovals(before, layout)).toEqual([]);
    const added = without((s) => ({ ...s, tables: [...s.tables, { id: 'boats', label: 'Boats', titleField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text' as const, required: true }] }] }));
    expect(dataRemovals(before, added)).toEqual([]);
  });
});

describe('REMOVE_DATA', () => {
  it('has the words of the Data step', () => {
    expect(REMOVE_DATA.title).toBe('Save and remove data?');
    expect(REMOVE_DATA.message(['One.', 'Two.'])).toBe('These changes delete preview data: One. Two.');
    expect(REMOVE_DATA.confirm).toBe('Save and remove');
    expect(REMOVE_DATA.busy).toBe('Saving...');
    expect(REMOVE_DATA.cancel).toBe('Keep editing');
    expect(REMOVE_DATA.needsAnswer).toBe('These changes remove data, so they need your OK first.');
  });
});
