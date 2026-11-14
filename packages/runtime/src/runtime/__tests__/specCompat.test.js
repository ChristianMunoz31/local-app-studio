// ADR-015: the feature list is deterministic, an old spec is untouched, a newer feature, key or layer key is named.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AppSpecSchema, LayoutLayerSchema, SPEC_VERSION } from '../../spec/schema.ts';
import { BASE_LAYER_KEYS, BASE_SPEC_KEYS, SPEC_FEATURES, SPEC_VERSION_KNOWN, featureLabel, specCompatProblem, specFeatures, withFeatures } from '../specCompat.js';

const FIXTURE = JSON.parse(readFileSync(new URL('../../spec/fixtures/crew-roster.json', import.meta.url), 'utf8'));

const REGISTRY = Object.freeze([
  { id: 'kanban-boards', part: 'Kanban' },
  { id: 'global-search', key: 'search' },
  { id: 'card-colors', layerKey: 'color' },
]);

const layer = (type, extra = {}) => ({ id: `l_${type}`, type, props: {}, children: [], ...extra });
const withLayers = (...layers) => ({ ...FIXTURE, pages: [{ ...FIXTURE.pages[0], layout: { id: 'root', type: 'Page', props: {}, children: layers } }] });

describe('the baseline lists follow the schema', () => {
  it('BASE_SPEC_KEYS are the keys of AppSpecSchema', () => {
    expect([...BASE_SPEC_KEYS].sort()).toEqual(Object.keys(AppSpecSchema.shape).sort());
  });

  it('BASE_LAYER_KEYS are the keys of a layer', () => {
    const shape = LayoutLayerSchema._zod.def.getter().shape;
    expect([...BASE_LAYER_KEYS].sort()).toEqual(Object.keys(shape).sort());
  });

  it('SPEC_VERSION_KNOWN is the schema version', () => {
    expect(SPEC_VERSION_KNOWN).toBe(SPEC_VERSION);
  });

  it('this version registers the phase 31 features, and every baseline design is still compatible', () => {
    expect(SPEC_FEATURES.map((f) => f.id).sort()).toEqual(['global-search', 'kanban-boards', 'table-inline-edit']);
    expect(specFeatures(FIXTURE)).toEqual([]);
    expect(specCompatProblem(FIXTURE)).toBeNull();
  });
});

describe('the phase 31 features (ADR-018)', () => {
  const table = (props) => layer('DataTable', { props });

  it('Kanban, GlobalSearch in a page and in a menu slot, and the DataTable edit prop are found', () => {
    expect(specFeatures(withLayers(layer('Kanban')))).toEqual(['kanban-boards']);
    expect(specFeatures(withLayers(layer('GlobalSearch')))).toEqual(['global-search']);
    const menu = { ...FIXTURE, menu: { position: 'top', style: 'icons-and-labels', start: [layer('GlobalSearch')] } };
    expect(specFeatures(menu)).toEqual(['global-search']);
    expect(specFeatures(withLayers(table({ source: 's', edit: 'cells' })))).toEqual(['table-inline-edit']);
    expect(specFeatures(withLayers(table({ source: 's', edit: 'off' })))).toEqual(['table-inline-edit']);
  });

  it('a DataTable without edit, and edit on another part, are not evidence', () => {
    expect(specFeatures(withLayers(table({ source: 's' })))).toEqual([]);
    expect(specFeatures(withLayers(table({ source: 's', edit: undefined })))).toEqual([]);
    expect(specFeatures(withLayers(layer('Text', { props: { edit: 'cells' } })))).toEqual([]);
    expect(specFeatures(withLayers(layer('DataTable', { props: null })))).toEqual([]);
  });

  it('a build that does not know a feature id says it is too new, by name', () => {
    const older = [];
    const all = withFeatures(withLayers(layer('Kanban'), layer('GlobalSearch'), table({ source: 's', edit: 'cells' })));
    expect(all.features).toEqual(['global-search', 'kanban-boards', 'table-inline-edit']);
    expect(specCompatProblem(all)).toBeNull();
    expect(specCompatProblem(all, older)?.sentence).toBe(
      'This app uses Global search, Kanban boards and Table inline edit, which this version does not know.',
    );
  });

  it('a part prop is not a layer key, so the schemaless reader does not flag it', () => {
    expect(specCompatProblem(withLayers(table({ source: 's', edit: 'cells' })), undefined, { unknownKeys: true })).toBeNull();
  });
});

describe('specFeatures', () => {
  it('finds a part, a top-level key and a layer key, sorted and without duplicates', () => {
    const spec = { ...withLayers(layer('Kanban'), layer('Kanban', { id: 'again' }), layer('Text', { id: 't', color: 'red' })), search: { on: true } };
    expect(specFeatures(spec, REGISTRY)).toEqual(['card-colors', 'global-search', 'kanban-boards']);
  });

  it('finds a part in a menu slot and in nested children', () => {
    const nested = withLayers(layer('Row', { id: 'row', children: [layer('Kanban')] }));
    expect(specFeatures(nested, REGISTRY)).toEqual(['kanban-boards']);
    const menu = { ...FIXTURE, menu: { position: 'top', style: 'icons-and-labels', start: [layer('Kanban')] } };
    expect(specFeatures(menu, REGISTRY)).toEqual(['kanban-boards']);
  });

  it('is deterministic: the same design gives the same list whatever the registry order or key order', () => {
    const spec = { ...withLayers(layer('Kanban')), search: 1 };
    const a = specFeatures(spec, REGISTRY);
    expect(specFeatures(spec, [...REGISTRY].reverse())).toEqual(a);
    expect(specFeatures(JSON.parse(JSON.stringify(spec)), REGISTRY)).toEqual(a);
    expect(specFeatures(spec, REGISTRY)).toEqual(a);
  });

  it('never throws on a hostile value', () => {
    for (const bad of [null, 5, 'x', [], { pages: 5 }, { pages: [null, { layout: 5 }] }, { menu: { start: 5 } }]) expect(specFeatures(bad, REGISTRY)).toEqual([]);
  });
});

