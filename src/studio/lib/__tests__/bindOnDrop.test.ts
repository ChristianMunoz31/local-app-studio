import { describe, expect, it } from 'vitest';
import { checkLayer, partContextFor } from '@/catalog/validateLayout';
import type { AppSpec, AppSpecInput, Field, LayoutLayer, Table } from '@local-app-studio/runtime/spec/schema';
import {
  OFFER,
  offerWords,
  NEW_SOURCE_PREFIX,
  NOT_CONNECTED,
  MSG,
  connectLayer,
  connectToNewTable,
  connectWithNewField,
  newSourceFor,
  offerFor,
  oneRecordRefusal,
  planDrop,
  withPageSources,
} from '../bindOnDrop';
import type { ConnectChoice, DraftPage, DropPlan } from '../bindOnDrop';
import { findLayer } from '../layoutTree';
import { pageOf, specOf } from './bindFixtures';

const spec = specOf();
const none: ReadonlySet<string> = new Set();

const bound = (plan: DropPlan) => {
  if (plan.kind !== 'bound') throw new Error(`expected bound, got ${JSON.stringify(plan)}`);
  return plan;
};
const drop = (type: string, pageId: string, s: AppSpec = spec, taken: ReadonlySet<string> = none): DropPlan => planDrop(type, s, pageOf(s, pageId), taken);
const valid = (plan: DropPlan, s: AppSpec, page: DraftPage): void => {
  const p = bound(plan);
  const ctx = partContextFor(withPageSources(s, page.id, p.sources), { ...s.pages.find((x) => x.id === page.id)!, sources: p.sources });
  expect(checkLayer(p.layer, ctx, 'layer', 5)).toEqual([]);
};

/** The part the person gets after answering the chooser a plan asked (P17-14): the same build as a silent bind, through connectLayer. */
const answered = (type: string, pageId: string, choice: ConnectChoice, s: AppSpec = spec): LayoutLayer => {
  const page = pageOf(s, pageId);
  const plan = drop(type, pageId, s);
  if (plan.kind !== 'choose') throw new Error(`expected choose, got ${JSON.stringify(plan)}`);
  const root: LayoutLayer = { id: 'root', type: 'Page', props: {}, children: [plan.layer] };
  const out = connectLayer(root, plan.layer.id, choice, s, { ...page, sources: plan.sources }, none);
  if (!out.result.ok) throw new Error(out.result.message);
  const found = findLayer(out.result.root, plan.layer.id);
  if (found === null) throw new Error('part lost');
  return found.layer;
};
/** The same app with only the Crews table, so only one table fits a part (the silent bind of P17-14). */
const oneTableSpec = (): AppSpec =>
  specOf((i) => {
    i.tables = i.tables?.filter((t) => t.id === 'crews').map((t) => ({ ...t, fields: t.fields.filter((f) => f.id !== 'lead_id') }));
    i.pages = i.pages.filter((p) => p.id === 'home' || p.id === 'other').map((p) => ({ ...p, sources: p.id === 'other' ? p.sources : [] }));
  });

describe('planDrop: parts with no data bind', () => {
  it('goes straight to newPartLayer', () => {
    const p = bound(drop('Heading', 'blank'));
    expect(p.layer.type).toBe('Heading');
    expect(p.added).toBeNull();
    expect(p.sources).toEqual([]);
  });
  it('refuses a part that cannot be added on its own', () => {
    expect(drop('Page', 'home').kind).toBe('refused');
  });
});

