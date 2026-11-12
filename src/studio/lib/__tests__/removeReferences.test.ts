import { describe, expect, it } from 'vitest';
import type { AppSpec, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { DATA_COPY } from '../dataCopy';
import { canRemoveReferences, removeReferences } from '../removeReferences';
import { validateSpec } from '../validate';
import { specOf } from './bindFixtures';

const layer = (id: string, type: string, props: LayoutLayer['props'], children: LayoutLayer[] | string = []): LayoutLayer => ({ id, type, props, children });

/** The audit app with real parts on Home: a table, a list, a chart, a form, a filter bar, a number tile. */
function withParts(): AppSpec {
  return specOf((input) => {
    const home = input.pages?.find((p) => p.id === 'home');
    if (home === undefined) throw new Error('no home');
    home.sources = [
      { id: 'all_crews', table: 'crews', mode: 'list', where: [{ field: 'status', op: 'eq', value: 'open' }], orderBy: [{ field: 'status', dir: 'asc' }], limit: 50 },
      { id: 'all_tasks', table: 'tasks', mode: 'list', where: [], orderBy: [], limit: 50 },
    ] as never;
    home.layout = layer('root', 'Page', {}, [
      layer('table_1', 'DataTable', { source: 'all_crews', columns: ['name', 'status', 'size'] }),
      layer('chart_1', 'Chart', { source: 'all_crews', groupBy: 'status', measure: 'count' }),
      layer('form_1', 'RecordForm', { table: 'crews', mode: 'create', fields: ['name', 'status'] }),
      layer('filter_1', 'FilterBar', { source: 'all_crews', fields: ['status'] }),
      layer('list_1', 'RecordList', { source: 'all_tasks', titleField: 'title' }),
    ]) as never;
  });
}

const removeField = (spec: AppSpec, table: string, field: string): AppSpec => ({
  ...spec,
  tables: spec.tables.map((t) => (t.id === table ? { ...t, fields: t.fields.filter((f) => f.id !== field) } : t)),
});
const removeTable = (spec: AppSpec, table: string): AppSpec => ({
  ...spec,
  tables: spec.tables.filter((t) => t.id !== table).map((t) => ({ ...t, fields: t.fields.filter((f) => !(f.type === 'reference' && f.table === table)) })),
});

const homeLayer = (spec: AppSpec, id: string): LayoutLayer | undefined => {
  const kids = spec.pages.find((p) => p.id === 'home')?.layout.children;
  return Array.isArray(kids) ? kids.find((k) => k.id === id) : undefined;
};

describe('removeReferences', () => {
  it('starts from a valid design', () => {
    expect(validateSpec(withParts()).issues).toEqual([]);
  });

  it('leaves a valid design alone and says nothing changed', () => {
    const spec = withParts();
    const result = removeReferences(spec);
    expect(result).toEqual({ ok: true, spec, changed: false, links: [] });
    expect(canRemoveReferences(spec)).toBe(false);
  });

  it('takes a removed field out of columns, filters, sorts, forms and filter bars, and switches the chart to the next choice field', () => {
    const broken = removeField(withParts(), 'crews', 'status');
    expect(validateSpec(broken).ok).toBe(false);
    expect(canRemoveReferences(broken)).toBe(true);
    const result = removeReferences(broken);
    if (!result.ok) throw new Error('expected ok');
    expect(validateSpec(result.spec).issues).toEqual([]);
    expect(homeLayer(result.spec, 'table_1')?.props.columns).toEqual(['name', 'size']);
    expect(homeLayer(result.spec, 'form_1')?.props.fields).toEqual(['name']);
    // The only choice field is gone, so the chart goes; the filter bar cannot work without its field and goes too.
    expect(homeLayer(result.spec, 'chart_1')).toBeUndefined();
    expect(homeLayer(result.spec, 'filter_1')).toBeUndefined();
    const home = result.spec.pages.find((p) => p.id === 'home');
    expect(home?.sources[0].where).toEqual([]);
    expect(home?.sources[0].orderBy).toEqual([]);
    expect(homeLayer(result.spec, 'list_1')).toBeDefined();
  });

  it('switches a chart to the next choice field when the table has one', () => {
    const base = specOf((input) => {
      const crews = input.tables?.find((t) => t.id === 'crews');
      crews?.fields.push({ id: 'kind', label: 'Kind', type: 'select', options: ['a', 'b'] } as never);
    });
    const spec = withParts();
    const withKind: AppSpec = { ...spec, tables: spec.tables.map((t) => (t.id === 'crews' ? { ...t, fields: [...t.fields, base.tables[1].fields[4]] } : t)) };
    const result = removeReferences(removeField(withKind, 'crews', 'status'));
    if (!result.ok) throw new Error('expected ok');
    expect(homeLayer(result.spec, 'chart_1')?.props.groupBy).toBe('kind');
  });

  it('drops the columns prop when every column is gone, so the part shows its defaults', () => {
    const spec = withParts();
    const home = spec.pages.find((p) => p.id === 'home');
    const table = home?.layout.children;
    if (!Array.isArray(table)) throw new Error('no children');
    table[0].props.columns = ['status'];
    const result = removeReferences(removeField(spec, 'crews', 'status'));
    if (!result.ok) throw new Error('expected ok');
    expect(homeLayer(result.spec, 'table_1')?.props).toEqual({ source: 'all_crews' });
  });

  it('removes the sources of a removed table and the parts bound to them', () => {
    const broken = removeTable(withParts(), 'crews');
    expect(validateSpec(broken).ok).toBe(false);
    const result = removeReferences(broken);
    if (!result.ok) throw new Error('expected ok');
    expect(validateSpec(result.spec).issues).toEqual([]);
    const home = result.spec.pages.find((p) => p.id === 'home');
    expect(home?.sources.map((s) => s.id)).toEqual(['all_tasks']);
    for (const id of ['table_1', 'chart_1', 'form_1', 'filter_1']) expect(homeLayer(result.spec, id)).toBeUndefined();
    expect(homeLayer(result.spec, 'list_1')).toBeDefined();
    // The other pages that read the table lose their sources too; the record page keeps its top part.
    expect(result.spec.pages.find((p) => p.id === 'crew')?.sources).toEqual([]);
    expect(result.spec.pages.find((p) => p.id === 'other')?.sources).toEqual([]);
  });

  it('removes a link field that points at a removed table', () => {
    const spec = withParts();
    const broken: AppSpec = { ...spec, tables: spec.tables.filter((t) => t.id !== 'crews') };
    const result = removeReferences(broken);
    if (!result.ok) throw new Error('expected ok');
    expect(result.spec.tables.find((t) => t.id === 'tasks')?.fields.map((f) => f.id)).toEqual(['title', 'done', 'due']);
    // M3: the link field that went is named, so the notice can say so.
    expect(result.links).toEqual([{ field: 'Crew', table: 'Tasks' }]);
    expect(DATA_COPY.removeNoticeLinks(result.links)).toBe('Took it out of the parts that used it, and removed the link field Crew from Tasks.');
    expect(DATA_COPY.removeNoticeLinks([...result.links, { field: 'Owner', table: 'Jobs' }])).toBe('Took it out of the parts that used it, and removed the link fields Crew from Tasks and Owner from Jobs.');
    expect(validateSpec(result.spec).issues).toEqual([]);
  });

  it('does not change what it was given', () => {
    const broken = removeField(withParts(), 'crews', 'status');
    const copy = structuredClone(broken);
    removeReferences(broken);
    expect(broken).toEqual(copy);
  });

  it('says no when a problem has no safe fix', () => {
    const spec = withParts();
    const broken: AppSpec = { ...spec, nav: [{ pageId: 'ghost', label: 'Ghost', icon: 'home' }] };
    expect(removeReferences(broken)).toEqual({ ok: false });
    expect(canRemoveReferences(broken)).toBe(false);
  });
});
