import { describe, expect, it } from 'vitest';
import type { GridPlace } from '@local-app-studio/runtime/spec/gridPlacement';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { crewCtx, layer } from '@/catalog/__tests__/fixtures';
import { checkLayer } from '@/catalog/validateLayout';
import {
  dropPlace,
  fillRow,
  flowColumnsFor,
  gridDropIds,
  insertAtCell,
  isFreeGrid,
  moveToCell,
  placeOf,
  placesIn,
  setPlace,
  stepInGrid,
  syncGrids,
  toFlow,
  toFree,
} from '../gridLayout';
import { EDGE_WORDS, GRID_FULL_WORDS, GRID_OVERLAP_WORDS, NOT_FREE_WORDS, OUT_OF_GRID_WORDS, TALLEST_WORDS, TOO_MANY_WORDS } from '../gridWords';
import { toLayoutLayer } from '../layout';
import { findLayer, replaceLayer } from '../layoutTree';
import type { TreeResult } from '../layoutTree';

const at = (col: number, span: number, row: number, rowSpan: number): GridPlace => ({ col, span, row, rowSpan });
const text = (id: string, grid?: GridPlace): LayoutLayer => ({ ...layer(id, 'Text', {}, id), ...(grid === undefined ? {} : { grid }) });
const kidsOf = (l: LayoutLayer): LayoutLayer[] => (Array.isArray(l.children) ? l.children : []);
const free = (id: string, children: LayoutLayer[], rows = 1): LayoutLayer => layer(id, 'Grid', { placement: 'free', columns: 12, rows }, children);
const page = (...children: LayoutLayer[]): LayoutLayer => layer('root', 'Page', {}, children);
const must = (r: TreeResult): LayoutLayer => {
  if (!r.ok) throw new Error(`${r.reason}: ${r.message}`);
  return r.root;
};
const refusal = (r: TreeResult): { reason: string; message: string } => {
  if (r.ok) throw new Error('expected a refusal');
  return { reason: r.reason, message: r.message };
};
const gridOf = (root: LayoutLayer, id = 'g'): LayoutLayer => findLayer(root, id)!.layer;
const placesOfKids = (root: LayoutLayer, id = 'g'): Array<GridPlace | undefined> => kidsOf(gridOf(root, id)).map((c) => c.grid);

/** root > g (free: a at 1..3 row 1, b at 4..6 row 1, rows 1) */
const base = (): LayoutLayer => page(free('g', [text('a', at(1, 3, 1, 1)), text('b', at(4, 3, 1, 1))]));

describe('isFreeGrid, placeOf, placesIn', () => {
  it('reads free Grids and places', () => {
    const root = base();
    expect(isFreeGrid(gridOf(root))).toBe(true);
    expect(isFreeGrid(layer('x', 'Grid', {}))).toBe(false);
    expect(isFreeGrid(null)).toBe(false);
    expect(placeOf(root, 'a')).toEqual(at(1, 3, 1, 1));
    expect(placeOf(root, 'g')).toBeNull();
    expect(placeOf(root, 'missing')).toBeNull();
    expect(placesIn(gridOf(root), 'a')).toEqual([at(4, 3, 1, 1)]);
  });

  it('placeOf is null for a part in a feature block or without a block', () => {
    const block: LayoutLayer = { ...layer('blk', 'Section', {}, [text('inner', at(1, 3, 1, 1))]), feature: { id: 'f', version: 1, params: {} } };
    expect(placeOf(page(free('g', [block])), 'inner')).toBeNull();
    expect(placeOf(page(free('g', [text('c')])), 'c')).toBeNull();
  });
});

