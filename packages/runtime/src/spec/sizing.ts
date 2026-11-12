// Where a layer sits in a row of its parent (docs/APP_SPEC.md "Layer sizing"). Pure: imported by schema.ts, the runtime
// renderer and Design. No zod, no React, no imports (docs/ARCHITECTURE_DECISIONS.md ADR-006: erasable TypeScript only).
export const LAYER_WIDTHS = ['full', 'three-quarters', 'two-thirds', 'half', 'third', 'quarter', 'fit'] as const;
export type LayerWidth = (typeof LAYER_WIDTHS)[number];
/** Widths that are a share of the row (the resize handle and the pair table work on these). */
export const SHARE_WIDTHS = ['quarter', 'third', 'half', 'two-thirds', 'three-quarters'] as const;
export type ShareWidth = (typeof SHARE_WIDTHS)[number];

export interface LayerSizing {
  width: LayerWidth;
  grow: boolean;
}

export const SIZING_DEFAULTS: Readonly<LayerSizing> = Object.freeze({ width: 'full', grow: false });

/** A stored or raw block read without trusting it: own keys only, enum members only, anything else the default. */
export function readSizing(raw: unknown): LayerSizing {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ...SIZING_DEFAULTS };
  const w = Object.hasOwn(raw, 'width') ? (raw as { width?: unknown }).width : undefined;
  const g = Object.hasOwn(raw, 'grow') ? (raw as { grow?: unknown }).grow : undefined;
  const width = typeof w === 'string' && (LAYER_WIDTHS as readonly string[]).includes(w) ? (w as LayerWidth) : 'full';
  return { width, grow: g === true };
}

/** True when the layer leaves the whole-row default (its width is not full). `grow` alone with full changes nothing. */
export const isSideBySide = (raw: unknown): boolean => readSizing(raw).width !== 'full';

/** True when two placements draw the same: every whole-row placement is the same (grow only counts beside other parts). */
export const samePlacement = (a: LayerSizing, b: LayerSizing): boolean => (a.width === 'full' && b.width === 'full') || (a.width === b.width && a.grow === b.grow);
