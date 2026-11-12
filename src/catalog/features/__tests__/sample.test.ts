import { describe, expect, it } from 'vitest';
import crewRoster from '@local-app-studio/runtime/spec/fixtures/crew-roster.json';
import { validateAppSpec } from '@local-app-studio/runtime/spec/schema.ts';
import type { AppSpecInput } from '@local-app-studio/runtime/spec/schema.ts';
import { PART_DEFINITIONS } from '../../definitions.ts';
import { checkLayout } from '../../validateLayout.ts';
import { TASKS_TABLE, layer } from '../../__tests__/fixtures.ts';
import { builtInPreviewSpec, sampleParams, sampleRows, sampleSpecFor } from '../sample.ts';
import { SEED_FEATURES } from '../seeds.ts';
import type { FeatureBody } from '../types.ts';
import { libOf } from './helpers.ts';

const body = (b: Partial<FeatureBody>): FeatureBody => ({ params: [], bindings: [], fragment: layer('r', 'Divider'), ...b });

describe('sampleSpecFor', () => {
  it.each(SEED_FEATURES.map((s) => s.id))('builds a valid sample app for %s', (id) => {
    const seed = SEED_FEATURES.find((s) => s.id === id);
    if (!seed) throw new Error(id);
    const r = sampleSpecFor(seed, libOf());
    expect('spec' in r, JSON.stringify(r)).toBe(true);
  });

  it('gives a record page route when any source param is a record source', () => {
    const b = body({
      params: [{ name: 'one', label: 'One', type: 'source', mode: 'record' }],
      fragment: layer('r', 'RecordDetail', { source: 's' }),
      bindings: [{ param: 'one', layer: 'r', target: 'props.source' }],
    });
    const r = sampleSpecFor(b, libOf());
    if (!('spec' in r)) throw new Error(JSON.stringify(r));
    expect(r.spec.pages.find((p) => p.id === 'preview')?.route).toBe('/preview-feature/:id');
    const list = sampleSpecFor(SEED_FEATURES[0], libOf());
    if (!('spec' in list)) throw new Error('list');
    expect(list.spec.pages.find((p) => p.id === 'preview')?.route).toBe('/preview-feature');
  });

  it('uses the detail page for a page param inside a withRecord action, else home', () => {
    const mk = (withRecord: boolean): FeatureBody =>
      body({
        params: [{ name: 'go', label: 'Page', type: 'page' }, { name: 'src', label: 'List', type: 'source', mode: 'list' }],
        fragment: layer('r', 'DataTable', { source: 's', rowAction: { action: 'navigate', pageId: 'home', withRecord } }),
        bindings: [
          { param: 'src', layer: 'r', target: 'props.source' },
          { param: 'go', layer: 'r', target: 'props.rowAction.pageId' },
        ],
      });
    expect(sampleParams(mk(true)).go).toBe('detail');
    expect(sampleParams(mk(false)).go).toBe('home');
    expect('spec' in sampleSpecFor(mk(true), libOf())).toBe(true);
    expect('spec' in sampleSpecFor(mk(false), libOf())).toBe(true);
  });

  it('maps param types to sample values', () => {
    const b = body({
      params: [
        { name: 'label', label: 'Caption', type: 'text' },
        { name: 'table', label: 'Table', type: 'table' },
        { name: 'src', label: 'List', type: 'source', mode: 'list' },
        { name: 'col', label: 'Column', type: 'field', of: 'table' },
      ],
    });
    expect(sampleParams(b)).toEqual({ label: 'Caption', table: 'sample', src: 's_src', col: 'f_col' });
  });

  it('gives a text param the words its part holds, else its label', () => {
    const b = body({
      params: [
        { name: 'title', label: 'Board title', type: 'text' },
        { name: 'other', label: 'Other words', type: 'text' },
      ],
      fragment: layer('r', 'Section', {}, [layer('h', 'Heading', {}, 'Status board')]),
      bindings: [{ param: 'title', layer: 'h', target: 'children' }],
    });
    expect(sampleParams(b)).toEqual({ title: 'Status board', other: 'Other words' });
  });

  it('reports the issues of a broken fragment instead of throwing', () => {
    const r = sampleSpecFor(body({ fragment: layer('r', 'Divider', { className: 'x' }) }), libOf());
    expect('issues' in r).toBe(true);
  });
});

describe('sampleRows', () => {
  it('is deterministic and computes numbers in code', () => {
    const r = sampleSpecFor(SEED_FEATURES[0], libOf());
    if (!('spec' in r)) throw new Error('spec');
    const a = sampleRows(r.spec);
    expect(sampleRows(r.spec)).toEqual(a);
    expect(a.sample).toHaveLength(5);
    expect(a.sample.map((row) => row.f_amount)).toEqual([3, 6, 9, 12, 15]);
    expect(a.sample[0]).toMatchObject({ id: 'sample_1', name: 'Name 1' });
    expect(sampleRows(r.spec, 2).sample).toHaveLength(2);
  });
});

// Tab and Column only exist inside Tabs and Columns, whose examples already hold one. The tasks table and the open_tasks source
// are added the way the Studio previews add them (src/studio/showcase/samples.ts), not by builtInPreviewSpec.
describe('builtInPreviewSpec', () => {
  const fixture = crewRoster as AppSpecInput;
  it.each(PART_DEFINITIONS.filter((d) => d.name !== 'Page' && d.name !== 'Tab' && d.name !== 'Column').map((d) => d.name))('holds the sources the %s example names', (name) => {
    const def = PART_DEFINITIONS.find((d) => d.name === name);
    if (!def) throw new Error(name);
    const preview = builtInPreviewSpec({ ...fixture, tables: [...(fixture.tables ?? []), TASKS_TABLE] }, { id: 'root', type: 'Page', props: {}, children: [def.example] });
    const open = { id: 'open_tasks', table: 'tasks', where: [{ field: 'done', op: 'eq' as const, value: false }], limit: 50 };
    const spec = { ...preview, pages: preview.pages.map((p) => (p.id === 'crew' ? { ...p, sources: [...(p.sources ?? []), open] } : p)) };
    const r = validateAppSpec(spec, { checkLayout });
    expect(r.issues, name).toEqual([]);
  });
});