describe('syncGrids', () => {
  it('gives back the same object when consistent', () => {
    const root = base();
    expect(syncGrids(root)).toBe(root);
    const flow = page(layer('g', 'Grid', { columns: 2 }, [text('a')]));
    expect(syncGrids(flow)).toBe(flow);
  });

  it('drops the block of a part whose parent is not a free Grid', () => {
    const root = page(layer('s', 'Section', {}, [text('a', at(1, 3, 1, 1))]), layer('g', 'Grid', { columns: 2 }, [text('b', at(1, 3, 1, 1))]));
    const out = syncGrids(root);
    expect('grid' in findLayer(out, 'a')!.layer).toBe(false);
    expect('grid' in findLayer(out, 'b')!.layer).toBe(false);
  });

  it('places unplaced and overlapping children on the next free cell', () => {
    const root = page(free('g', [text('a', at(1, 3, 1, 1)), text('b'), text('c', at(2, 3, 1, 1)), text('d', at(4, 3, 1, 1))]));
    const out = syncGrids(root);
    const byId = Object.fromEntries(kidsOf(gridOf(out)).map((c) => [c.id, c.grid]));
    expect(byId.a).toEqual(at(1, 3, 1, 1));
    expect(byId.d).toEqual(at(4, 3, 1, 1));
    expect(byId.b).toEqual(at(7, 3, 1, 1));
    expect(byId.c).toEqual(at(10, 3, 1, 1));
  });

  it('sorts into reading order and keeps rows and columns in step', () => {
    const root = page(layer('g', 'Grid', { placement: 'free', columns: 2, rows: 9 }, [text('b', at(1, 3, 3, 2)), text('a', at(1, 3, 1, 1))]));
    const out = syncGrids(root);
    expect(kidsOf(gridOf(out)).map((c) => c.id)).toEqual(['a', 'b']);
    expect(gridOf(out).props).toMatchObject({ placement: 'free', columns: 12, rows: 4 });
  });

  it('writes rows 1 for an empty free Grid', () => {
    const out = syncGrids(page(layer('g', 'Grid', { placement: 'free', columns: 12 }, [])));
    expect(gridOf(out).props.rows).toBe(1);
  });

  it('keeps the inside of a feature block but updates the block own key', () => {
    const inside = layer('t', 'Text', {}, 'x');
    const block: LayoutLayer = { ...layer('blk', 'Grid', { placement: 'free', columns: 2, rows: 9 }, [{ ...inside, grid: at(1, 3, 1, 1) }]), feature: { id: 'f', version: 1, params: {} }, grid: at(1, 3, 1, 1) };
    const out = syncGrids(page(free('fg', [block], 1)));
    const kept = kidsOf(kidsOf(out)[0])[0];
    expect(kept.props).toEqual({ placement: 'free', columns: 2, rows: 9 });
    expect(kept.grid).toEqual(at(1, 3, 1, 1));
    const out2 = syncGrids(page(layer('s', 'Section', {}, [block])));
    expect('grid' in kidsOf(kidsOf(out2)[0])[0]).toBe(false);
    expect(kidsOf(kidsOf(kidsOf(out2)[0])[0])[0].grid).toEqual(at(1, 3, 1, 1));
  });

  it('drops the block when no cell is left', () => {
    const full: LayoutLayer[] = [];
    for (let row = 1; row <= 60; row += 1) full.push(text(`f${row}`, at(1, 12, row, 1)));
    const out = syncGrids(page(free('g', [...full, text('extra')], 60)));
    expect(kidsOf(gridOf(out)).find((c) => c.id === 'extra')!.grid).toBeUndefined();
  });
});

