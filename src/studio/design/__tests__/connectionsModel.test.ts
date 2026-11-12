import { describe, expect, it } from 'vitest';
import { partContextFor } from '@/catalog/validateLayout';
import type { AppSpec, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { specOf } from '../../lib/__tests__/bindFixtures';
import { NOT_CONNECTED, newSourceFor } from '../../lib/bindOnDrop';
import { connectionIssues, connectionOf } from '../connections';

const layer = (id: string, type: string, props: LayoutLayer['props'], children: LayoutLayer['children'] = []): LayoutLayer => ({ id, type, props, children });
const root = (...children: LayoutLayer[]): LayoutLayer => layer('root', 'Page', {}, children);

function withLayout(pageId: string, layout: LayoutLayer, edit: (s: AppSpec) => AppSpec = (s) => s): AppSpec {
  const s = specOf();
  return edit({ ...s, pages: s.pages.map((p) => (p.id === pageId ? { ...p, layout } : p)) });
}
const ctxFor = (s: AppSpec, pageId: string) => partContextFor(s, s.pages.find((p) => p.id === pageId)!);

describe('connectionOf', () => {
  const spec = specOf();
  const home = ctxFor(spec, 'home');
  const crew = ctxFor(spec, 'crew');

  it('a list part is connected with the table and "shows records"', () => {
    const c = connectionOf(layer('t', 'DataTable', { source: 'all_crews' }), home, spec);
    expect(c).toEqual({ state: 'connected', table: 'crews', tableLabel: 'Crews', mode: 'shows records' });
  });
  it('a record source reads "one record"', () => {
    const c = connectionOf(layer('d', 'RecordDetail', { source: 'one_crew' }), crew, spec);
    expect(c).toMatchObject({ state: 'connected', mode: 'one record' });
  });
  it('a Quick add or a Form with a table adds records', () => {
    expect(connectionOf(layer('q', 'QuickAdd', { table: 'crews', field: 'name' }), home, spec)).toMatchObject({ mode: 'adds records', tableLabel: 'Crews' });
    expect(connectionOf(layer('f', 'RecordForm', { table: 'people' }), home, spec)).toMatchObject({ mode: 'adds records', table: 'people' });
  });
  it('a Form with a record source edits this record', () => {
    const c = connectionOf(layer('f', 'RecordForm', { table: 'crews', source: 'one_crew', mode: 'edit' }), crew, spec);
    expect(c).toMatchObject({ state: 'connected', mode: 'edits this record', table: 'crews' });
  });
  it('an empty or unknown value is not connected, with the target of the prop', () => {
    expect(connectionOf(layer('t', 'DataTable', { source: NOT_CONNECTED }), home, spec)).toEqual({ state: 'not_connected', target: 'props.source' });
    expect(connectionOf(layer('t', 'DataTable', { source: 'gone' }), home, spec)).toEqual({ state: 'not_connected', target: 'props.source' });
    expect(connectionOf(layer('q', 'QuickAdd', { table: NOT_CONNECTED }), home, spec)).toEqual({ state: 'not_connected', target: 'props.table' });
    expect(connectionOf(layer('q', 'QuickAdd', { table: 'nope' }), home, spec)).toEqual({ state: 'not_connected', target: 'props.table' });
    expect(connectionOf(layer('q', 'QuickAdd', {}), home, spec)).toEqual({ state: 'not_connected', target: 'props.table' });
  });
  it('is null for parts with no data, a feature block and a menu SearchBox', () => {
    expect(connectionOf(layer('h', 'Heading', { size: 'lg' }, 'Hi'), home, spec)).toBeNull();
    const block: LayoutLayer = { ...layer('b', 'Section', {}, [layer('s', 'StatCard', { source: 'all_crews' })]), feature: { id: 'kpi_row', version: 1, params: {} } };
    expect(connectionOf(block, home, spec)).toBeNull();
    expect(connectionOf(layer('m', 'SearchBox', {}), home, spec)).toBeNull();
    expect(connectionOf(layer('m', 'SearchBox', { source: 'all_crews' }), home, spec)).toMatchObject({ state: 'connected' });
  });
});

describe('connectionIssues', () => {
  it('has none for a clean spec', () => {
    expect(connectionIssues(specOf(), null)).toEqual([]);
  });

  it('lists a not-connected part with the exact message and a key', () => {
    const s = withLayout('home', root(layer('t', 'DataTable', { source: NOT_CONNECTED })));
    expect(connectionIssues(s, null)).toEqual([
      {
        key: 'home|t|not_connected',
        code: 'not_connected',
        pageId: 'home',
        pageTitle: 'Home',
        layerId: 't',
        target: 'props.source',
        message: 'The Table of records on Home needs a table.',
        offer: null,
        dismissible: false,
      },
    ]);
  });

  it('appends the offer when no table fits', () => {
    const noTables = withLayout('home', root(layer('t', 'DataTable', { source: NOT_CONNECTED })), (s) => ({
      ...s,
      tables: [],
      pages: s.pages.map((p) => ({ ...p, sources: [] })),
    }));
    const [none] = connectionIssues(noTables, null);
    expect(none.offer).toEqual({ kind: 'no_table' });
    expect(none.message).toBe('The Table of records on Home needs a table.');

    const noBool = withLayout('home', root(layer('c', 'Checklist', { source: NOT_CONNECTED })), (s) => ({
      ...s,
      tables: s.tables.map((t) => ({ ...t, fields: t.fields.filter((f) => f.type !== 'boolean') })),
    }));
    const [field] = connectionIssues(noBool, null);
    expect(field.offer).toMatchObject({ kind: 'no_field', needs: [{ prop: 'field', types: ['boolean'] }] });
    expect(field.message).toBe('The Checklist on Home needs a yes or no field.');
  });

  it('flags a write part on a table the page does not show, and only dismissible', () => {
    const s = withLayout('home', root(layer('q', 'QuickAdd', { table: 'people', field: 'name' })));
    const [issue, ...rest] = connectionIssues(s, null);
    expect(rest).toEqual([]);
    expect(issue).toMatchObject({
      key: 'home|q|other_table|people',
      code: 'other_table',
      target: 'props.table',
      dismissible: true,
      message: 'The Quick add on Home adds to People, but nothing on this page shows People.',
    });
  });

  it('does not flag a write part on a page with no source, or on a table the page shows', () => {
    expect(connectionIssues(withLayout('blank', root(layer('q', 'QuickAdd', { table: 'people', field: 'name' }))), null)).toEqual([]);
    expect(connectionIssues(withLayout('home', root(layer('q', 'QuickAdd', { table: 'crews', field: 'name' }))), null)).toEqual([]);
  });

  it('does not flag a form that edits the page record', () => {
    const s = withLayout('crew', root(layer('f', 'RecordForm', { table: 'crews', source: 'one_crew', mode: 'edit' })));
    expect(connectionIssues(s, null)).toEqual([]);
  });

  it('skips feature blocks and what is inside them', () => {
    const block: LayoutLayer = { ...layer('b', 'Section', {}, [layer('t', 'DataTable', { source: NOT_CONNECTED })]), feature: { id: 'x', version: 1, params: {} } };
    expect(connectionIssues(withLayout('home', root(block)), null)).toEqual([]);
  });

  it('orders by page then tree and walks nested parts', () => {
    const nested = root(layer('sec', 'Section', {}, [layer('a', 'DataTable', { source: '' }), layer('b', 'Chart', { source: 'zzz' })]));
    let s = withLayout('other', nested);
    s = { ...s, pages: s.pages.map((p) => (p.id === 'home' ? { ...p, layout: root(layer('c', 'Checklist', { source: '' })) } : p)) };
    expect(connectionIssues(s, null).map((i) => `${i.pageId}:${i.layerId}`)).toEqual(['home:c', 'other:a', 'other:b']);
  });

  it('the draft replaces the saved layout and sources of its page', () => {
    const saved = withLayout('blank', root(layer('t', 'DataTable', { source: NOT_CONNECTED })));
    const fixed = connectionIssues(saved, { pageId: 'blank', layout: root(layer('t', 'DataTable', { source: 'crews' })), sources: [newSourceFor('crews', 'list', [])] });
    expect(fixed).toEqual([]);
    const broken = connectionIssues(specOf(), { pageId: 'blank', layout: root(layer('t', 'DataTable', { source: NOT_CONNECTED })), sources: [] });
    expect(broken.map((i) => i.key)).toEqual(['blank|t|not_connected']);
  });

  it('a draft source decides the other_table rule of its page', () => {
    const layout = root(layer('q', 'QuickAdd', { table: 'people', field: 'name' }));
    expect(connectionIssues(specOf(), { pageId: 'blank', layout, sources: [] })).toEqual([]);
    expect(connectionIssues(specOf(), { pageId: 'blank', layout, sources: [newSourceFor('crews', 'list', [])] }).map((i) => i.code)).toEqual(['other_table']);
  });
});