describe('planDrop: source parts', () => {
  it('P17-14: a DataTable on a page that lists a table asks which table when other tables fit', () => {
    const p = drop('DataTable', 'home');
    expect(p).toMatchObject({ kind: 'choose', target: 'props.source' });
    if (p.kind === 'choose') expect(p.layer.props.source).toBe(NOT_CONNECTED);
    expect(drop('DataTable', 'other').kind).toBe('choose');
  });
  it('P17-14: answering the chooser with the page list binds it like the silent bind did', () => {
    expect(answered('DataTable', 'home', { sourceId: 'all_crews' }).props.source).toBe('all_crews');
  });
  it('P17-14: a DataTable on a page that lists the only table that fits still binds silently', () => {
    const s = oneTableSpec();
    const p = bound(drop('DataTable', 'other', s));
    expect(p.layer.props.source).toBe('crews_list');
    expect(p.added).toBeNull();
    valid(drop('DataTable', 'other', s), s, pageOf(s, 'other'));
  });
  it('B4: Timeline on Home binds all_tasks on due, not Crews on created_at', () => {
    const p = bound(drop('Timeline', 'home'));
    expect(p.layer.props).toMatchObject({ source: 'all_tasks', dateField: 'due' });
  });
  it('B4: Timeline falls back to created_at when no declared date exists', () => {
    const s = specOf((i) => {
      i.tables = i.tables?.map((t) => (t.id === 'tasks' ? { ...t, fields: t.fields.filter((f) => f.id !== 'due') } : t));
    });
    expect(bound(drop('Timeline', 'home', s)).layer.props).toMatchObject({ source: 'all_crews', dateField: 'created_at' });
  });
  it('B3: DataTable on Blank with several tables is placed not connected with a chooser', () => {
    const p = drop('DataTable', 'blank');
    expect(p.kind).toBe('choose');
    if (p.kind !== 'choose') return;
    expect(p.layer.props.source).toBe(NOT_CONNECTED);
    expect(p.layer.id).toBe('datatable_1');
    expect(p.layer.children).toEqual([]);
    expect(p.target).toBe('props.source');
    expect(p.sources).toEqual([]);
  });
  it('the chooser id avoids taken ids', () => {
    const p = drop('DataTable', 'blank', spec, new Set(['datatable_1']));
    expect(p.kind === 'choose' && p.layer.id).toBe('datatable_2');
  });
  it('B3: DataTable on Blank with one table adds a page source on it', () => {
    const s = specOf((i) => {
      i.tables = i.tables?.filter((t) => t.id === 'crews').map((t) => ({ ...t, fields: t.fields.filter((f) => f.id !== 'lead_id') }));
      i.pages = i.pages.filter((p) => p.id === 'blank' || p.id === 'home').map((p) => ({ ...p, sources: [] }));
    });
    const p = bound(drop('DataTable', 'blank', s));
    expect(p.added).toMatchObject({ id: 'crews', table: 'crews', mode: 'list', where: [], orderBy: [] });
    expect(p.sources).toEqual([p.added]);
    expect(p.layer.props.source).toBe('crews');
    valid(drop('DataTable', 'blank', s), s, pageOf(s, 'blank'));
  });
  it('does not mutate its inputs', () => {
    const before = JSON.stringify(spec);
    const page = pageOf(spec, 'blank');
    planDrop('DataTable', spec, page, none);
    expect(JSON.stringify(spec)).toBe(before);
    expect(page.sources).toEqual([]);
  });
  it('B3: RecordDetail on Home refuses and names the page that opens from a list', () => {
    const named = 'This part shows one record. Open the page Crew (it opens from a list) and add it there.';
    expect(oneRecordRefusal(spec)).toBe(named);
    expect(drop('RecordDetail', 'home')).toEqual({ kind: 'refused', refusal: named });
    expect(drop('RecordDetail', 'blank')).toEqual({ kind: 'refused', refusal: named });
  });
  it('B3: RecordDetail with no record page in the app says how to make one', () => {
    const s = specOf((i) => {
      i.pages = i.pages.filter((p) => p.id !== 'crew');
    });
    expect(drop('RecordDetail', 'home', s)).toEqual({
      kind: 'refused',
      refusal: MSG.oneRecordHere,
    });
  });
  it('RecordDetail on a record page binds the record source', () => {
    expect(bound(drop('RecordDetail', 'crew')).layer.props.source).toBe('one_crew');
  });
  it('B3: RecordDetail on a record page with no record source and one table adds a record source', () => {
    const s = specOf((i) => {
      i.tables = i.tables?.filter((t) => t.id === 'people');
      i.pages = i.pages.filter((p) => p.id === 'crew' || p.id === 'home').map((p) => ({ ...p, sources: [] }));
    });
    const p = bound(drop('RecordDetail', 'crew', s));
    expect(p.added).toMatchObject({ id: 'people', table: 'people', mode: 'record' });
    expect(p.layer.props.source).toBe('people');
    valid(drop('RecordDetail', 'crew', s), s, pageOf(s, 'crew'));
  });
  it('RecordDetail on a record page with several tables asks', () => {
    const s = specOf((i) => {
      i.pages = i.pages.map((p) => (p.id === 'crew' ? { ...p, sources: [] } : p));
    });
    expect(drop('RecordDetail', 'crew', s).kind).toBe('choose');
  });
  it('offers Add a field when no table has the field the part needs', () => {
    const noBool = specOf((i) => {
      i.tables = i.tables?.map((t) => ({ ...t, fields: t.fields.filter((f) => f.type !== 'boolean') }));
    });
    const plan = drop('Checklist', 'blank', noBool);
    expect(plan).toMatchObject({
      kind: 'offer',
      target: 'props.source',
      sources: [],
      offer: { kind: 'no_field', needs: [{ prop: 'field', types: ['boolean'] }], tables: ['people', 'crews', 'tasks'] },
    });
    if (plan.kind === 'offer') {
      expect(plan.layer.props.source).toBe(NOT_CONNECTED);
      expect(plan.layer.id).toBe('checklist_1');
    }
  });
  it('leaves a table with 60 fields out of the Add a field tables', () => {
    const full = specOf((i) => {
      i.tables = [
        { id: 'items_list', label: 'Items', titleField: 'name', fields: Array.from({ length: 60 }, (_, n) => ({ id: n === 0 ? 'name' : `f${n}`, label: n === 0 ? 'Name' : `F ${n}`, type: 'text' as const })) },
        { id: 'boats', label: 'Boats', titleField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text' as const }] },
      ];
      i.pages = i.pages.map((p) => ({ ...p, sources: [] }));
    });
    const plan = drop('Checklist', 'blank', full);
    expect(plan.kind === 'offer' && plan.offer).toMatchObject({ kind: 'no_field', tables: ['boats'] });
  });
  it('offers New table on a blank app for every source part', () => {
    const blank = specOf((i) => {
      i.tables = [];
      i.pages = i.pages.map((p) => ({ ...p, sources: [] }));
    });
    for (const type of ['DataTable', 'RecordList', 'StatCard', 'Chart', 'Timeline', 'Checklist', 'ProgressBar', 'FilterBar', 'SearchBox', 'SortControl', 'ReferencePicker']) {
      const plan = drop(type, 'blank', blank);
      expect(plan, type).toMatchObject({ kind: 'offer', offer: { kind: 'no_table' }, target: 'props.source', sources: [] });
      if (plan.kind === 'offer') {
        expect(plan.layer.props.source).toBe(NOT_CONNECTED);
        expect(plan.layer.id).toBe(`${type.toLowerCase()}_1`);
      }
    }
    for (const type of ['RecordForm', 'QuickAdd']) {
      const plan = drop(type, 'blank', blank);
      expect(plan, type).toMatchObject({ kind: 'offer', offer: { kind: 'no_table' }, target: 'props.table', sources: [] });
    }
  });
  it('a page with 8 sources refuses a part that needs a new one', () => {
    const eight = Array.from({ length: 8 }, (_, n) => ({ id: `s${n}`, table: 'people', mode: 'list' as const, where: [], orderBy: [], limit: 50 }));
    const s = specOf((i) => {
      i.pages = i.pages.map((p) => (p.id === 'blank' ? { ...p, sources: eight } : p));
    });
    expect(drop('Checklist', 'blank', s)).toEqual({ kind: 'refused', refusal: MSG.full });
    const noBool = specOf((i) => {
      i.tables = i.tables?.map((t) => ({ ...t, fields: t.fields.filter((f) => f.type !== 'boolean') }));
      i.pages = i.pages.map((p) => (p.id === 'blank' ? { ...p, sources: eight } : p));
    });
    expect(drop('Checklist', 'blank', noBool)).toEqual({ kind: 'refused', refusal: MSG.full });
    expect(bound(drop('DataTable', 'blank', s)).layer.props.source).toBe('s0');
  });
  it('a Checklist on Home binds the only table with a yes/no field', () => {
    expect(bound(drop('Checklist', 'home')).layer.props).toMatchObject({ source: 'all_tasks', field: 'done' });
  });
  it('a Checklist on Other (Crews only) asks or adds on the fitting table', () => {
    const p = bound(drop('Checklist', 'other'));
    expect(p.added).toMatchObject({ id: 'tasks', table: 'tasks' });
    expect(p.sources.map((x) => x.id)).toEqual(['crews_list', 'tasks']);
    expect(p.layer.props.source).toBe('tasks');
  });
});

describe('planDrop: write parts (B1, B2, B8)', () => {
  it('B1 with P17-14: Quick add and Form on Home ask which table; Crews, a table the page shows, is a valid answer', () => {
    expect(drop('QuickAdd', 'home')).toMatchObject({ kind: 'choose', target: 'props.table' });
    expect(drop('RecordForm', 'home')).toMatchObject({ kind: 'choose', target: 'props.table' });
    expect(answered('QuickAdd', 'home', { table: 'crews' }).props).toMatchObject({ table: 'crews', field: 'name' });
    expect(answered('RecordForm', 'home', { table: 'crews' }).props.table).toBe('crews');
  });
  it('B1 with P17-14: on Other the Form asks too, and binds Crews when answered', () => {
    expect(drop('RecordForm', 'other').kind).toBe('choose');
    expect(answered('RecordForm', 'other', { table: 'crews' }).props.table).toBe('crews');
  });
  it('P17-14: a Form or Quick add binds silently when the page shows the only table that fits', () => {
    const s = oneTableSpec();
    expect(bound(drop('QuickAdd', 'other', s)).layer.props.table).toBe('crews');
    expect(bound(drop('RecordForm', 'other', s)).layer.props.table).toBe('crews');
  });
  it('on a page with no source and several tables the Table field is the chooser', () => {
    const p = drop('QuickAdd', 'blank');
    expect(p.kind).toBe('choose');
    if (p.kind === 'choose') {
      expect(p.target).toBe('props.table');
      expect(p.layer.props).toEqual({ table: NOT_CONNECTED });
    }
    expect(drop('RecordForm', 'blank').kind).toBe('choose');
  });
  it('on a page with no source and one table binds it', () => {
    const s = specOf((i) => {
      i.tables = i.tables?.filter((t) => t.id === 'people');
      i.pages = i.pages.filter((p) => p.id === 'blank' || p.id === 'home').map((p) => ({ ...p, sources: [] }));
    });
    expect(bound(drop('QuickAdd', 'blank', s)).layer.props.table).toBe('people');
    expect(bound(drop('RecordForm', 'blank', s)).layer.props.table).toBe('people');
  });
  it('B2: a Form on the record page edits the page record', () => {
    const plan = drop('RecordForm', 'crew');
    expect(bound(plan).layer.props).toMatchObject({ table: 'crews', source: 'one_crew', mode: 'edit', submitLabel: 'Save' });
    expect(bound(plan).layer.props).not.toHaveProperty('fields');
    valid(plan, spec, pageOf(spec, 'crew'));
  });
  it('B2: a Form on a page without a record source keeps create mode', () => {
    expect(answered('RecordForm', 'home', { table: 'crews' }).props).not.toHaveProperty('source');
  });
  it('B7 words: Add to Crews', () => {
    expect(answered('QuickAdd', 'home', { table: 'crews' }).props.placeholder).toBe('Add to Crews');
  });
  it('B8: skips a shown table that needs two fields for the next fitting table', () => {
    const s = specOf((i) => {
      i.tables = i.tables?.map((t) => (t.id === 'crews' ? { ...t, fields: t.fields.map((f) => (f.id === 'size' ? { ...f, required: true } : f)) } : t));
      i.pages = i.pages.map((p) => (p.id === 'other' ? { ...p, sources: p.sources } : p));
    });
    expect(drop('QuickAdd', 'home', s).kind).toBe('choose');
    expect(answered('QuickAdd', 'home', { table: 'tasks' }, s).props.table).toBe('tasks');
    const page = pageOf(s, 'home');
    const root: LayoutLayer = { id: 'root', type: 'Page', props: {}, children: [{ id: 'quickadd_1', type: 'QuickAdd', props: { table: NOT_CONNECTED }, children: [] }] };
    expect(connectLayer(root, 'quickadd_1', { table: 'crews' }, s, page, none).result.ok).toBe(false);
  });
  it('B8: refuses with the Quick add wording when no table fits', () => {
    const s = specOf((i) => {
      i.tables = i.tables?.map((t) => ({ ...t, fields: [...t.fields, { id: 'extra', label: 'Extra', type: 'integer', required: true }] }));
    });
    expect(drop('QuickAdd', 'home', s)).toEqual({ kind: 'refused', refusal: MSG.quickAdd });
    expect(drop('RecordForm', 'home', s).kind).toBe('choose');
  });
  it('offers New table for a Form when the app has no table', () => {
    const s = specOf((i) => {
      i.tables = [];
      i.pages = i.pages.map((p) => ({ ...p, sources: [] }));
    });
    expect(drop('RecordForm', 'home', s)).toMatchObject({ kind: 'offer', offer: { kind: 'no_table' }, target: 'props.table' });
  });
});

describe('planDrop: declared fits first across tables (B4 leftover)', () => {
  const crewsOnly = (extra: (input: AppSpecInput) => void = () => {}): AppSpec =>
    specOf((i) => {
      i.pages = i.pages.map((p) => (p.id === 'home' ? { ...p, sources: (p.sources ?? []).filter((s) => s.id === 'all_crews') } : p));
      extra(i);
    });

  it('Timeline binds a new list of Tasks on due, not the Crews list on created_at', () => {
    const s = crewsOnly();
    const plan = bound(drop('Timeline', 'home', s));
    expect(plan.added).toMatchObject({ table: 'tasks', mode: 'list' });
    expect(plan.layer.props).toMatchObject({ source: plan.added?.id, dateField: 'due' });
  });
  it('Chart binds a new list of Tasks grouped by status, titled Tasks by Status', () => {
    const s = crewsOnly((i) => {
      i.tables = i.tables?.map((t) => (t.id === 'crews' ? { ...t, fields: t.fields.filter((f) => f.id !== 'status' && f.id !== 'lead_id') } : t));
      i.tables = i.tables?.map((t) => (t.id === 'tasks' ? { ...t, fields: [...t.fields, { id: 'status', label: 'Status', type: 'select', options: ['a', 'b'] }] } : t));
    });
    const plan = bound(drop('Chart', 'home', s));
    expect(plan.added).toMatchObject({ table: 'tasks' });
    expect(plan.layer.props).toMatchObject({ groupBy: 'status', title: 'Tasks by Status' });
  });
  it('with the page full, Timeline binds the Crews list on created_at', () => {
    const seven = Array.from({ length: 7 }, (_, n) => ({ id: `s${n}`, table: 'people', mode: 'list' as const, where: [], orderBy: [], limit: 50 }));
    const s = crewsOnly((i) => {
      i.pages = i.pages.map((p) => (p.id === 'home' ? { ...p, sources: [...(p.sources ?? []), ...seven] } : p));
    });
    expect(bound(drop('Timeline', 'home', s)).layer.props).toMatchObject({ source: 'all_crews', dateField: 'created_at' });
  });
});

describe('offerFor', () => {
  const placeholder = (type: string, prop: 'source' | 'table'): LayoutLayer => ({ id: `${type.toLowerCase()}_1`, type, props: { [prop]: NOT_CONNECTED }, children: [] });
  const noTables = specOf((i) => {
    i.tables = [];
    i.pages = i.pages.map((p) => ({ ...p, sources: [] }));
  });
  const noBool = specOf((i) => {
    i.tables = i.tables?.map((t) => ({ ...t, fields: t.fields.filter((f) => f.type !== 'boolean') }));
  });

  it('is null for a connected part, a part with no bind and a part a table fits', () => {
    expect(offerFor({ id: 'a', type: 'DataTable', props: { source: 'all_crews' }, children: [] }, spec, pageOf(spec, 'home'))).toBeNull();
    expect(offerFor({ id: 'h', type: 'Heading', props: { size: 'lg' }, children: 'Hi' }, spec, pageOf(spec, 'home'))).toBeNull();
    expect(offerFor(placeholder('DataTable', 'source'), spec, pageOf(spec, 'blank'))).toBeNull();
    expect(offerFor(placeholder('QuickAdd', 'table'), spec, pageOf(spec, 'blank'))).toBeNull();
  });
  it('is no_table when the app has no table', () => {
    expect(offerFor(placeholder('DataTable', 'source'), noTables, pageOf(noTables, 'blank'))).toEqual({ kind: 'no_table' });
    expect(offerFor(placeholder('RecordForm', 'table'), noTables, pageOf(noTables, 'blank'))).toEqual({ kind: 'no_table' });
  });
  it('is no_field when no table has the field', () => {
    expect(offerFor(placeholder('Checklist', 'source'), noBool, pageOf(noBool, 'blank'))).toMatchObject({ kind: 'no_field', needs: [{ prop: 'field', types: ['boolean'] }] });
  });
  it('is null for a record part on a page that is not a record page', () => {
    expect(offerFor(placeholder('RecordDetail', 'source'), noTables, pageOf(noTables, 'home'))).toBeNull();
  });
  it('is full, with the words of MSG.full, when a source part has no table and the page has the most lists', () => {
    const eight = Array.from({ length: 8 }, (_, n) => ({ id: `s${n}`, table: 'crews', mode: 'list' as const, where: [], orderBy: [], limit: 50 }));
    const page: DraftPage = { ...pageOf(noBool, 'blank'), sources: eight };
    const offer = offerFor(placeholder('Checklist', 'source'), noBool, page);
    expect(offer).toEqual({ kind: 'full' });
    expect(offer === null ? '' : offerWords(offer)).toBe(MSG.full);
  });
  it('offers only New table (no Add a field) to a Linked record picker while the app has a single table', () => {
    const one = specOf((i) => {
      i.tables = [{ id: 'crews', label: 'Crews', titleField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] }];
      i.pages = i.pages.map((p) => ({ ...p, sources: [] }));
    });
    expect(offerFor(placeholder('ReferencePicker', 'source'), one, pageOf(one, 'blank'))).toMatchObject({ kind: 'no_field', tables: [] });
  });
  it('never words a need list into "needs: ."', () => {
    expect(OFFER.noField([])).toBe('No table has the field this part needs.');
    expect(OFFER.noField([{ prop: 'field', types: ['integer'] }])).toBe('No table has the field this part needs: a number field.');
  });
});

