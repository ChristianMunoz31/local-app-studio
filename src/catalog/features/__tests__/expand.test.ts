import { describe, expect, it } from 'vitest';
import { validateAppSpec } from '@local-app-studio/runtime/spec/schema.ts';
import type { AppSpecInput, LayoutLayer } from '@local-app-studio/runtime/spec/schema.ts';
import { crewCtx, crewSpec, layer, ROOT_ONLY } from '../../__tests__/fixtures.ts';
import { checkLayout } from '../../validateLayout.ts';
import { checkParamValues, expandFeature, expandLayout, expandSpecFeatures, featureMarkers, hasFeatureNodes } from '../expand.ts';
import type { FeatureBody, FeatureDefinition } from '../types.ts';
import { defOf, headingBody, libOf, seedLib, wrapperBody } from './helpers.ts';

const kpi = (lib = seedLib()): FeatureDefinition => lib.get('kpi_row') as FeatureDefinition;
const KPI_PARAMS = { source: 'open_crews', amount: 'size', title: 'Crew size' };
const featureNode = (id: string, featureId: string, params: Record<string, string>): LayoutLayer =>
  layer(id, 'Feature', { featureId, params });

const codesOf = (r: { ok: boolean; issues?: { code: string }[] }): string[] => (r.ok ? [] : (r.issues ?? []).map((i) => i.code));

