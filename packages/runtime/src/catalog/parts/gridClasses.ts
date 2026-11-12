// Literal Tailwind classes of a Grid that places parts freely (docs/APP_SPEC.md "Free placement on a grid", ADR-012). Shared by the
// runtime SpecRenderer and the Design canvas so both draw the same grid. Every class is written out in full because the Tailwind
// scanner reads source text; no template literal builds a class name. No colors.
import { readGrid } from '../../spec/gridPlacement.ts';
import type { GridPlace } from '../../spec/gridPlacement.ts';

/** A free Grid: one column below md, 12 columns from md, rows sized by content with a small theme-spacing minimum. Gap comes from Grid's own gap class. */
export const FREE_GRID_CLASS = 'flex flex-col md:grid md:grid-cols-12 md:auto-rows-[minmax(calc(var(--spacing)*10),auto)]';

/** First column, 1 to 12. */
export const COL_START_CLASS: Readonly<Record<number, string>> = {
  1: 'md:col-start-1',
  2: 'md:col-start-2',
  3: 'md:col-start-3',
  4: 'md:col-start-4',
  5: 'md:col-start-5',
  6: 'md:col-start-6',
  7: 'md:col-start-7',
  8: 'md:col-start-8',
  9: 'md:col-start-9',
  10: 'md:col-start-10',
  11: 'md:col-start-11',
  12: 'md:col-start-12',
};

/** Columns covered, 1 to 12. */
export const COL_SPAN_CLASS: Readonly<Record<number, string>> = {
  1: 'md:col-span-1',
  2: 'md:col-span-2',
  3: 'md:col-span-3',
  4: 'md:col-span-4',
  5: 'md:col-span-5',
  6: 'md:col-span-6',
  7: 'md:col-span-7',
  8: 'md:col-span-8',
  9: 'md:col-span-9',
  10: 'md:col-span-10',
  11: 'md:col-span-11',
  12: 'md:col-span-12',
};

/** First row, 1 to 60. */
export const ROW_START_CLASS: Readonly<Record<number, string>> = {
  1: 'md:row-start-1',
  2: 'md:row-start-2',
  3: 'md:row-start-3',
  4: 'md:row-start-4',
  5: 'md:row-start-5',
  6: 'md:row-start-6',
  7: 'md:row-start-7',
  8: 'md:row-start-8',
  9: 'md:row-start-9',
  10: 'md:row-start-10',
  11: 'md:row-start-11',
  12: 'md:row-start-12',
  13: 'md:row-start-13',
  14: 'md:row-start-14',
  15: 'md:row-start-15',
  16: 'md:row-start-16',
  17: 'md:row-start-17',
  18: 'md:row-start-18',
  19: 'md:row-start-19',
  20: 'md:row-start-20',
  21: 'md:row-start-21',
  22: 'md:row-start-22',
  23: 'md:row-start-23',
  24: 'md:row-start-24',
  25: 'md:row-start-25',
  26: 'md:row-start-26',
  27: 'md:row-start-27',
  28: 'md:row-start-28',
  29: 'md:row-start-29',
  30: 'md:row-start-30',
  31: 'md:row-start-31',
  32: 'md:row-start-32',
  33: 'md:row-start-33',
  34: 'md:row-start-34',
  35: 'md:row-start-35',
  36: 'md:row-start-36',
  37: 'md:row-start-37',
  38: 'md:row-start-38',
  39: 'md:row-start-39',
  40: 'md:row-start-40',
  41: 'md:row-start-41',
  42: 'md:row-start-42',
  43: 'md:row-start-43',
  44: 'md:row-start-44',
  45: 'md:row-start-45',
  46: 'md:row-start-46',
  47: 'md:row-start-47',
  48: 'md:row-start-48',
  49: 'md:row-start-49',
  50: 'md:row-start-50',
  51: 'md:row-start-51',
  52: 'md:row-start-52',
  53: 'md:row-start-53',
  54: 'md:row-start-54',
  55: 'md:row-start-55',
  56: 'md:row-start-56',
  57: 'md:row-start-57',
  58: 'md:row-start-58',
  59: 'md:row-start-59',
  60: 'md:row-start-60',
};

/** Rows covered, 1 to 12. */
export const ROW_SPAN_CLASS: Readonly<Record<number, string>> = {
  1: 'md:row-span-1',
  2: 'md:row-span-2',
  3: 'md:row-span-3',
  4: 'md:row-span-4',
  5: 'md:row-span-5',
  6: 'md:row-span-6',
  7: 'md:row-span-7',
  8: 'md:row-span-8',
  9: 'md:row-span-9',
  10: 'md:row-span-10',
  11: 'md:row-span-11',
  12: 'md:row-span-12',
};

/** A placed child: stretches over its rows and its part grows to fill them. */
export const GRID_ITEM_BASE = 'min-w-0 md:flex md:flex-col md:*:grow';
/** A child without a readable block: a full row the browser places. */
export const UNPLACED_ITEM_CLASS = 'min-w-0 md:col-span-12';

/** The four position classes of a place. */
export function gridAreaClass(p: GridPlace): string {
  return `${COL_START_CLASS[p.col]} ${COL_SPAN_CLASS[p.span]} ${ROW_START_CLASS[p.row]} ${ROW_SPAN_CLASS[p.rowSpan]}`;
}

/** The wrapper class of a child of a free Grid from its raw block. */
export function gridItemClass(raw: unknown): string {
  const p = readGrid(raw);
  return p === null ? UNPLACED_ITEM_CLASS : `${GRID_ITEM_BASE} ${gridAreaClass(p)}`;
}
