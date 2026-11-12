import { describe, expect, it } from 'vitest';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { PLACE_DIFF_SHOWN, diffSpecs, isPlaceChange } from '../specDiff';
import type { SpecChange } from '../specDiff';
import { baseSpec } from '../../__tests__/fixtures';
import { block, gridSpec, three, tile } from './placeFixtures';

const places = (before: AppSpec, after: AppSpec): SpecChange[] => diffSpecs(before, after).filter(isPlaceChange);
const sentences = (before: AppSpec, after: AppSpec): string[] => places(before, after).map((c) => c.sentence);
const withBoard = (spec: AppSpec): AppSpec => {
  spec.pages.push({ ...structuredClone(spec.pages[0]), id: 'board', title: 'Board', route: '/board' });
  return spec;
};

describe('diffSpecs place sentences', () => {
  it('P1: an added page with a free Grid gets one line counting its children', () => {
    expect(places(gridSpec([]), withBoard(gridSpec(three()))).filter((c) => c.path.includes('board'))).toEqual([
      { kind: 'added', area: 'page', path: 'pages.board.layout.place', sentence: 'Places 3 parts in a grid on Board.', destructive: false, parts: 3 },
    ]);
  });

  it('P1: an added page with a flow Grid gets no place line', () => {
    expect(places(gridSpec([], { free: false }), withBoard(gridSpec(three(), { free: false })))).toEqual([]);
  });

  it('P1: a first design over the starter page (no Grid before) gets the P1 line on the changed page, not P2', () => {
    expect(places(baseSpec(), gridSpec(three()))).toEqual([
      { kind: 'added', area: 'page', path: 'pages.home.layout.place', sentence: 'Places 3 parts in a grid on Home.', destructive: false, parts: 3 },
    ]);
  });

  it('P1: a free Grid with another id than the flow Grid before it is new, and the old flow Grid gets no P2 line', () => {
    const flow = gridSpec(three(), { free: false, gridId: 'grid_old' });
    expect(sentences(flow, gridSpec(three(), { gridId: 'grid_new' }))).toEqual(['Places 3 parts in a grid on Home.']);
  });

  it('P2: turning a Grid on or off, with the Grid name', () => {
    const flow = gridSpec(three(), { free: false, gridName: 'Tiles' });
    const free = gridSpec(three(), { gridName: 'Tiles' });
    expect(places(flow, free)).toEqual([
      { kind: 'changed', area: 'page', path: 'pages.home.layout.grid_1.placement', sentence: 'Turns on Place parts freely for Tiles on Home.', destructive: false },
    ]);
    expect(sentences(free, flow)).toEqual(['Turns off Place parts freely for Tiles on Home.']);
    expect(sentences(gridSpec(three(), { free: false }), gridSpec(three()))).toEqual(['Turns on Place parts freely for Auto grid on Home.']);
  });

  it('P3: a part moved keeps its size (row, column, or both)', () => {
    const before = gridSpec(three());
    const row = gridSpec([tile('statcard_1', 'StatCard', block(1, 4, 3)), ...three().slice(1)]);
    expect(places(before, row)).toEqual([
      { kind: 'changed', area: 'page', path: 'pages.home.layout.statcard_1.grid', sentence: 'Moves Number tile to row 3.', destructive: false },
    ]);
    const col = gridSpec([tile('statcard_1', 'StatCard', block(9, 4, 1)), ...three().slice(1)]);
    expect(sentences(before, col)).toEqual(['Moves Number tile to column 9.']);
    const both = gridSpec([tile('statcard_1', 'StatCard', block(9, 4, 3)), ...three().slice(1)]);
    expect(sentences(before, both)).toEqual(['Moves Number tile to column 9 of row 3.']);
  });

  it('names row 1 "the top row"', () => {
    const before = gridSpec([tile('chart_1', 'Chart', block(1, 8, 2, 3)), tile('statcard_1', 'StatCard', block(1, 4, 5))]);
    const after = gridSpec([tile('chart_1', 'Chart', block(1, 8, 1, 3)), tile('statcard_1', 'StatCard', block(1, 4, 5))]);
    expect(sentences(before, after)).toEqual(['Moves Chart to the top row.']);
  });

  it('P4: a part resized keeps its corner (width, height, both)', () => {
    const before = gridSpec(three());
    const wide = gridSpec([...three().slice(0, 2), tile('chart_1', 'Chart', block(1, 12, 2, 3))]);
    expect(places(before, wide)).toEqual([
      { kind: 'changed', area: 'page', path: 'pages.home.layout.chart_1.grid', sentence: 'Makes Chart 12 columns wide.', destructive: false },
    ]);
    const short = gridSpec([...three().slice(0, 2), tile('chart_1', 'Chart', block(1, 8, 2, 1))]);
    expect(sentences(before, short)).toEqual(['Makes Chart 1 row high.']);
    const both = gridSpec([...three().slice(0, 2), tile('chart_1', 'Chart', block(1, 6, 2, 2))]);
    expect(sentences(before, both)).toEqual(['Makes Chart 6 columns wide and 2 rows high.']);
  });

  it('P5: moved and resized in one line, with the height only when it changed', () => {
    const before = gridSpec(three());
    const moveWide = gridSpec([...three().slice(0, 2), tile('chart_1', 'Chart', block(7, 6, 2, 3))]);
    expect(sentences(before, moveWide)).toEqual(['Moves Chart to column 7, 6 columns wide.']);
    const moveBoth = gridSpec([...three().slice(0, 2), tile('chart_1', 'Chart', block(7, 6, 4, 2))]);
    expect(sentences(before, moveBoth)).toEqual(['Moves Chart to column 7 of row 4, 6 columns wide and 2 rows high.']);
  });

  it('P6: a part that was not on the Grid before gets a place line, the height only above one row', () => {
    const before = gridSpec(three());
    const after = gridSpec([...three(), tile('statcard_3', 'StatCard', block(9, 3, 1)), tile('table_1', 'DataTable', block(9, 4, 2, 3))]);
    expect(places(before, after)).toEqual([
      { kind: 'added', area: 'page', path: 'pages.home.layout.statcard_3.place', sentence: 'Places Number tile at column 9, row 1, 3 columns wide.', destructive: false },
      { kind: 'added', area: 'page', path: 'pages.home.layout.table_1.place', sentence: 'Places Table of records at column 9, row 2, 4 columns wide, 3 rows high.', destructive: false },
    ]);
  });

  it('uses the layer name when it has one', () => {
    const before = gridSpec(three());
    const after = gridSpec([...three(), tile('statcard_3', 'StatCard', block(9, 3, 1), 'Revenue')]);
    expect(sentences(before, after)).toEqual(['Places Revenue at column 9, row 1, 3 columns wide.']);
  });

  it('groups consecutive moves of one name to one place, in the plural', () => {
    const before = gridSpec([tile('statcard_1', 'StatCard', block(1, 4, 2)), tile('statcard_2', 'StatCard', block(5, 4, 2)), tile('chart_1', 'Chart', block(1, 8, 3, 2))]);
    const after = gridSpec([tile('statcard_1', 'StatCard', block(1, 4, 1)), tile('statcard_2', 'StatCard', block(5, 4, 1)), tile('chart_1', 'Chart', block(1, 8, 2, 2))]);
    const out = places(before, after);
    expect(out.map((c) => c.sentence)).toEqual(['Moves Number tiles to the top row.', 'Moves Chart to row 2.']);
    expect(out[0].path).toBe('pages.home.layout.statcard_1.grid');
  });

  it('does not group parts that carry a custom name (its plural would be a guess)', () => {
    const a = gridSpec([tile('x_1', 'Text', block(1, 3, 1), 'Summary'), tile('x_2', 'Text', block(4, 3, 1), 'Summary')]);
    const b = gridSpec([tile('x_1', 'Text', block(1, 3, 2), 'Summary'), tile('x_2', 'Text', block(4, 3, 2), 'Summary')]);
    expect(sentences(a, b)).toEqual(['Moves Summary to row 2.', 'Moves Summary to row 2.']);
  });

  it('carries the part count on a grouped line and on the P7 line, not on a single move', () => {
    const a = gridSpec([tile('s_1', 'StatCard', block(1, 4, 2)), tile('s_2', 'StatCard', block(5, 4, 2)), tile('t_1', 'Text', block(9, 2, 2), 'T')]);
    const b = gridSpec([tile('s_1', 'StatCard', block(1, 4, 1)), tile('s_2', 'StatCard', block(5, 4, 1)), tile('t_1', 'Text', block(9, 2, 1), 'T')]);
    expect(places(a, b).map((c) => c.parts)).toEqual([2, undefined]);
  });

  it('P7: past six lines the rest are counted in one sentence on the pages path', () => {
    const kids = Array.from({ length: 5 }, (_, i) => tile(`text_${i}`, 'Text', block(1 + i * 2, 2, 1), `T${i}`));
    const added = Array.from({ length: PLACE_DIFF_SHOWN + 2 }, (_, i) => tile(`note_${i}`, 'Text', block(1 + (i % 6) * 2, 2, 3 + Math.floor(i / 6)), `N${i}`));
    const after = gridSpec([...kids, ...added]);
    const out = places(gridSpec(kids), after);
    expect(out).toHaveLength(PLACE_DIFF_SHOWN + 1);
    expect(out[0].sentence).toBe('Places N0 at column 1, row 3, 2 columns wide.');
    expect(out[PLACE_DIFF_SHOWN].sentence).toBe('Changes the place of 2 more parts on Home.');
    expect(out[PLACE_DIFF_SHOWN].path).toBe('pages.home.layout.places');
  });

  it('turning the Grid on is one line: the parts that were already in it are not moved', () => {
    const kids = Array.from({ length: 3 }, (_, i) => tile(`text_${i}`, 'Text', block(1 + i * 2, 2, 1), `T${i}`));
    expect(sentences(gridSpec(kids, { free: false }), gridSpec(kids))).toEqual(['Turns on Place parts freely for Auto grid on Home.']);
  });

  it('puts moves before placed parts', () => {
    const before = gridSpec(three());
    const after = gridSpec([tile('statcard_1', 'StatCard', block(1, 4, 3)), ...three().slice(1), tile('statcard_3', 'StatCard', block(9, 3, 1))]);
    expect(sentences(before, after)).toEqual(['Moves Number tile to row 3.', 'Places Number tile at column 9, row 1, 3 columns wide.']);
  });

  it('says nothing when the blocks are the same, and nothing for a flow Grid', () => {
    expect(places(gridSpec(three()), gridSpec(three()))).toEqual([]);
    expect(places(gridSpec(three(), { free: false }), gridSpec(three(), { free: false }))).toEqual([]);
  });

  it('matches by id: a part under a new id is a placed part, not a move', () => {
    const before = gridSpec(three());
    const after = gridSpec([tile('statcard_9', 'StatCard', block(1, 4, 1)), ...three().slice(1)]);
    expect(sentences(before, after)).toEqual(['Places Number tile at column 1, row 1, 4 columns wide.']);
  });
});

describe('isPlaceChange', () => {
  const c = (area: SpecChange['area'], path: string): SpecChange => ({ kind: 'changed', area, path, sentence: '', destructive: false });
  it('knows the place paths and nothing else', () => {
    expect(isPlaceChange(c('page', 'pages.home.layout.grid_1.placement'))).toBe(true);
    expect(isPlaceChange(c('page', 'pages.home.layout.chart_1.grid'))).toBe(true);
    expect(isPlaceChange(c('page', 'pages.home.layout.chart_1.place'))).toBe(true);
    expect(isPlaceChange(c('page', 'pages.home.layout.place'))).toBe(true);
    expect(isPlaceChange(c('page', 'pages.home.layout.places'))).toBe(true);
    expect(isPlaceChange(c('page', 'pages.home.layout'))).toBe(false);
    expect(isPlaceChange(c('page', 'pages.home.layout.chart_1.sizing'))).toBe(false);
    expect(isPlaceChange(c('field', 'pages.home.layout.chart_1.grid'))).toBe(false);
  });
});