describe('gridDropIds and dropPlace', () => {
  it('lists free Grids a part may go into, with its own parent', () => {
    const root = page(base().children[0] as LayoutLayer, layer('flow', 'Grid', { columns: 2 }, []));
    const ids = gridDropIds(root, 'Text');
    expect([...ids]).toEqual(['g']);
    expect([...gridDropIds(root, 'Text', 'b')]).toEqual(['g']);
    expect([...gridDropIds(root, 'Page')]).toEqual([]);
  });

  it('computes where a drop lands', () => {
    const root = base();
    expect(dropPlace(root, 'g', { col: 8, row: 2 }, null)).toEqual({ place: at(8, 3, 2, 1), free: true });
    expect(dropPlace(root, 'g', { col: 2, row: 1 }, null)).toEqual({ place: at(2, 3, 1, 1), free: false });
    expect(dropPlace(root, 'g', { col: 12, row: 1 }, null)).toEqual({ place: at(10, 3, 1, 1), free: true });
    expect(dropPlace(root, 'g', null, null)).toEqual({ place: at(7, 3, 1, 1), free: true });
    expect(dropPlace(root, 'root', null, null)).toBeNull();
  });

  it('a part already in the Grid keeps its size and ignores itself', () => {
    const root = page(free('g', [text('a', at(1, 6, 1, 2))], 2));
    expect(dropPlace(root, 'g', { col: 3, row: 1 }, 'a')).toEqual({ place: at(3, 6, 1, 2), free: true });
  });

  it('is null when the Grid is full', () => {
    const full: LayoutLayer[] = [];
    for (let row = 1; row <= 60; row += 1) full.push(text(`f${row}`, at(1, 12, row, 1)));
    expect(dropPlace(page(free('g', full, 60)), 'g', null, null)).toBeNull();
  });
});

describe('insertAtCell', () => {
  it('adds the part at the cell', () => {
    const out = must(insertAtCell(base(), 'g', text('n'), { col: 8, row: 2 }));
    expect(placeOf(out, 'n')).toEqual(at(8, 3, 2, 1));
    expect(gridOf(out).props.rows).toBe(2);
    expect(kidsOf(gridOf(out)).map((c) => c.id)).toEqual(['a', 'b', 'n']);
  });

  it('uses the next free cell without a cell', () => {
    expect(placeOf(must(insertAtCell(base(), 'g', text('n'), null)), 'n')).toEqual(at(7, 3, 1, 1));
  });

  it('refuses on taken cells, a full Grid, a flow Grid and a missing Grid', () => {
    expect(refusal(insertAtCell(base(), 'g', text('n'), { col: 1, row: 1 }))).toEqual({ reason: 'grid_overlap', message: GRID_OVERLAP_WORDS });
    const full: LayoutLayer[] = [];
    for (let row = 1; row <= 60; row += 1) full.push(text(`f${row}`, at(1, 12, row, 1)));
    expect(refusal(insertAtCell(page(free('g', full, 60)), 'g', text('n'), null)).reason).toBe('grid_full');
    expect(refusal(insertAtCell(page(layer('g', 'Grid', {}, [])), 'g', text('n'), null))).toEqual({ reason: 'not_free', message: NOT_FREE_WORDS });
    expect(refusal(insertAtCell(base(), 'nope', text('n'), null)).reason).toBe('not_found');
  });
});

