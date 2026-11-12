import { describe, expect, it } from 'vitest';
import { SEED_FEATURES, expandFeature, validateFeatureInput } from '@/catalog/features';
import type { FeatureLibrary } from '@/catalog/features';
import { crewCtx, exampleCtx } from '@/catalog/__tests__/fixtures';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { buildFeatureInput, defaultChoices, featureFileOf, latestValues, missingLabels, optionWords, dropUnusedLists, optionsFor, settleOnFirstTable, settleValues, slotGroups, valuesOf, withDefaults } from '../featureFromSelection';
import { autoValues } from '../layoutTree';
import { pairedParams, pickField, shownParams, textDefault } from '../featureParams';
import { boardDef } from './boardFeature';
import type { FeatureRecord } from '../../types';

const layer = (id: string, type: string, props: LayoutLayer['props'] = {}, children: LayoutLayer['children'] = []): LayoutLayer => ({ id, type, props, children });
const lib: FeatureLibrary = new Map(SEED_FEATURES.map((d) => [d.id, d]));
const empty: FeatureLibrary = new Map();

const selection = (): LayoutLayer =>
  layer('sec', 'Section', { title: 'Crews' }, [
    layer('a', 'StatCard', { source: 'open_crews', stat: 'count', label: 'Crews' }),
    layer('b', 'StatCard', { source: 'open_crews', stat: 'sum', field: 'size', label: 'People' }),
    layer('t', 'DataTable', { source: 'open_crews', columns: ['name', 'size'], rowAction: { action: 'navigate', pageId: 'home', withRecord: false } }),
  ]);

const choicesFor = (sel: LayoutLayer, lb: FeatureLibrary) => {
  const { groups } = slotGroups(sel, lb);
  const all = defaultChoices(groups, lb);
  const forced = all.params.filter((p) => groups.find((g) => g.key === p.group)?.forced);
  return { groups, all, choices: { ...all, id: 'crew_numbers', label: 'Crew numbers', description: 'Counts crews.', params: forced } };
};

describe('slotGroups', () => {
  it('merges equal values and forces ids and fields', () => {
    const { groups, droppedLists } = slotGroups(selection(), empty);
    const source = groups.find((g) => g.kind === 'source');
    expect(source?.uses).toHaveLength(3);
    expect(source?.forced).toBe(true);
    expect(groups.find((g) => g.kind === 'field')?.of).toBe(source?.key);
    expect(groups.find((g) => g.kind === 'page')?.value).toBe('home');
    expect(groups.find((g) => g.kind === 'text' && g.value === 'Crews')?.forced).toBe(false);
    expect(droppedLists).toEqual([{ layer: 't', target: 'props.columns' }]);
  });

  it('keeps the required fields list of a SearchBox as field slots', () => {
    const { groups, droppedLists } = slotGroups(layer('s', 'SearchBox', { source: 'open_crews', fields: ['name'] }), empty);
    expect(droppedLists).toEqual([]);
    expect(groups.find((g) => g.kind === 'field')?.uses[0].target).toBe('props.fields.0');
  });

  it('turns an expanded block into a Feature node whose params join the groups', () => {
    const block = expandFeature(lib.get('kpi_row')!, { source: 'open_crews', amount: 'size', title: 'Size' }, crewCtx(), lib, { rootId: 'blk' });
    expect(block.ok).toBe(true);
    if (!block.ok) return;
    const { groups } = slotGroups(layer('wrap', 'Section', {}, [block.value]), lib);
    expect(groups.some((g) => g.kind === 'source' && g.uses[0].target === 'props.params.source')).toBe(true);
  });
});

describe('buildFeatureInput', () => {
  it('builds a record the library accepts, without ids of the source app', () => {
    const { groups, choices } = choicesFor(selection(), empty);
    const input = buildFeatureInput(selection(), choices, empty);
    expect(input.params.map((p) => p.type).sort()).toEqual(['field', 'page', 'source']);
    expect(JSON.stringify(input.fragment)).not.toContain('open_crews');
    expect(JSON.stringify(input.fragment)).not.toContain('columns');
    const checked = validateFeatureInput(input, empty);
    expect(checked.ok).toBe(true);
    expect(valuesOf(groups, choices).list).toBe('open_crews');
  });

  it('makes a ticked text a setting', () => {
    const { groups, all, choices } = choicesFor(selection(), empty);
    const text = groups.find((g) => g.kind === 'text' && g.value === 'Crews')!;
    const extra = all.params.find((p) => p.group === text.key)!;
    const input = buildFeatureInput(selection(), { ...choices, params: [...choices.params, extra] }, empty);
    expect(input.params.some((p) => p.type === 'text')).toBe(true);
    expect(validateFeatureInput(input, empty).ok).toBe(true);
  });

  it('stores an inner block by reference', () => {
    const block = expandFeature(lib.get('kpi_row')!, { source: 'open_crews', amount: 'size', title: 'Size' }, crewCtx(), lib, { rootId: 'blk' });
    if (!block.ok) throw new Error('expand failed');
    const sel = layer('wrap', 'Section', {}, [block.value]);
    const { choices } = choicesFor(sel, lib);
    const input = buildFeatureInput(sel, choices, lib);
    const inner = (input.fragment.children as LayoutLayer[])[0];
    expect(inner.type).toBe('Feature');
    expect(inner.props.featureId).toBe('kpi_row');
    expect(validateFeatureInput(input, lib).ok).toBe(true);
  });
});

