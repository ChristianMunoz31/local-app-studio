// The slots of the app menu bar (docs/APP_SPEC.md, "Menu slots"): `menu.start` and `menu.end` hold small parts. Pure and
// import free (ADR-006): the schema, the runtime, the catalog and Design all read the same allow list and limits here.

export const MENU_SLOTS = ['start', 'end'] as const;
export type MenuSlotName = (typeof MENU_SLOTS)[number];

/** The parts a menu slot may hold. No data views, forms or features. */
export const MENU_PARTS: readonly string[] = ['Button', 'Link', 'SearchBox', 'QuickAdd', 'Text', 'Row'];
/** The parts a Row inside a menu slot may hold (no Row in a Row). */
export const MENU_ROW_PARTS: readonly string[] = ['Button', 'Link', 'SearchBox', 'QuickAdd', 'Text'];
/** A slot holds at most `perSlot` top layers, the whole menu at most `layers` layers (Rows and their children included). */
export const MENU_LIMITS = Object.freeze({ perSlot: 6, layers: 24 });

const TOP_PROBLEM = 'The menu bar can only hold: Button, Link, SearchBox, QuickAdd, Text and Row.';
const ROW_PROBLEM = 'A row in the menu bar can only hold: Button, Link, SearchBox, QuickAdd and Text.';

/** The layers of one slot, read without trusting the block: own key, an array, else []. */
export function slotLayers(menu: unknown, slot: MenuSlotName): readonly unknown[] {
  if (menu === null || typeof menu !== 'object' || Array.isArray(menu)) return [];
  if (!Object.hasOwn(menu, slot)) return [];
  const layers = (menu as Record<string, unknown>)[slot];
  return Array.isArray(layers) ? layers : [];
}

/** True when either slot holds at least one layer. Empty arrays count as no slots. */
export function hasSlotLayers(menu: unknown): boolean {
  return MENU_SLOTS.some((slot) => slotLayers(menu, slot).length > 0);
}

/** Why a part of this type cannot sit here in the menu, or null. `inRow`: its parent is a Row inside the menu. */
export function menuTypeProblem(type: string, inRow: boolean): string | null {
  if (inRow) return MENU_ROW_PARTS.includes(type) ? null : ROW_PROBLEM;
  return MENU_PARTS.includes(type) ? null : TOP_PROBLEM;
}
