// A way to add records (phase 25): which tables no Form, Quick add or open-form button adds to, and the menu button or Form that
// gives each one a way in. Pure; the same adder rule as pro's withRunnableDefaults, held in step by a pin test.
import { checkLayer, menuPartContext, partContextFor } from '@/catalog/validateLayout';
import { MENU_LIMITS, slotLayers } from '@local-app-studio/runtime/spec/menuSlots';
import type { MenuSlotName } from '@local-app-studio/runtime/spec/menuSlots';
import { isFreeGridLayer } from '@local-app-studio/runtime/spec/gridPlacement';
import type { AppSpec, LayoutLayer, Page } from '@local-app-studio/runtime/spec/schema';
import { newMenuLayer } from './menuTree';
import { insertLayer, uniqueId } from './layoutTree';

export const ADD_WAY_IN = 'Add a way to add records';

export interface WayInGap {
  table: string;
  tableLabel: string;
}
export type WayInAdded =
  | { kind: 'menu'; table: string; tableLabel: string; layerId: string; slot: 'start' | 'end' }
  | { kind: 'form'; table: string; tableLabel: string; layerId: string; pageId: string; pageTitle: string };
export type WayInLeft =
  | { reason: 'not_shown'; table: string; tableLabel: string }
  | { reason: 'other_page'; table: string; tableLabel: string; pageId: string; pageTitle: string }
  | { reason: 'no_room'; table: string; tableLabel: string; pageTitle: string | null };
export interface WaysInOptions {
  pageId?: string;
  only?: readonly string[];
}
export interface WaysInResult {
  spec: AppSpec;
  added: WayInAdded[];
  left: WayInLeft[];
}

// Loaded specs can be malformed (a page with no layout or no sources): such parts are skipped, never thrown on, as in pro.
const isLayer = (v: unknown): v is LayoutLayer => typeof v === 'object' && v !== null;
const kids = (layer: LayoutLayer): LayoutLayer[] => (Array.isArray(layer.children) ? layer.children : []);
const propsOf = (layer: LayoutLayer): Record<string, unknown> => (isLayer(layer.props) ? layer.props : {});
const sourcesOf = (page: Page): Page['sources'] => (Array.isArray(page.sources) ? page.sources : []);

/** Every layer under these roots, parents first, feature blocks included. */
function every(roots: readonly LayoutLayer[]): LayoutLayer[] {
  const out: LayoutLayer[] = [];
  const stack = [...roots].reverse();
  while (stack.length > 0) {
    const l = stack.pop();
    if (!isLayer(l)) continue;
    out.push(l);
    const c = kids(l);
    for (let i = c.length - 1; i >= 0; i -= 1) stack.push(c[i]);
  }
  return out;
}

const menuTop = (spec: AppSpec, slot: MenuSlotName): LayoutLayer[] => [...slotLayers(spec.menu, slot)] as LayoutLayer[];
const allRoots = (spec: AppSpec): LayoutLayer[] => [...spec.pages.map((p) => p.layout), ...menuTop(spec, 'start'), ...menuTop(spec, 'end')];

/** The tables that parts of the app add to: a create Form, a Quick add, or an open-form action (create) on a part or a row. */
export function tablesAddedTo(spec: AppSpec): Set<string> {
  const added = new Set<string>();
  for (const layer of every(allRoots(spec))) {
    const props = propsOf(layer);
    if (layer.type === 'RecordForm' && props.mode !== 'edit' && typeof props.table === 'string') added.add(props.table);
    if (layer.type === 'QuickAdd' && typeof props.table === 'string') added.add(props.table);
    for (const a of [props.action, props.rowAction]) {
      if (typeof a !== 'object' || a === null) continue;
      const act = a as Record<string, unknown>;
      if (act.action === 'open-form' && act.mode !== 'edit' && typeof act.table === 'string') added.add(act.table);
    }
  }
  return added;
}

/** Tables with no way to add a record, in table order (tables nothing shows included). */
export function waysIn(spec: AppSpec): WayInGap[] {
  const added = tablesAddedTo(spec);
  return spec.tables.filter((t) => !added.has(t.id)).map((t) => ({ table: t.id, tableLabel: t.label }));
}

const LIST_PARTS = new Set(['DataTable', 'RecordList']);