describe('settings form helpers', () => {
  const def = lib.get('kpi_row')!;
  it('offers the lists of the page and the fields of the table behind them', () => {
    const values = withDefaults(def, crewCtx(), {});
    expect(values.source).toBe('open_crews');
    expect(values.amount).toBe('size');
    expect(optionsFor(def, def.params[1], crewCtx(), values)).toEqual(['size']);
    expect(optionsFor(def, def.params[2], crewCtx(), values)).toBeNull();
    expect(missingLabels(def, values)).toEqual(['Title']);
  });

  it('drops a value that no longer fits', () => {
    expect(withDefaults(def, crewCtx(), { source: 'gone', title: 'x' }).source).toBe('open_crews');
  });
});

describe('featureFileOf', () => {
  const record = (id: string, fragment: LayoutLayer | null, ok = true): FeatureRecord => ({
    id,
    label: id,
    description: 'd',
    version: 1,
    updatedAt: '',
    createdAt: '',
    params: [],
    fragment,
    bindings: [],
    ok,
    issues: [],
    usedBy: { apps: [], features: [] },
  });
  it('lists dependencies first', () => {
    const outer = record('outer', layer('s', 'Section', {}, [layer('n', 'Feature', { featureId: 'inner', params: {} })]));
    const inner = record('inner', layer('h', 'Heading', {}, 'Hi'));
    const file = featureFileOf('outer', [outer, inner]);
    expect(file?.format).toBe('local-app-studio-feature');
    expect(file?.includes.map((f) => f.id)).toEqual(['inner']);
    expect(file?.feature.id).toBe('outer');
  });
  it('refuses a broken record', () => {
    expect(featureFileOf('x', [record('x', null, false)])).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Phase 17: one slot is one choice (P17-06), the first field (P17-10), the words (P17-11), Update to latest (P17-07), names (P17-08)
// ---------------------------------------------------------------------------------------------

describe('pairedParams', () => {
  it('pairs the list setting "X list" with the table setting "X" and shows the table only', () => {
    const def = boardDef();
    expect(pairedParams(def).map((p) => [p.table.name, p.list.name])).toEqual([['things', 'things_list']]);
    expect(shownParams(def).map((p) => p.name)).toEqual(['things', 'status', 'title_field', 'board_title']);
  });

  it('does not pair a lone table setting with a lone list setting whose labels are not one slot', () => {
    const lone = { params: [{ name: 'a', label: 'Projects', type: 'table' as const }, { name: 'b', label: 'Tasks list', type: 'source' as const, mode: 'list' as const }] };
    expect(pairedParams(lone)).toEqual([]);
    expect(shownParams(lone)).toHaveLength(2);
  });

  it('leaves unmatched settings apart', () => {
    const apart = {
      params: [
        { name: 'a', label: 'Crews', type: 'table' as const },
        { name: 'b', label: 'Tasks', type: 'table' as const },
        { name: 'c', label: 'Open list', type: 'source' as const, mode: 'list' as const },
      ],
    };
    expect(pairedParams(apart)).toEqual([]);
    expect(shownParams(apart)).toHaveLength(3);
  });
});

describe('settleValues', () => {
  const ctx = exampleCtx();

  it('settles the list first and the table follows it, with every field on the same table', () => {
    const { values, made } = settleValues(boardDef(), ctx, {});
    expect(values).toMatchObject({ things_list: 'open_crews', things: 'crews', status: 'status', title_field: 'name' });
    expect(made).toEqual([]);
  });

  it("puts a block whose list and table disagree on the list's table", () => {
    const { values } = settleValues(boardDef(), ctx, { things: 'people', things_list: 'open_tasks' });
    expect(values).toMatchObject({ things: 'tasks', things_list: 'open_tasks' });
  });

  it('follows a table the person picks to a list of that table on the page', () => {
    const { values, made } = settleValues(boardDef(), ctx, { things: 'tasks', things_list: 'open_crews' }, 'things');
    expect(values).toMatchObject({ things: 'tasks', things_list: 'open_tasks', status: 'done' });
    expect(made).toEqual([]);
  });

  it('makes a list with newSourceFor when the page has none for the table, and the fields come from that table', () => {
    const { values, made, ctx: next } = settleValues(boardDef(), ctx, { things: 'people', things_list: 'open_crews' }, 'things');
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ id: 'people', table: 'people', mode: 'list', where: [], orderBy: [] });
    expect(values).toMatchObject({ things: 'people', things_list: 'people', status: '', title_field: 'name' });
    expect(next.sources.people).toEqual({ table: 'people', mode: 'list' });
    // Settling again with the made list in the values gives the same answer and the same new list.
    expect(settleValues(boardDef(), ctx, values, 'things').made).toEqual(made);
  });

  it('keeps the two slots of a feature independent: a Tasks list and a Projects table are not forced onto one table', () => {
    const twoSlots = {
      params: [
        { name: 'tasks_list', label: 'Tasks list', type: 'source' as const, mode: 'list' as const },
        { name: 'projects', label: 'Projects', type: 'table' as const },
      ],
    };
    const picked = { tasks_list: 'open_tasks', projects: 'people' };
    const settled = settleValues(twoSlots, ctx, picked, 'projects');
    expect(settled.values).toEqual(picked);
    expect(settled.made).toEqual([]);
    expect(latestValues(twoSlots, ctx, picked).values).toEqual(picked);
    expect(withDefaults(twoSlots, ctx, picked)).toEqual(picked);
  });

  it('keeps withDefaults the same as its values', () => {
    expect(withDefaults(boardDef(), ctx, {})).toEqual(settleValues(boardDef(), ctx, {}).values);
  });
});

describe('settleOnFirstTable (B-11)', () => {
  const ctx = exampleCtx();
  const noLists = { ...ctx, sourceIds: [], sources: {} };

  it('takes the first table and makes the list the page lacks, so "This page gets a list of X" applies', () => {
    expect(autoValues(boardDef(), noLists)).toBeNull();
    const settled = settleOnFirstTable(boardDef(), noLists);
    expect(settled).not.toBeNull();
    expect(settled?.values).toMatchObject({ things: 'crews', things_list: 'crews', status: 'status', title_field: 'name' });
    expect(settled?.made).toHaveLength(1);
    expect(settled?.made[0]).toMatchObject({ table: 'crews', mode: 'list' });
    expect(settled?.ctx.sources.crews).toEqual({ table: 'crews', mode: 'list' });
  });

  it('skips a table the settings do not fit and takes the first one they do (the root of the null after the merge)', () => {
    const people = noLists.fields.people;
    expect(noLists.tableIds[0]).toBe('people');
    expect(people.some((f) => f.type === 'select')).toBe(false);
    expect(settleOnFirstTable(boardDef(), noLists)?.values.things).toBe('crews');
  });

  it('gives a field setting a field of the table, never one the table lacks (T-13)', () => {
    const lessons = { ...noLists, tableIds: ['lessons'], fields: { lessons: [{ id: 'notes', type: 'text' as const }, { id: 'status', type: 'select' as const }] } };
    const settled = settleOnFirstTable(boardDef(), lessons);
    expect(settled?.values).toMatchObject({ things: 'lessons', status: 'status', title_field: 'notes' });
    const noText = { ...lessons, fields: { lessons: [{ id: 'status', type: 'select' as const }] } };
    expect(settleValues(boardDef(), noText, {}).values.title_field).toBe('');
    expect(settleOnFirstTable(boardDef(), noText)).toBeNull();
  });

  it('tries the table named like the feature first, then the first that fits (L-15)', () => {
    const one = { params: [{ name: 'things', label: 'Maintenance', type: 'table' as const }] };
    const two = { ...noLists, tableIds: ['units', 'repairs'] };
    const words = { tables: [{ id: 'units', label: 'Units', fields: [] }, { id: 'repairs', label: 'Maintenance', fields: [] }], pages: [] };
    expect(settleOnFirstTable(one, two)?.values.things).toBe('units');
    expect(settleOnFirstTable(one, two, 'Repair log', words)?.values.things).toBe('repairs');
    expect(settleOnFirstTable({ params: [{ name: 'things', label: 'Things', type: 'table' as const }] }, two, 'Repair log', words)?.values.things).toBe('repairs');
    expect(settleOnFirstTable({ params: [{ name: 'things', label: 'Things', type: 'table' as const }] }, two, 'Nothing like it', words)?.values.things).toBe('units');
  });

  it('says null when the app has no table, so New table opens', () => {
    expect(settleOnFirstTable(boardDef(), { ...noLists, tableIds: [] })).toBeNull();
  });
});

describe('dropUnusedLists (L-15)', () => {
  const src = (id: string) => ({ id, table: id, mode: 'list' as const, where: [], orderBy: [], limit: 50 });
  const root = layer('r', 'Page', {}, [layer('t', 'DataTable', { source: 'repairs' })]);

  it('drops an added list nothing reads and keeps the rest', () => {
    const out = dropUnusedLists([src('units'), src('repairs'), src('mine')], new Set(['units', 'repairs']), root);
    expect(out.sources.map((s) => s.id)).toEqual(['repairs', 'mine']);
    expect(out.gone).toEqual(['units']);
  });

  it('changes nothing when no list was added', () => {
    expect(dropUnusedLists([src('units')], new Set(), root)).toEqual({ sources: [src('units')], gone: [] });
  });
});

describe('pickField', () => {
  const fields = [
    { id: 'lead_id', type: 'reference' },
    { id: 'due', type: 'date' },
    { id: 'done', type: 'boolean' },
    { id: 'status', type: 'select' },
    { id: 'created_at', type: 'datetime' },
  ];
  const ids = fields.map((f) => f.id);
  const p = { name: 'group', label: 'Group' };

  it('prefers the field named like the setting, then a choice, a yes or no, a date, a link', () => {
    expect(pickField({ name: 'x', label: 'Due' }, ids, fields)).toBe('due');
    expect(pickField(p, ids, fields)).toBe('status');
    expect(pickField(p, ['lead_id', 'due', 'done'], fields)).toBe('done');
    expect(pickField(p, ['lead_id', 'due'], fields)).toBe('due');
    expect(pickField(p, ['lead_id'], fields)).toBe('lead_id');
  });

  it('takes Created and Updated only when nothing else fits, and nothing when there is nothing', () => {
    expect(pickField(p, ['created_at', 'lead_id'], fields)).toBe('lead_id');
    expect(pickField(p, ['created_at'], fields)).toBe('created_at');
    expect(pickField(p, [], fields)).toBeUndefined();
  });

  it('starts a groups-by setting on a choice field, not the first field of the table (a link)', () => {
    expect(settleValues(boardDef(), exampleCtx(), {}).values.status).toBe('status');
  });
});

describe('textDefault', () => {
  it("reads the words the feature holds, else the setting's label", () => {
    const def = boardDef();
    expect(textDefault(def, def.params[4])).toBe('Status board');
    expect(textDefault({ params: def.params }, def.params[4])).toBe('Board title');
    expect(textDefault({ ...def, bindings: [] }, def.params[4])).toBe('Board title');
  });
});

describe('latestValues', () => {
  it("drops settings that are gone, keeps values that fit and fills a new words setting with the feature's own words", () => {
    const v2 = boardDef(2, true);
    const old = { things: 'crews', things_list: 'open_crews', status: 'status', title_field: 'name', board_title: 'My board', gone: 'x' };
    const { values } = latestValues(v2, exampleCtx(), old);
    expect(values).toEqual({ things: 'crews', things_list: 'open_crews', status: 'status', title_field: 'name', board_title: 'My board', chart_title: 'Things to track by Status' });
  });

  it('fills a new table or field setting with the defaults of a new block', () => {
    const { values } = latestValues(boardDef(), exampleCtx(), { board_title: 'Kept' });
    expect(values).toMatchObject({ things: 'crews', things_list: 'open_crews', status: 'status', board_title: 'Kept' });
  });
});

describe('optionWords', () => {
  const words = {
    tables: [
      { id: 'crews', label: 'Crews', fields: [{ id: 'name', label: 'Name' }, { id: 'status', label: 'Status' }] },
      { id: 'tasks', label: 'Tasks', fields: [{ id: 'title', label: 'Title' }] },
    ],
    pages: [{ id: 'home', title: 'Home' }],
  };
  const def = boardDef();
  const ctx = exampleCtx();

  it('names tables, pages and fields the way the app does, Created and Updated included', () => {
    expect(optionWords(def, def.params[0], ['crews', 'tasks'], ctx, {}, words)).toEqual(['Crews', 'Tasks']);
    const page = { name: 'p', label: 'P', type: 'page' as const };
    expect(optionWords({ params: [page] }, page, ['home'], ctx, {}, words)).toEqual(['Home']);
    const values = { things: 'crews', things_list: 'open_crews' };
    expect(optionWords(def, def.params[2], ['status', 'created_at', 'updated_at'], ctx, values, words)).toEqual(['Status', 'Created', 'Updated']);
  });

  it('names a list by its table, numbers two with the same words, and falls back to the id without words', () => {
    expect(optionWords(def, def.params[1], ['open_crews', 'open_tasks'], ctx, {}, words)).toEqual(['Crews', 'Tasks']);
    expect(optionWords(def, def.params[0], ['crews', 'crews'], ctx, {}, words)).toEqual(['Crews', 'Crews 2']);
    expect(optionWords(def, def.params[0], ['crews'], ctx, {}, undefined)).toEqual(['crews']);
  });
});

