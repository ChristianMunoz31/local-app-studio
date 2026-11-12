import { describe, expect, it } from 'vitest';
import {
  GRID_DEFAULTS,
  GRID_LIMITS,
  GRID_PLACEMENTS,
  cellsOf,
  clampPlace,
  collides,
  colEnd,
  isFreeGridLayer,
  isValidPlace,
  movePlace,
  nextFreeCell,
  overlaps,
  readGrid,
  readGridProps,
  readingOrder,
  resizePlace,
  rowEnd,
  rowsFor,
  stepPlace,
} from '../gridPlacement';
import type { GridPlace } from '../gridPlacement';

const p = (col: number, span: number, row: number, rowSpan: number): GridPlace => ({ col, span, row, rowSpan });

describe('constants', () => {
  it('are fixed', () => {
    expect(GRID_PLACEMENTS).toEqual(['flow', 'free']);
    expect(GRID_LIMITS).toEqual({ columns: 12, maxRow: 60, maxSpan: 12, maxRowSpan: 12 });
    expect(GRID_DEFAULTS).toEqual({ span: 3, rowSpan: 1 });
    expect(Object.isFrozen(GRID_LIMITS)).toBe(true);
  });
});

describe('isValidPlace and readGrid', () => {
  it('accepts the edges of the grid', () => {
    expect(isValidPlace(p(1, 12, 1, 12))).toBe(true);
    expect(isValidPlace(p(12, 1, 60, 1))).toBe(true);
    expect(isValidPlace(p(1, 1, 49, 12))).toBe(true);
    expect(readGrid(p(4, 3, 2, 1))).toEqual(p(4, 3, 2, 1));
  });

  it('refuses what leaves the grid or is not whole', () => {
    const bads = [p(0, 1, 1, 1), p(13, 1, 1, 1), p(10, 4, 1, 1), p(1, 1, 61, 1), p(1, 1, 50, 12), p(1, 0, 1, 1), p(1, 13, 1, 1), p(1, 1, 1, 13), p(1.5, 1, 1, 1), p(Number.NaN, 1, 1, 1)];
    for (const bad of bads) {
      expect(isValidPlace(bad)).toBe(false);
      expect(readGrid(bad)).toBeNull();
    }
  });

  it('reads junk to null', () => {
    const inherited = Object.create({ col: 1, span: 1, row: 1, rowSpan: 1 }) as unknown;
    const junks: unknown[] = [null, undefined, [], 'x', 4, true, {}, { col: 1, span: 1, row: 1 }, { col: '1', span: 1, row: 1, rowSpan: 1 }, inherited];
    for (const junk of junks) expect(readGrid(junk)).toBeNull();
  });

  it('returns a fresh object of the four keys', () => {
    const raw = { col: 1, span: 2, row: 3, rowSpan: 4 };
    const read = readGrid(raw);
    expect(read).toEqual(raw);
    expect(read).not.toBe(raw);
  });
});

describe('clampPlace', () => {
  it('rounds and clamps size first, then the corner', () => {
    expect(clampPlace(p(11.6, 5, 2, 1))).toEqual(p(8, 5, 2, 1));
    expect(clampPlace(p(-3, 40, 0, 99))).toEqual(p(1, 12, 1, 12));
    expect(clampPlace(p(1, 1, 99, 3))).toEqual(p(1, 1, 58, 3));
    expect(clampPlace(p(Number.NaN, Number.NaN, Number.NaN, Number.NaN))).toEqual(p(1, 1, 1, 1));
    expect(isValidPlace(clampPlace(p(100, 100, 100, 100)))).toBe(true);
  });
});

