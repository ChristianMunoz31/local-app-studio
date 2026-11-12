// Pure editing helpers for parts placed freely on a Grid (docs/DESIGN.md "Parts placed freely on a grid", ADR-012). No React.
// Every editor returns a TreeResult from layoutTree.ts, never mutates, runs `syncGrids` on its result, returns the same root when
// nothing changes and refuses with words from gridWords.ts. `syncGrids` is the one invariant keeper: Design calls it on every edit.
import { GRID_DEFAULTS, GRID_LIMITS, clampPlace, collides, isFreeGridLayer, isValidPlace, nextFreeCell, readGrid, readingOrder, rowEnd, rowsFor, stepPlace } from '@local-app-studio/runtime/spec/gridPlacement';
import type { GridCell, GridDirection, GridPlace } from '@local-app-studio/runtime/spec/gridPlacement';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { EDGE_WORDS, GRID_FULL_WORDS, GRID_OVERLAP_WORDS, NOT_FREE_WORDS, OUT_OF_GRID_WORDS, TALLEST_WORDS, TOO_MANY_WORDS } from './gridWords';
import { dropTargets, findLayer, insertLayer, moveLayer } from './layoutTree';
import type { TreeRefusal, TreeResult } from './layoutTree';

const kids = (layer: LayoutLayer): LayoutLayer[] => (Array.isArray(layer.children) ? layer.children : []);
const refuse = (reason: TreeRefusal, message: string): TreeResult => ({ ok: false, reason, message });
const gone = 'That part is no longer on the page.';
const inBlockWords = "This can't go inside a feature block.";
const notGridWords = 'Only a grid can place parts freely.';

const samePlace = (a: GridPlace, b: GridPlace): boolean => a.col === b.col && a.span === b.span && a.row === b.row && a.rowSpan === b.rowSpan;

/** True for a Grid layer with placement free. */
export const isFreeGrid = (layer: LayoutLayer | null | undefined): boolean => layer !== null && layer !== undefined && isFreeGridLayer(layer);

/** The place of a child of a free Grid (null when the layer is not one, is in a feature block, or has no readable block). */
export function placeOf(root: LayoutLayer, id: string): GridPlace | null {
  const at = findLayer(root, id);
  if (at === null || at.inBlock || !isFreeGrid(at.parent)) return null;
  return readGrid(at.layer.grid);
}

/** The readable places of a free Grid's children, without `exceptId`. */
export function placesIn(grid: LayoutLayer, exceptId?: string): GridPlace[] {
  const out: GridPlace[] = [];
  for (const child of kids(grid)) {
    if (child.id === exceptId) continue;
    const p = readGrid(child.grid);
    if (p !== null) out.push(p);
  }
  return out;
}

/** The layer with a new `grid` block (null removes it). */
function withGrid(layer: LayoutLayer, place: GridPlace | null): LayoutLayer {
  const out: LayoutLayer = { ...layer };
  if (place === null) delete out.grid;
  else out.grid = { col: place.col, span: place.span, row: place.row, rowSpan: place.rowSpan };
  return out;
}

/** A copy of the tree where the layer with this id is replaced by fn(layer); the same tree when the id is not there. */
function updateLayer(layer: LayoutLayer, id: string, fn: (l: LayoutLayer) => LayoutLayer): LayoutLayer {
  if (layer.id === id) return fn(layer);
  if (!Array.isArray(layer.children)) return layer;
  let changed = false;
  const next = layer.children.map((c) => {
    const n = updateLayer(c, id, fn);
    if (n !== c) changed = true;
    return n;
  });
  return changed ? { ...layer, children: next } : layer;
}

/** The children of a free Grid with a place each: valid non-overlapping ones keep theirs (array order), the rest take the next free cell. */
function placeChildren(children: readonly LayoutLayer[]): Array<GridPlace | null> {
  const places: Array<GridPlace | null> = children.map(() => null);
  const kept: GridPlace[] = [];
  children.forEach((c, i) => {
    const p = readGrid(c.grid);
    if (p !== null && !collides(p, kept)) {
      places[i] = p;
      kept.push(p);
    }
  });
  children.forEach((_, i) => {
    if (places[i] !== null) return;
    const p = nextFreeCell(kept, GRID_DEFAULTS.span, GRID_DEFAULTS.rowSpan);
    if (p === null) return;
    places[i] = p;
    kept.push(p);
  });
  return places;
}