describe('connectToNewTable', () => {
  const root = (child: LayoutLayer): LayoutLayer => ({ id: 'root', type: 'Page', props: {}, children: [child] });
  const placeholder = (type: string, prop: 'source' | 'table'): LayoutLayer => ({ id: `${type.toLowerCase()}_1`, type, props: { [prop]: NOT_CONNECTED }, children: [], sizing: { width: 'half', grow: false } });
  const blankApp = specOf((i) => {
    i.tables = [];
    i.pages = i.pages.map((p) => ({ ...p, sources: [] }));
  });
  const page = pageOf(blankApp, 'blank');
  const crews: Table = { id: 'crews', label: 'Crews', titleField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] };
  const ids = new Set(['root', 'datatable_1']);

  it('adds the table and a new list, binds the part and keeps its id and width', () => {
    const out = connectToNewTable(root(placeholder('DataTable', 'source')), 'datatable_1', crews, blankApp, page, ids);
    if (!out.result.ok) throw new Error(out.result.message);
    expect(out.tables).toEqual([crews]);
    expect(out.added).toEqual(newSourceFor('crews', 'list', []));
    expect(out.sources).toEqual([out.added]);
    const next = (out.result.root.children as LayoutLayer[])[0];
    expect(next).toMatchObject({ id: 'datatable_1', props: { source: 'crews' }, sizing: { width: 'half', grow: false } });
  });
  it('binds a write part to the table and adds no list', () => {
    const out = connectToNewTable(root(placeholder('QuickAdd', 'table')), 'quickadd_1', crews, blankApp, page, new Set(['root', 'quickadd_1']));
    if (!out.result.ok) throw new Error(out.result.message);
    expect((out.result.root.children as LayoutLayer[])[0].props).toMatchObject({ table: 'crews', field: 'name' });
    expect(out.sources).toEqual([]);
    expect(out.added).toBeNull();
    expect(out.tables).toEqual([crews]);
  });
  it('a Chart on a table with a Status choice groups by it', () => {
    const withStatus: Table = { ...crews, fields: [...crews.fields, { id: 'status', label: 'Status', type: 'select', options: ['To do', 'Doing', 'Done'], required: false }] };
    const out = connectToNewTable(root(placeholder('Chart', 'source')), 'chart_1', withStatus, blankApp, page, new Set(['root', 'chart_1']));
    if (!out.result.ok) throw new Error(out.result.message);
    expect((out.result.root.children as LayoutLayer[])[0].props).toMatchObject({ groupBy: 'status', title: 'Crews by Status' });
  });
  it('still adds a table the part cannot use (a Linked record picker needs a link field), tables only, the part unchanged', () => {
    const picker = placeholder('ReferencePicker', 'source');
    const out = connectToNewTable(root(picker), 'referencepicker_1', crews, blankApp, page, new Set(['root', 'referencepicker_1']));
    if (!out.result.ok) throw new Error(out.result.message);
    expect(out.connected).toBe(false);
    expect(out.tables).toEqual([crews]);
    expect(out.sources).toEqual([]);
    expect(out.added).toBeNull();
    expect((out.result.root.children as LayoutLayer[])[0]).toEqual(picker);
  });
  it('a refusal leaves tables and sources as they were', () => {
    const eight = Array.from({ length: 8 }, (_, n) => ({ id: `s${n}`, table: 'crews', mode: 'list' as const, where: [], orderBy: [], limit: 50 }));
    const full: DraftPage = { ...page, sources: eight };
    const out = connectToNewTable(root(placeholder('DataTable', 'source')), 'datatable_1', crews, blankApp, full, ids);
    expect(out.result.ok).toBe(false);
    expect(out.sources).toBe(eight);
    expect(out.tables).toBe(blankApp.tables);
    expect(out.added).toBeNull();
  });
});

