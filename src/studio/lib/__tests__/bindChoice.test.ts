import { describe, expect, it } from 'vitest';
import { getPartDefinition } from '@/catalog/definitions';
import { partContextFor } from '@/catalog/validateLayout';
import type { PartContext, PartDefinition } from '@/catalog/types';
import type { Table } from '@local-app-studio/runtime/spec/schema';
import { GROUP_FIELD_TYPES } from '@/catalog/enums';
import { RUNTIME_COLUMNS, dataBindOf, fittingTables, pickSource, quickAddFits, rankFieldIds, steer, tableFits, tablePreference } from '../bindChoice';
import type { DataBind } from '../bindChoice';
import { specOf } from './bindFixtures';

const def = (name: string): PartDefinition => {
  const d = getPartDefinition(name);
  if (d === undefined) throw new Error(name);
  return d;
};
const bindOf = (name: string): DataBind => {
  const b = dataBindOf(def(name));
  if (b === null) throw new Error(name);
  return b;
};
const spec = specOf();
const ctxOf = (id: string): PartContext => {
  const p = spec.pages.find((x) => x.id === id);
  if (p === undefined) throw new Error(id);
  return partContextFor(spec, p);
};
const table = (fields: object[]): Table => ({ id: 'x', label: 'X', titleField: 'a', fields }) as unknown as Table;

describe('dataBindOf', () => {
  it('reads the required source bind with its mode', () => {
    expect(bindOf('DataTable')).toEqual({ prop: 'source', kind: 'source', mode: 'list' });
    expect(bindOf('RecordDetail')).toEqual({ prop: 'source', kind: 'source', mode: 'record' });
    expect(bindOf('ProgressBar')).toEqual({ prop: 'source', kind: 'source', mode: undefined });
  });
  it('uses the table bind for QuickAdd and RecordForm, whose source is optional', () => {
    expect(bindOf('QuickAdd')).toEqual({ prop: 'table', kind: 'table', mode: undefined });
    expect(bindOf('RecordForm').kind).toBe('table');
  });
  it('is null for parts with no required data bind', () => {
    for (const name of ['Text', 'Heading', 'Section', 'Button', 'Breadcrumb', 'NavLinks']) expect(dataBindOf(def(name))).toBeNull();
  });
});

describe('tablePreference', () => {
  it('lists the tables of the page sources in page order, then the rest', () => {
    expect(tablePreference(ctxOf('home'), false)).toEqual(['crews', 'tasks', 'people']);
    expect(tablePreference(ctxOf('blank'), false)).toEqual(['people', 'crews', 'tasks']);
  });
  it('puts record sources first when asked, without duplicates', () => {
    expect(tablePreference(ctxOf('crew'), true)).toEqual(['crews', 'people', 'tasks']);
    const c = ctxOf('home');
    const mixed: PartContext = { ...c, sourceIds: ['all_tasks', 'all_crews', 'one'], sources: { ...c.sources, one: { table: 'people', mode: 'record' } } };
    expect(tablePreference(mixed, true)).toEqual(['people', 'tasks', 'crews']);
    expect(tablePreference(mixed, false)).toEqual(['tasks', 'crews', 'people']);
  });
});

describe('tableFits (B4)', () => {
  it('counts created_at as a date unless declaredOnly', () => {
    const ctx = ctxOf('home');
    const b = bindOf('Timeline');
    expect(tableFits(def('Timeline'), b, 'crews', ctx, false)).toBe(true);
    expect(tableFits(def('Timeline'), b, 'crews', ctx, true)).toBe(false);
    expect(tableFits(def('Timeline'), b, 'tasks', ctx, true)).toBe(true);
  });
  it('needs a boolean for a Checklist and a reference for a ReferencePicker', () => {
    const ctx = ctxOf('home');
    expect(tableFits(def('Checklist'), bindOf('Checklist'), 'tasks', ctx, false)).toBe(true);
    expect(tableFits(def('Checklist'), bindOf('Checklist'), 'crews', ctx, false)).toBe(false);
    expect(tableFits(def('ReferencePicker'), bindOf('ReferencePicker'), 'people', ctx, false)).toBe(false);
  });
  it('fits anything when no field is required (StatCard)', () => {
    expect(tableFits(def('StatCard'), bindOf('StatCard'), 'people', ctxOf('home'), true)).toBe(true);
  });
  it('names the runtime columns', () => {
    expect([...RUNTIME_COLUMNS].sort()).toEqual(['created_at', 'updated_at']);
  });
});

describe('quickAddFits (B8)', () => {
  const text = { id: 'name', label: 'Name', type: 'text', required: true };
  it('needs a text field', () => {
    expect(quickAddFits(table([{ id: 'n', label: 'N', type: 'integer', required: true }]))).toBe(false);
  });
  it('fits one required text field', () => {
    expect(quickAddFits(table([text]))).toBe(true);
  });
  it('refuses another required field with no default, accepts a default, a yes/no or an optional one', () => {
    expect(quickAddFits(table([text, { id: 'size', label: 'Size', type: 'integer', required: true }]))).toBe(false);
    expect(quickAddFits(table([text, { id: 'size', label: 'Size', type: 'integer', required: true, default: 1 }]))).toBe(true);
    expect(quickAddFits(table([text, { id: 'ok', label: 'Ok', type: 'boolean', required: true }]))).toBe(true);
    expect(quickAddFits(table([text, { id: 'size', label: 'Size', type: 'integer' }]))).toBe(true);
  });
  it('refuses when the first text field is optional and a later text field is required', () => {
    expect(quickAddFits(table([{ id: 'a', label: 'A', type: 'text' }, { id: 'b', label: 'B', type: 'text', required: true }]))).toBe(false);
  });
});