function walk(layer: LayoutLayer, parentFree: boolean): LayoutLayer {
  let out = layer;
  if (!parentFree && out.grid !== undefined) out = withGrid(out, null);
  // A feature block keeps its own `grid` key up to date; its inside is not touched.
  if (out.feature !== undefined || !Array.isArray(out.children)) return out;
  const free = isFreeGridLayer(out);
  const original = out.children;
  let list = original;
  if (free) {
    const places = placeChildren(original);
    list = original.map((c, i) => {
      const p = places[i];
      const current = readGrid(c.grid);
      if (p === null) return c.grid === undefined ? c : withGrid(c, null);
      return current !== null && samePlace(current, p) && c.grid !== undefined ? c : withGrid(c, p);
    });
  }
  const walked = list.map((c) => walk(c, free));
  let next: LayoutLayer[] = walked.every((c, i) => c === original[i]) ? original : walked;
  let props = out.props;
  if (free) {
    const ordered = readingOrder(next);
    if (ordered !== next) next = Array.from(ordered);
    const rows = rowsFor(next.flatMap((c) => readGrid(c.grid) ?? []));
    if (props.columns !== GRID_LIMITS.columns || props.rows !== rows) props = { ...props, columns: GRID_LIMITS.columns, rows };
  }
  if (next === original && props === out.props) return out;
  return { ...out, props, children: next };
}

/**
 * The one invariant keeper. For every layer outside feature blocks (a block's own `grid` key is kept up to date, its inside is not touched):
 * a child whose parent is not a free Grid loses `grid`; in a free Grid, `columns` is 12, children keep valid non-overlapping places in
 * array order, a child without one (or overlapping an earlier one) gets nextFreeCell(kept, 3, 1) (none left: the block is dropped),
 * the children are put in readingOrder, and `rows` = rowsFor(places). Same object back when nothing changes.
 */
export const syncGrids = (root: LayoutLayer): LayoutLayer => walk(root, false);

/** The ids of the children of a free Grid (outside feature blocks) that have no readable grid block. */
function unplacedIds(root: LayoutLayer): Set<string> {
  const out = new Set<string>();
  const stack: LayoutLayer[] = [root];
  for (let l = stack.pop(); l !== undefined; l = stack.pop()) {
    if (l.feature !== undefined) continue;
    if (isFreeGrid(l)) for (const c of kids(l)) if (readGrid(c.grid) === null) out.add(c.id);
    stack.push(...kids(l));
  }
  return out;
}

/** True when `after` (a synced tree) has a child in a free Grid with no cell that `before` did not already have: a part added by a plain insert or move into a Grid with no 3x1 cell left. */
export function gotNoCell(before: LayoutLayer, after: LayoutLayer): boolean {
  const was = unplacedIds(before);
  for (const id of unplacedIds(after)) if (!was.has(id)) return true;
  return false;
}

const done = (root: LayoutLayer, focusId: string): TreeResult => ({ ok: true, root: syncGrids(root), focusId });

/** The free Grids a dragged part may go into: free Grids among dropTargets(root, type, movingId) parents, plus the moving layer's own parent when it is one. */
export function gridDropIds(root: LayoutLayer, type: string, movingId?: string): Set<string> {
  const free = new Set<string>();
  const stack: LayoutLayer[] = [root];
  for (let l = stack.pop(); l !== undefined; l = stack.pop()) {
    if (l.feature !== undefined) continue;
    if (isFreeGrid(l)) free.add(l.id);
    stack.push(...kids(l));
  }
  const out = new Set<string>();
  for (const t of dropTargets(root, type, movingId)) if (free.has(t.parentId)) out.add(t.parentId);
  if (movingId !== undefined) {
    const moving = findLayer(root, movingId);
    if (moving !== null && moving.parent !== null && !moving.inBlock && free.has(moving.parent.id)) out.add(moving.parent.id);
  }
  return out;
}

/**
 * Where a drop would land: size = the moving layer's own when it already sits in this Grid, else GRID_DEFAULTS; cell given: clampPlace
 * at that top-left, `free` = no collision with the others; cell null: nextFreeCell (null when none fits). Null when gridId is not a free Grid.
 */
