// Layer sizing through features (DESIGN-phase9.md 2.7): placement belongs to the place, so it survives expansion, a
// Feature node's sizing wins over its fragment root's, and Save as feature then placing keeps every width.
import { describe, expect, it } from 'vitest';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema.ts';
import { crewCtx, layer } from '../../__tests__/fixtures.ts';
import { expandFeature, expandLayout } from '../expand.ts';
import { validateFeatureInput } from '../validate.ts';
import type { FeatureBody, FeatureDefinition } from '../types.ts';
import { defOf, libOf } from './helpers.ts';
import { buildFeatureInput, defaultChoices, slotGroups, valuesOf } from '@/studio/lib/featureFromSelection';
import { newFeatureLayer } from '@/studio/lib/layoutTree';
import { stableJson } from '@/studio/lib/stableJson';

const sized = (l: LayoutLayer, sizing: LayoutLayer['sizing']): LayoutLayer => ({ ...l, sizing });
const kidsOf = (l: LayoutLayer): LayoutLayer[] => (Array.isArray(l.children) ? l.children : []);
const HALF = { width: 'half' as const, grow: false };
const THIRD = { width: 'third' as const, grow: true };

/** A Section (sized a third) holding a Heading (half) with its text bound. */
const sectionBody = (): FeatureBody => ({
  params: [{ name: 'title', label: 'Title', type: 'text' }],
  fragment: sized(layer('s', 'Section', {}, [sized(layer('h', 'Heading', {}, 'Placeholder'), HALF)]), THIRD),
  bindings: [{ param: 'title', layer: 'h', target: 'children' }],
});

/** A Card holding a Feature node of `inner`, the node sized as given. */
const wrapBody = (inner: string, nodeSizing?: LayoutLayer['sizing']): FeatureBody => {
  const node = layer('n', 'Feature', { featureId: inner, params: { title: 'x' } });
  return {
    params: [{ name: 'title', label: 'Title', type: 'text' }],
    fragment: layer('w', 'Card', {}, [nodeSizing === undefined ? node : sized(node, nodeSizing)]),
    bindings: [{ param: 'title', layer: 'n', target: 'props.params.title' }],
  };
};

describe('expandFeature keeps sizing', () => {
  it('on the fragment root and inside it', () => {
    const lib = libOf(defOf('sec', sectionBody()));
    const r = expandFeature(lib.get('sec') as FeatureDefinition, { title: 'Hi' }, crewCtx(), lib, { rootId: 'blk' });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(r.value.sizing).toEqual(THIRD);
    expect(kidsOf(r.value)[0].sizing).toEqual(HALF);
  });

  it('a nested Feature node with sizing wins over the inner fragment root', () => {
    const lib = libOf(defOf('sec', sectionBody()), defOf('wrap', wrapBody('sec', { width: 'quarter', grow: false })));
    const r = expandFeature(lib.get('wrap') as FeatureDefinition, { title: 'Hi' }, crewCtx(), lib, { rootId: 'blk' });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const inner = kidsOf(r.value)[0];
    expect(inner.feature?.id).toBe('sec');
    expect(inner.sizing).toEqual({ width: 'quarter', grow: false });
    expect(kidsOf(inner)[0].sizing).toEqual(HALF);
  });

  it('a nested Feature node without sizing leaves the inner root its own', () => {
    const lib = libOf(defOf('sec', sectionBody()), defOf('wrap', wrapBody('sec')));
    const r = expandFeature(lib.get('wrap') as FeatureDefinition, { title: 'Hi' }, crewCtx(), lib, { rootId: 'blk' });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(kidsOf(r.value)[0].sizing).toEqual(THIRD);
    expect('sizing' in r.value).toBe(false);
  });
});

