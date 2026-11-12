// Where a layer sits on a Grid that places parts freely (docs/APP_SPEC.md "Free placement on a grid", docs/ARCHITECTURE_DECISIONS.md
// ADR-012). Pure: imported by schema.ts, the runtime renderer, the validator and Design. No zod, no React, no imports at all
// (ADR-006: erasable TypeScript only).
export const GRID_PLACEMENTS = ['flow', 'free'] as const;
export type GridPlacementMode = (typeof GRID_PLACEMENTS)[number];
export const GRID_LIMITS = Object.freeze({ columns: 12, maxRow: 60, maxSpan: 12, maxRowSpan: 12 } as const);
/** Size of a new part dropped on a free Grid. */
export const GRID_DEFAULTS = Object.freeze({ span: 3, rowSpan: 1 } as const);

export interface GridPlace {
  col: number;
  span: number;
  row: number;
  rowSpan: number;
}
export interface GridCell {
  col: number;
  row: number;
}
export type GridDirection = 'left' | 'right' | 'up' | 'down';

const KEYS = ['col', 'span', 'row', 'rowSpan'] as const;
const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const inRange = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;
const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));
const whole = (n: number): number => (Number.isFinite(n) ? Math.round(n) : 1);

/** True for whole numbers inside every limit, col + span <= 13 and row + rowSpan <= 61. */
export function isValidPlace(p: GridPlace): boolean {
  return (
    inRange(p.col, 1, GRID_LIMITS.columns) &&
    inRange(p.span, 1, GRID_LIMITS.maxSpan) &&
    inRange(p.row, 1, GRID_LIMITS.maxRow) &&
    inRange(p.rowSpan, 1, GRID_LIMITS.maxRowSpan) &&
    p.col + p.span <= GRID_LIMITS.columns + 1 &&
    p.row + p.rowSpan <= GRID_LIMITS.maxRow + 1
  );
}

/** A raw block read without trusting it: own keys only, all four whole numbers, isValidPlace; anything else null. */
export function readGrid(raw: unknown): GridPlace | null {
  if (!isPlain(raw)) return null;
  for (const k of KEYS) if (!Object.hasOwn(raw, k)) return null;
  const p: GridPlace = { col: raw.col as number, span: raw.span as number, row: raw.row as number, rowSpan: raw.rowSpan as number };
  return isValidPlace(p) ? p : null;
}

/** Rounds to whole numbers, clamps span 1..12 then col 1..13-span, rowSpan 1..12 then row 1..61-rowSpan. Never null. */
export function clampPlace(p: GridPlace): GridPlace {
  const span = clamp(whole(p.span), 1, GRID_LIMITS.maxSpan);
  const rowSpan = clamp(whole(p.rowSpan), 1, GRID_LIMITS.maxRowSpan);
  return {
    col: clamp(whole(p.col), 1, GRID_LIMITS.columns + 1 - span),
    span,
    row: clamp(whole(p.row), 1, GRID_LIMITS.maxRow + 1 - rowSpan),
    rowSpan,
  };
}

/** Last row covered, inclusive. */
export const rowEnd = (p: GridPlace): number => p.row + p.rowSpan - 1;
/** Last column covered, inclusive. */
export const colEnd = (p: GridPlace): number => p.col + p.span - 1;

/** Every covered cell, in reading order (row, then column). */
export function cellsOf(p: GridPlace): GridCell[] {
  const out: GridCell[] = [];
  for (let row = p.row; row <= rowEnd(p); row += 1) for (let col = p.col; col <= colEnd(p); col += 1) out.push({ col, row });
  return out;
}

/** True when the two rectangles share at least one cell (touching edges do not overlap). */
export function overlaps(a: GridPlace, b: GridPlace): boolean {
  return a.col <= colEnd(b) && b.col <= colEnd(a) && a.row <= rowEnd(b) && b.row <= rowEnd(a);
}

/** True when p overlaps any of `others`. */
export const collides = (p: GridPlace, others: readonly GridPlace[]): boolean => others.some((o) => overlaps(p, o));

/** The stored row count: max rowEnd, 1 when empty; never above 60. */
export function rowsFor(places: readonly GridPlace[]): number {
  let last = 1;
  for (const p of places) last = Math.max(last, rowEnd(p));
  return Math.min(last, GRID_LIMITS.maxRow);
}