export function dropPlace(root: LayoutLayer, gridId: string, cell: GridCell | null, movingId: string | null): { place: GridPlace; free: boolean } | null {
  const grid = findLayer(root, gridId);
  if (grid === null || grid.inBlock || !isFreeGrid(grid.layer)) return null;
  const moving = movingId === null ? null : findLayer(root, movingId);
  const inside = moving !== null && moving.parent === grid.layer;
  const own = inside && moving !== null ? readGrid(moving.layer.grid) : null;
  const span = own?.span ?? GRID_DEFAULTS.span;
  const rowSpan = own?.rowSpan ?? GRID_DEFAULTS.rowSpan;
  const taken = placesIn(grid.layer, inside ? (movingId ?? undefined) : undefined);
  if (cell === null) {
    const next = nextFreeCell(taken, span, rowSpan);
    return next === null ? null : { place: next, free: true };
  }
  const place = clampPlace({ col: cell.col, row: cell.row, span, rowSpan });
  return { place, free: !collides(place, taken) };
}

/** insertLayer at the end of the Grid, then the place of dropPlace(root, gridId, cell, null). Refuses grid_overlap or grid_full. */
export function insertAtCell(root: LayoutLayer, gridId: string, layer: LayoutLayer, cell: GridCell | null): TreeResult {
  const grid = findLayer(root, gridId);
  if (grid === null) return refuse('not_found', gone);
  if (grid.inBlock) return refuse('inside_block', inBlockWords);
  if (!isFreeGrid(grid.layer)) return refuse('not_free', NOT_FREE_WORDS);
  const drop = dropPlace(root, gridId, cell, null);
  if (drop === null) return refuse('grid_full', GRID_FULL_WORDS);
  if (!drop.free) return refuse('grid_overlap', GRID_OVERLAP_WORDS);
  const result = insertLayer(root, { parentId: gridId, index: kids(grid.layer).length }, withGrid(layer, drop.place));
  return result.ok ? done(result.root, result.focusId) : result;
}

/** moveLayer into the Grid (when not already a child) and the place of dropPlace(root, gridId, cell, id). Refuses grid_overlap or grid_full, and whatever moveLayer refuses. */
export function moveToCell(root: LayoutLayer, id: string, gridId: string, cell: GridCell | null): TreeResult {
  const moving = findLayer(root, id);
  const grid = findLayer(root, gridId);
  if (moving === null || grid === null) return refuse('not_found', gone);
  if (grid.inBlock) return refuse('inside_block', inBlockWords);
  if (!isFreeGrid(grid.layer)) return refuse('not_free', NOT_FREE_WORDS);
  const drop = dropPlace(root, gridId, cell, id);
  if (drop === null) return refuse('grid_full', GRID_FULL_WORDS);
  if (!drop.free) return refuse('grid_overlap', GRID_OVERLAP_WORDS);
  let base = root;
  if (moving.parent !== grid.layer) {
    const moved = moveLayer(root, id, { parentId: gridId, index: kids(grid.layer).length });
    if (!moved.ok) return moved;
    base = moved.root;
  }
  const current = readGrid(findLayer(base, id)?.layer.grid);
  if (base === root && current !== null && samePlace(current, drop.place)) return { ok: true, root, focusId: id };
  return done(updateLayer(base, id, (l) => withGrid(l, drop.place)), id);
}

/** Sets the place of a child of a free Grid. Refuses not_free, bad_value (not isValidPlace) and grid_overlap. */
export function setPlace(root: LayoutLayer, id: string, place: GridPlace): TreeResult {
  const at = findLayer(root, id);
  if (at === null) return refuse('not_found', gone);
  if (at.inBlock || at.parent === null || !isFreeGrid(at.parent)) return refuse('not_free', NOT_FREE_WORDS);
  if (!isValidPlace(place)) return refuse('bad_value', OUT_OF_GRID_WORDS);
  if (collides(place, placesIn(at.parent, id))) return refuse('grid_overlap', GRID_OVERLAP_WORDS);
  const current = readGrid(at.layer.grid);
  if (current !== null && samePlace(current, place)) return { ok: true, root, focusId: id };
  return done(updateLayer(root, id, (l) => withGrid(l, place)), id);
}

