// Pure helpers for the menu bar on the Design canvas (docs/DESIGN.md, "The menu bar on the canvas"). The menu is edited as a tree so
// layoutTree.ts can move, insert and remove in it like on a page: `AppMenu` over two `MenuSlot` layers, `start` and `end`. The ids
// begin with "@", which a real layer id never does (LAYER_ID_RE), so they never meet a part's id. The two frame layers are not
// catalog parts and are never saved: composeMenu writes the slots back as the plain `menu.start` and `menu.end` lists.
import { fieldIdsOf, linkablePageIds } from '@/catalog/bindings';
import { getPartDefinition } from '@/catalog/definitions';
import type { PartContext } from '@/catalog/types';
import { checkLayer } from '@/catalog/validateLayout';
import type { LayerPlace } from '@/catalog/validateLayout';
import { MENU_PARTS, MENU_SLOTS, menuTypeProblem, slotLayers } from '@local-app-studio/runtime/spec/menuSlots';
import type { MenuSlotName } from '@local-app-studio/runtime/spec/menuSlots';
import type { LayoutLayer, Menu, Table } from '@local-app-studio/runtime/spec/schema';
import { quickAddFits, steer } from './bindChoice';
import { addToWords } from './followWords';
import { layerIds, toLayoutLayer } from './layout';
import { MENU_ROOT_TYPE, MENU_SLOT_TYPE, findLayer, insertLayer, newPartLayer, removeLayer, uniqueId } from './layoutTree';
import type { DropTarget, TreeRefusal } from './layoutTree';

export const MENU_ROOT_ID = '@menu';
export const MENU_SLOT_IDS: Readonly<Record<MenuSlotName, string>> = Object.freeze({ start: '@menu-start', end: '@menu-end' });

const NO_LIST = 'Add a list to this page first, in Page settings.';
const NO_TABLE = 'This app has no table yet. Put a part that shows records on a page and press New table on it.';
export const MENU_FEATURE_REFUSAL = 'Saved features cannot go on the menu bar.';
const DEEP_MSG = 'Parts on the menu bar cannot hold other parts, except in a row.';
const DOES_NOT_FIT = "Change this part's settings first: they do not fit there.";
const QUICK_ADD_NO_TABLE = 'Quick add needs a table where only one text field must be filled in. Use a Form instead.';
export const MENU_NO_FIT = "This part can't be added to the menu bar yet. Put it on a page first and press New table or Add a field on it.";

/** True for the id of the menu bar or one of its two slots. */
export const isMenuFrameId = (id: string): boolean => id === MENU_ROOT_ID || id === MENU_SLOT_IDS.start || id === MENU_SLOT_IDS.end;

/** The slot a frame id names, or null. */
export function slotNameOf(id: string): MenuSlotName | null {
  return MENU_SLOTS.find((slot) => MENU_SLOT_IDS[slot] === id) ?? null;
}

const kids = (layer: LayoutLayer): LayoutLayer[] => (Array.isArray(layer.children) ? layer.children : []);

/** The menu as a tree: the bar over its two slots, each holding the stored layers (copied). A null menu gives two empty slots. */
export function menuTreeOf(menu: Menu | null): LayoutLayer {
  const slot = (name: MenuSlotName): LayoutLayer => ({
    id: MENU_SLOT_IDS[name],
    type: MENU_SLOT_TYPE,
    props: {},
    children: slotLayers(menu, name).map((l) => toLayoutLayer(l as LayoutLayer)),
  });
  return { id: MENU_ROOT_ID, type: MENU_ROOT_TYPE, props: {}, children: MENU_SLOTS.map(slot) };
}

/** The slots of a menu tree as stored: an empty slot gives no key. Layers are rebuilt with toLayoutLayer. */
export function slotsOfTree(tree: LayoutLayer): { start?: LayoutLayer[]; end?: LayoutLayer[] } {
  const out: { start?: LayoutLayer[]; end?: LayoutLayer[] } = {};
  for (const name of MENU_SLOTS) {
    const holder = kids(tree).find((s) => s.id === MENU_SLOT_IDS[name]);
    const layers = holder === undefined ? [] : kids(holder).map(toLayoutLayer);
    if (layers.length > 0) out[name] = layers;
  }
  return out;
}

/** The menu block to save: the look (position and style) with the slots of the tree. Undefined without a look: no menu bar, no parts. */
export function composeMenu(look: Menu | null, tree: LayoutLayer): Menu | undefined {
  if (look === null) return undefined;
  return { position: look.position, style: look.style, ...slotsOfTree(tree) };
}