/** First place of this size in reading order (row 1..61-rowSpan, col 1..13-span) that collides with nothing; null when none fits. */
export function nextFreeCell(taken: readonly GridPlace[], span: number = GRID_DEFAULTS.span, rowSpan: number = GRID_DEFAULTS.rowSpan): GridPlace | null {
  if (!inRange(span, 1, GRID_LIMITS.maxSpan) || !inRange(rowSpan, 1, GRID_LIMITS.maxRowSpan)) return null;
  for (let row = 1; row <= GRID_LIMITS.maxRow + 1 - rowSpan; row += 1) {
    for (let col = 1; col <= GRID_LIMITS.columns + 1 - span; col += 1) {
      const p = { col, span, row, rowSpan };
      if (!collides(p, taken)) return p;
    }
  }
  return null;
}

/** p with its top-left at `to` (clamped into the grid, size kept); null when that collides with `others`. */
export function movePlace(others: readonly GridPlace[], p: GridPlace, to: GridCell): GridPlace | null {
  const next = clampPlace({ ...p, col: to.col, row: to.row });
  return collides(next, others) ? null : next;
}

/** p with a new size (clamped from its own col and row); null when that collides with `others`. */
export function resizePlace(others: readonly GridPlace[], p: GridPlace, size: { span: number; rowSpan: number }): GridPlace | null {
  const next = {
    col: p.col,
    row: p.row,
    span: clamp(whole(size.span), 1, Math.min(GRID_LIMITS.maxSpan, GRID_LIMITS.columns + 1 - p.col)),
    rowSpan: clamp(whole(size.rowSpan), 1, Math.min(GRID_LIMITS.maxRowSpan, GRID_LIMITS.maxRow + 1 - p.row)),
  };
  return collides(next, others) ? null : next;
}

/**
 * One keyboard step, geometry only (no collision check): move shifts col or row by one; resize changes span (left narrower,
 * right wider) or rowSpan (up shorter, down taller) by one. Null when the step would leave the grid or a limit.
 */
export function stepPlace(p: GridPlace, dir: GridDirection, mode: 'move' | 'resize'): GridPlace | null {
  const next = { ...p };
  if (mode === 'move') {
    if (dir === 'left') next.col -= 1;
    else if (dir === 'right') next.col += 1;
    else if (dir === 'up') next.row -= 1;
    else next.row += 1;
  } else if (dir === 'left') next.span -= 1;
  else if (dir === 'right') next.span += 1;
  else if (dir === 'up') next.rowSpan -= 1;
  else next.rowSpan += 1;
  return isValidPlace(next) ? next : null;
}

/**
 * Children in reading order: placed ones by (row, col), then the ones without a readable block, each group stable.
 * Returns the same array instance when it is already in that order.
 */
export function readingOrder<T extends { grid?: unknown }>(children: readonly T[]): readonly T[] {
  const placed: Array<{ child: T; place: GridPlace; at: number }> = [];
  const loose: T[] = [];
  children.forEach((child, at) => {
    const place = readGrid(child.grid);
    if (place === null) loose.push(child);
    else placed.push({ child, place, at });
  });
  placed.sort((a, b) => a.place.row - b.place.row || a.place.col - b.place.col || a.at - b.at);
  const sorted = [...placed.map((e) => e.child), ...loose];
  return sorted.every((c, i) => c === children[i]) ? children : sorted;
}

/** True for a plain object with type 'Grid' and props.placement === 'free'. */
export function isFreeGridLayer(layer: unknown): boolean {
  return isPlain(layer) && layer.type === 'Grid' && isPlain(layer.props) && layer.props.placement === 'free';
}

/** placement (flow unless 'free') and rows (a whole number 1..60, else 1) of raw Grid props. */
export function readGridProps(props: unknown): { placement: GridPlacementMode; rows: number } {
  const p = isPlain(props) ? props : {};
  return {
    placement: p.placement === 'free' ? 'free' : 'flow',
    rows: inRange(p.rows, 1, GRID_LIMITS.maxRow) ? p.rows : 1,
  };
}
