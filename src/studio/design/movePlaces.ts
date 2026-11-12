// The Move to... list of a block: the places in plain words, numbered the way the page will read after the move, with the
// block's own place marked "(here)". A place of the block's own container counts the block itself, so the numbers have no gaps
// (the two drop places beside the block are the same place as the block). Pure.
import type { DropTarget } from '../lib/layoutTree';

/** Said after the number of the place the block is in now. */
export const HERE = '(here)';

/** Where a block sits now: its container and its place in it. */
export interface OwnPlace {
  parentId: string;
  index: number;
}

/** The number of a drop place as the person counts it: a place of the block's own container counts the block itself (1 to the number of parts). */
export function placeNumber(target: DropTarget, own: OwnPlace | null): number {
  if (own === null || target.parentId !== own.parentId) return target.index + 1;
  return target.index <= own.index ? target.index + 1 : target.index;
}

export interface PlaceRow {
  key: string;
  label: string;
  /** The block's own place: listed, not a button. */
  here: boolean;
  target: DropTarget | null;
}

/** The rows of Move to... for the places of the block's own tree: `name(parentId)` is the container's plain name. */
export function placeRows(targets: readonly DropTarget[], own: OwnPlace | null, name: (parentId: string) => string): PlaceRow[] {
  const rows: PlaceRow[] = targets.map((t) => ({ key: `${t.parentId}:${t.index}`, label: `${name(t.parentId)}, place ${placeNumber(t, own)}`, here: false, target: t }));
  if (own === null) return rows;
  const hereNo = own.index + 1;
  const sameParent = (r: PlaceRow): boolean => r.target !== null && r.target.parentId === own.parentId;
  let at = rows.findIndex((r) => sameParent(r) && r.target !== null && placeNumber(r.target, own) > hereNo);
  if (at < 0) at = rows.reduce((last, r, i) => (sameParent(r) ? i + 1 : last), 0);
  const here: PlaceRow = { key: `${own.parentId}:here`, label: `${name(own.parentId)}, place ${hereNo} ${HERE}`, here: true, target: null };
  return [...rows.slice(0, at), here, ...rows.slice(at)];
}
