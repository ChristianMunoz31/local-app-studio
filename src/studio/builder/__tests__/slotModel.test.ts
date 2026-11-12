import { describe, expect, it } from 'vitest';
import { validateFeatureInput } from '@/catalog/features';
import type { LayoutLayer, Table } from '@local-app-studio/runtime/spec/schema';
import type { HostDoc } from '../../design/DesignSession';
import { planDrop, withPageSources } from '../../lib/bindOnDrop';
import { pairedParams } from '../../lib/featureParams';
import type { Source } from '../../lib/bindOnDrop';
import { layerIds } from '../../lib/layout';
import { insertLayer } from '../../lib/layoutTree';
import { emptyBench, slotTable } from '../bench';
import type { PanelState } from '../bench';
import { builderSlots, featureInputOf, fragmentOf, paramCount, settingCount } from '../slotModel';
import { layer, seedLibrary } from './benchFixtures';

const none: PanelState = { textOn: new Set(), labels: {} };

/** A bench document with the parts dropped in order, each through the normal drop planner (what a drop on the canvas does). */
function dropped(types: string[], tables: Table[], extra: LayoutLayer[] = []): HostDoc {
  let root: LayoutLayer = layer('root_feature', 'Page', {}, [...extra]);
  let sources: Source[] = [];
  for (const type of types) {
    const spec = withPageSources({ ...emptyBench(), tables }, 'feature', sources);
    const plan = planDrop(type, spec, { id: 'feature', title: 'Your feature', route: '/', sources }, layerIds(root));
    if (plan.kind === 'refused') throw new Error(plan.refusal);
    const at = { parentId: root.id, index: Array.isArray(root.children) ? root.children.length : 0 };
    const result = insertLayer(root, at, plan.layer);
    if (!result.ok) throw new Error(result.message);
    root = result.root;
    sources = plan.sources;
  }
  return { root, sources, tables };
}

const library = seedLibrary();
const crews = (): Table => slotTable('Crews', 'crews', [], new Set());
const tasks = (): Table => slotTable('Tasks', 'tasks', [], new Set());
const save = (doc: HostDoc, state: PanelState = none) => featureInputOf({ doc, library, state, id: 'my_feature', name: 'My feature', line: 'Shows crews.' });

describe('builderSlots', () => {
  it('gives one table slot, saved as a list setting and a table setting, for a Table of records and a Quick add on one bench table', () => {
    const doc = dropped(['DataTable', 'QuickAdd'], [crews()]);
    const rows = builderSlots(doc, emptyBench(), library, none);
    const tableRows = rows.filter((r) => r.kind === 'table');
    expect(tableRows).toHaveLength(1);
    expect(tableRows[0]).toMatchObject({ key: 'table|crews', heading: 'Table this feature shows', label: 'Crews', tableId: 'crews', sample: 'crews', on: true });
    expect(tableRows[0].uses).toEqual(['Table of records', 'Quick add']);
    const input = save(doc);
    // The list, the table (Quick add takes the table itself) and the one text field Quick add writes to: three params, but the list
    // and the table are one thing people fill in (P17-06), so the count line says 2 and the limit still counts the 3.
    expect(paramCount(doc, library, none)).toBe(3);
    expect(settingCount(doc, library, none)).toBe(2);
    expect(input.params.map((p) => [p.type, p.label]).sort()).toEqual([
      ['field', 'Name'],
      ['source', 'Crews list'],
      ['table', 'Crews'],
    ]);
    expect(validateFeatureInput(input, library).ok).toBe(true);
  });

  it('says a table slot that no part uses is not used, and saves nothing for it', () => {
    const doc = dropped(['Heading'].filter(() => false), [crews()], [layer('h1', 'Heading', { size: 'lg' }, 'Welcome')]);
    const rows = builderSlots(doc, emptyBench(), library, none);
    expect(rows.find((r) => r.kind === 'table')?.uses).toEqual([]);
    expect(save(doc).params).toEqual([]);
  });

  it('makes a field slot of a Chart group field and names the heading by it', () => {
    const doc = dropped(['Chart'], [tasks()]);
    const rows = builderSlots(doc, emptyBench(), library, none);
    const groups = rows.filter((r) => r.heading === 'Field it groups by');
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: 'field', label: 'Status', tableId: 'tasks', fieldId: 'status' });
    const field = save(doc).params.find((p) => p.type === 'field');
    expect(field).toMatchObject({ label: 'Status' });
    expect(field?.fieldTypes).toContain('select');
    expect(validateFeatureInput(save(doc), library).ok).toBe(true);
  });

  it('makes a field slot of any other field a part uses, under Field it uses', () => {
    const doc = dropped(['Checklist'], [tasks()]);
    const rows = builderSlots(doc, emptyBench(), library, none);
    expect(rows.some((r) => r.kind === 'field' && r.heading === 'Field it uses')).toBe(true);
    expect(validateFeatureInput(save(doc), library).ok).toBe(true);
  });

  it('makes a page slot of a Button that goes to a page', () => {
    const doc = dropped(['Button'], []);
    const rows = builderSlots(doc, emptyBench(), library, none);
    const pages = rows.filter((r) => r.kind === 'page');
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ heading: 'Page it opens', label: 'Page it opens', on: true });
    expect(save(doc).params.find((p) => p.type === 'page')?.label).toBe('Page it opens');
    expect(validateFeatureInput(save(doc), library).ok).toBe(true);
  });

  it('makes a text slot only when it is ticked, and names it from the page words or the label typed', () => {
    const doc = dropped([], [], [layer('h1', 'Heading', { size: 'lg' }, 'Welcome')]);
    const off = builderSlots(doc, emptyBench(), library, none).find((r) => r.kind === 'text');
    expect(off).toMatchObject({ heading: 'Words you can change', label: 'Welcome', on: false });
    expect(settingCount(doc, library, none)).toBe(0);
    expect(save(doc).params).toEqual([]);
    const ticked: PanelState = { textOn: new Set([off?.key ?? '']), labels: {} };
    expect(settingCount(doc, library, ticked)).toBe(1);
    expect(save(doc, ticked).params).toEqual([{ name: 'welcome', label: 'Welcome', type: 'text' }]);
    const named: PanelState = { textOn: ticked.textOn, labels: { [off?.key ?? '']: '  The title  ' } };
    expect(save(doc, named).params[0].label).toBe('The title');
    expect(validateFeatureInput(save(doc, named), library).ok).toBe(true);
  });

  it('keeps a text slot ticked and named when its words are edited (the panel is keyed by use, not by words)', () => {
    const before = dropped([], [], [layer('h1', 'Heading', { size: 'lg' }, 'Welcome')]);
    const row = builderSlots(before, emptyBench(), library, none).find((r) => r.kind === 'text');
    const state: PanelState = { textOn: new Set([row?.key ?? '']), labels: { [row?.key ?? '']: 'The title' } };
    const after = dropped([], [], [layer('h1', 'Heading', { size: 'lg' }, 'Hello there')]);
    const next = builderSlots(after, emptyBench(), library, state).find((r) => r.kind === 'text');
    expect(next).toMatchObject({ key: row?.key, on: true, label: 'The title' });
    expect(settingCount(after, library, state)).toBe(1);
    expect(save(after, state).params).toEqual([{ name: 'the_title', label: 'The title', type: 'text' }]);
  });

  it('finds a stored tick and label under any use of the group, not only the first', () => {
    const doc = dropped([], [], [layer('h1', 'Heading', { size: 'lg' }, 'Welcome'), layer('h2', 'Heading', { size: 'lg' }, 'Welcome')]);
    const row = builderSlots(doc, emptyBench(), library, none).find((r) => r.kind === 'text');
    expect(row).toBeDefined();
    const second = `use|h2|children`;
    const state: PanelState = { textOn: new Set([second]), labels: { [second]: 'The title' } };
    const found = builderSlots(doc, emptyBench(), library, state).find((r) => r.kind === 'text');
    expect(found).toMatchObject({ key: second, on: true, label: 'The title' });
    expect(settingCount(doc, library, state)).toBe(1);
  });

  it('orders the groups: tables, fields it groups by, fields it uses, pages, words', () => {
    const doc = dropped(['Chart', 'Button'], [tasks()], [layer('h1', 'Heading', { size: 'lg' }, 'Welcome')]);
    const rows = builderSlots(doc, emptyBench(), library, none);
    const order = rows.map((r) => r.heading);
    const rank = ['Table this feature shows', 'Field it groups by', 'Field it uses', 'Page it opens', 'Words you can change'];
    expect(order.map((h) => rank.indexOf(h))).toEqual([...order.map((h) => rank.indexOf(h))].sort((a, b) => a - b));
  });
});