describe('rectangles', () => {
  it('rowEnd and colEnd are inclusive', () => {
    expect(rowEnd(p(1, 1, 5, 3))).toBe(7);
    expect(colEnd(p(4, 3, 1, 1))).toBe(6);
  });

  it('cellsOf lists cells in reading order', () => {
    expect(cellsOf(p(2, 2, 3, 2))).toEqual([
      { col: 2, row: 3 },
      { col: 3, row: 3 },
      { col: 2, row: 4 },
      { col: 3, row: 4 },
    ]);
  });

  it('touching edges do not overlap, shared cells do', () => {
    expect(overlaps(p(1, 3, 1, 1), p(4, 3, 1, 1))).toBe(false);
    expect(overlaps(p(1, 3, 1, 1), p(1, 3, 2, 1))).toBe(false);
    expect(overlaps(p(1, 3, 1, 2), p(3, 3, 2, 1))).toBe(true);
    expect(overlaps(p(1, 12, 1, 1), p(6, 1, 1, 1))).toBe(true);
    expect(collides(p(1, 3, 1, 1), [p(4, 3, 1, 1), p(2, 1, 1, 1)])).toBe(true);
    expect(collides(p(1, 3, 1, 1), [])).toBe(false);
  });

  it('rowsFor is 1 when empty and never above 60', () => {
    expect(rowsFor([])).toBe(1);
    expect(rowsFor([p(1, 1, 2, 3), p(1, 1, 1, 1)])).toBe(4);
    expect(rowsFor([p(1, 1, 60, 1)])).toBe(60);
    expect(rowsFor([p(1, 1, 49, 12)])).toBe(60);
  });
});

describe('nextFreeCell', () => {
  it('takes the first free place in reading order', () => {
    expect(nextFreeCell([])).toEqual(p(1, 3, 1, 1));
    expect(nextFreeCell([p(1, 3, 1, 1)])).toEqual(p(4, 3, 1, 1));
    expect(nextFreeCell([p(1, 12, 1, 1)])).toEqual(p(1, 3, 2, 1));
    expect(nextFreeCell([p(2, 1, 1, 1)], 3, 1)).toEqual(p(3, 3, 1, 1));
    expect(nextFreeCell([p(1, 3, 1, 1)], 6, 2)).toEqual(p(4, 6, 1, 2));
  });

  it('is null when nothing fits or the size is invalid', () => {
    const full: GridPlace[] = [];
    for (let row = 1; row <= 60; row += 1) full.push(p(1, 12, row, 1));
    expect(nextFreeCell(full)).toBeNull();
    expect(nextFreeCell([], 0, 1)).toBeNull();
    expect(nextFreeCell([], 13, 1)).toBeNull();
    expect(nextFreeCell([], 3, 13)).toBeNull();
  });
});

describe('movePlace and resizePlace', () => {
  it('moves with the size kept and clamps into the grid', () => {
    expect(movePlace([], p(1, 3, 1, 1), { col: 5, row: 2 })).toEqual(p(5, 3, 2, 1));
    expect(movePlace([], p(1, 3, 1, 2), { col: 12, row: 60 })).toEqual(p(10, 3, 59, 2));
  });

  it('is null on collision', () => {
    expect(movePlace([p(5, 3, 2, 1)], p(1, 3, 1, 1), { col: 5, row: 2 })).toBeNull();
    expect(resizePlace([p(4, 3, 1, 1)], p(1, 3, 1, 1), { span: 4, rowSpan: 1 })).toBeNull();
  });

  it('resizes from its own corner', () => {
    expect(resizePlace([], p(10, 1, 1, 1), { span: 6, rowSpan: 2 })).toEqual(p(10, 3, 1, 2));
    expect(resizePlace([], p(1, 3, 59, 1), { span: 0, rowSpan: 9 })).toEqual(p(1, 1, 59, 2));
  });
});

