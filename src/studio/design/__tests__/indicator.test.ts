import { describe, expect, it } from 'vitest';
import { SEED_FEATURES } from '@/catalog/features';
import type { FeatureLibrary } from '@/catalog/features';
import { partContextFor } from '@/catalog/validateLayout';
import type { AppSpec, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { seedRecords } from '../../components/__tests__/featureFixtures';
import { pageOf, specOf } from '../../lib/__tests__/bindFixtures';
import { NOT_CONNECTED } from '../../lib/bindOnDrop';
import { buildShowcaseEntries, partEntries } from '../../showcase/entries';
import { NEEDS_TABLE, NEWER_VERSION, behindCount, connectedText, entryNeedsTable, isBehind, needsFieldText, newerVersionLine, partIndicator, slotText, specNeeds } from '../indicator';

const library: FeatureLibrary = new Map(SEED_FEATURES.map((d) => [d.id, d]));
const layer = (id: string, type: string, props: LayoutLayer['props'], children: LayoutLayer['children'] = []): LayoutLayer => ({ id, type, props, children });
const root = (...children: LayoutLayer[]): LayoutLayer => layer('root', 'Page', {}, children);
const withLayout = (spec: AppSpec, pageId: string, layout: LayoutLayer): AppSpec => ({ ...spec, pages: spec.pages.map((p) => (p.id === pageId ? { ...p, layout } : p)) });
const ctxOf = (spec: AppSpec, pageId: string) => partContextFor(spec, spec.pages.find((p) => p.id === pageId)!);
const indicate = (spec: AppSpec, pageId: string, l: LayoutLayer, opts = {}) => partIndicator(l, ctxOf(spec, pageId), spec, pageOf(spec, pageId), opts);

/** Crew Audit with only the People table: no yes or no field, no date, no choice anywhere. */
const peopleOnly = (): AppSpec => {
  const s = specOf();
  return { ...s, tables: s.tables.filter((t) => t.id === 'people'), pages: s.pages.map((p) => ({ ...p, sources: [] })) };
};
const noTables = (): AppSpec => ({ ...peopleOnly(), tables: [] });

describe('partIndicator, built-in parts', () => {
  const spec = specOf();
  it('connected: words, table and target', () => {
    expect(indicate(spec, 'home', layer('t', 'DataTable', { source: 'all_crews' }))).toMatchObject({ state: 'connected', table: 'crews', tableLabel: 'Crews', text: 'Connected to Crews', target: 'props.source' });
    expect(indicate(spec, 'home', layer('q', 'QuickAdd', { table: 'crews', field: 'name' }))).toMatchObject({ state: 'connected', text: connectedText('Crews'), target: 'props.table' });
    expect(indicate(spec, 'home', layer('c', 'Checklist', { source: 'all_tasks' }))).toMatchObject({ state: 'connected', table: 'tasks' });
    expect(indicate(spec, 'home', layer('f', 'RecordForm', { table: 'people' }))).toMatchObject({ state: 'connected', table: 'people' });
  });
  it('the builder reads Uses slot', () => {
    expect(indicate(spec, 'home', layer('t', 'DataTable', { source: 'all_crews' }), { builder: true })).toMatchObject({ state: 'slot', text: slotText('Crews') });
  });
  it('needs a table when a table fits, and the offer is null', () => {
    expect(indicate(spec, 'home', layer('t', 'DataTable', { source: NOT_CONNECTED }))).toEqual({ state: 'needs_table', text: NEEDS_TABLE, offer: null, target: 'props.source' });
  });
  it('needs a table with no_table when the app has none', () => {
    const s = noTables();
    expect(indicate(s, 'blank', layer('t', 'DataTable', { source: NOT_CONNECTED }))).toEqual({ state: 'needs_table', text: 'Needs a table', offer: { kind: 'no_table' }, target: 'props.source' });
    expect(indicate(s, 'blank', layer('q', 'QuickAdd', { table: NOT_CONNECTED }))).toMatchObject({ state: 'needs_table', offer: { kind: 'no_table' }, target: 'props.table' });
  });
  it('needs a table with full when the page list limit is reached', () => {
    const s = peopleOnly();
    const full = Array.from({ length: 20 }, (_, i) => ({ id: `l${i}`, table: 'people', mode: 'list' as const, where: [], orderBy: [], limit: 10 }));
    const got = partIndicator(layer('c', 'Checklist', { source: NOT_CONNECTED }), ctxOf(s, 'blank'), s, { ...pageOf(s, 'blank'), sources: full });
    expect(got).toMatchObject({ state: 'needs_table', offer: { kind: 'full' } });
  });
  it('needs a field when no table has what the part needs', () => {
    const got = indicate(peopleOnly(), 'blank', layer('c', 'Checklist', { source: NOT_CONNECTED }));
    expect(got).toMatchObject({ state: 'needs_field', text: 'Needs a yes or no field', tables: ['people'], target: 'props.source' });
    if (got?.state === 'needs_field') expect(needsFieldText(got.needs)).toBe('Needs a yes or no field');
  });
  it('names every kind a part needs', () => {
    expect(needsFieldText([{ prop: 'a', types: ['date'] }, { prop: 'b', types: ['select'] }])).toBe('Needs a date field and a choice field');
  });
  it('is null for parts with no data and a menu Search box', () => {
    expect(indicate(spec, 'home', layer('h', 'Heading', { size: 'lg' }, 'Hi'))).toBeNull();
    expect(indicate(spec, 'home', layer('m', 'SearchBox', {}))).toBeNull();
  });
});

describe('partIndicator, feature blocks', () => {
  const spec = specOf();
  const block = (params: Record<string, string>): LayoutLayer => ({ ...layer('b', 'Section', {}, []), feature: { id: 'kpi_row', version: 1, params } });
  it('is connected when the list resolves, with no target', () => {
    expect(indicate(spec, 'home', block({ source: 'all_crews' }), { library })).toMatchObject({ state: 'connected', table: 'crews', text: 'Connected to Crews', target: null });
  });
  it('goes stale to needs a table with no offer', () => {
    expect(indicate(spec, 'home', block({ source: 'gone' }), { library })).toEqual({ state: 'needs_table', text: NEEDS_TABLE, offer: null, target: 'props.source' });
  });
  it('is null without a library or for an unknown feature', () => {
    expect(indicate(spec, 'home', block({ source: 'all_crews' }))).toBeNull();
    expect(indicate(spec, 'home', { ...block({}), feature: { id: 'nope', version: 1, params: {} } }, { library })).toBeNull();
  });
  it('the builder reads Uses slot', () => {
    expect(indicate(spec, 'home', block({ source: 'all_crews' }), { library, builder: true })).toMatchObject({ state: 'slot', text: 'Uses slot Crews' });
  });
});

describe('specNeeds', () => {
  it('is empty for a clean spec', () => {
    expect(specNeeds(specOf(), library)).toEqual([]);
  });
  it('lists needs in page order then tree order with lower-case words', () => {
    let s = withLayout(peopleOnly(), 'home', root(layer('h', 'Heading', {}, 'Hi'), layer('t', 'DataTable', { source: NOT_CONNECTED }), layer('c', 'Checklist', { source: NOT_CONNECTED })));
    s = withLayout(s, 'other', root(layer('q', 'QuickAdd', { table: 'people', field: 'name' }), layer('t2', 'DataTable', { source: NOT_CONNECTED })));
    const needs = specNeeds(s, library);
    expect(needs.map((n) => [n.pageId, n.layerId])).toEqual([
      ['home', 't'],
      ['home', 'c'],
      ['other', 't2'],
    ]);
    expect(needs[0]).toMatchObject({ pageTitle: 'Home', part: 'Table of records', text: 'needs a table' });
    expect(needs[1]).toMatchObject({ part: 'Checklist', text: 'needs a yes or no field' });
  });
});

describe('entryNeedsTable', () => {
  const parts = partEntries();
  const part = (id: string) => parts.find((p) => p.id === id)!;
  const kpi = buildShowcaseEntries(seedRecords()).find((e) => e.id === 'kpi_row')!;

  it('with no context it is true for entries that draw rows', () => {
    expect(entryNeedsTable(part('DataTable'), library, null)).toBe(true);
    expect(entryNeedsTable(part('Heading'), library, null)).toBe(false);
    expect(entryNeedsTable(kpi, library, null)).toBe(true);
  });
  it('with an empty context a data part and a list feature need a table, a plain part does not', () => {
    const empty = ctxOf(noTables(), 'blank');
    expect(entryNeedsTable(part('DataTable'), library, empty)).toBe(true);
    expect(entryNeedsTable(kpi, library, empty)).toBe(true);
    expect(entryNeedsTable(part('Heading'), library, empty)).toBe(false);
  });
  it('with a fitting context nothing needs a table', () => {
    const ctx = ctxOf(specOf(), 'home');
    expect(entryNeedsTable(part('DataTable'), library, ctx)).toBe(false);
    expect(entryNeedsTable(kpi, library, ctx)).toBe(false);
  });
});

describe('newer version (P17-26)', () => {
  const lib: FeatureLibrary = new Map([['kpi_row', { ...library.get('kpi_row')!, version: 3 }]]);
  const block = (id: string, version: number, featureId = 'kpi_row'): LayoutLayer => ({ ...layer(id, 'Section', {}, []), feature: { id: featureId, version, params: {} } });

  it('is true for a feature block saved at an older version than the library, and for nothing else', () => {
    expect(isBehind(block('a', 2), lib)).toBe(true);
    expect(isBehind(block('b', 3), lib)).toBe(false);
    expect(isBehind(block('c', 1, 'gone'), lib)).toBe(false);
    expect(isBehind(layer('d', 'Heading', {}, 'Hi'), lib)).toBe(false);
    expect(isBehind(block('e', 1), undefined)).toBe(false);
  });

  it('counts the blocks behind the library on a page, nested ones included', () => {
    const page = root(block('a', 1), layer('sec', 'Section', {}, [block('b', 2), block('c', 3)]), layer('h', 'Heading', {}, 'Hi'));
    expect(behindCount(page, lib)).toBe(2);
    expect(behindCount(root(block('c', 3)), lib)).toBe(0);
  });

  it('has the words of the pill and the plural of the page strip line', () => {
    expect(NEWER_VERSION).toBe('Newer version');
    expect(newerVersionLine(1)).toBe('1 feature on this page has a newer version.');
    expect(newerVersionLine(2)).toBe('2 features on this page have a newer version.');
  });
});