describe('settingCount', () => {
  it('counts every setting the save would have', () => {
    expect(settingCount(dropped(['Checklist'], [tasks()]), library, none)).toBe(save(dropped(['Checklist'], [tasks()])).params.length);
  });

  it('counts a table and the list of the same table once, so the count line matches the rows people fill in', () => {
    const doc = dropped(['DataTable', 'QuickAdd'], [crews()]);
    const rows = builderSlots(doc, emptyBench(), library, none).filter((r) => r.kind === 'table' || r.kind === 'field');
    expect(settingCount(doc, library, none)).toBe(rows.length);
    expect(paramCount(doc, library, none)).toBe(save(doc).params.length);
  });

  it('counts a list with no table setting beside it as its own thing', () => {
    const chartOnly = dropped(['Chart'], [tasks()]);
    expect(settingCount(chartOnly, library, none)).toBe(paramCount(chartOnly, library, none));
  });
});

describe('fragmentOf', () => {
  it('is the only child of the page', () => {
    const only = layer('a', 'Section');
    expect(fragmentOf(layer('root', 'Page', {}, [only]))).toBe(only);
  });

  it('is a Section holding every child when there are several, with an id no part uses', () => {
    const root = layer('root', 'Page', {}, [layer('section_1', 'Heading', {}, 'A'), layer('b', 'Heading', {}, 'B')]);
    const fragment = fragmentOf(root);
    expect(fragment).toMatchObject({ type: 'Section', props: {} });
    expect(fragment.id).not.toBe('section_1');
    expect(Array.isArray(fragment.children) && fragment.children.map((c) => c.id)).toEqual(['section_1', 'b']);
  });

  it('keeps a saved feature block a block, inside a Section', () => {
    const block: LayoutLayer = { ...layer('k', 'Section'), feature: { id: 'kpi_row', version: 1, params: {} } };
    expect(fragmentOf(layer('root', 'Page', {}, [block])).type).toBe('Section');
  });
});

describe('a long table name (phase 17 round 2, L6)', () => {
  it('keeps the list ending and still pairs the list with its table', () => {
    const long = slotTable('X'.repeat(60), 'crews', [], new Set());
    const input = save(dropped(['DataTable', 'QuickAdd'], [long]));
    const list = input.params.find((p) => p.type === 'source');
    expect(list?.label.endsWith(' list')).toBe(true);
    expect(list?.label.length).toBeLessThanOrEqual(40);
    expect(pairedParams(input)).toHaveLength(1);
  });
});
