// The precise words and reach of keyboard, handle and Place steps on a free Grid (docs/DESIGN.md "Parts placed freely on a grid").
// Pure, no React. Used by useGridKeys, PlaceSettings and GridResizeHandle.
import { GRID_LIMITS, cellsOf, colEnd, overlaps, rowEnd, stepPlace } from '@local-app-studio/runtime/spec/gridPlacement';
import type { GridDirection, GridPlace } from '@local-app-studio/runtime/spec/gridPlacement';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { isFreeGrid, placeOf, placesIn, stepInGrid } from '../lib/gridLayout';
import { blockedWords, placeBlockedWords } from '../lib/gridWords';
import { findLayer } from '../lib/layoutTree';

export type NameOf = (layer: LayoutLayer, parent: LayoutLayer | null) => string;

const kids = (layer: LayoutLayer): LayoutLayer[] => (Array.isArray(layer.children) ? layer.children : []);

/** The readable place of one child of a grid. */
const placeOfChild = (grid: LayoutLayer, child: LayoutLayer): GridPlace | null => placesIn({ ...grid, children: [child] })[0] ?? null;

/** The first sibling (array order) of `id` whose readable place overlaps `place`. */
function firstBlocker(grid: LayoutLayer, id: string, place: GridPlace): LayoutLayer | null {
  for (const child of kids(grid)) {
    if (child.id === id) continue;
    const p = placeOfChild(grid, child);
    if (p !== null && overlaps(place, p)) return child;
  }
  return null;
}

/**
 * Words for a keyboard or handle step that stepInGrid would refuse, null when the step is allowed or the part is not placed.
 * Edge or limit: the matching EDGE_WORDS entry, except a resize down stopped by the 12-row limit (row end below 60): TALLEST_WORDS.
 * Overlap: the first sibling (array order) whose place overlaps the stepped place is the blocker, and the line is the column or row
 * the part tried to enter.
 */
export function stepRefusal(root: LayoutLayer, id: string, dir: GridDirection, mode: 'move' | 'resize', nameOf: NameOf): string | null {
  const current = placeOf(root, id);
  if (current === null) return null;
  const at = findLayer(root, id);
  if (at === null || at.parent === null) return null;
  const next = stepPlace(current, dir, mode);
  if (next === null) {
    const result = stepInGrid(root, id, dir, mode);
    return result.ok ? null : result.message;
  }
  const blocker = firstBlocker(at.parent, id, next);
  if (blocker === null) return null;
  let line: number;
  if (dir === 'right') line = colEnd(current) + 1;
  else if (dir === 'left') line = current.col - 1;
  else if (dir === 'down') line = rowEnd(current) + 1;
  else line = current.row - 1;
  return blockedWords(dir, mode, nameOf(blocker, at.parent), line);
}

/** Words for a setPlace that would overlap: placeBlockedWords(nameOf(blocker, grid), first cell of cellsOf(place) the blocker covers); null when it would not. */
export function placeRefusal(root: LayoutLayer, id: string, place: GridPlace, nameOf: NameOf): string | null {
  const at = findLayer(root, id);
  if (at === null || at.parent === null || !isFreeGrid(at.parent)) return null;
  const blocker = firstBlocker(at.parent, id, place);
  if (blocker === null) return null;
  const covered = placeOfChild(at.parent, blocker);
  if (covered === null) return null;
  const cell = cellsOf(place).find((c) => overlaps({ col: c.col, span: 1, row: c.row, rowSpan: 1 }, covered));
  return cell === undefined ? null : placeBlockedWords(nameOf(blocker, at.parent), cell);
}

/** The widest span and tallest rowSpan the part can take from its own col and row without leaving the grid, the 12 limits or covering a sibling (at least its current size when that is valid). */
export function gridReach(root: LayoutLayer, id: string): { span: number; rowSpan: number } {
  const current = placeOf(root, id);
  const at = findLayer(root, id);
  if (current === null || at === null || at.parent === null) return { span: 1, rowSpan: 1 };
  const others = placesIn(at.parent, id);
  const free = (p: GridPlace): boolean => !others.some((o) => overlaps(p, o));
  let span = current.span;
  while (span < GRID_LIMITS.maxSpan && current.col + span <= GRID_LIMITS.columns && free({ ...current, span: span + 1 })) span += 1;
  let rowSpan = current.rowSpan;
  while (rowSpan < GRID_LIMITS.maxRowSpan && current.row + rowSpan <= GRID_LIMITS.maxRow && free({ ...current, rowSpan: rowSpan + 1 })) rowSpan += 1;
  return { span, rowSpan };
}

/** True when the part's index among its parent's children differs between the two roots (syncGrids keeps the array in reading order). */
export function orderChanged(before: LayoutLayer, after: LayoutLayer, id: string): boolean {
  const a = findLayer(before, id);
  const b = findLayer(after, id);
  if (a === null || b === null) return false;
  return a.index !== b.index;
}
