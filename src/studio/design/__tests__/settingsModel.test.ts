import { describe, expect, it } from 'vitest';
import { partContextFor } from '@/catalog/validateLayout';
import type { AppSpec, LayoutLayer, Page, Table } from '@local-app-studio/runtime/spec/schema';
import { specOf } from '../../lib/__tests__/bindFixtures';
import { changeDraft, editableSettings, fieldGaps, firstFieldChoice, hasFieldChoice, initialDraft, settingRows } from '../settingsModel';

const layerOf = (id: string, type: string, props: LayoutLayer['props']): LayoutLayer => ({ id, type, props, children: [] });
const pageRoot = (...children: LayoutLayer[]): LayoutLayer => ({ id: 'root', type: 'Page', props: {}, children });

const items = (fields: Table['fields']): Table => ({ id: 'items_list', label: 'Items', titleField: 'name', fields });
const NAME: Table['fields'][number] = { id: 'name', label: 'Name', type: 'text', required: true };

/** One table "Items" and one list of it on every page. */
function itemsSpec(fields: Table['fields'] = [NAME]): AppSpec {
  return specOf((i) => {
    i.tables = [items(fields)];
    i.pages = i.pages.map((p) => ({ ...p, sources: [{ id: 'items', table: 'items_list', mode: 'list' as const, where: [], orderBy: [], limit: 50 }] }));
  });
}
const homeOf = (spec: AppSpec): Page => spec.pages.find((p) => p.id === 'home') as Page;

describe('settingRows: a total needs a number field (3.9.4)', () => {
  const progress = layerOf('p', 'ProgressBar', { source: 'items', stat: 'count', label: 'Items', target: 10 });
  const rowFor = (spec: AppSpec, layer: LayoutLayer, target: string) => {
    const page = homeOf(spec);
    const ctx = partContextFor(spec, page);
    const settings = editableSettings(layer, ctx);
    return settingRows(settings, initialDraft(settings), spec, page, ctx, layer.type).find((r) => r.target === target);
  };

  it('a ProgressBar on a table with no number lists only How many', () => {
    expect(rowFor(itemsSpec(), progress, 'props.stat')?.choices?.map((c) => c.label)).toEqual(['How many']);
  });
  it('after a number field is added it lists both', () => {
    const spec = itemsSpec([NAME, { id: 'amount', label: 'Amount', type: 'integer', required: false }]);
    expect(rowFor(spec, progress, 'props.stat')?.choices?.map((c) => c.label)).toEqual(['How many', 'Total of a number']);
  });
  it('a Chart lists Show without totals and averages when there is no number', () => {
    const chart = layerOf('c', 'Chart', { source: 'items', groupBy: 'created_at', kind: 'bar', measure: 'count' });
    expect(rowFor(itemsSpec(), chart, 'props.measure')?.choices?.map((c) => c.value)).toEqual(['count']);
    const spec = itemsSpec([NAME, { id: 'amount', label: 'Amount', type: 'real', required: false }]);
    expect(rowFor(spec, chart, 'props.measure')?.choices?.map((c) => c.value)).toEqual(['count', 'sum', 'avg']);
  });
  it('a Number tile lists Show: How many only without a number, and the totals with one', () => {
    const tile = layerOf('s', 'StatCard', { source: 'items', stat: 'count', label: 'Items' });
    expect(rowFor(itemsSpec(), tile, 'props.stat')?.choices?.map((c) => c.value)).toEqual(['count']);
    const spec = itemsSpec([NAME, { id: 'amount', label: 'Amount', type: 'integer', required: false }]);
    expect(rowFor(spec, tile, 'props.stat')?.choices?.map((c) => c.label)).toEqual(['How many', 'Total of a number', 'Average of a number', 'Lowest of a number', 'Highest of a number']);
  });
  it('keeps the value the part has now, even without a number', () => {
    const summing = layerOf('p', 'ProgressBar', { source: 'items', stat: 'sum', field: 'name', label: 'Items', target: 10 });
    expect(rowFor(itemsSpec(), summing, 'props.stat')?.choices?.map((c) => c.value)).toEqual(['count', 'sum']);
  });
  it('shows no extra field of the choices (value and label only)', () => {
    const row = rowFor(itemsSpec(), progress, 'props.stat');
    expect(row?.choices?.[0]).toEqual({ value: 'count', label: 'How many' });
  });
});