/** Why this layer (with what is inside it) cannot go on the menu bar, in plain words, or null. */
export function menuSubtreeProblem(layer: LayoutLayer): string | null {
  if (layer.feature !== undefined) return MENU_FEATURE_REFUSAL;
  const top = menuTypeProblem(layer.type, false);
  if (top !== null) return top;
  for (const child of kids(layer)) {
    if (child.feature !== undefined) return MENU_FEATURE_REFUSAL;
    const problem = menuTypeProblem(child.type, true);
    if (problem !== null) return problem;
    if (kids(child).length > 0) return DEEP_MSG;
  }
  return null;
}

const tableLabelOf = (tables: readonly Table[], id: string): string => tables.find((t) => t.id === id)?.label ?? id;

/** What a new menu part needs to know about the page that is open: the tables to try first (the page's own, in page order, then the rest) and every table. */
export interface MenuTables {
  prefer: readonly string[];
  tables: readonly Table[];
}

/**
 * A new part for the menu bar. A Button opens a form to add a record in the first table (or goes to the first page when the app has
 * no table), a Row starts empty, a SearchBox has no source (the runtime gives it the page's list), anything else is built like on a page.
 * With `pageTables` a Button and a Quick add use a table the open page shows first (Crew Roster: Crews, not People), and a Quick add
 * only takes a table it can save with one text field (B8).
 */
export function newMenuLayer(type: string, menuCtx: PartContext, takenIds: ReadonlySet<string>, pageTables?: MenuTables): LayoutLayer | { refusal: string } {
  const problem = menuTypeProblem(type, false);
  if (problem !== null) return { refusal: problem };
  const taken = new Set(takenIds);
  let layer: LayoutLayer;
  if (type === 'SearchBox') {
    layer = { id: uniqueId('searchbox', taken), type, props: {}, children: [] };
  } else if (type === 'Row') {
    layer = { id: uniqueId('row', taken), type, props: {}, children: [] };
  } else if (type === 'Button') {
    const table = pageTables?.prefer.find((t) => menuCtx.tableIds.includes(t)) ?? menuCtx.tableIds[0];
    const page = linkablePageIds(menuCtx)[0] ?? menuCtx.pageIds[0];
    if (table !== undefined) layer = { id: uniqueId('button', taken), type, props: { action: { action: 'open-form', table, mode: 'create' } }, children: addToWords(tableLabelOf(pageTables?.tables ?? [], table)) };
    else if (page !== undefined) layer = { id: uniqueId('button', taken), type, props: { action: { action: 'navigate', pageId: page, withRecord: false } }, children: 'Go' };
    else return { refusal: NO_TABLE };
  } else if (type === 'QuickAdd' && pageTables !== undefined) {
    const usable = [...new Set([...pageTables.prefer, ...menuCtx.tableIds])].filter((t) => {
      const table = pageTables.tables.find((x) => x.id === t);
      return menuCtx.tableIds.includes(t) && table !== undefined && quickAddFits(table);
    });
    if (usable.length === 0) return { refusal: QUICK_ADD_NO_TABLE };
    const made = newPartLayer(type, steer(menuCtx, { tableId: usable[0] }), taken);
    if ('refusal' in made) return made;
    layer = made;
  } else {
    const made = newPartLayer(type, menuCtx, taken);
    if ('refusal' in made) return made;
    layer = made;
  }
  return checkLayer(layer, menuCtx, 'layer', 1, 'menu').length === 0 ? layer : { refusal: MENU_NO_FIT };
}

/** The first list of a page and the text fields a menu SearchBox moved onto it searches (at most 4), or null when it has none. */
function pageSearchTarget(ctx: PartContext): { source: string; fields: string[] } | null {
  const source = ctx.sourceIds.find((id) => ctx.sources[id].mode === 'list');
  if (source === undefined) return null;
  const fields = fieldIdsOf(ctx, [ctx.sources[source].table], { types: ['text', 'longtext'] }).slice(0, 4);
  return fields.length === 0 ? null : { source, fields };
}

export type Adapted = { ok: true; layer: LayoutLayer } | { ok: false; message: string };

/** The layer rebuilt with `change` applied to every SearchBox in it (a Row's parts too). Never mutates its input. */
function mapSearchBoxes(layer: LayoutLayer, change: (box: LayoutLayer) => LayoutLayer): LayoutLayer {
  if (layer.type === 'SearchBox') return change(layer);
  return Array.isArray(layer.children) ? { ...layer, children: layer.children.map((c) => mapSearchBoxes(c, change)) } : layer;
}

const hasSearchBox = (layer: LayoutLayer): boolean => layer.type === 'SearchBox' || kids(layer).some(hasSearchBox);