describe('connectWithNewField', () => {
  const root = (child: LayoutLayer): LayoutLayer => ({ id: 'root', type: 'Page', props: {}, children: [child] });
  const items = specOf((i) => {
    i.tables = [{ id: 'items_list', label: 'Items', titleField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] }];
    i.pages = i.pages.map((p) => ({ ...p, sources: p.id === 'home' ? [newSourceFor('items_list', 'list', [])] : [] }));
  });
  const home = pageOf(items, 'home');
  const date: Field = { id: 'date', label: 'Date', type: 'date', required: false };
  const done: Field = { id: 'done', label: 'Done', type: 'boolean', required: false };
  const grab = (r: ReturnType<typeof connectWithNewField>): LayoutLayer => {
    if (!r.result.ok) throw new Error(r.result.message);
    return (r.result.root.children as LayoutLayer[])[0];
  };

  it('a connected Timeline gets the field as its date, with no new list', () => {
    const timeline: LayoutLayer = { id: 'timeline_1', type: 'Timeline', props: { source: 'items_list', dateField: 'created_at', titleField: 'name' }, children: [] };
    const out = connectWithNewField(root(timeline), 'timeline_1', 'items_list', date, null, null, items, home, new Set(['root', 'timeline_1']));
    expect(grab(out).props).toMatchObject({ source: 'items_list', dateField: 'date' });
    expect(out.added).toBeNull();
    expect(out.sources).toBe(home.sources);
    expect(out.tables[0].fields.map((f) => f.id)).toEqual(['name', 'date']);
  });
  it('a not connected Checklist binds to the page list on the table', () => {
    const checklist: LayoutLayer = { id: 'checklist_1', type: 'Checklist', props: { source: NOT_CONNECTED }, children: [] };
    const out = connectWithNewField(root(checklist), 'checklist_1', 'items_list', done, null, null, items, home, new Set(['root', 'checklist_1']));
    expect(grab(out).props).toMatchObject({ source: 'items_list', field: 'done' });
    expect(out.added).toBeNull();
  });
  it('a not connected Checklist with no list on the table gets a new list', () => {
    const checklist: LayoutLayer = { id: 'checklist_1', type: 'Checklist', props: { source: NOT_CONNECTED }, children: [] };
    const blank = pageOf(items, 'blank');
    const out = connectWithNewField(root(checklist), 'checklist_1', 'items_list', done, null, null, items, blank, new Set(['root', 'checklist_1']));
    expect(out.added).toMatchObject({ table: 'items_list', mode: 'list' });
    expect(grab(out).props).toMatchObject({ source: out.added?.id, field: 'done' });
  });
  it('honours a pending new list choice and an explicit target', () => {
    const two = specOf((i) => {
      i.pages = i.pages.map((p) => (p.id === 'home' ? { ...p, sources: [] } : p));
    });
    const timeline: LayoutLayer = { id: 'timeline_1', type: 'Timeline', props: { source: NOT_CONNECTED }, children: [] };
    const out = connectWithNewField(root(timeline), 'timeline_1', 'crews', date, 'props.dateField', { newSourceOn: 'crews' }, two, pageOf(two, 'home'), new Set(['root', 'timeline_1']));
    expect(out.added).toMatchObject({ table: 'crews' });
    expect(grab(out).props).toMatchObject({ source: out.added?.id, dateField: 'date' });
    expect(out.tables.find((t) => t.id === 'crews')?.fields.at(-1)?.id).toBe('date');
  });
  it('refuses a missing part, a table that is not there and a field that is already there', () => {
    const timeline: LayoutLayer = { id: 'timeline_1', type: 'Timeline', props: { source: 'items_list' }, children: [] };
    expect(connectWithNewField(root(timeline), 'ghost', 'items_list', date, null, null, items, home, none).result.ok).toBe(false);
    expect(connectWithNewField(root(timeline), 'timeline_1', 'nope', date, null, null, items, home, none).result.ok).toBe(false);
    const dup: Field = { id: 'name', label: 'Name', type: 'text', required: false };
    expect(connectWithNewField(root(timeline), 'timeline_1', 'items_list', dup, null, null, items, home, none).result.ok).toBe(false);
  });
});

