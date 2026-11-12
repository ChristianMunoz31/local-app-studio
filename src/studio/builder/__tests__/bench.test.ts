import { describe, expect, it } from 'vitest';
import { SEED_FEATURES, validateFeatureInput } from '@/catalog/features';
import { validateAppSpec } from '@local-app-studio/runtime/spec/schema';
import type { Table } from '@local-app-studio/runtime/spec/schema';
import type { HostDoc } from '../../design/DesignSession';
import { fieldNeedsOf } from '../../lib/partFields';
import { SAMPLE_IDS, SAMPLE_TABLES, benchFromFeature, builderHidesEntry, emptyBench, renameTableSlot, sampleFor, sampleOf, slotTable, switchSample, usedFields } from '../bench';
import { builderSlots, featureInputOf } from '../slotModel';
import type { FeatureInput } from '../../types';
import { benchOfSeed, docOf, layer, seedInput, seedLibrary } from './benchFixtures';

const doc = (tables: Table[], root = layer('root_feature', 'Page'), sources: HostDoc['sources'] = []): HostDoc => ({ root, sources, tables });

describe('emptyBench', () => {
  it('is a valid app with the canvas page and a page to open', () => {
    const bench = emptyBench();
    expect(bench.pages.map((p) => [p.id, p.route])).toEqual([
      ['feature', '/'],
      ['another', '/another'],
    ]);
    expect(bench.tables).toEqual([]);
    expect(bench.app.name).toBe('Your feature');
    expect(validateAppSpec(bench).ok).toBe(true);
  });
});

describe('sample tables', () => {
  it('are three plain templates whose title field is name', () => {
    expect(SAMPLE_IDS).toEqual(['crews', 'tasks', 'items']);
    for (const id of SAMPLE_IDS) expect(SAMPLE_TABLES[id].fields[0]).toMatchObject({ id: 'name', type: 'text', required: true });
    expect(SAMPLE_TABLES.crews.fields.map((f) => f.label)).toEqual(['Name', 'Phone', 'Status', 'Size']);
    expect(SAMPLE_TABLES.tasks.fields.map((f) => f.label)).toEqual(['Name', 'Due', 'Starts', 'Status', 'Done', 'Notes']);
    expect(SAMPLE_TABLES.items.fields.map((f) => f.label)).toEqual(['Name', 'Count', 'Price', 'Category']);
  });

  it('start a part on Crews when it needs nothing, else on the first template that covers its needs', () => {
    expect(sampleFor('DataTable')).toBe('crews');
    expect(sampleFor('QuickAdd')).toBe('crews');
    expect(fieldNeedsOf('Checklist').length).toBeGreaterThan(0);
    expect(sampleFor('Checklist')).toBe('tasks');
    expect(sampleFor('Timeline')).toBe('tasks');
  });
});

describe('slotTable', () => {
  it('makes a unique id that is never a reserved one, with the template fields', () => {
    const first = slotTable('Tasks', 'tasks', [], new Set());
    expect(first).toMatchObject({ id: 'tasks', label: 'Tasks', titleField: 'name' });
    expect(first.fields.map((f) => f.id)).toEqual(SAMPLE_TABLES.tasks.fields.map((f) => f.id));
    expect(slotTable('Tasks', 'tasks', [], new Set(['tasks'])).id).toBe('tasks_2');
    expect(slotTable('Table', 'crews', [], new Set()).id).not.toBe('table');
    expect(slotTable('Select', 'crews', [], new Set()).id).not.toBe('select');
  });

  it('adds a field a need lacks and leaves a covered need alone', () => {
    const lacking = slotTable('Crews', 'crews', [{ prop: 'done', types: ['boolean'] }], new Set());
    expect(lacking.fields.some((f) => f.type === 'boolean')).toBe(true);
    expect(slotTable('Tasks', 'tasks', [{ prop: 'done', types: ['boolean'] }], new Set()).fields).toHaveLength(SAMPLE_TABLES.tasks.fields.length);
  });
});