describe('expandFeature', () => {
  it('expands kpi_row on the crew context: ids, marker, name, bound values', () => {
    const r = expandFeature(kpi(), KPI_PARAMS, crewCtx(), seedLib(), { rootId: 'feature_1' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const root = r.value;
    expect(root.id).toBe('feature_1');
    expect(root.name).toBe('Number row');
    expect(root.feature).toEqual({ id: 'kpi_row', version: 1, params: { amount: 'size', source: 'open_crews', title: 'Crew size' } });
    expect(root.props.title).toBe('Crew size');
    const kids = root.children as LayoutLayer[];
    expect(kids.map((k) => k.id)).toEqual(['feature_1-1', 'feature_1-2', 'feature_1-3']);
    expect(kids[1].props).toMatchObject({ source: 'open_crews', field: 'size', stat: 'sum' });
    expect(kids[0].feature).toBeUndefined();
    expect(r.used).toEqual(['kpi_row']);
  });

  it('does not change the definition and passes the full page validation afterwards', () => {
    const def = kpi();
    const before = JSON.stringify(def);
    const r = expandFeature(def, KPI_PARAMS, crewCtx(), seedLib(), { rootId: 'feature_1' });
    expect(JSON.stringify(def)).toBe(before);
    if (!r.ok) throw new Error('expected ok');
    const spec = validateAppSpec(crewSpec({ ...ROOT_ONLY, children: [r.value] }), { checkLayout });
    expect(spec.issues).toEqual([]);
  });

  it('keeps ids unique against taken ids', () => {
    const taken = new Set(['feature_1-1', 'feature_1-3', 'x']);
    const r = expandFeature(kpi(), KPI_PARAMS, crewCtx(), seedLib(), { rootId: 'feature_1', takenIds: taken });
    if (!r.ok) throw new Error('expected ok');
    expect((r.value.children as LayoutLayer[]).map((k) => k.id)).toEqual(['feature_1-2', 'feature_1-4', 'feature_1-5']);
    expect(taken.has('feature_1-5')).toBe(true);
  });

  it('expands nested features and keeps the inner marker', () => {
    const lib = libOf(defOf('say', headingBody()), defOf('wrap', wrapperBody('say')));
    const r = expandFeature(lib.get('wrap') as FeatureDefinition, { title: 'Hello' }, crewCtx(), lib, { rootId: 'blk' });
    if (!r.ok) throw new Error(JSON.stringify(r));
    const inner = (r.value.children as LayoutLayer[])[0];
    expect(inner).toMatchObject({ id: 'blk-1', type: 'Heading', children: 'Hello', feature: { id: 'say', version: 1, params: { title: 'Hello' } } });
    expect(r.used.sort()).toEqual(['say', 'wrap']);
  });

  it('refuses a cycle a -> b -> a', () => {
    const lib = libOf(defOf('aa', wrapperBody('bb')), defOf('bb', wrapperBody('aa')));
    const r = expandFeature(lib.get('aa') as FeatureDefinition, { title: 'x' }, crewCtx(), lib, { rootId: 'r' });
    expect(codesOf(r)).toEqual(['feature_cycle']);
    expect(JSON.stringify(r)).toContain('aa -> bb -> aa');
  });

  it('allows 3 levels and refuses 4', () => {
    const lib = libOf(defOf('l1', headingBody()), defOf('l2', wrapperBody('l1')), defOf('l3', wrapperBody('l2')), defOf('l4', wrapperBody('l3')));
    const ok = expandFeature(lib.get('l3') as FeatureDefinition, { title: 'x' }, crewCtx(), lib, { rootId: 'r' });
    expect(ok.ok).toBe(true);
    const deep = expandFeature(lib.get('l4') as FeatureDefinition, { title: 'x' }, crewCtx(), lib, { rootId: 'r' });
    expect(codesOf(deep)).toEqual(['feature_too_deep']);
  });

  it.each(['__proto__', 'constructor', 'prototype'])('refuses the target segment %s', (segment) => {
    const body: FeatureBody = {
      params: [{ name: 'title', label: 'Title', type: 'text' }],
      fragment: layer('s', 'Section', { title: 'T' }),
      bindings: [{ param: 'title', layer: 's', target: `props.${segment}` }],
    };
    const r = expandFeature(defOf('evil', body), { title: 'x' }, crewCtx(), libOf(), { rootId: 'r' });
    expect(codesOf(r)).toEqual(['invalid_binding']);
    expect(({} as Record<string, unknown>).title).toBeUndefined();
  });

  it('refuses a path that does not exist, a non-slot target and a kind mismatch', () => {
    const base: FeatureBody = {
      params: [{ name: 'title', label: 'Title', type: 'text' }],
      fragment: layer('s', 'Section', { title: 'T', variant: 'card', className: 'x' }),
      bindings: [],
    };
    const run = (target: string, param: FeatureBody['params'][number] = base.params[0]): string[] =>
      codesOf(expandFeature(defOf('e', { ...base, params: [param], bindings: [{ param: param.name, layer: 's', target }] }), { [param.name]: 'v' }, crewCtx(), libOf(), { rootId: 'r' }));
    expect(run('props.subtitle')).toEqual(['invalid_binding']); // does not exist
    expect(run('props.variant')).toEqual(['invalid_binding']); // an enum, not a slot
    expect(run('props.className')).toEqual(['invalid_binding']); // never a slot
    expect(run('children')).toEqual(['invalid_binding']); // Section holds parts, not text
    expect(run('props.title', { name: 'title', label: 'Title', type: 'page' })).toEqual(['param_type']); // 'v' is not a page
  });

  it('never writes an object or a non-string: values are checked as text first', () => {
    const r = expandFeature(kpi(), { ...KPI_PARAMS, title: { evil: 1 } as unknown as string }, crewCtx(), seedLib(), { rootId: 'r' });
    expect(codesOf(r)).toEqual(['param_type']);
  });

  it('refuses a Feature node with children or extra props', () => {
    const withKids = layer('n', 'Feature', { featureId: 'kpi_row', params: KPI_PARAMS }, [layer('x', 'Text')]);
    const extra = layer('n', 'Feature', { featureId: 'kpi_row', params: KPI_PARAMS, className: 'x' });
    const fnValue = layer('n', 'Feature', { featureId: 'kpi_row', params: { source: 1 } });
    const page = (n: LayoutLayer): LayoutLayer => ({ ...ROOT_ONLY, children: [n] });
    expect(codesOf(expandLayout(page(withKids), seedLib(), crewCtx()))).toEqual(['feature_children']);
    expect(codesOf(expandLayout(page(extra), seedLib(), crewCtx()))).toEqual(['feature_props']);
    expect(codesOf(expandLayout(page(fnValue), seedLib(), crewCtx()))).toEqual(['feature_props']);
  });

  it('refuses an expansion that would push the page past 300 layers', () => {
    const many: LayoutLayer[] = Array.from({ length: 299 }, (_, i) => layer(`t${i}`, 'Divider'));
    const page: LayoutLayer = { ...ROOT_ONLY, children: [...many, featureNode('n', 'kpi_row', KPI_PARAMS)] };
    expect(codesOf(expandLayout(page, seedLib(), crewCtx()))).toEqual(['feature_too_large']);
  });
});

describe('checkParamValues', () => {
  const run = (params: unknown): string[] => checkParamValues(kpi(), params, crewCtx(), 'p').map((i) => i.code);
  it('accepts the good values', () => expect(run(KPI_PARAMS)).toEqual([]));
  it('reports missing and unknown names', () => {
    expect(run({ source: 'open_crews', amount: 'size' })).toEqual(['missing_param']);
    expect(run({ ...KPI_PARAMS, extra: 'x' })).toEqual(['unknown_param']);
  });
  it('checks text length, control characters and type', () => {
    expect(run({ ...KPI_PARAMS, title: '' })).toEqual(['param_type']);
    expect(run({ ...KPI_PARAMS, title: 'x'.repeat(2001) })).toEqual(['param_type']);
    expect(run({ ...KPI_PARAMS, title: 'a\u0000b' })).toEqual(['param_type']);
    expect(run({ ...KPI_PARAMS, title: 'two\nlines' })).toEqual([]);
    expect(run({ ...KPI_PARAMS, title: 5 })).toEqual(['param_type']);
  });
  it('checks source existence and mode, and prototype keys', () => {
    expect(run({ ...KPI_PARAMS, source: 'one_crew' })).toContain('param_type');
    expect(run({ ...KPI_PARAMS, source: 'nope' })).toContain('param_type');
    expect(run({ ...KPI_PARAMS, source: '__proto__' })).toContain('param_type');
    expect(run({ ...KPI_PARAMS, source: 'constructor' })).toContain('param_type');
  });
  it('checks a field through its source, by name and by type', () => {
    expect(run({ ...KPI_PARAMS, amount: 'name' })).toEqual(['param_type']); // text, not a number field
    expect(run({ ...KPI_PARAMS, amount: 'nope' })).toEqual(['param_type']);
  });
  it('resolves a field through a table param, and checks table and page params', () => {
    const body: FeatureBody = {
      params: [
        { name: 'table', label: 'Table', type: 'table' },
        { name: 'col', label: 'Column', type: 'field', of: 'table' },
        { name: 'go', label: 'Page', type: 'page' },
      ],
      fragment: layer('s', 'Section'),
      bindings: [],
    };
    const def = defOf('t', body);
    const run2 = (p: Record<string, string>): string[] => checkParamValues(def, p, crewCtx(), 'p').map((i) => i.code);
    expect(run2({ table: 'crews', col: 'size', go: 'home' })).toEqual([]);
    expect(run2({ table: 'people', col: 'size', go: 'home' })).toEqual(['param_type']); // size is a crews field
    expect(run2({ table: 'nope', col: 'size', go: 'nope' })).toEqual(['param_type', 'param_type']);
    expect(run2({ table: 'crews', col: 'size', go: 'nope' })).toEqual(['param_type']);
  });
});

describe('expandLayout and spec helpers', () => {
  it('returns the same object when there is no Feature node', () => {
    const r = expandLayout(ROOT_ONLY, seedLib(), crewCtx());
    expect(r).toEqual({ ok: true, value: ROOT_ONLY, used: [] });
    if (r.ok) expect(r.value).toBe(ROOT_ONLY);
  });

  it('replaces Feature nodes at any depth, in document order, without touching the input', () => {
    const page: LayoutLayer = {
      ...ROOT_ONLY,
      children: [layer('c', 'Card', {}, [featureNode('first', 'kpi_row', KPI_PARAMS)]), featureNode('second', 'kpi_row', { ...KPI_PARAMS, title: 'Again' })],
    };
    const before = JSON.stringify(page);
    const r = expandLayout(page, seedLib(), crewCtx());
    expect(JSON.stringify(page)).toBe(before);
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(JSON.stringify(r.value)).not.toContain('"Feature"');
    const kids = r.value.children as LayoutLayer[];
    expect(((kids[0].children as LayoutLayer[])[0]).id).toBe('first');
    expect(kids[1].id).toBe('second');
    expect(kids[1].props.title).toBe('Again');
  });

  it('reports unknown_feature with the known ids', () => {
    const r = expandLayout({ ...ROOT_ONLY, children: [featureNode('n', 'nope', {})] }, seedLib(), crewCtx(), { path: 'pages.0.layout' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0]).toMatchObject({ code: 'unknown_feature', path: 'pages.0.layout.children.0.props.featureId' });
      expect(r.issues[0].message).toContain('kpi_row');
    }
  });

  it('expands every page of a raw spec and leaves malformed input alone', () => {
    const spec = crewSpec({ ...ROOT_ONLY, children: [featureNode('n', 'kpi_row', KPI_PARAMS)] });
    expect(hasFeatureNodes(spec)).toBe(true);
    const r = expandSpecFeatures(spec, seedLib());
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(hasFeatureNodes(r.value)).toBe(false);
    expect(validateAppSpec(r.value, { checkLayout }).issues).toEqual([]);
    expect(featureMarkers(r.value)).toEqual(new Map([['kpi_row', 1]]));
    expect(hasFeatureNodes(spec)).toBe(true); // the input is untouched
    for (const bad of [null, 5, 'x', {}, { pages: 5 }, { pages: [null, 5, { layout: 7 }] }]) {
      expect(expandSpecFeatures(bad, seedLib())).toEqual({ ok: true, value: bad, used: [] });
    }
    const noRoute = { pages: [{ id: 'home', layout: { ...ROOT_ONLY, children: [featureNode('n', 'kpi_row', KPI_PARAMS)] } }] };
    expect(() => expandSpecFeatures(noRoute, seedLib())).not.toThrow();
  });

  it('collects issues of a bad page with the page path', () => {
    const spec = crewSpec({ ...ROOT_ONLY, children: [featureNode('n', 'kpi_row', { ...KPI_PARAMS, source: 'one_crew' })] }) as AppSpecInput;
    const r = expandSpecFeatures(spec, seedLib());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]).toMatchObject({ code: 'param_type', path: 'pages.1.layout.children.0.props.params.source' });
  });

  it('counts markers including nested ones', () => {
    const spec = { pages: [{ layout: { feature: { id: 'a' }, children: [{ feature: { id: 'b' }, children: [{ feature: { id: 'a' }, children: [] }] }] } }] };
    expect(featureMarkers(spec)).toEqual(new Map([['a', 2], ['b', 1]]));
  });
});

describe('expandLayout page budget', () => {
  // A page of one Section plus n Feature nodes, each expanding to one Heading: n + 1 parts after expansion.
  const pageWith = (n: number): LayoutLayer => ({
    id: 'root',
    type: 'Section',
    props: {},
    children: Array.from({ length: n }, (_, i) => featureNode(`f${i}`, 'say', { title: 'x' })),
  });
  const lib = libOf(defOf('say', headingBody()));

  it('accepts a page of exactly 300 parts', () => {
    const r = expandLayout(pageWith(299), lib, crewCtx());
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it('refuses a page of 301 parts', () => {
    const r = expandLayout(pageWith(300), lib, crewCtx());
    expect(codesOf(r)).toContain('feature_too_large');
  });
});