describe('expandLayout keeps a page Feature node sizing', () => {
  it('node sizing wins; no node sizing keeps the fragment root sizing', () => {
    const lib = libOf(defOf('sec', sectionBody()));
    const node = (id: string, s?: LayoutLayer['sizing']): LayoutLayer => {
      const n = layer(id, 'Feature', { featureId: 'sec', params: { title: 'Hi' } });
      return s === undefined ? n : sized(n, s);
    };
    const root = layer('root', 'Page', {}, [node('a', HALF), node('b')]);
    const r = expandLayout(root, lib, crewCtx());
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const [a, b] = kidsOf(r.value);
    expect(a.sizing).toEqual(HALF);
    expect(b.sizing).toEqual(THIRD);
  });
});

describe('validateFeatureInput and sizing', () => {
  it('accepts sizing in a fragment', () => {
    const r = validateFeatureInput({ id: 'sec_x', label: 'Sec', description: 'A section.', ...sectionBody() }, libOf());
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (r.ok) expect(r.value.fragment.sizing).toEqual(THIRD);
  });

  it('refuses sizing on a Tab inside a fragment', () => {
    const tab = sized(layer('tab', 'Tab', { label: 'First' }, [layer('x', 'Text', {}, 'One')]), HALF);
    const body: FeatureBody = { params: [], fragment: layer('tabs', 'Tabs', {}, [tab]), bindings: [] };
    const r = validateFeatureInput({ id: 'tabs_x', label: 'Tabs', description: 'Some tabs.', ...body }, libOf());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.map((i) => i.code)).toContain('invalid_fragment');
    expect(r.issues.map((i) => i.message).join(' ')).toContain('Tab takes the width of the part it is in, so it cannot have sizing.');
  });
});

describe('Save as feature then place keeps every width', () => {
  it('sizing of every layer survives featureFromSelection and newFeatureLayer', () => {
    const empty = libOf();
    const selection = sized(
      layer('sec', 'Section', { title: 'Crews' }, [
        sized(layer('a', 'StatCard', { source: 'open_crews', stat: 'count', label: 'Crews' }), HALF),
        sized(layer('b', 'StatCard', { source: 'open_crews', stat: 'sum', field: 'size', label: 'People' }), THIRD),
        layer('t', 'Text', {}, 'Plain'),
      ]),
      { width: 'two-thirds', grow: false },
    );
    const { groups } = slotGroups(selection, empty);
    const all = defaultChoices(groups, empty);
    const params = all.params.filter((p) => groups.find((g) => g.key === p.group)?.forced);
    const choices = { ...all, id: 'crew_numbers', label: 'Crew numbers', description: 'Counts crews.', params };
    const input = buildFeatureInput(selection, choices, empty);
    const checked = validateFeatureInput(input, empty);
    if (!checked.ok) throw new Error(JSON.stringify(checked.issues));
    const def: FeatureDefinition = { ...checked.value, version: 1, updatedAt: '2026-01-01T00:00:00.000Z' };
    const placed = newFeatureLayer(def, valuesOf(groups, choices), crewCtx(), libOf(def), new Set(['root']));
    if (!placed.ok) throw new Error(JSON.stringify(placed.issues));
    const widths = (l: LayoutLayer): string[] => [stableJson(l.sizing ?? null), ...kidsOf(l).flatMap(widths)];
    expect(widths(placed.value)).toEqual(widths(selection));
    expect(widths(placed.value)).toEqual([stableJson({ width: 'two-thirds', grow: false }), stableJson(HALF), stableJson(THIRD), 'null']);
  });

  it('an inner block becomes a Feature node that keeps its sizing', () => {
    const lib = libOf(defOf('sec', sectionBody()));
    const block = expandFeature(lib.get('sec') as FeatureDefinition, { title: 'Hi' }, crewCtx(), lib, { rootId: 'blk' });
    if (!block.ok) throw new Error('expand failed');
    const selection = layer('wrap', 'Card', {}, [sized(block.value, HALF)]);
    const { groups } = slotGroups(selection, lib);
    const all = defaultChoices(groups, lib);
    const input = buildFeatureInput(selection, { ...all, id: 'wrapped', label: 'Wrapped', params: [] }, lib);
    const node = kidsOf(input.fragment)[0];
    expect(node.type).toBe('Feature');
    expect(node.sizing).toEqual(HALF);
  });
});