const RESIZE_EDGE = { left: 'narrowest', right: 'widest', up: 'shortest', down: 'tallest' } as const;

/** One keyboard or handle step (stepPlace, then a collision check). Refuses grid_edge with EDGE_WORDS, grid_overlap, not_free. */
export function stepInGrid(root: LayoutLayer, id: string, dir: GridDirection, mode: 'move' | 'resize'): TreeResult {
  const current = placeOf(root, id);
  if (current === null) return refuse('not_free', NOT_FREE_WORDS);
  const next = stepPlace(current, dir, mode);
  if (next === null) {
    // A resize down stopped by the 12-row limit, not by the last row, has its own words.
    if (mode === 'resize' && dir === 'down' && current.rowSpan >= GRID_LIMITS.maxRowSpan) return refuse('grid_edge', TALLEST_WORDS);
    return refuse('grid_edge', EDGE_WORDS[mode === 'move' ? dir : RESIZE_EDGE[dir]]);
  }
  return setPlace(root, id, next);
}

/** { col: 1, span: 12, row, rowSpan } through setPlace. */
export function fillRow(root: LayoutLayer, id: string): TreeResult {
  const current = placeOf(root, id);
  if (current === null) return refuse('not_free', NOT_FREE_WORDS);
  return setPlace(root, id, { col: 1, span: GRID_LIMITS.columns, row: current.row, rowSpan: current.rowSpan });
}

/** Flow to free: placement 'free', columns 12, each child in order at nextFreeCell(placed, 12 / columns, 1). Refuses not_found, grid_full (TOO_MANY_WORDS), inside_block. Focus: the Grid. */
export function toFree(root: LayoutLayer, gridId: string): TreeResult {
  const at = findLayer(root, gridId);
  if (at === null) return refuse('not_found', gone);
  if (at.inBlock || at.layer.feature !== undefined) return refuse('inside_block', inBlockWords);
  if (at.layer.type !== 'Grid') return refuse('not_allowed_here', notGridWords);
  if (isFreeGrid(at.layer)) return { ok: true, root, focusId: gridId };
  const columns = typeof at.layer.props.columns === 'number' && at.layer.props.columns >= 1 && at.layer.props.columns <= 4 ? at.layer.props.columns : 2;
  const width = Math.floor(GRID_LIMITS.columns / columns);
  const placed: GridPlace[] = [];
  const children: LayoutLayer[] = [];
  for (const child of kids(at.layer)) {
    const p = nextFreeCell(placed, width, 1);
    if (p === null) return refuse('grid_full', TOO_MANY_WORDS);
    placed.push(p);
    children.push(withGrid(child, p));
  }
  const next: LayoutLayer = { ...at.layer, props: { ...at.layer.props, placement: 'free', columns: GRID_LIMITS.columns, rows: rowsFor(placed) }, children };
  return done(updateLayer(root, gridId, () => next), gridId);
}

/** The most places that share one row, clamped to 1..4; 2 when there are none. */
export function flowColumnsFor(places: readonly GridPlace[]): 1 | 2 | 3 | 4 {
  if (places.length === 0) return 2;
  const counts = new Array<number>(GRID_LIMITS.maxRow + 2).fill(0);
  let most = 1;
  for (const p of places) {
    for (let r = p.row; r <= rowEnd(p); r += 1) {
      counts[r] += 1;
      most = Math.max(most, counts[r]);
    }
  }
  return Math.min(4, Math.max(1, most)) as 1 | 2 | 3 | 4;
}

/** Free to flow: children in reading order, every grid block deleted, placement and rows deleted, columns = flowColumnsFor(places). Focus: the Grid. */
export function toFlow(root: LayoutLayer, gridId: string): TreeResult {
  const at = findLayer(root, gridId);
  if (at === null) return refuse('not_found', gone);
  if (at.inBlock) return refuse('inside_block', inBlockWords);
  if (!isFreeGrid(at.layer)) return refuse('not_free', NOT_FREE_WORDS);
  const columns = flowColumnsFor(placesIn(at.layer));
  const children = readingOrder(kids(at.layer)).map((c) => withGrid(c, null));
  const props: LayoutLayer['props'] = { ...at.layer.props, columns };
  delete props.placement;
  delete props.rows;
  return done(updateLayer(root, gridId, (l) => ({ ...l, props, children })), gridId);
}