/** Where a Form goes after the first list of `table` on a page: its container and index, climbing out of a free Grid. Null when the page has none. */
function firstListOf(page: Page, table: string): { parentId: string; index: number } | null {
  const trail: Array<{ container: LayoutLayer; index: number }> = [];
  const search = (layer: LayoutLayer): boolean => {
    const c = kids(layer);
    for (let index = 0; index < c.length; index += 1) {
      const child = c[index];
      if (!isLayer(child)) continue;
      const props = propsOf(child);
      const source = LIST_PARTS.has(child.type) ? sourcesOf(page).find((s) => s.id === props.source && s.mode === 'list') : undefined;
      trail.push({ container: layer, index });
      if (source !== undefined && source.table === table) return true;
      if (search(child)) return true;
      trail.pop();
    }
    return false;
  };
  if (!isLayer(page.layout) || !search(page.layout)) return null;
  let at = trail.length - 1;
  while (at > 0 && isFreeGridLayer(trail[at].container)) at -= 1;
  return { parentId: trail[at].container.id, index: trail[at].index };
}

/** Adds a menu button or a Form for each table with no way in (the menu bar first, a Form after its first list otherwise). */
export function addWaysIn(spec: AppSpec, options: WaysInOptions = {}): WaysInResult {
  const gaps = waysIn(spec).filter((g) => options.only === undefined || options.only.includes(g.table));
  if (gaps.length === 0) return { spec, added: [], left: [] };
  let next = spec;
  const added: WayInAdded[] = [];
  const left: WayInLeft[] = [];
  const taken = new Set(every(allRoots(spec)).map((l) => l.id));
  for (const { table, tableLabel } of gaps) {
    if (next.menu !== undefined) {
      const slot = (['end', 'start'] as const).find((s) => menuTop(next, s).length < MENU_LIMITS.perSlot);
      const count = every([...menuTop(next, 'start'), ...menuTop(next, 'end')]).length;
      const button = slot === undefined || count >= MENU_LIMITS.layers ? null : newMenuLayer('Button', menuPartContext(next), taken, { prefer: [table], tables: next.tables });
      if (slot !== undefined && button !== null && !('refusal' in button)) {
        taken.add(button.id);
        next = { ...next, menu: { ...next.menu, [slot]: [...menuTop(next, slot), button] } };
        added.push({ kind: 'menu', table, tableLabel, layerId: button.id, slot });
        continue;
      }
    }
    const listed = next.pages.filter((p) => firstListOf(p, table) !== null);
    const here = listed.find((p) => options.pageId === undefined || p.id === options.pageId);
    if (here === undefined) {
      if (listed.length === 0) left.push({ reason: 'not_shown', table, tableLabel });
      else left.push({ reason: 'other_page', table, tableLabel, pageId: listed[0].id, pageTitle: listed[0].title });
      continue;
    }
    const at = firstListOf(here, table);
    const form: LayoutLayer = { id: uniqueId('recordform', taken), type: 'RecordForm', props: { table, mode: 'create' }, children: [] };
    const placed = at === null ? null : insertLayer(here.layout, { parentId: at.parentId, index: at.index + 1 }, form);
    if (placed === null || !placed.ok || checkLayer(form, partContextFor(next, here), 'layer', 1).length > 0) {
      left.push({ reason: 'no_room', table, tableLabel, pageTitle: here.title });
      continue;
    }
    const layout = placed.root;
    next = { ...next, pages: next.pages.map((p) => (p.id === here.id ? { ...p, layout } : p)) };
    added.push({ kind: 'form', table, tableLabel, layerId: form.id, pageId: here.id, pageTitle: here.title });
  }
  return { spec: added.length === 0 ? spec : next, added, left };
}

const joined = (items: readonly string[]): string => (items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/** "Crews has no way to add records yet." / "Crews, Steps and Jobs have no way to add records yet." */
export const noWayInLine = (gaps: readonly WayInGap[]): string => `${joined(gaps.map((g) => g.tableLabel))} ${gaps.length === 1 ? 'has' : 'have'} no way to add records yet.`;

/** What follows noWayInLine when nothing can be added here. */
export const noWayHere = (count: number): string => ` Show ${count === 1 ? 'it' : 'them'} on a page in Design first.`;

function leftWords(l: WayInLeft): string {
  if (l.reason === 'not_shown') return `Nothing shows ${l.tableLabel} yet: put a list of it on a page first.`;
  if (l.reason === 'other_page') return `Open ${l.pageTitle} to add one for ${l.tableLabel}.`;
  return `${l.pageTitle ?? 'The page'} has no room for a Form for ${l.tableLabel}.`;
}

/** The notice sentence: what was added, then one sentence per table left. */
export function waysInOutcome(r: WaysInResult): string {
  const phrases = r.added.map((a) => (a.kind === 'menu' ? `a menu button for ${a.tableLabel}` : `a Form for ${a.tableLabel} on ${a.pageTitle}`));
  const lead = phrases.length === 0 ? 'Nothing was added.' : `Added ${joined(phrases)}.`;
  return [lead, ...r.left.map(leftWords)].join(' ');
}

/** The Undo label. */
export const waysInLabel = (r: WaysInResult): string => (r.added.length === 1 ? 'added a way to add records' : `added ${r.added.length} ways to add records`);