describe('planDrop: table words (B7, B9 label)', () => {
  it('a Chart is titled "Crews by Status"', () => {
    expect(answered('Chart', 'other', { sourceId: 'crews_list' }).props).toMatchObject({ source: 'crews_list', groupBy: 'status', title: 'Crews by Status' });
  });
  it('a ProgressBar is labelled with the table name', () => {
    expect(answered('ProgressBar', 'other', { sourceId: 'crews_list' }).props.label).toBe('Crews');
  });
  it('a StatCard that sums is labelled "Sum of <field>" (P-32)', () => {
    expect(answered('StatCard', 'other', { sourceId: 'crews_list' }).props).toMatchObject({ stat: 'sum', field: 'size', label: 'Sum of Size' });
  });
  it('B9: a StatCard on a table with no number field counts and is labelled "Count of <table>" (P-32)', () => {
    const s = specOf((i) => {
      i.tables = i.tables?.map((t) => (t.id === 'crews' ? { ...t, fields: t.fields.filter((f) => f.id !== 'size') } : t));
    });
    const layer = answered('StatCard', 'other', { sourceId: 'crews_list' }, s);
    expect(layer.props).toMatchObject({ source: 'crews_list', stat: 'count', label: 'Count of Crews' });
    expect(layer.props.field).toBeUndefined();
  });
  it('a long table label is cut to the prop maximum and still passes checkLayer', () => {
    const long = 'L'.repeat(60);
    const s = specOf((i) => {
      i.tables = i.tables?.map((t) => (t.id === 'crews' ? { ...t, label: long } : t));
    });
    const quick = answered('QuickAdd', 'other', { table: 'crews' }, s);
    expect((quick.props.placeholder as string).length).toBeLessThanOrEqual(60);
    const chart = answered('Chart', 'other', { sourceId: 'crews_list' }, s);
    expect((chart.props.title as string).length).toBeLessThanOrEqual(60);
    const ctx = partContextFor(s, s.pages.find((x) => x.id === 'other')!);
    expect(checkLayer(quick, ctx, 'layer', 5)).toEqual([]);
    expect(checkLayer(chart, ctx, 'layer', 5)).toEqual([]);
  });
});