describe('sampleOf', () => {
  it('knows a template table and not one with other fields', () => {
    expect(sampleOf(slotTable('Items', 'items', [], new Set()))).toBe('items');
    const own = slotTable('Items', 'items', [{ prop: 'done', types: ['boolean'] }], new Set());
    expect(sampleOf(own)).toBeNull();
  });
});

describe('switchSample', () => {
  const source = { id: 'crews', table: 'crews', mode: 'list' as const, where: [], orderBy: [], limit: 50 };
  const chartDoc = (): HostDoc => {
    const crews = slotTable('Crews', 'crews', [], new Set());
    const chart = layer('chart_1', 'Chart', { source: 'crews', groupBy: 'status', title: 'Crews by Status' });
    return doc([crews], layer('root_feature', 'Page', {}, [chart]), [source]);
  };

  it('swaps the fields no part uses and keeps the one a part uses', () => {
    const before = chartDoc();
    expect([...(usedFields(before).get('crews') ?? [])]).toEqual(['status']);
    const after = switchSample(before, 'crews', 'items');
    const fields = after.tables[0].fields;
    expect(fields.map((f) => f.id)).toContain('status');
    expect(fields.map((f) => f.id)).toContain('price');
    expect(fields.map((f) => f.id)).not.toContain('phone');
    expect(fields.find((f) => f.id === 'status')).toMatchObject({ type: 'select', options: ['Active', 'Paused', 'Done'] });
    expect(after.tables[0].titleField).toBe('name');
  });

  it('gives the template field a new id when a used field clashes with it in type', () => {
    const t = slotTable('Crews', 'crews', [], new Set());
    const clash: Table = { ...t, fields: t.fields.map((f) => (f.id === 'size' ? { id: 'size', label: 'Size', type: 'text', required: false } : f)) };
    const d = doc([clash], layer('root_feature', 'Page', {}, [layer('c', 'Chart', { source: 'crews', groupBy: 'size', title: 'x' })]), [source]);
    const ids = switchSample(d, 'crews', 'crews').tables[0].fields.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('leaves an unknown table alone', () => {
    const d = chartDoc();
    expect(switchSample(d, 'nope', 'items')).toBe(d);
  });
});

describe('renameTableSlot', () => {
  it('changes the label only, and an empty or same label changes nothing', () => {
    const d = doc([slotTable('Crews', 'crews', [], new Set())]);
    const next = renameTableSlot(d, 'crews', ' Jobs ');
    expect(next.tables[0]).toMatchObject({ id: 'crews', label: 'Jobs' });
    expect(renameTableSlot(d, 'crews', '  ')).toBe(d);
    expect(renameTableSlot(d, 'crews', 'Crews')).toBe(d);
  });
});

describe('benchFromFeature', () => {
  it('puts both seed features on the bench and saves them back as valid records with the same settings', () => {
    const library = seedLibrary();
    for (const def of SEED_FEATURES) {
      const start = benchOfSeed(def.id);
      expect(start.problem).toBeNull();
      const d = docOf(start);
      expect(Array.isArray(d.root.children) && d.root.children).toHaveLength(1);
      const input = featureInputOf({ doc: d, library, state: start.state, id: def.id, name: def.label, line: def.description });
      expect(validateFeatureInput(input, library, { replacingId: def.id }).ok).toBe(true);
      expect(input.params.map((p) => p.type).sort()).toEqual(def.params.map((p) => p.type).sort());
    }
  });

  it('keeps the same fragment through a second save', () => {
    const library = seedLibrary();
    const first = benchOfSeed('search_list');
    const once = featureInputOf({ doc: docOf(first), library, state: first.state, id: 'x', name: 'Search', line: 'Searches.' });
    const second = benchFromFeature(once, library);
    expect(second.problem).toBeNull();
    const twice = featureInputOf({ doc: docOf(second), library, state: second.state, id: 'x', name: 'Search', line: 'Searches.' });
    expect(twice.fragment).toEqual(once.fragment);
    expect(twice.params).toEqual(once.params);
    expect(twice.bindings).toEqual(once.bindings);
  });

  it('opens a feature made of a table setting on the bench', () => {
    const start = benchFromFeature(
      {
        id: 'quick',
        label: 'Quick',
        description: 'Adds.',
        params: [{ name: 'table', label: 'Crews', type: 'table' }],
        fragment: layer('f1', 'Section', {}, [layer('f2', 'QuickAdd', { table: 't', placeholder: 'Add to Crews', buttonLabel: 'Add' })]),
        bindings: [{ param: 'table', layer: 'f2', target: 'props.table' }],
      },
      seedLibrary(),
    );
    expect(start.problem).toBeNull();
    expect(start.spec.tables.map((t) => t.label)).toEqual(['Crews']);
  });

  it('refuses a feature that needs one record', () => {
    const start = benchFromFeature(
      { id: 'rec', label: 'Rec', description: 'Shows one.', params: [{ name: 'record', label: 'Record', type: 'source', mode: 'record' }], fragment: layer('f1', 'RecordDetails', { source: 's' }), bindings: [{ param: 'record', layer: 'f1', target: 'props.source' }] },
      seedLibrary(),
    );
    expect(start.problem).toBe('one_record');
  });

  it('says cannot_hold, not one_record, for a field setting whose table setting is missing', () => {
    const start = benchFromFeature(
      {
        id: 'orphan',
        label: 'Orphan',
        description: 'A field alone.',
        params: [{ name: 'f', label: 'Field', type: 'field', of: 'missing' }],
        fragment: layer('f1', 'Section', {}, []),
        bindings: [],
      },
      seedLibrary(),
    );
    expect(start.problem).toBe('cannot_hold');
  });

  it('brings a text setting back ticked and named under its use, so a round trip keeps both', () => {
    const input: FeatureInput = {
      id: 'hello',
      label: 'Hello',
      description: 'Says hello.',
      params: [{ name: 'title', label: 'The title', type: 'text' }],
      fragment: layer('f1', 'Heading', { size: 'lg' }, 'Hello'),
      bindings: [{ param: 'title', layer: 'f1', target: 'children' }],
    };
    const library = seedLibrary();
    const start = benchFromFeature(input, library);
    expect(start.problem).toBeNull();
    const row = builderSlots(docOf(start), start.spec, library, start.state).find((r) => r.kind === 'text');
    expect(row).toMatchObject({ on: true, label: 'The title' });
    expect(row?.key.startsWith('use|')).toBe(true);
  });
});

describe('builderHidesEntry', () => {
  const library = seedLibrary();
  it('hides Tab and the parts that show one record', () => {
    expect(builderHidesEntry('part:Tab', null, library)).toBe(true);
    expect(builderHidesEntry('part:RecordDetail', null, library)).toBe(true);
    expect(builderHidesEntry('part:DataTable', null, library)).toBe(false);
    expect(builderHidesEntry('part:RecordForm', null, library)).toBe(false);
  });

  it('hides the feature being edited and every feature that holds it', () => {
    const holder = { ...seedInput('kpi_row'), id: 'holder', fragment: layer('h1', 'Section', {}, [layer('h2', 'Feature', { featureId: 'search_list', params: { source: 's', search: 'x' } })]) };
    const lib = new Map(library);
    lib.set('holder', { ...holder, version: 1, updatedAt: '' });
    expect(builderHidesEntry('feature:search_list', 'search_list', lib)).toBe(true);
    expect(builderHidesEntry('feature:holder', 'search_list', lib)).toBe(true);
    expect(builderHidesEntry('feature:kpi_row', 'search_list', lib)).toBe(false);
    expect(builderHidesEntry('feature:holder', null, lib)).toBe(false);
  });
});
