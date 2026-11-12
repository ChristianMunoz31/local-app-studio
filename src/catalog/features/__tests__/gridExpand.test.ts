// The grid block through features (phase 21, ADR-012): a Feature node's block wins over its fragment root's, a fragment root
// never brings one, and Save as feature drops the selection root's block and keeps the inner ones.
import { describe, expect, it } from 'vitest';
import type { GridPlace } from '@local-app-studio/runtime/spec/gridPlacement';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { crewCtx, layer } from '../../__tests__/fixtures.ts';
import { expandFeature, expandLayout } from '../expand.ts';
import { validateFeatureInput } from '../validate.ts';
import type { FeatureBody, FeatureDefinition } from '../types.ts';
import { defOf, libOf } from './helpers.ts';
import { buildFeatureInput, defaultChoices, slotGroups } from '@/studio/lib/featureFromSelection';

const NODE_AT: GridPlace = { col: 4, span: 6, row: 2, rowSpan: 2 };
const ROOT_AT: GridPlace = { col: 1, span: 3, row: 1, rowSpan: 1 };
const kidsOf = (l: LayoutLayer): LayoutLayer[] => (Array.isArray(l.children) ? l.children : []);
const placed = (l: LayoutLayer, grid: GridPlace): LayoutLayer => ({ ...l, grid });

const innerBody = (): FeatureBody => ({
  params: [{ name: 'title', label: 'Title', type: 'text' }],
  fragment: layer('h', 'Heading', {}, 'Placeholder'),
  bindings: [{ param: 'title', layer: 'h', target: 'children' }],
});

/** A Card whose fragment root is a Feature node of `inner`, the node carrying `grid` when given. */
const wrapBody = (grid?: GridPlace): FeatureBody => {
  const node = layer('n', 'Feature', { featureId: 'inner', params: { title: 'x' } });
  return {
    params: [{ name: 'title', label: 'Title', type: 'text' }],
    fragment: layer('w', 'Card', {}, [grid === undefined ? node : placed(node, grid)]),
    bindings: [{ param: 'title', layer: 'n', target: 'props.params.title' }],
  };
};

describe('expandFeature and the grid block', () => {
  it('a nested Feature node gives its block to the expanded layer', () => {
    const lib = libOf(defOf('inner', innerBody()), defOf('wrap', wrapBody(NODE_AT)));
    const r = expandFeature(lib.get('wrap') as FeatureDefinition, { title: 'Hi' }, crewCtx(), lib, { rootId: 'blk' });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(kidsOf(r.value)[0].grid).toEqual(NODE_AT);
  });

  it('a fragment root never brings a block', () => {
    const body = innerBody();
    body.fragment = placed(body.fragment, ROOT_AT);
    const lib = libOf(defOf('inner', body), defOf('wrap', wrapBody()));
    const r = expandFeature(lib.get('wrap') as FeatureDefinition, { title: 'Hi' }, crewCtx(), lib, { rootId: 'blk' });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect('grid' in kidsOf(r.value)[0]).toBe(false);
  });
});

describe('expandLayout and the grid block', () => {
  it('a page Feature node keeps its own block and drops the fragment root block', () => {
    const body = innerBody();
    body.fragment = placed(body.fragment, ROOT_AT);
    const lib = libOf(defOf('inner', body));
    const node = (id: string, grid?: GridPlace): LayoutLayer => {
      const n = layer(id, 'Feature', { featureId: 'inner', params: { title: 'Hi' } });
      return grid === undefined ? n : placed(n, grid);
    };
    const free = layer('g', 'Grid', { placement: 'free', columns: 12, rows: 3 }, [node('a', NODE_AT), node('b')]);
    const r = expandLayout(layer('root', 'Page', {}, [free]), lib, crewCtx());
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const [a, b] = kidsOf(kidsOf(r.value)[0]);
    expect(a.grid).toEqual(NODE_AT);
    expect('grid' in b).toBe(false);
  });
});

describe('featureFromSelection and the grid block', () => {
  it('drops the selection root block and keeps the inner ones', () => {
    const selection = placed(
      layer('sec', 'Section', {}, [
        layer('g', 'Grid', { placement: 'free', columns: 12, rows: 1 }, [placed(layer('t', 'Text', {}, 'Hi'), ROOT_AT)]),
      ]),
      NODE_AT,
    );
    const lib = libOf();
    const { groups } = slotGroups(selection, lib);
    const all = defaultChoices(groups, lib);
    const forced = all.params.filter((p) => groups.find((g) => g.key === p.group)?.forced);
    const input = buildFeatureInput(selection, { ...all, id: 'free_card', label: 'Free card', description: 'A free grid.', params: forced }, lib);
    expect('grid' in input.fragment).toBe(false);
    const grid = kidsOf(input.fragment)[0];
    expect(kidsOf(grid)[0].grid).toEqual(ROOT_AT);
    expect(validateFeatureInput(input, lib).ok).toBe(true);
  });
});