describe('moveToCell', () => {
  it('moves inside the Grid, keeping the size', () => {
    const out = must(moveToCell(base(), 'a', 'g', { col: 1, row: 3 }));
    expect(placeOf(out, 'a')).toEqual(at(1, 3, 3, 1));
    expect(gridOf(out).props.rows).toBe(3);
    expect(kidsOf(gridOf(out)).map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('is a no-op to the same place', () => {
    const root = base();
    const r = moveToCell(root, 'a', 'g', { col: 1, row: 1 });
    expect(r.ok && r.root).toBe(root);
  });

  it('brings a part in from outside and out of another grid', () => {
    const root = page(base().children[0] as LayoutLayer, layer('s', 'Section', {}, [text('x')]), free('h', [text('y', at(1, 3, 1, 1))]));
    const inFromSection = must(moveToCell(root, 'x', 'g', { col: 7, row: 1 }));
    expect(placeOf(inFromSection, 'x')).toEqual(at(7, 3, 1, 1));
    const across = must(moveToCell(root, 'y', 'g', null));
    expect(placeOf(across, 'y')).toEqual(at(7, 3, 1, 1));
    expect(kidsOf(gridOf(across, 'h'))).toEqual([]);
    expect(gridOf(across, 'h').props.rows).toBe(1);
  });

  it('refuses overlap, a flow target, and what moveLayer refuses', () => {
    expect(refusal(moveToCell(base(), 'a', 'g', { col: 4, row: 1 }))).toEqual({ reason: 'grid_overlap', message: GRID_OVERLAP_WORDS });
    expect(refusal(moveToCell(page(layer('f', 'Grid', {}, [text('x')]), base().children[0] as LayoutLayer), 'a', 'f', null)).reason).toBe('not_free');
    expect(refusal(moveToCell(base(), 'g', 'g', null)).reason).not.toBe('ok');
  });
});

describe('setPlace and stepInGrid', () => {
  it('sets a place and says nothing changed for the same one', () => {
    const root = base();
    const out = must(setPlace(root, 'a', at(1, 3, 2, 2)));
    expect(placeOf(out, 'a')).toEqual(at(1, 3, 2, 2));
    expect(gridOf(out).props.rows).toBe(3);
    expect(must(setPlace(root, 'a', at(1, 3, 1, 1)))).toBe(root);
  });

  it('refuses not_free, bad_value and grid_overlap', () => {
    expect(refusal(setPlace(page(layer('s', 'Section', {}, [text('a')])), 'a', at(1, 3, 1, 1))).reason).toBe('not_free');
    expect(refusal(setPlace(base(), 'a', at(10, 4, 1, 1)))).toEqual({ reason: 'bad_value', message: OUT_OF_GRID_WORDS });
    expect(refusal(setPlace(base(), 'a', at(3, 3, 1, 1)))).toEqual({ reason: 'grid_overlap', message: GRID_OVERLAP_WORDS });
    expect(refusal(setPlace(base(), 'zzz', at(1, 3, 1, 1))).reason).toBe('not_found');
  });

  it('takes all eight steps', () => {
    const root = page(free('g', [text('a', at(4, 3, 2, 2))], 3));
    const step = (dir: 'left' | 'right' | 'up' | 'down', mode: 'move' | 'resize'): GridPlace | null => placeOf(must(stepInGrid(root, 'a', dir, mode)), 'a');
    expect(step('left', 'move')).toEqual(at(3, 3, 2, 2));
    expect(step('right', 'move')).toEqual(at(5, 3, 2, 2));
    expect(step('up', 'move')).toEqual(at(4, 3, 1, 2));
    expect(step('down', 'move')).toEqual(at(4, 3, 3, 2));
    expect(step('left', 'resize')).toEqual(at(4, 2, 2, 2));
    expect(step('right', 'resize')).toEqual(at(4, 4, 2, 2));
    expect(step('up', 'resize')).toEqual(at(4, 3, 2, 1));
    expect(step('down', 'resize')).toEqual(at(4, 3, 2, 3));
  });

  it('refuses every edge with its words', () => {
    const edge = (place: GridPlace, dir: 'left' | 'right' | 'up' | 'down', mode: 'move' | 'resize') =>
      refusal(stepInGrid(page(free('g', [text('a', place)], place.row + place.rowSpan - 1)), 'a', dir, mode));
    expect(edge(at(1, 3, 2, 1), 'left', 'move')).toEqual({ reason: 'grid_edge', message: EDGE_WORDS.left });
    expect(edge(at(10, 3, 2, 1), 'right', 'move').message).toBe(EDGE_WORDS.right);
    expect(edge(at(1, 3, 1, 1), 'up', 'move').message).toBe(EDGE_WORDS.up);
    expect(edge(at(1, 3, 60, 1), 'down', 'move').message).toBe(EDGE_WORDS.down);
    expect(edge(at(1, 1, 1, 1), 'left', 'resize').message).toBe(EDGE_WORDS.narrowest);
    expect(edge(at(10, 3, 1, 1), 'right', 'resize').message).toBe(EDGE_WORDS.widest);
    expect(edge(at(1, 3, 1, 1), 'up', 'resize').message).toBe(EDGE_WORDS.shortest);
    expect(edge(at(1, 3, 1, 12), 'down', 'resize').message).toBe(TALLEST_WORDS);
    expect(edge(at(1, 3, 60, 1), 'down', 'resize').message).toBe(EDGE_WORDS.tallest);
  });

  it('refuses a step into another part with the validator words', () => {
    expect(refusal(stepInGrid(base(), 'a', 'right', 'move'))).toEqual({ reason: 'grid_overlap', message: GRID_OVERLAP_WORDS });
    expect(refusal(stepInGrid(page(layer('s', 'Section', {}, [text('a')])), 'a', 'left', 'move'))).toEqual({ reason: 'not_free', message: NOT_FREE_WORDS });
  });
});

describe('fillRow', () => {
  it('spans the 12 columns from column 1', () => {
    const root = page(free('g', [text('a', at(5, 3, 2, 2))], 3));
    expect(placeOf(must(fillRow(root, 'a')), 'a')).toEqual(at(1, 12, 2, 2));
  });

  it('refuses when another part is in those rows, and outside a free Grid', () => {
    expect(refusal(fillRow(base(), 'a')).reason).toBe('grid_overlap');
    expect(refusal(fillRow(page(text('a')), 'a')).reason).toBe('not_free');
  });
});

describe('toFree', () => {
  const flow = (columns: number, count: number): LayoutLayer => page(layer('g', 'Grid', { columns }, Array.from({ length: count }, (_, i) => text(`c${i}`))));

  it('gives each child 12 / columns in order', () => {
    const cases: Array<[number, number, GridPlace[]]> = [
      [1, 2, [at(1, 12, 1, 1), at(1, 12, 2, 1)]],
      [2, 3, [at(1, 6, 1, 1), at(7, 6, 1, 1), at(1, 6, 2, 1)]],
      [3, 4, [at(1, 4, 1, 1), at(5, 4, 1, 1), at(9, 4, 1, 1), at(1, 4, 2, 1)]],
      [4, 5, [at(1, 3, 1, 1), at(4, 3, 1, 1), at(7, 3, 1, 1), at(10, 3, 1, 1), at(1, 3, 2, 1)]],
    ];
    for (const [columns, count, expected] of cases) {
      const out = must(toFree(flow(columns, count), 'g'));
      expect(placesOfKids(out)).toEqual(expected);
      expect(gridOf(out).props).toMatchObject({ placement: 'free', columns: 12, rows: expected[expected.length - 1].row });
      expect(kidsOf(gridOf(out)).map((c) => c.id)).toEqual(Array.from({ length: count }, (_, i) => `c${i}`));
    }
  });

  it('keeps the gap and passes the validator', () => {
    const out = must(toFree(page(layer('g', 'Grid', { columns: 3, gap: 'lg' }, [text('a'), text('b')])), 'g'));
    expect(gridOf(out).props.gap).toBe('lg');
    expect(checkLayer(out, crewCtx(), 'layer')).toEqual([]);
  });

  it('is a no-op when already free, and refuses a missing, non Grid, block or too full Grid', () => {
    const root = base();
    expect(must(toFree(root, 'g'))).toBe(root);
    expect(refusal(toFree(root, 'nope')).reason).toBe('not_found');
    expect(refusal(toFree(page(layer('s', 'Section', {}, [])), 's')).reason).toBe('not_allowed_here');
    const block: LayoutLayer = { ...layer('blk', 'Grid', { columns: 2 }, []), feature: { id: 'f', version: 1, params: {} } };
    expect(refusal(toFree(page(block), 'blk')).reason).toBe('inside_block');
    expect(refusal(toFree(flow(1, 61), 'g'))).toEqual({ reason: 'grid_full', message: TOO_MANY_WORDS });
  });
});

describe('toFlow and flowColumnsFor', () => {
  it('deletes blocks, placement and rows and sets columns from the fullest row', () => {
    const root = page(free('g', [text('c', at(1, 3, 2, 1)), text('a', at(1, 3, 1, 1)), text('b', at(4, 3, 1, 1)), text('d', at(7, 3, 1, 1))], 2));
    const out = must(toFlow(root, 'g'));
    expect(kidsOf(gridOf(out)).map((c) => c.id)).toEqual(['a', 'b', 'd', 'c']);
    expect(kidsOf(gridOf(out)).every((c) => c.grid === undefined)).toBe(true);
    expect(gridOf(out).props).toEqual({ columns: 3 });
  });

  it('refuses a flow Grid', () => {
    expect(refusal(toFlow(page(layer('g', 'Grid', {}, [])), 'g'))).toEqual({ reason: 'not_free', message: NOT_FREE_WORDS });
  });

  it('counts the most places on one row, clamped', () => {
    expect(flowColumnsFor([])).toBe(2);
    expect(flowColumnsFor([at(1, 3, 1, 1)])).toBe(1);
    expect(flowColumnsFor([at(1, 3, 1, 1), at(4, 3, 1, 1), at(7, 3, 1, 1), at(10, 1, 1, 1), at(11, 1, 1, 1)])).toBe(4);
    expect(flowColumnsFor([at(1, 3, 1, 3), at(4, 3, 2, 1), at(7, 3, 2, 1)])).toBe(3);
  });

  it('a round trip through free keeps the order and the children', () => {
    const start = page(layer('g', 'Grid', { columns: 2 }, [text('a'), text('b'), text('c')]));
    const back = must(toFlow(must(toFree(start, 'g')), 'g'));
    expect(kidsOf(gridOf(back)).map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(gridOf(back).props).toEqual({ columns: 2 });
  });
});

describe('replaceLayer and toLayoutLayer keep the block', () => {
  it('replaceLayer keeps the cell on a free Grid and drops a stray block elsewhere', () => {
    const out = must(replaceLayer(base(), 'a', text('a2')));
    expect(placeOf(out, 'a2')).toEqual(at(1, 3, 1, 1));
    const flowRoot = page(layer('s', 'Section', {}, [text('x')]));
    const stray = must(replaceLayer(flowRoot, 'x', text('y', at(1, 3, 1, 1))));
    expect('grid' in findLayer(stray, 'y')!.layer).toBe(false);
  });

  it('toLayoutLayer copies the block as a fresh object', () => {
    const src = text('a', at(2, 3, 4, 5));
    const copy = toLayoutLayer(src);
    expect(copy.grid).toEqual(at(2, 3, 4, 5));
    expect(copy.grid).not.toBe(src.grid);
    expect('grid' in toLayoutLayer(text('b'))).toBe(false);
  });
});

describe('the invariants hold after every editor', () => {
  it('results are valid against the catalog', () => {
    let root = base();
    root = must(insertAtCell(root, 'g', text('n'), { col: 1, row: 2 }));
    root = must(stepInGrid(root, 'n', 'right', 'resize'));
    root = must(fillRow(root, 'n'));
    root = must(moveToCell(root, 'a', 'g', { col: 1, row: 3 }));
    expect(checkLayer(root, crewCtx(), 'layer')).toEqual([]);
    expect(GRID_FULL_WORDS.length).toBeGreaterThan(0);
  });
});

describe('a Grid inside a feature block', () => {
  const inBlock = (): LayoutLayer => {
    const inner = free('in', [text('a', at(1, 3, 1, 1))]);
    const block: LayoutLayer = { ...layer('blk', 'Section', {}, [inner]), feature: { id: 'f', version: 1, params: {} } };
    return page(block, layer('s', 'Section', {}, [text('m')]));
  };

  it('insertAtCell and moveToCell refuse inside_block, not grid_full', () => {
    const words = "This can't go inside a feature block.";
    expect(refusal(insertAtCell(inBlock(), 'in', text('n'), null))).toEqual({ reason: 'inside_block', message: words });
    expect(refusal(moveToCell(inBlock(), 'm', 'in', null))).toEqual({ reason: 'inside_block', message: words });
  });
});