describe('newSourceFor and withPageSources', () => {
  it('makes a source as SourcesEditor does, with a unique id', () => {
    const a = newSourceFor('crews', 'list', []);
    expect(a).toEqual({ id: 'crews', table: 'crews', mode: 'list', where: [], orderBy: [], limit: 50 });
    expect(newSourceFor('crews', 'record', [a]).id).toBe('crews_2');
  });
  it('replaces the sources of one page only', () => {
    const next = withPageSources(spec, 'blank', [newSourceFor('crews', 'list', [])]);
    expect(next.pages.find((p) => p.id === 'blank')?.sources).toHaveLength(1);
    expect(next.pages.find((p) => p.id === 'home')?.sources).toHaveLength(2);
    expect(spec.pages.find((p) => p.id === 'blank')?.sources).toEqual([]);
  });
});

describe('connectLayer', () => {
  const root = (child: LayoutLayer): LayoutLayer => ({ id: 'root', type: 'Page', props: {}, children: [child] });
  const placeholder = (type: string, prop: 'source' | 'table'): LayoutLayer => ({ id: `${type.toLowerCase()}_1`, type, props: { [prop]: NOT_CONNECTED }, children: [], sizing: { width: 'half', grow: false } });
  const page = pageOf(spec, 'blank');

  it('connects to a new list of a table: adds the source, keeps id and width', () => {
    const out = connectLayer(root(placeholder('DataTable', 'source')), 'datatable_1', { newSourceOn: 'crews' }, spec, page, new Set(['root', 'datatable_1']));
    expect(out.added).toMatchObject({ id: 'crews', table: 'crews', mode: 'list' });
    expect(out.sources.map((s) => s.id)).toEqual(['crews']);
    if (!out.result.ok) throw new Error(out.result.message);
    const next = (out.result.root.children as LayoutLayer[])[0];
    expect(next.id).toBe('datatable_1');
    expect(next.props.source).toBe('crews');
    expect(next.sizing).toEqual({ width: 'half', grow: false });
    expect(out.result.focusId).toBe('datatable_1');
  });
  it('connects to an existing list of the page', () => {
    const home = pageOf(spec, 'home');
    const out = connectLayer(root(placeholder('Timeline', 'source')), 'timeline_1', { sourceId: 'all_crews' }, spec, home, new Set(['root', 'timeline_1']));
    if (!out.result.ok) throw new Error(out.result.message);
    expect((out.result.root.children as LayoutLayer[])[0].props).toMatchObject({ source: 'all_crews', dateField: 'created_at' });
    expect(out.added).toBeNull();
    expect(out.sources).toBe(home.sources);
  });
  it('connects a write part to a table, with B2 on a record page', () => {
    const out = connectLayer(root(placeholder('RecordForm', 'table')), 'recordform_1', { table: 'crews' }, spec, pageOf(spec, 'crew'), new Set(['root', 'recordform_1']));
    if (!out.result.ok) throw new Error(out.result.message);
    expect((out.result.root.children as LayoutLayer[])[0].props).toMatchObject({ table: 'crews', source: 'one_crew', mode: 'edit' });
  });
  it('refuses a table a Quick add cannot use, a list that is not on the page and a missing part', () => {
    const r = root(placeholder('QuickAdd', 'table'));
    const s = specOf((i) => {
      i.tables = i.tables?.map((t) => (t.id === 'people' ? { ...t, fields: [...t.fields, { id: 'e', label: 'E', type: 'integer', required: true }] } : t));
    });
    expect(connectLayer(r, 'quickadd_1', { table: 'people' }, s, pageOf(s, 'blank'), none).result.ok).toBe(false);
    expect(connectLayer(root(placeholder('DataTable', 'source')), 'datatable_1', { sourceId: 'nope' }, spec, page, none).result.ok).toBe(false);
    const missing = connectLayer(r, 'ghost', { table: 'crews' }, spec, page, none);
    expect(missing.result.ok === false && missing.result.reason).toBe('not_found');
  });
  it('refuses a new source on a full page and on a table that does not fit', () => {
    const eight = Array.from({ length: 8 }, (_, n) => ({ id: `s${n}`, table: 'people', mode: 'list' as const, where: [], orderBy: [], limit: 50 }));
    const full: DraftPage = { ...page, sources: eight };
    const out = connectLayer(root(placeholder('DataTable', 'source')), 'datatable_1', { newSourceOn: 'crews' }, spec, full, none);
    expect(out.result.ok === false && out.result.message).toBe(MSG.full);
    const bad = connectLayer(root(placeholder('Checklist', 'source')), 'checklist_1', { newSourceOn: 'crews' }, spec, page, none);
    expect(bad.result.ok).toBe(false);
    expect(bad.sources).toBe(page.sources);
  });
  it('exports the settings prefix', () => {
    expect(NEW_SOURCE_PREFIX).toBe('@new:');
  });
});
