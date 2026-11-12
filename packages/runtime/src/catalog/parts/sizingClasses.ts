// Literal Tailwind classes for parts side by side (docs/CATALOG.md "Rows of parts"). Shared by the runtime SpecRenderer and
// the Design canvas so both draw the same row. Every class is written out in full so the build sees it. No colors.
import { readSizing } from '../../spec/sizing.ts';
import type { LayerSizing, LayerWidth } from '../../spec/sizing.ts';

/** Parents that stack their children and lay runs of sized children out as a wrapping row. */
export const SIZED_PARENTS: ReadonlySet<string> = new Set(['Page', 'Section', 'Card', 'Collapsible', 'Column', 'Tab']);
/** Parts whose width is set by their parent: a sizing block on them is refused (validateLayout, sizing_not_allowed). */
export const UNSIZED_TYPES: ReadonlySet<string> = new Set(['Page', 'Tab', 'Column']);

/** Below md one column; from md a wrapping row. gap-4 is calc(var(--spacing) * 4), the g of the basis formulas. */
export const ROW_CLASS = 'flex flex-col gap-4 md:flex-row md:flex-wrap md:items-start';

/** basis = f * 100% - g * (1 - f), g = 4 * --spacing, so widths adding up to one row fill one line exactly. */
export const WIDTH_CLASS: Readonly<Record<LayerWidth, string>> = {
  full: 'md:basis-full',
  'three-quarters': 'md:basis-[calc(75%_-_var(--spacing))]',
  'two-thirds': 'md:basis-[calc(200%/3_-_var(--spacing)*4/3)]',
  half: 'md:basis-[calc(50%_-_var(--spacing)*2)]',
  third: 'md:basis-[calc(100%/3_-_var(--spacing)*8/3)]',
  quarter: 'md:basis-[calc(25%_-_var(--spacing)*3)]',
  fit: 'md:basis-auto',
};
export const GROW_CLASS = 'md:grow';

/** The class of one item of a row. */
export function itemClass(s: LayerSizing): string {
  return s.grow ? `min-w-0 ${WIDTH_CLASS[s.width]} ${GROW_CLASS}` : `min-w-0 ${WIDTH_CLASS[s.width]}`;
}

export type SizingSegment = { kind: 'single'; index: number } | { kind: 'row'; indexes: readonly number[] };

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** True when a child leaves the whole row: a layer of a sizable type whose width is not full. */
function sized(child: unknown): boolean {
  if (!isPlain(child)) return false;
  const type = Object.hasOwn(child, 'type') ? child.type : undefined;
  if (typeof type !== 'string' || UNSIZED_TYPES.has(type)) return false;
  return readSizing(Object.hasOwn(child, 'sizing') ? child.sizing : undefined).width !== 'full';
}

/**
 * The children of a parent as segments in order: each child with the whole-row default is a single, each run of
 * consecutive side-by-side children is one row. A parent outside SIZED_PARENTS, and a child of an UNSIZED_TYPES type,
 * always gives singles. Tolerates junk children (not objects): singles.
 */
export function sizingSegments(parentType: unknown, children: readonly unknown[]): SizingSegment[] {
  const out: SizingSegment[] = [];
  const rows = typeof parentType === 'string' && SIZED_PARENTS.has(parentType);
  let run: number[] = [];
  const close = (): void => {
    if (run.length > 0) out.push({ kind: 'row', indexes: run });
    run = [];
  };
  children.forEach((child, index) => {
    if (rows && sized(child)) {
      run.push(index);
      return;
    }
    close();
    out.push({ kind: 'single', index });
  });
  close();
  return out;
}
