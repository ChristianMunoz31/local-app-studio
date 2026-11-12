// Pointer math for a free Grid on the Design canvas (phase 21, ADR-012). Reads the track sizes the browser resolved at drag
// time (never stored); the cell under the pointer comes from them, because rows are sized by their content.
import { GRID_LIMITS } from '@local-app-studio/runtime/spec/gridPlacement';
import type { GridCell } from '@local-app-studio/runtime/spec/gridPlacement';

export interface GridMetrics {
  left: number;
  top: number;
  cols: number[];
  rows: number[];
  colGap: number;
  rowGap: number;
}

/** Parses a resolved track list ("64px 40.5px 40px") to numbers; tokens in [brackets] are skipped; null when a token is not px. */
export function parseTracks(value: string): number[] | null {
  const cleaned = value.replace(/\[[^\]]*\]/g, ' ').trim();
  if (cleaned === '') return null;
  const out: number[] = [];
  for (const token of cleaned.split(/\s+/)) {
    const m = /^(\d+(?:\.\d+)?)px$/.exec(token);
    if (m === null) return null;
    out.push(Number(m[1]));
  }
  return out;
}

const px = (value: string): number => {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};

/** Reads getComputedStyle(el): display must be 'grid' and both track lists px; null otherwise (below md, jsdom). */
export function measureGrid(el: Element | null): GridMetrics | null {
  if (el === null) return null;
  const style = getComputedStyle(el);
  if (style.display !== 'grid') return null;
  const cols = parseTracks(style.gridTemplateColumns);
  const rows = parseTracks(style.gridTemplateRows);
  if (cols === null || rows === null) return null;
  const rect = el.getBoundingClientRect();
  return {
    left: rect.left + px(style.borderLeftWidth) + px(style.paddingLeft),
    top: rect.top + px(style.borderTopWidth) + px(style.paddingTop),
    cols,
    rows,
    colGap: px(style.columnGap),
    rowGap: px(style.rowGap),
  };
}

/** The 1-based track holding `offset` (each track owns its size plus the gap after it); before the first: 1; after the last: sizes.length + 1. */
export function trackIndex(sizes: readonly number[], gap: number, offset: number): number {
  if (offset < 0) return 1;
  let start = 0;
  for (let i = 0; i < sizes.length; i += 1) {
    const end = start + sizes[i]! + gap;
    if (offset < end) return i + 1;
    start = end;
  }
  return sizes.length + 1;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** The cell under client point (x, y); col clamped 1..12, row clamped 1..60. */
export function cellAt(m: GridMetrics, x: number, y: number): GridCell {
  return {
    col: clamp(trackIndex(m.cols, m.colGap, x - m.left), 1, GRID_LIMITS.columns),
    row: clamp(trackIndex(m.rows, m.rowGap, y - m.top), 1, GRID_LIMITS.maxRow),
  };
}

/** The one empty row a free Grid offers below its parts while a part is dragged: 10 spacing units, like the Grid's own minimum row. */
export const EXTRA_ROW = 'calc(var(--spacing)*10)';

/**
 * The row template of the dotted cells: the row sizes the content grid resolved (so each dotted row is a row cellAt judges) and one
 * empty row more, capped at the 60 rows a Grid may have. Null while the Grid is not measured (below md, jsdom).
 */
export function dropRowsTemplate(rows: readonly number[] | null): string | null {
  if (rows === null || rows.length === 0) return null;
  return [...rows.slice(0, GRID_LIMITS.maxRow).map((r) => `${r}px`), ...(rows.length < GRID_LIMITS.maxRow ? [EXTRA_ROW] : [])].join(' ');
}

/** True below md, where a free Grid shows one column: window.matchMedia('(width < 48rem)').matches; false when matchMedia is missing. */
export function narrowGrid(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(width < 48rem)').matches;
}
