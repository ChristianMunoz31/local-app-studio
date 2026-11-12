import { describe, expect, it } from 'vitest';
import type { AppSpec, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { connectionIssues } from '../../design/connections';
import type { DraftPage } from '../bindOnDrop';
import { FIX_ALL, canFixAll, fixAllConnections, fixAllLabel, fixAllOutcome } from '../fixAllConnections';
import type { FixAllResult } from '../fixAllConnections';
import { findLayer } from '../layoutTree';
import { pageOf, specOf } from './bindFixtures';

const spec = specOf();
const none: ReadonlySet<string> = new Set();
const page = (s: AppSpec, id: string): DraftPage => pageOf(s, id);
const part = (id: string, type: string, props: LayoutLayer['props']): LayoutLayer => ({ id, type, props, children: [] });
const root = (...children: LayoutLayer[]): LayoutLayer => ({ id: 'root', type: 'Page', props: {}, children });
const run = (s: AppSpec, pageId: string, tree: LayoutLayer, kept: ReadonlySet<string> = none) =>
  fixAllConnections(tree, { spec: s, page: page(s, pageId), takenIds: new Set(['root']), kept });
const propsOf = (tree: LayoutLayer, id: string): LayoutLayer['props'] => findLayer(tree, id)!.layer.props;
/** The same app with only the Crews table, so exactly one table fits a part. */
const oneTable = (): AppSpec =>
  specOf((i) => {
    i.tables = i.tables?.filter((t) => t.id === 'crews').map((t) => ({ ...t, fields: t.fields.filter((f) => f.id !== 'lead_id') }));
    i.pages = i.pages.filter((p) => p.id === 'home' || p.id === 'other').map((p) => ({ ...p, sources: p.id === 'other' ? p.sources : [] }));
  });
/** The saved app with a layout on a page, not validated (it may hold parts that are not connected yet). */
const withLayout = (s: AppSpec, pageId: string, layout: LayoutLayer): AppSpec => ({ ...s, pages: s.pages.map((p) => (p.id === pageId ? { ...p, layout } : p)) });

describe('fixAllConnections', () => {
  it('connects a part to the one table that fits and adds the list at the end', () => {
    const s = oneTable();
    const tree = root(part('dt', 'DataTable', { source: '' }), part('rl', 'RecordList', { source: '' }));
    const out = run(s, 'home', tree);
    expect(out.fixed).toEqual(['dt', 'rl']);
    expect(out.result.ok).toBe(true);
    expect(out.needTable).toBe(0);
    expect(out.sources.length).toBeGreaterThan(0);
    expect(out.sources.every((x) => x.table === 'crews')).toBe(true);
    expect(connectionIssues(withLayout(s, 'home', out.result.root), { pageId: 'home', layout: out.result.root, sources: out.sources })).toEqual([]);
    expect(out.result.focusId).toBe('dt');
  });

  it('leaves a part that asks (several tables fit) and counts it', () => {
    const tree = root(part('dt', 'DataTable', { source: '' }));
    const out = run(spec, 'blank', tree);
    expect(out.fixed).toEqual([]);
    expect(out.result.root).toBe(tree);
    expect(out.result.focusId).toBe('root');
    expect(out.sources).toEqual([]);
    expect(out.needTable).toBe(1);
    expect(fixAllOutcome(out)).toBe('Nothing could be connected by itself. 1 still needs a table.');
  });

  it('repoints a write part to the one table the page shows', () => {
    const tree = root(part('rf', 'RecordForm', { table: 'tasks', mode: 'create' }));
    const s = withLayout(spec, 'other', tree);
    const out = run(s, 'other', tree);
    expect(out.fixed).toEqual(['rf']);
    expect(propsOf(out.result.root, 'rf').table).toBe('crews');
    expect(out.sources).toEqual(page(s, 'other').sources);
    expect(out.otherTable).toBe(0);
  });

  it('leaves a write part when the page shows two tables', () => {
    const tree = root(part('rf', 'RecordForm', { table: 'people', mode: 'create' }));
    const s = withLayout(spec, 'home', tree);
    const out = run(s, 'home', tree);
    expect(out.fixed).toEqual([]);
    expect(out.otherTable).toBe(1);
    expect(fixAllOutcome(out)).toBe('Nothing could be connected by itself. 1 still adds to a table the page does not show.');
  });

  it('never touches a kept issue, and does not count it', () => {
    const tree = root(part('qa', 'RecordForm', { table: 'tasks', mode: 'create' }));
    const s = withLayout(spec, 'other', tree);
    const kept = new Set(['other|qa|other_table|tasks']);
    const out = run(s, 'other', tree, kept);
    expect(out.fixed).toEqual([]);
    expect(out.result.root).toBe(tree);
    expect(out.otherTable).toBe(0);
    expect(canFixAll(connectionIssues(s, { pageId: 'other', layout: tree, sources: page(s, 'other').sources }), 'other', kept)).toBe(false);
  });

  it('counts issues of other pages and leaves them alone', () => {
    const tree = root(part('dt', 'DataTable', { source: '' }));
    const s = withLayout(spec, 'blank', tree);
    const open = root(part('qa', 'RecordForm', { table: 'tasks', mode: 'create' }));
    const withOpen = withLayout(s, 'other', open);
    const out = run(withOpen, 'other', open);
    expect(out.fixed).toEqual(['qa']);
    expect(out.elsewhere).toBe(1);
    expect(fixAllOutcome(out)).toBe('Connected 1 part. 1 more is on another page.');
  });

  it('is idempotent', () => {
    const s = oneTable();
    const tree = root(part('dt', 'DataTable', { source: '' }));
    const first = run(s, 'home', tree);
    const again = fixAllConnections(first.result.root, { spec: s, page: { ...page(s, 'home'), sources: first.sources }, takenIds: new Set(['root']), kept: none });
    expect(again.fixed).toEqual([]);
    expect(again.result.root).toBe(first.result.root);
  });
});

describe('canFixAll', () => {
  const issue = (pageId: string, key: string) => ({ key, pageId }) as Parameters<typeof canFixAll>[0][number];
  it('needs an open-page issue that is not kept', () => {
    expect(canFixAll([], 'a', none)).toBe(false);
    expect(canFixAll([issue('b', 'b|x|not_connected')], 'a', none)).toBe(false);
    expect(canFixAll([issue('a', 'a|x|not_connected')], 'a', none)).toBe(true);
    expect(canFixAll([issue('a', 'a|x|not_connected')], 'a', new Set(['a|x|not_connected']))).toBe(false);
  });
});

describe('words', () => {
  const r = (over: Partial<FixAllResult>): FixAllResult => ({ result: { ok: true, root: root(), focusId: 'root' }, sources: [], fixed: [], needTable: 0, otherTable: 0, elsewhere: 0, ...over });
  it('says each part only when above zero, in order', () => {
    expect(FIX_ALL).toBe('Fix all');
    expect(fixAllOutcome(r({ fixed: ['a'] }))).toBe('Connected 1 part.');
    expect(fixAllOutcome(r({ fixed: ['a', 'b', 'c'], needTable: 1 }))).toBe('Connected 3 parts. 1 still needs a table.');
    expect(fixAllOutcome(r({ needTable: 2 }))).toBe('Nothing could be connected by itself. 2 still need a table.');
    expect(fixAllOutcome(r({ fixed: ['a'], needTable: 2, otherTable: 2, elsewhere: 2 }))).toBe(
      'Connected 1 part. 2 still need a table. 2 still add to a table the page does not show. 2 more are on other pages.',
    );
    expect(fixAllOutcome(r({ otherTable: 1, elsewhere: 1 }))).toBe('Nothing could be connected by itself. 1 still adds to a table the page does not show. 1 more is on another page.');
    expect(fixAllOutcome(r({}))).toBe('Nothing could be connected by itself.');
  });
  it('labels the Undo step', () => {
    expect(fixAllLabel(1)).toBe('connected 1 part');
    expect(fixAllLabel(3)).toBe('connected 3 parts');
  });
});
