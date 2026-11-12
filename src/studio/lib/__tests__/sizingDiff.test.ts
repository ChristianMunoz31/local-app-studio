// Widths in the change list and the Describe summary (DESIGN-phase9.md 2.9).
import { describe, expect, it } from 'vitest';
import type { AppSpec, LayerSizing, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { baseSpec } from '../../__tests__/fixtures';
import { diffSpecs } from '../specDiff';
import { pageLine, summarizeSpec } from '../specSummary';

const clone = (): AppSpec => structuredClone(baseSpec());
const sentences = (a: AppSpec, b: AppSpec): string[] => diffSpecs(a, b).map((c) => c.sentence);
const part = (id: string, type: string, props: LayoutLayer['props'] = {}, sizing?: LayerSizing): LayoutLayer => ({
  id,
  type,
  ...(sizing === undefined ? {} : { sizing }),
  props,
  children: [],
});
const withLayout = (...children: LayoutLayer[]): AppSpec => {
  const spec = clone();
  spec.pages[0].sources = [{ id: 'open_crews', table: 'crews', mode: 'list', where: [], orderBy: [], limit: 50 }];
  spec.pages[0].layout = { id: 'root_home', type: 'Page', props: {}, children };
  return spec;
};
const HALF: LayerSizing = { width: 'half', grow: false };
const LAYOUT = 'Changes the layout of "Home" (3 parts).';

describe('diffSpecs and widths', () => {
  it('says how a part now sits, by name or by part label', () => {
    const before = withLayout(part('q', 'QuickAdd', { table: 'crews', field: 'name' }), part('t', 'DataTable', { source: 'open_crews' }));
    const after = withLayout(
      { ...part('q', 'QuickAdd', { table: 'crews', field: 'name' }, HALF), name: 'Quick add' },
      part('t', 'DataTable', { source: 'open_crews' }, { width: 'fit', grow: true }),
    );
    expect(sentences(before, after)).toEqual([LAYOUT, 'Quick add now takes half the row.', 'Table of records now fills the rest of the row.']);
    const back = diffSpecs(after, before);
    expect(back.map((c) => c.sentence)).toEqual([LAYOUT, 'Quick add now takes the whole row.', 'Table of records now takes the whole row.']);
    expect(back[1]).toMatchObject({ kind: 'changed', area: 'page', path: 'pages.home.layout.q.sizing', destructive: false });
  });

  it('says nothing new when only an explicit full block appears', () => {
    const before = withLayout(part('a', 'Text'), part('b', 'Text'));
    const after = withLayout(part('a', 'Text', {}, { width: 'full', grow: false }), part('b', 'Text'));
    expect(sentences(before, after)).toEqual(['Changes the layout of "Home" (3 parts).']);
  });

  it('says nothing when a whole-row block that grows goes away (every whole row draws the same)', () => {
    const before = withLayout(part('a', 'Text', {}, { width: 'full', grow: true }), part('b', 'Text'));
    const after = withLayout(part('a', 'Text'), part('b', 'Text'));
    expect(sentences(before, after)).toEqual([LAYOUT]);
    expect(sentences(after, before)).toEqual([LAYOUT]);
  });

  it('folds the seventh change on a page into one sentence', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const before = withLayout(...ids.map((id) => part(id, 'Text')));
    const after = withLayout(...ids.map((id) => part(id, 'Text', {}, HALF)));
    const out = sentences(before, after);
    expect(out).toHaveLength(8);
    expect(out.slice(1, 7)).toEqual(Array.from({ length: 6 }, () => 'Text now takes half the row.'));
    expect(out[7]).toBe('Changes the width of 1 more parts on "Home".');
  });

  it('says nothing for layers inside a feature block, but counts the block root', () => {
    const block = (sizing?: LayerSizing, inner?: LayerSizing): LayoutLayer => ({
      ...part('blk', 'Section', {}, sizing),
      name: 'Number row',
      feature: { id: 'kpi_row', version: 1, params: {} },
      children: [part('blk-1', 'Text', {}, inner)],
    });
    expect(sentences(withLayout(block()), withLayout(block(undefined, HALF)))).toEqual(['Changes the layout of "Home" (3 parts).']);
    expect(sentences(withLayout(block()), withLayout(block(HALF)))).toEqual(['Changes the layout of "Home" (3 parts).', 'Number row now takes half the row.']);
  });

  it('ignores a changed type under the same id', () => {
    const out = sentences(withLayout(part('a', 'Text')), withLayout(part('a', 'Heading', {}, HALF)));
    expect(out).toEqual(['Changes the layout of "Home" (2 parts).']);
  });
});

describe('summarizeSpec and widths', () => {
  it('adds the width to a part sentence', () => {
    const spec = withLayout(part('n', 'StatCard', { source: 'open_crews', label: 'Total' }, HALF), part('t', 'DataTable', { source: 'open_crews' }));
    const page = summarizeSpec(spec).pages[0];
    expect(page.parts).toEqual(['a number: Total (half the row)', 'a list of Crews']);
    expect(pageLine(page)).toBe('Home: a number: Total (half the row) and a list of Crews');
  });

  it('adds the width to a feature block sentence', () => {
    const blk: LayoutLayer = { ...part('blk', 'Section', {}, { width: 'fit', grow: true }), name: 'Number row', feature: { id: 'kpi_row', version: 1, params: {} } };
    expect(summarizeSpec(withLayout(blk)).pages[0].parts).toEqual(['the feature Number row (fills the rest of the row)']);
  });

  it('gives the phase 8 sentences without sizing', () => {
    const spec = withLayout(part('n', 'StatCard', { source: 'open_crews', label: 'Total' }), part('t', 'DataTable', { source: 'open_crews' }));
    expect(summarizeSpec(spec).pages[0].parts).toEqual(['a number: Total', 'a list of Crews']);
    const full = withLayout(part('n', 'StatCard', { source: 'open_crews', label: 'Total' }, { width: 'full', grow: true }));
    expect(summarizeSpec(full).pages[0].parts).toEqual(['a number: Total']);
  });
});