describe('settingRows: a date in Group by says how it groups (P17-23)', () => {
  const spec = itemsSpec([NAME, { id: 'due', label: 'Date out', type: 'date', required: false }, { id: 'seen', label: 'Seen', type: 'datetime', required: false }, { id: 'kind', label: 'Kind', type: 'select', options: ['a', 'b'], required: false }]);
  const labels = (props: LayoutLayer['props']): string[] => {
    const page = homeOf(spec);
    const ctx = partContextFor(spec, page);
    const layer = layerOf('c', 'Chart', props);
    const settings = editableSettings(layer, ctx);
    const row = settingRows(settings, initialDraft(settings), spec, page, ctx, 'Chart').find((r) => r.target === 'props.groupBy');
    return (row?.choices ?? []).map((c) => c.label);
  };
  it('lists a date and a datetime field "by month" and leaves other fields as they are', () => {
    const out = labels({ source: 'items', groupBy: 'due', kind: 'bar', measure: 'count' });
    expect(out).toContain('Date out (by month)');
    expect(out).toContain('Seen (by month)');
    expect(out).toContain('Kind');
  });
  it('says "by day" when Dates by is Day', () => {
    expect(labels({ source: 'items', groupBy: 'due', kind: 'bar', measure: 'count', bucket: 'day' })).toContain('Date out (by day)');
  });
});

describe('changeDraft: the field follows the bind order (3.9.2)', () => {
  it('a Chart moved from Crews to Tasks groups by Status, not Done', () => {
    const spec = specOf((i) => {
      i.tables = i.tables?.map((t) => (t.id === 'tasks' ? { ...t, fields: [...t.fields, { id: 'status', label: 'Status', type: 'select' as const, options: ['a', 'b'] }] } : t));
    });
    const page = homeOf(spec);
    const ctx = partContextFor(spec, page);
    const chart = layerOf('c', 'Chart', { source: 'all_crews', groupBy: 'lead_id', kind: 'bar', measure: 'count' });
    const settings = editableSettings(chart, ctx);
    const next = changeDraft(settings, initialDraft(settings), 'props.source', 'all_tasks', ctx);
    expect(next['props.groupBy']).toBe('status');
  });
  it('keeps a field that still fits', () => {
    const spec = specOf();
    const ctx = partContextFor(spec, homeOf(spec));
    const chart = layerOf('c', 'Chart', { source: 'all_crews', groupBy: 'status', kind: 'bar', measure: 'count' });
    const settings = editableSettings(chart, ctx);
    expect(changeDraft(settings, initialDraft(settings), 'props.source', 'all_crews', ctx)['props.groupBy']).toBe('status');
  });
});

describe('fieldGaps', () => {
  const timeline = layerOf('t', 'Timeline', { source: 'items', dateField: 'created_at', titleField: 'name' });
  const gapsOf = (spec: AppSpec) => {
    const ctx = partContextFor(spec, homeOf(spec));
    const settings = editableSettings(timeline, ctx);
    return fieldGaps(settings, initialDraft(settings), ctx);
  };

  it('names the field setting whose table has no declared field of its types', () => {
    expect(gapsOf(itemsSpec())).toEqual({ 'props.dateField': { table: 'items_list', type: 'date' } });
  });
  it('is empty once the table has such a field', () => {
    expect(gapsOf(itemsSpec([NAME, { id: 'due', label: 'Due', type: 'date', required: false }]))).toEqual({});
  });
  it('follows the draft table, so a pending List choice counts', () => {
    const spec = specOf();
    const ctx = partContextFor(spec, homeOf(spec));
    const settings = editableSettings(layerOf('t', 'Timeline', { source: 'all_tasks', dateField: 'due', titleField: 'title' }), ctx);
    const draft = { ...initialDraft(settings), 'props.source': 'all_crews' };
    expect(fieldGaps(settings, draft, ctx)['props.dateField']).toEqual({ table: 'crews', type: 'date' });
  });
});

describe('hasFieldChoice and firstFieldChoice', () => {
  const chartOn = (spec: AppSpec, source: string, groupBy: string) => pageRoot(layerOf('c', 'Chart', { source, groupBy, kind: 'bar', measure: 'count' }));

  it('is true when a required field setting has more than one declared field to pick', () => {
    const spec = specOf();
    expect(hasFieldChoice(chartOn(spec, 'all_tasks', 'done'), 'c', spec, homeOf(spec))).toBe(true);
    expect(firstFieldChoice(chartOn(spec, 'all_tasks', 'done'), 'c', spec, homeOf(spec))).toBe('props.groupBy');
  });
  it('does not count the runtime columns', () => {
    const spec = itemsSpec([NAME, { id: 'status', label: 'Status', type: 'select', options: ['a'], required: false }]);
    expect(hasFieldChoice(chartOn(spec, 'items', 'status'), 'c', spec, homeOf(spec))).toBe(false);
    expect(firstFieldChoice(chartOn(spec, 'items', 'status'), 'c', spec, homeOf(spec))).toBeNull();
  });
  it('is false for a missing part and a part with no data bind', () => {
    const spec = specOf();
    expect(hasFieldChoice(chartOn(spec, 'all_tasks', 'done'), 'nope', spec, homeOf(spec))).toBe(false);
    expect(hasFieldChoice(pageRoot(layerOf('h', 'Heading', {})), 'h', spec, homeOf(spec))).toBe(false);
  });
});