describe('withFeatures', () => {
  it('leaves a design that uses none exactly as it was (same object, no key)', () => {
    expect(withFeatures(FIXTURE, REGISTRY)).toBe(FIXTURE);
    expect(withFeatures(FIXTURE)).toBe(FIXTURE);
  });

  it('drops a stale list, sets a missing one and is idempotent', () => {
    const stale = { ...FIXTURE, features: ['kanban-boards'] };
    const dropped = withFeatures(stale, REGISTRY);
    expect('features' in dropped).toBe(false);
    const used = withLayers(layer('Kanban'));
    const set = withFeatures(used, REGISTRY);
    expect(set.features).toEqual(['kanban-boards']);
    expect(withFeatures(set, REGISTRY)).toBe(set);
    expect(used.features).toBeUndefined();
  });
});

describe('specCompatProblem', () => {
  it('accepts a design whose features, keys and layer keys are all known', () => {
    const spec = { ...withLayers(layer('Kanban', { color: 'red' })), search: 1, features: ['global-search', 'kanban-boards'] };
    expect(specCompatProblem(spec, REGISTRY)).toBeNull();
  });

  it('names an unknown feature id in plain words', () => {
    const found = specCompatProblem({ ...FIXTURE, features: ['time-travel'] });
    expect(found).toEqual({ newer: ['Time travel'], sentence: 'This app uses Time travel, which this version does not know.' });
  });

  it('an unknown top-level or layer key alone is not evidence of a newer version (the schema reports it)', () => {
    expect(specCompatProblem({ ...FIXTURE, search: {} })).toBeNull();
    expect(specCompatProblem(withLayers(layer('Text', { color: 'red' })))).toBeNull();
    expect(specCompatProblem({ ...FIXTURE, menu: { start: [layer('Text', { glow: 1 })] } })).toBeNull();
  });

  it('with unknownKeys (the reader that runs no schema) names an unknown top-level key and an unknown layer key', () => {
    const opts = { unknownKeys: true };
    expect(specCompatProblem({ ...FIXTURE, search: {} }, undefined, opts)?.sentence).toBe('This app uses "search", which this version does not know.');
    expect(specCompatProblem(withLayers(layer('Text', { color: 'red' })), undefined, opts)?.sentence).toBe('This app uses "color", which this version does not know.');
    const inMenu = { ...FIXTURE, menu: { start: [layer('Text', { glow: 1 })] } };
    expect(specCompatProblem(inMenu, undefined, opts)?.newer).toEqual(['"glow"']);
    expect(specCompatProblem(FIXTURE, undefined, opts)).toBeNull();
    const known = { ...withLayers(layer('Kanban', { color: 'red' })), search: 1 };
    expect(specCompatProblem(known, REGISTRY, opts)).toBeNull();
  });

  it('a higher specVersion is evidence, in plain words; the current and a lower one are not', () => {
    const found = specCompatProblem({ ...FIXTURE, specVersion: SPEC_VERSION_KNOWN + 1 });
    expect(found?.sentence).toBe('This app was made by a newer version of Local App Studio.');
    expect(found?.newer).toEqual([`Spec version ${SPEC_VERSION_KNOWN + 1}`]);
    expect(specCompatProblem({ ...FIXTURE, specVersion: SPEC_VERSION_KNOWN })).toBeNull();
    expect(specCompatProblem({ ...FIXTURE, specVersion: 0 })).toBeNull();
    expect(specCompatProblem({ ...FIXTURE, specVersion: '9' })).toBeNull();
    expect(specCompatProblem({ ...FIXTURE, specVersion: SPEC_VERSION_KNOWN + 1 }, undefined, { version: false })).toBeNull();
  });

  it('lists up to three names, then counts the rest, sorted', () => {
    const spec = { ...FIXTURE, features: ['d-four', 'c-three', 'b-two', 'a-one', 'e-five'] };
    expect(specCompatProblem(spec)?.sentence).toBe('This app uses A one, B two, C three and 2 more, which this version does not know.');
  });

  it('refuses a non-string feature id without throwing, and ignores a non-object', () => {
    expect(specCompatProblem({ ...FIXTURE, features: [5] })?.newer).toEqual(['5']);
    expect(specCompatProblem(null)).toBeNull();
    expect(specCompatProblem([])).toBeNull();
  });

  it('is deterministic', () => {
    const spec = { ...FIXTURE, zzz: 1, aaa: 2, features: ['b-two', 'a-one'] };
    expect(specCompatProblem(spec)).toEqual(specCompatProblem(JSON.parse(JSON.stringify(spec))));
  });
});

describe('featureLabel', () => {
  it('turns an id into its words', () => {
    expect(featureLabel('kanban-boards')).toBe('Kanban boards');
    expect(featureLabel('search')).toBe('Search');
    expect(featureLabel('')).toBe('a newer feature');
  });
});
