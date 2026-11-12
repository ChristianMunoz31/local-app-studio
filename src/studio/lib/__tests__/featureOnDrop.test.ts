import { describe, expect, it } from 'vitest';
import { SEED_FEATURES } from '@/catalog/features';
import type { FeatureDefinition } from '@/catalog/features';
import { partContextFor } from '@/catalog/validateLayout';
import type { AppSpec, LayoutLayer, Table } from '@local-app-studio/runtime/spec/schema';
import { featureTableDraft, needsNewTable, placeFeatureOnNewTable } from '../featureOnDrop';
import { tableFromDraft } from '../tableDraft';

const def = (id: string): FeatureDefinition => {
  const found = SEED_FEATURES.find((d) => d.id === id);
  if (found === undefined) throw new Error(id);
  return found;
};
const library = new Map(SEED_FEATURES.map((d) => [d.id, d]));
const root = (): LayoutLayer => ({ id: 'root_home', type: 'Page', props: {}, children: [{ id: 'h1', type: 'Heading', props: { size: 'lg' }, children: 'Home' }] });
const blank = (): AppSpec => ({
  specVersion: 1,
  app: { name: 'Crew Roster', slug: 'crew-roster', identifier: 'com.example.crewroster', version: '1.0.0', description: '', icon: null },
  tables: [],
  pages: [{ id: 'home', title: 'Home', route: '/', sources: [], layout: root() }],
  nav: [{ pageId: 'home', label: 'Home' }],
  theme: { preset: 'aurora', radius: 'md' },
});
const page = { id: 'home', title: 'Home', route: '/', sources: [] };
const at = { parentId: 'root_home', index: 1 };

describe('featureTableDraft', () => {
  it('is Name plus one field per field setting, with its label and first allowed type', () => {
    const draft = featureTableDraft(def('kpi_row'), []);
    expect(draft.label).toBe('');
    expect(draft.fields.map((f) => [f.label, f.type])).toEqual([
      ['Name', 'text'],
      ['Number field', 'integer'],
    ]);
  });

  it('leaves a text field to Name and gives a choice field the example options', () => {
    expect(featureTableDraft(def('search_list'), []).fields.map((f) => f.label)).toEqual(['Name']);
    const select: FeatureDefinition = {
      ...def('kpi_row'),
      params: [
        { name: 'source', label: 'List', type: 'source', mode: 'list' },
        { name: 'status', label: 'Status', type: 'field', of: 'source', fieldTypes: ['select'] },
      ],
    };
    const field = featureTableDraft(select, []).fields[1];
    expect(field).toMatchObject({ label: 'Status', type: 'select' });
    expect(field.type === 'select' && field.options).toEqual(['To do', 'Doing', 'Done']);
  });
});

describe('needsNewTable', () => {
  it('is true for a list or table setting and false for one record', () => {
    expect(needsNewTable(def('kpi_row'))).toBe(true);
    expect(needsNewTable({ params: [{ name: 'r', label: 'R', type: 'source', mode: 'record' }] })).toBe(false);
    expect(needsNewTable({ params: [{ name: 't', label: 'T', type: 'text' }] })).toBe(false);
  });
});

describe('placeFeatureOnNewTable', () => {
  const made = (): Table => tableFromDraft({ ...featureTableDraft(def('kpi_row'), []), label: 'Jobs' }, []);

  it('adds the table, a list on it and the feature connected to it, in one result', () => {
    const out = placeFeatureOnNewTable(def('kpi_row'), made(), blank(), page, at, new Set(['root_home', 'h1']), library);
    if ('refusal' in out) throw new Error(out.refusal);
    expect(out.tables.map((t) => t.id)).toEqual(['jobs']);
    expect(out.sources).toHaveLength(1);
    expect(out.sources[0]).toMatchObject({ table: 'jobs', mode: 'list' });
    expect(out.result.ok).toBe(true);
    if (!out.result.ok) return;
    const block = (out.result.root.children as LayoutLayer[])[1];
    expect(block.feature).toMatchObject({ id: 'kpi_row', params: { source: out.sources[0].id, amount: 'number_field' } });
    // Every list and field the block names exists on the new page context.
    const ctx = partContextFor({ ...blank(), tables: out.tables }, { ...blank().pages[0], sources: out.sources });
    expect(ctx.sourceIds).toContain(out.sources[0].id);
  });

  it('makes a list for each list setting', () => {
    const two: FeatureDefinition = {
      ...def('search_list'),
      params: [
        { name: 'one', label: 'One', type: 'source', mode: 'list' },
        { name: 'two', label: 'Two', type: 'source', mode: 'list' },
      ],
      fragment: { id: 'f1', type: 'Section', props: {}, children: [{ id: 'f2', type: 'DataTable', props: { source: 's' }, children: [] }, { id: 'f3', type: 'DataTable', props: { source: 's' }, children: [] }] },
      bindings: [
        { param: 'one', layer: 'f2', target: 'props.source' },
        { param: 'two', layer: 'f3', target: 'props.source' },
      ],
    };
    const out = placeFeatureOnNewTable(two, tableFromDraft({ ...featureTableDraft(two, []), label: 'Jobs' }, []), blank(), page, at, new Set(['root_home', 'h1']), new Map([...library, ['search_list', two]]));
    if ('refusal' in out) throw new Error(out.refusal);
    expect(out.sources).toHaveLength(2);
    expect(new Set(out.sources.map((s) => s.id)).size).toBe(2);
  });

  it('fills every table setting with the new table, even when an older table is on the page', () => {
    const quick: FeatureDefinition = {
      ...def('search_list'),
      id: 'quick',
      params: [
        { name: 'table', label: 'Crews', type: 'table' },
        { name: 'status', label: 'Status', type: 'field', of: 'table', fieldTypes: ['select'] },
      ],
      fragment: { id: 'f1', type: 'QuickAdd', props: { table: 't', placeholder: 'Add', buttonLabel: 'Add' }, children: [] },
      bindings: [{ param: 'table', layer: 'f1', target: 'props.table' }],
    };
    const older: Table = { id: 'crews', label: 'Crews', titleField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] };
    const spec = { ...blank(), tables: [older] };
    const out = placeFeatureOnNewTable(quick, tableFromDraft({ ...featureTableDraft(quick, [older]), label: 'Jobs' }, [older]), spec, page, at, new Set(['root_home', 'h1']), new Map([...library, ['quick', quick]]));
    if ('refusal' in out) throw new Error(out.refusal);
    expect(out.result.ok).toBe(true);
    if (!out.result.ok) return;
    const block = (out.result.root.children as LayoutLayer[])[1];
    expect(block.feature?.params.table).toBe('jobs');
  });

  it('refuses a feature that needs one record', () => {
    const record: FeatureDefinition = { ...def('kpi_row'), params: [{ name: 'record', label: 'Record', type: 'source', mode: 'record' }] };
    const out = placeFeatureOnNewTable(record, made(), blank(), page, at, new Set(), library);
    expect(out).toHaveProperty('refusal');
  });

  it('refuses a table that already exists', () => {
    const spec = { ...blank(), tables: [made()] };
    expect(placeFeatureOnNewTable(def('kpi_row'), made(), spec, page, at, new Set(), library)).toHaveProperty('refusal', 'That table already exists.');
  });
});