describe('stepPlace', () => {
  it('moves one cell', () => {
    const at = p(4, 3, 2, 1);
    expect(stepPlace(at, 'left', 'move')).toEqual(p(3, 3, 2, 1));
    expect(stepPlace(at, 'right', 'move')).toEqual(p(5, 3, 2, 1));
    expect(stepPlace(at, 'up', 'move')).toEqual(p(4, 3, 1, 1));
    expect(stepPlace(at, 'down', 'move')).toEqual(p(4, 3, 3, 1));
  });

  it('resizes one cell and keeps the left and top edges', () => {
    const at = p(4, 3, 2, 2);
    expect(stepPlace(at, 'left', 'resize')).toEqual(p(4, 2, 2, 2));
    expect(stepPlace(at, 'right', 'resize')).toEqual(p(4, 4, 2, 2));
    expect(stepPlace(at, 'up', 'resize')).toEqual(p(4, 3, 2, 1));
    expect(stepPlace(at, 'down', 'resize')).toEqual(p(4, 3, 2, 3));
  });

  it('is null at every edge and limit', () => {
    expect(stepPlace(p(1, 3, 1, 1), 'left', 'move')).toBeNull();
    expect(stepPlace(p(10, 3, 1, 1), 'right', 'move')).toBeNull();
    expect(stepPlace(p(1, 3, 1, 1), 'up', 'move')).toBeNull();
    expect(stepPlace(p(1, 3, 60, 1), 'down', 'move')).toBeNull();
    expect(stepPlace(p(1, 1, 1, 1), 'left', 'resize')).toBeNull();
    expect(stepPlace(p(10, 3, 1, 1), 'right', 'resize')).toBeNull();
    expect(stepPlace(p(1, 3, 1, 1), 'up', 'resize')).toBeNull();
    expect(stepPlace(p(1, 3, 1, 12), 'down', 'resize')).toBeNull();
    expect(stepPlace(p(1, 3, 59, 2), 'down', 'resize')).toBeNull();
  });
});

describe('readingOrder', () => {
  const item = (id: string, grid?: unknown): { id: string; grid?: unknown } => ({ id, grid });

  it('sorts placed by row then column, then the rest, each group stable', () => {
    const a = item('a', p(4, 3, 1, 1));
    const b = item('b', p(1, 3, 2, 1));
    const c = item('c', p(1, 3, 1, 1));
    const d = item('d');
    const e = item('e', { col: 99 });
    const f = item('f', p(1, 3, 1, 1));
    expect(readingOrder([d, a, e, b, c, f]).map((x) => x.id)).toEqual(['c', 'f', 'a', 'b', 'd', 'e']);
  });

  it('returns the same array when already in order', () => {
    const list = [item('a', p(1, 3, 1, 1)), item('b', p(4, 3, 1, 1)), item('c')];
    expect(readingOrder(list)).toBe(list);
    expect(readingOrder([])).toEqual([]);
  });
});

describe('isFreeGridLayer and readGridProps', () => {
  it('recognizes a free Grid only', () => {
    expect(isFreeGridLayer({ type: 'Grid', props: { placement: 'free' } })).toBe(true);
    expect(isFreeGridLayer({ type: 'Grid', props: { placement: 'flow' } })).toBe(false);
    expect(isFreeGridLayer({ type: 'Section', props: { placement: 'free' } })).toBe(false);
    const junks: unknown[] = [null, undefined, 3, 'Grid', [], { type: 'Grid' }, { type: 'Grid', props: null }, { type: 'Grid', props: [] }];
    for (const junk of junks) expect(isFreeGridLayer(junk)).toBe(false);
  });

  it('reads defaults', () => {
    expect(readGridProps(undefined)).toEqual({ placement: 'flow', rows: 1 });
    expect(readGridProps({ placement: 'free', rows: 7 })).toEqual({ placement: 'free', rows: 7 });
    expect(readGridProps({ placement: 'free', rows: 61 })).toEqual({ placement: 'free', rows: 1 });
    expect(readGridProps({ placement: 'free', rows: 2.5 })).toEqual({ placement: 'free', rows: 1 });
    expect(readGridProps({ placement: 'other', rows: 0 })).toEqual({ placement: 'flow', rows: 1 });
  });
});