/**
 * The layer as it must be at its new place. Page to menu: a SearchBox keeps only its placeholder (the menu has no list of its own).
 * Menu to page: a SearchBox gets the first list of the page and its text fields, or the move is refused when the page has no list.
 */
export function adaptForPlace(layer: LayoutLayer, to: LayerPlace, ctx: PartContext): Adapted {
  if (!hasSearchBox(layer)) return { ok: true, layer };
  if (to === 'menu') {
    const plain = (box: LayoutLayer): LayoutLayer => ({ ...box, props: typeof box.props.placeholder === 'string' ? { placeholder: box.props.placeholder } : {}, children: [] });
    return { ok: true, layer: mapSearchBoxes(layer, plain) };
  }
  const target = pageSearchTarget(ctx);
  if (target === null) return { ok: false, message: NO_LIST };
  const bound = (box: LayoutLayer): LayoutLayer => ({ ...box, props: { ...box.props, source: target.source, fields: target.fields }, children: [] });
  return { ok: true, layer: mapSearchBoxes(layer, bound) };
}

export type PairResult = { ok: true; page: LayoutLayer; menu: LayoutLayer; focusId: string } | { ok: false; reason: TreeRefusal; message: string };

export interface PairContexts {
  page: PartContext;
  menu: PartContext;
}

const fail = (reason: TreeRefusal, message: string): PairResult => ({ ok: false, reason, message });

/** The layer with every id that is taken replaced by a fresh one (`taken` grows with the new ids). */
function withFreshIds(layer: LayoutLayer, clash: ReadonlySet<string>, taken: Set<string>): LayoutLayer {
  const id = clash.has(layer.id) ? uniqueId(layer.type.toLowerCase(), taken) : layer.id;
  return Array.isArray(layer.children) ? { ...layer, id, children: layer.children.map((c) => withFreshIds(c, clash, taken)) } : { ...layer, id };
}

/**
 * Moves a layer from the page to the menu bar or back, as one result for both trees. Refused: the page itself, a slot, anything inside
 * a feature block, a part the menu does not take (menuSubtreeProblem), a part whose settings do not fit the other place (checkLayer
 * of that place finds an issue the part did not have), and what removeLayer or insertLayer refuse (child counts, limits). A part
 * whose id is taken at the new place gets fresh ids. Its `sizing` stays.
 */
export function transferLayer(page: LayoutLayer, menu: LayoutLayer, from: LayerPlace, id: string, at: DropTarget, ctxs: PairContexts): PairResult {
  const to: LayerPlace = from === 'page' ? 'menu' : 'page';
  const source = from === 'page' ? page : menu;
  const dest = to === 'page' ? page : menu;
  const found = findLayer(source, id);
  if (found === null) return fail('not_found', 'That part is no longer there.');
  if (found.parent === null || found.layer.type === MENU_SLOT_TYPE) {
    return fail('root_locked', from === 'menu' ? 'The menu bar itself cannot be moved or removed.' : 'The page itself cannot be moved or removed.');
  }
  if (found.inBlock) return fail('inside_block', "This can't go inside a feature block.");
  const adapted = adaptForPlace(found.layer, to, ctxs[to]);
  if (!adapted.ok) return fail('bad_value', adapted.message);
  if (to === 'menu') {
    const problem = menuSubtreeProblem(adapted.layer);
    if (problem !== null) return fail('not_allowed_here', problem);
  }
  const known = checkLayer(found.layer, ctxs[from], 'layer', 20, from);
  const introduced = checkLayer(adapted.layer, ctxs[to], 'layer', 20, to).filter((i) => !known.some((k) => k.path === i.path && k.code === i.code));
  if (introduced.length > 0) return fail('bad_value', DOES_NOT_FIT);
  const removed = removeLayer(source, id);
  if (!removed.ok) return removed;
  const taken = new Set([...layerIds(page), ...layerIds(menu)]);
  const placed = withFreshIds(adapted.layer, layerIds(dest), taken);
  const inserted = insertLayer(dest, at, placed);
  if (!inserted.ok) return inserted;
  const sourceAfter = removed.root;
  return { ok: true, page: to === 'page' ? inserted.root : sourceAfter, menu: to === 'menu' ? inserted.root : sourceAfter, focusId: placed.id };
}

/** True for a shelf entry that may go on the menu bar: a built-in part from the menu's list. Saved features never do. */
export function fitsMenu(entry: { kind: 'part' | 'feature'; id: string }): boolean {
  return entry.kind === 'part' && MENU_PARTS.includes(entry.id) && getPartDefinition(entry.id) !== undefined;
}