describe('pickSource', () => {
  it('Timeline on Home picks all_tasks on its declared date, not Crews on created_at', () => {
    expect(pickSource(def('Timeline'), bindOf('Timeline'), ctxOf('home'), spec.tables)).toBe('all_tasks');
  });
  it('falls back to created_at when no declared date exists anywhere', () => {
    const s = specOf((i) => {
      i.tables = i.tables?.map((t) => (t.id === 'tasks' ? { ...t, fields: t.fields.filter((f) => f.id !== 'due') } : t));
    });
    expect(pickSource(def('Timeline'), bindOf('Timeline'), partContextFor(s, s.pages[0]), s.tables)).toBe('all_crews');
  });
  it('honours the bind mode and returns null for a table bind or no fit', () => {
    expect(pickSource(def('DataTable'), bindOf('DataTable'), ctxOf('crew'), spec.tables)).toBeNull();
    expect(pickSource(def('RecordDetail'), bindOf('RecordDetail'), ctxOf('crew'), spec.tables)).toBe('one_crew');
    expect(pickSource(def('QuickAdd'), bindOf('QuickAdd'), ctxOf('home'), spec.tables)).toBeNull();
    expect(pickSource(def('Checklist'), bindOf('Checklist'), ctxOf('other'), spec.tables)).toBeNull();
  });
  it('takes the first source of any mode for a ProgressBar', () => {
    expect(pickSource(def('ProgressBar'), bindOf('ProgressBar'), ctxOf('crew'), spec.tables)).toBe('one_crew');
  });
  it('declaredOnly: true is the declared pass alone, false the runtime pass alone', () => {
    const s = specOf((i) => {
      i.tables = i.tables?.map((t) => (t.id === 'tasks' ? { ...t, fields: t.fields.filter((f) => f.id !== 'due') } : t));
    });
    const ctx = partContextFor(s, s.pages[0]);
    expect(pickSource(def('Timeline'), bindOf('Timeline'), ctx, s.tables)).toBe('all_crews');
    expect(pickSource(def('Timeline'), bindOf('Timeline'), ctx, s.tables, true)).toBeNull();
    expect(pickSource(def('Timeline'), bindOf('Timeline'), ctx, s.tables, false)).toBe('all_crews');
    expect(pickSource(def('Timeline'), bindOf('Timeline'), ctxOf('home'), spec.tables, true)).toBe('all_tasks');
  });
});

describe('rankFieldIds', () => {
  const fields = [
    { id: 'name', type: 'text' },
    { id: 'done', type: 'boolean' },
    { id: 'due', type: 'date' },
    { id: 'status', type: 'select' },
    { id: 'created_at', type: 'datetime' },
  ];
  it('orders by the position of the type in the bind, declared before created_at and updated_at', () => {
    expect(rankFieldIds(['done', 'due', 'status', 'created_at'], GROUP_FIELD_TYPES, fields)).toEqual(['status', 'done', 'due', 'created_at']);
  });
  it('keeps table order for the same type and when no types are given', () => {
    expect(rankFieldIds(['created_at', 'name', 'done'], undefined, fields)).toEqual(['name', 'done', 'created_at']);
    expect(rankFieldIds(['b', 'a'], ['text'], [{ id: 'a', type: 'text' }, { id: 'b', type: 'text' }])).toEqual(['b', 'a']);
  });
});

describe('fittingTables', () => {
  it('lists declared fits first, then runtime-only fits', () => {
    expect(fittingTables(def('Timeline'), bindOf('Timeline'), ctxOf('blank'), spec.tables)).toEqual(['tasks', 'people', 'crews']);
  });
  it('QuickAdd skips tables it cannot save with one text field', () => {
    const s = specOf((i) => {
      i.tables = i.tables?.map((t) => (t.id === 'crews' ? { ...t, fields: t.fields.map((f) => (f.id === 'size' ? { ...f, required: true } : f)) } : t));
    });
    expect(fittingTables(def('QuickAdd'), bindOf('QuickAdd'), partContextFor(s, s.pages[1]), s.tables)).toEqual(['people', 'tasks']);
  });
  it('is empty for a Checklist when no table has a yes/no field', () => {
    const s = specOf((i) => {
      i.tables = i.tables?.map((t) => ({ ...t, fields: t.fields.filter((f) => f.type !== 'boolean') }));
    });
    expect(fittingTables(def('Checklist'), bindOf('Checklist'), partContextFor(s, s.pages[0]), s.tables)).toEqual([]);
  });
});

describe('steer', () => {
  it('moves the ids first, keeps the members and does not mutate', () => {
    const ctx = ctxOf('home');
    const out = steer(ctx, { sourceId: 'all_tasks', tableId: 'tasks' });
    expect(out.sourceIds).toEqual(['all_tasks', 'all_crews']);
    expect(out.tableIds).toEqual(['tasks', 'people', 'crews']);
    expect(out.sources).toBe(ctx.sources);
    expect(ctx.sourceIds).toEqual(['all_crews', 'all_tasks']);
  });
  it('ignores an unknown id', () => {
    const ctx = ctxOf('home');
    expect(steer(ctx, { sourceId: 'nope' }).sourceIds).toEqual(ctx.sourceIds);
  });
});
