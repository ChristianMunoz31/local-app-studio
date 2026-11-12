// Pure helpers for the Design canvas (docs/DESIGN.md, phase 7 section 4.1). The only code that changes a layout tree:
// every function returns a new tree (structural sharing) or a refusal, never a partial edit, and never mutates its input.
// Invariants: one page root that is never moved or removed, nothing goes into a feature block or into itself, Tabs only
// hold Tab, a part with a child count (Columns, PageHeader) keeps it, the page stays within LIMITS. No React, no store.
// The menu bar (phase 10) is edited with the same helpers: its tree is `AppMenu` over two `MenuSlot` layers (menuTree.ts), so a slot
// takes the part list of the menu, a Row in it a shorter one, and neither the bar nor a slot can be moved or removed.
// Widths (phase 9): moves never change a `sizing` block; only the side drops, setSizing, resizePair and stepWidth write one,
// and they never write an explicit whole-row block (Whole row deletes it).
import { SIZED_PARENTS, UNSIZED_TYPES, sizingSegments } from '@local-app-studio/runtime/catalog/parts/sizingClasses';
import { MENU_LIMITS, MENU_PARTS, MENU_ROW_PARTS, menuTypeProblem } from '@local-app-studio/runtime/spec/menuSlots';
import { LAYER_ID_RE, LIMITS } from '@local-app-studio/runtime/spec/schema';
import { isFreeGridLayer } from '@local-app-studio/runtime/spec/gridPlacement';
import { LAYER_WIDTHS, SHARE_WIDTHS, readSizing, samePlacement } from '@local-app-studio/runtime/spec/sizing';
import type { LayerSizing, LayerWidth, ShareWidth } from '@local-app-studio/runtime/spec/sizing';
import type { JsonValue, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { fieldIdsOf, linkablePageIds } from '@/catalog/bindings';
import { getPartDefinition } from '@/catalog/definitions';
import { checkParamValues, expandFeature, slotsOf } from '@/catalog/features';
import { CONTROL_RE } from '@/catalog/features/expand';
import type { ExpandResult, FeatureDefinition, FeatureLibrary, Slot, SlotKind } from '@/catalog/features';
import type { PartContext, PartDefinition } from '@/catalog/types';
import { checkLayer } from '@/catalog/validateLayout';
import type { LayerPlace } from '@/catalog/validateLayout';
import * as z from 'zod';
import { rankFieldIds } from './bindChoice';
import { pairedParams, pickField, textDefault } from './featureParams';
import { choiceKey, choicePropsOf, readChoice } from './choiceProps';
import { applySpecial, specialKeysOf } from './rowColumns';

export type TreeRefusal =
  | 'not_found'
  | 'root_locked'
  | 'not_allowed_here'
  | 'into_itself'
  | 'inside_block'
  | 'too_many_layers'
  | 'too_deep'
  | 'child_count'
  | 'bad_value'
  | 'no_sizing'
  | 'at_end'
  | 'not_paired'
  | 'grid_overlap'
  | 'grid_edge'
  | 'grid_full'
  | 'not_free';
export type TreeResult = { ok: true; root: LayoutLayer; focusId: string } | { ok: false; reason: TreeRefusal; message: string };

export interface DropTarget {
  parentId: string;
  index: number;
}

/** A place beside a layer: its left or right side, in the same parent. */
export interface SideTarget {
  targetId: string;
  side: 'left' | 'right';
}

export interface Located {
  layer: LayoutLayer;
  parent: LayoutLayer | null;
  index: number;
  /** True when a layer above it is a feature block. The block itself is not "in" a block. */
  inBlock: boolean;
}

/** The types of the two frame layers of a menu tree. They are not catalog parts. */
export const MENU_ROOT_TYPE = 'AppMenu';
export const MENU_SLOT_TYPE = 'MenuSlot';
const isMenuTree = (root: LayoutLayer): boolean => root.type === MENU_ROOT_TYPE;
/** The most layers a menu tree may hold: the 24 parts of the menu plus its 3 frame layers (the bar and two slots). */
const MENU_TREE_MAX = MENU_LIMITS.layers + 3;

const refuse = (reason: TreeRefusal, message: string): TreeResult => ({ ok: false, reason, message });
const ok = (root: LayoutLayer, focusId: string): TreeResult => ({ ok: true, root, focusId });

const FORBIDDEN_SEGMENTS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);
const CONFIGURABLE: ReadonlySet<SlotKind> = new Set<SlotKind>(['text', 'table', 'source', 'page', 'field']);

const MSG = {
  gone: 'That part is no longer on the page.',
  rootLocked: 'The page itself cannot be moved or removed.',
  menuLocked: 'The menu bar itself cannot be moved or removed.',
  menuFull: `The menu bar is full: at most ${MENU_LIMITS.layers} parts.`,
  slotFull: `A side of the menu bar holds at most ${MENU_LIMITS.perSlot} parts.`,
  intoItself: 'A part cannot go inside itself.',
  inBlock: "This can't go inside a feature block.",
  full: `This page is full: at most ${LIMITS.layersPerPage} parts.`,
  deep: 'Parts are nested too deeply here. Put this higher up on the page.',
  place: 'That place is no longer there.',
  sameName: 'Two parts would end up with the same name. Try again.',
  noSizingType: 'This part takes the width of the part it is in.',
  noSizingParent: 'Parts in here cannot sit side by side.',
  noSizingMenu: 'Parts on the menu bar take the room they need.',
  pickWidth: 'Pick one of the widths.',
  besideItself: 'A part cannot go beside itself.',
  widest: 'This already takes the whole row.',
  narrowest: 'This is as narrow as it gets.',
  handleEnd: 'The handle cannot go further this way.',
  otherLine: 'That would move another part of this row to a different line.',
  notPaired: 'Only two parts side by side in one row can be resized together.',
} as const;

const kids = (layer: LayoutLayer): LayoutLayer[] => (Array.isArray(layer.children) ? layer.children : []);
const isBlock = (layer: LayoutLayer): boolean => layer.feature !== undefined;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Why a part of this type cannot go into the parent, in plain words. */
export function notAllowedMessage(parent: LayoutLayer, type: string, root?: LayoutLayer): string {
  if (parent.type === MENU_SLOT_TYPE) return menuTypeProblem(type, false) ?? "This can't go in there.";
  if (parent.type === 'Row' && root !== undefined && isMenuTree(root)) return menuTypeProblem(type, true) ?? "This can't go in there.";
  if (type === 'Page') return 'A page has one top part. It cannot be added again.';
  if (type === 'Tab') return 'A tab panel can only go inside Tabs.';
  if (type === 'Column') return 'A column can only go inside Columns.';
  if (parent.type === 'Tabs') return 'Tabs only hold tab panels.';
  if (parent.type === 'Columns') return 'Columns only hold columns.';
  if (parent.type === 'PageHeader') return 'A page header can only hold buttons, links and quick adds.';
  if (parent.type === 'NavLinks') return 'Page links can only hold buttons and links.';
  return "This can't go in there.";
}

const COUNT_MESSAGES: Readonly<Record<string, string>> = {
  Columns: 'Columns hold 2 to 4 columns.',
  PageHeader: 'A page header holds at most 3 buttons, links or quick adds.',
  NavLinks: 'Page links hold at most 3 buttons or links.',
  [MENU_SLOT_TYPE]: MSG.slotFull,
};

/** Why a part with a child count refuses one more or one less child, in plain words. */
function countMessage(parent: LayoutLayer): string {
  if (Object.hasOwn(COUNT_MESSAGES, parent.type)) return COUNT_MESSAGES[parent.type];
  const limits = getPartDefinition(parent.type)?.childCount;
  return limits === undefined ? MSG.place : `This part holds ${limits.min} to ${limits.max} parts.`;
}

/** True when the parent may have `delta` more (or fewer) children and still keep its child count, if its part has one. */
function countAllows(parent: LayoutLayer, delta: number): boolean {
  const limits = parent.type === MENU_SLOT_TYPE ? { min: 0, max: MENU_LIMITS.perSlot } : getPartDefinition(parent.type)?.childCount;
  if (limits === undefined) return true;
  const next = kids(parent).length + delta;
  return next >= limits.min && next <= limits.max;
}

/** Root to layer, both included, by identity; null when the id is not in the tree. Iterative. */
function pathOf(root: LayoutLayer, id: string): LayoutLayer[] | null {
  const stack: LayoutLayer[][] = [[root]];
  for (let path = stack.pop(); path !== undefined; path = stack.pop()) {
    const last = path[path.length - 1];
    if (last.id === id) return path;
    for (const child of kids(last)) stack.push([...path, child]);
  }
  return null;
}

export function findLayer(root: LayoutLayer, id: string): Located | null {
  const path = pathOf(root, id);
  if (path === null) return null;
  const layer = path[path.length - 1];
  const parent = path.length > 1 ? path[path.length - 2] : null;
  return {
    layer,
    parent,
    index: parent === null ? 0 : kids(parent).indexOf(layer),
    inBlock: path.slice(0, -1).some(isBlock),
  };
}

/** True for the layer a result may never move, replace or remove: the page, or in a menu tree the bar and its two slots (`path`: root to layer). */
const lockedAt = (root: LayoutLayer, path: readonly LayoutLayer[]): boolean => path.length === 1 || (isMenuTree(root) && path.length === 2);
const lockedMessage = (root: LayoutLayer): string => (isMenuTree(root) ? MSG.menuLocked : MSG.rootLocked);

/**
 * True when a layer of this part type may sit inside `parent`, by the part definitions. Never a Page. `root` is the tree the parent
 * is in: in a menu tree a slot holds the menu's parts, a Row only the shorter list, and the bar nothing.
 */
export function canHold(parent: LayoutLayer, type: string, root?: LayoutLayer): boolean {
  if (parent.type === MENU_ROOT_TYPE) return false;
  if (parent.type === MENU_SLOT_TYPE) return MENU_PARTS.includes(type);
  if (parent.type === 'Row' && root !== undefined && isMenuTree(root) && !MENU_ROW_PARTS.includes(type)) return false;
  const holder = getPartDefinition(parent.type);
  if (!holder || holder.children !== 'parts') return false;
  const child = getPartDefinition(type);
  if (!child || child.name === 'Page') return false;
  if (child.childOf !== undefined && !child.childOf.includes(parent.type)) return false;
  return holder.allowedChildren === undefined || holder.allowedChildren.includes(type);
}

/** Number of layers in a subtree and its height (the layer alone is 1). Iterative. */
function measure(layer: LayoutLayer): { count: number; height: number } {
  let count = 0;
  let height = 0;
  const stack: Array<{ layer: LayoutLayer; depth: number }> = [{ layer, depth: 1 }];
  for (let e = stack.pop(); e !== undefined; e = stack.pop()) {
    count += 1;
    height = Math.max(height, e.depth);
    for (const child of kids(e.layer)) stack.push({ layer: child, depth: e.depth + 1 });
  }
  return { count, height };
}

function idsOf(layer: LayoutLayer): string[] {
  const out: string[] = [];
  const stack: LayoutLayer[] = [layer];
  for (let l = stack.pop(); l !== undefined; l = stack.pop()) {
    out.push(l.id);
    stack.push(...kids(l));
  }
  return out;
}

/** A copy of the tree where the layer at the end of `path` (from findLayer's chain) is replaced. */
function replaceAtPath(path: readonly LayoutLayer[], next: LayoutLayer): LayoutLayer {
  let current = next;
  for (let i = path.length - 2; i >= 0; i -= 1) {
    const parent = path[i];
    const old = path[i + 1];
    current = { ...parent, children: kids(parent).map((c) => (c === old ? current : c)) };
  }
  return current;
}

/** The layer with a new children list, rebuilt up to the root. */
function withChildren(path: readonly LayoutLayer[], children: LayoutLayer[]): LayoutLayer {
  const holder = path[path.length - 1];
  return replaceAtPath(path, { ...holder, children });
}

/** Every place a layer of this part type may go, in document order. `movingId`: the layer being moved (its own subtree and no-op places are left out). */
export function dropTargets(root: LayoutLayer, type: string, movingId?: string): DropTarget[] {
  const moving = movingId === undefined ? null : findLayer(root, movingId);
  if (movingId !== undefined && (moving === null || moving.parent === null || moving.inBlock || (isMenuTree(root) && moving.layer.type === MENU_SLOT_TYPE))) return [];
  const out: DropTarget[] = [];
  const stack: LayoutLayer[] = [root];
  for (let l = stack.pop(); l !== undefined; l = stack.pop()) {
    // Nothing is offered inside a feature block or inside the layer being moved.
    if (isBlock(l) || (moving !== null && l === moving.layer)) continue;
    const children = kids(l);
    const sameParent = moving !== null && moving.parent === l;
    // A place that would break a child count (Columns at 4, or a Column leaving Columns at 2) is not offered.
    const countOk = sameParent || (countAllows(l, 1) && (moving === null || moving.parent === null || countAllows(moving.parent, -1)));
    if (countOk && canHold(l, type, root)) {
      // A grid lays parts out by position, so it only offers its end; order inside it changes with Move up and Move down.
      const indexes = l.type === 'Grid' ? [children.length] : children.map((_, i) => i).concat(children.length);
      for (const index of indexes) {
        if (sameParent && (index === moving.index || index === moving.index + 1)) continue;
        out.push({ parentId: l.id, index });
      }
    }
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
  }
  return out;
}

/** Limits that hold after `added` layers of `height` levels go under a parent at `parentDepth`. */
function limitRefusal(root: LayoutLayer, added: number, height: number, parentDepth: number): TreeResult | null {
  if (isMenuTree(root)) return measure(root).count + added > MENU_TREE_MAX ? refuse('too_many_layers', MSG.menuFull) : null;
  if (measure(root).count + added > LIMITS.layersPerPage) return refuse('too_many_layers', MSG.full);
  if (parentDepth + height > LIMITS.layerDepth) return refuse('too_deep', MSG.deep);
  return null;
}

export function insertLayer(root: LayoutLayer, at: DropTarget, layer: LayoutLayer): TreeResult {
  const path = pathOf(root, at.parentId);
  if (path === null) return refuse('not_found', MSG.gone);
  const parent = path[path.length - 1];
  if (path.some(isBlock)) return refuse('inside_block', MSG.inBlock);
  if (!LAYER_ID_RE.test(layer.id) || !canHold(parent, layer.type, root)) return refuse('not_allowed_here', notAllowedMessage(parent, layer.type, root));
  const children = kids(parent);
  if (!Number.isInteger(at.index) || at.index < 0 || at.index > children.length) return refuse('bad_value', MSG.place);
  if (!countAllows(parent, 1)) return refuse('child_count', countMessage(parent));
  const existing = new Set(idsOf(root));
  const incoming = idsOf(layer);
  if (new Set(incoming).size !== incoming.length || incoming.some((id) => existing.has(id))) return refuse('bad_value', MSG.sameName);
  const size = measure(layer);
  const limit = limitRefusal(root, size.count, size.height, path.length);
  if (limit !== null) return limit;
  const next = [...children.slice(0, at.index), layer, ...children.slice(at.index)];
  return ok(withChildren(path, next), layer.id);
}

export function moveLayer(root: LayoutLayer, id: string, at: DropTarget): TreeResult {
  const located = findLayer(root, id);
  if (located === null) return refuse('not_found', MSG.gone);
  const ownPath = pathOf(root, id);
  if (located.parent === null || (ownPath !== null && lockedAt(root, ownPath))) return refuse('root_locked', lockedMessage(root));
  if (located.inBlock) return refuse('inside_block', MSG.inBlock);
  const targetPath = pathOf(root, at.parentId);
  if (targetPath === null) return refuse('not_found', MSG.gone);
  if (targetPath.includes(located.layer)) return refuse('into_itself', MSG.intoItself);
  if (targetPath.some(isBlock)) return refuse('inside_block', MSG.inBlock);
  const target = targetPath[targetPath.length - 1];
  if (!canHold(target, located.layer.type, root)) return refuse('not_allowed_here', notAllowedMessage(target, located.layer.type, root));
  const targetKids = kids(target);
  if (!Number.isInteger(at.index) || at.index < 0 || at.index > targetKids.length) return refuse('bad_value', MSG.place);
  const size = measure(located.layer);
  if (targetPath.length + size.height > LIMITS.layerDepth) return refuse('too_deep', MSG.deep);
  if (located.parent !== target) {
    if (!countAllows(target, 1)) return refuse('child_count', countMessage(target));
    if (!countAllows(located.parent, -1)) return refuse('child_count', countMessage(located.parent));
  }

  const sameParent = located.parent === target;
  // The index is in the parent before the removal; moving down inside the same parent shifts it by one.
  const insertAt = sameParent && located.index < at.index ? at.index - 1 : at.index;
  if (sameParent && insertAt === located.index) return ok(root, id);

  const parentPath = pathOf(root, located.parent.id);
  if (parentPath === null) return refuse('not_found', MSG.gone);
  const without = withChildren(parentPath, kids(located.parent).filter((c) => c !== located.layer));
  const targetAfter = pathOf(without, at.parentId);
  if (targetAfter === null) return refuse('not_found', MSG.gone);
  const list = kids(targetAfter[targetAfter.length - 1]);
  const next = [...list.slice(0, insertAt), located.layer, ...list.slice(insertAt)];
  return ok(withChildren(targetAfter, next), id);
}

export function moveBy(root: LayoutLayer, id: string, delta: -1 | 1): TreeResult {
  const path = pathOf(root, id);
  if (path === null) return refuse('not_found', MSG.gone);
  if (lockedAt(root, path)) return refuse('root_locked', lockedMessage(root));
  if (path.slice(0, -1).some(isBlock)) return refuse('inside_block', MSG.inBlock);
  const parent = path[path.length - 2];
  const siblings = kids(parent);
  const from = siblings.indexOf(path[path.length - 1]);
  const to = from + delta;
  // At an edge nothing changes and nothing is refused.
  if (to < 0 || to >= siblings.length) return ok(root, id);
  const next = siblings.slice();
  [next[from], next[to]] = [next[to], next[from]];
  return ok(withChildren(path.slice(0, -1), next), id);
}

export function removeLayer(root: LayoutLayer, id: string): TreeResult {
  const path = pathOf(root, id);
  if (path === null) return refuse('not_found', MSG.gone);
  if (lockedAt(root, path)) return refuse('root_locked', lockedMessage(root));
  if (path.slice(0, -1).some(isBlock)) return refuse('inside_block', MSG.inBlock);
  const parent = path[path.length - 2];
  const layer = path[path.length - 1];
  if (!countAllows(parent, -1)) return refuse('child_count', countMessage(parent));
  return ok(withChildren(path.slice(0, -1), kids(parent).filter((c) => c !== layer)), parent.id);
}

/** The layer replaced by another at the same place (a feature update, Save as feature). */
export function replaceLayer(root: LayoutLayer, id: string, next: LayoutLayer): TreeResult {
  const path = pathOf(root, id);
  if (path === null) return refuse('not_found', MSG.gone);
  if (lockedAt(root, path)) return refuse('root_locked', lockedMessage(root));
  if (path.slice(0, -1).some(isBlock)) return refuse('inside_block', MSG.inBlock);
  const parent = path[path.length - 2];
  if (!LAYER_ID_RE.test(next.id) || !canHold(parent, next.type, root)) return refuse('not_allowed_here', notAllowedMessage(parent, next.type, root));
  const old = path[path.length - 1];
  const outside = new Set(idsOf(root));
  for (const own of idsOf(old)) outside.delete(own);
  const incoming = idsOf(next);
  if (new Set(incoming).size !== incoming.length || incoming.some((x) => outside.has(x))) return refuse('bad_value', MSG.sameName);
  const size = measure(next);
  const oldSize = measure(old);
  if (measure(root).count - oldSize.count + size.count > LIMITS.layersPerPage) return refuse('too_many_layers', MSG.full);
  if (path.length - 1 + size.height > LIMITS.layerDepth) return refuse('too_deep', MSG.deep);
  // Placement belongs to the place: the new layer sits where the old one sat, at its width and, on a free Grid, in its cell.
  const sized = withSizing(next, old.sizing !== undefined && !UNSIZED_TYPES.has(next.type) ? readSizing(old.sizing) : null);
  const placed: LayoutLayer = { ...sized };
  if (isFreeGridLayer(parent) && old.grid !== undefined) placed.grid = old.grid;
  else delete placed.grid;
  return ok(replaceAtPath(path, placed), next.id);
}

// ---------------------------------------------------------------------------------------------
// Widths: side drops, the Width setting, the resize handle, Shrink and Widen (docs/DESIGN.md "Parts side by side")
// ---------------------------------------------------------------------------------------------

/** Twelfths of a row, for line packing and the handle (fit counts 0: its width is not known here). */
export const WIDTH_UNITS: Readonly<Record<LayerWidth, number>> = {
  full: 12,
  'three-quarters': 9,
  'two-thirds': 8,
  half: 6,
  third: 4,
  quarter: 3,
  fit: 0,
};

/** Shrink and Widen of a layer on its own, narrowest first. */
const ALONE: readonly LayerWidth[] = ['fit', 'quarter', 'third', 'half', 'two-thirds', 'three-quarters', 'full'];

/** True for a width that is a share of the row (not the whole row, not only what it needs). */
export const isShareWidth = (w: LayerWidth): w is ShareWidth => (SHARE_WIDTHS as readonly string[]).includes(w);

/** The layer with this placement: null or the whole row removes the block, anything else is written as width and grow only. */
function withSizing(layer: LayoutLayer, s: LayerSizing | null): LayoutLayer {
  if (s === null || s.width === 'full') {
    if (layer.sizing === undefined) return layer;
    const rest: LayoutLayer = { ...layer };
    delete rest.sizing;
    return rest;
  }
  return { ...layer, sizing: { width: s.width, grow: s.grow } };
}

/** The tree with new placements for some layers (ids that are not there are skipped; a placement that draws the same is left as stored). */
function placeAll(root: LayoutLayer, changes: ReadonlyArray<{ id: string; sizing: LayerSizing }>): LayoutLayer {
  let next = root;
  for (const c of changes) {
    const path = pathOf(next, c.id);
    if (path === null) continue;
    const layer = path[path.length - 1];
    if (samePlacement(readSizing(layer.sizing), c.sizing)) continue;
    next = replaceAtPath(path, withSizing(layer, c.sizing));
  }
  return next;
}

type Sizable = { ok: true; path: LayoutLayer[]; layer: LayoutLayer; parent: LayoutLayer } | { ok: false; refusal: TreeResult };

/** Why a layer cannot have a width here, or its path when it can (not the root, not inside a block, in a stacking parent). */
function sizable(root: LayoutLayer, id: string): Sizable {
  const path = pathOf(root, id);
  if (path === null) return { ok: false, refusal: refuse('not_found', MSG.gone) };
  if (path.length === 1) return { ok: false, refusal: refuse('root_locked', MSG.rootLocked) };
  if (isMenuTree(root)) return { ok: false, refusal: refuse('no_sizing', MSG.noSizingMenu) };
  if (path.slice(0, -1).some(isBlock)) return { ok: false, refusal: refuse('inside_block', MSG.inBlock) };
  const layer = path[path.length - 1];
  const parent = path[path.length - 2];
  if (UNSIZED_TYPES.has(layer.type)) return { ok: false, refusal: refuse('no_sizing', MSG.noSizingType) };
  if (!SIZED_PARENTS.has(parent.type)) return { ok: false, refusal: refuse('no_sizing', MSG.noSizingParent) };
  return { ok: true, path, layer, parent };
}

/** True when the Width setting, Shrink and Widen apply to this layer. */
export const canSize = (root: LayoutLayer, id: string): boolean => sizable(root, id).ok;

/** Every side place a part of this type may go, in document order (docs/DESIGN.md "Parts side by side"). */
export function sideTargets(root: LayoutLayer, type: string, movingId?: string): SideTarget[] {
  if (UNSIZED_TYPES.has(type)) return [];
  const moving = movingId === undefined ? null : findLayer(root, movingId);
  if (isMenuTree(root) || (movingId !== undefined && (moving === null || moving.parent === null || moving.inBlock))) return [];
  const out: SideTarget[] = [];
  const stack: LayoutLayer[] = [root];
  for (let l = stack.pop(); l !== undefined; l = stack.pop()) {
    // Nothing inside a feature block or inside the moving layer: a block root itself is a target, from its parent.
    if (isBlock(l) || (moving !== null && l === moving.layer)) continue;
    const children = kids(l);
    const sameParent = moving !== null && moving.parent === l;
    const countOk = sameParent || (countAllows(l, 1) && (moving === null || moving.parent === null || countAllows(moving.parent, -1)));
    if (SIZED_PARENTS.has(l.type) && countOk && canHold(l, type, root)) {
      for (const child of children) {
        if (UNSIZED_TYPES.has(child.type) || (moving !== null && child === moving.layer)) continue;
        out.push({ targetId: child.id, side: 'left' }, { targetId: child.id, side: 'right' });
      }
    }
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
  }
  return out;
}

/** The widths after a side drop on a target: a whole-row target and the dropped part both take half, else the part takes the target's width. */
export function besideSizing(target: LayerSizing): { target: LayerSizing | null; dropped: LayerSizing } {
  if (target.width === 'full') return { target: { width: 'half', grow: false }, dropped: { width: 'half', grow: false } };
  return { target: null, dropped: { width: target.width, grow: false } };
}

type SidePlace = { ok: true; target: LayoutLayer; parent: LayoutLayer; index: number } | { ok: false; refusal: TreeResult };

/** The checked target of a side drop and the index the part goes to in its parent. */
function sidePlace(root: LayoutLayer, at: SideTarget): SidePlace {
  if (at.side !== 'left' && at.side !== 'right') return { ok: false, refusal: refuse('bad_value', MSG.place) };
  const found = sizable(root, at.targetId);
  if (!found.ok) return found;
  const index = kids(found.parent).indexOf(found.layer) + (at.side === 'right' ? 1 : 0);
  return { ok: true, target: found.layer, parent: found.parent, index };
}

/** The placements a side drop writes: the target's (when it changes) and the dropped layer's. */
function besideChanges(target: LayoutLayer, droppedId: string): Array<{ id: string; sizing: LayerSizing }> {
  const next = besideSizing(readSizing(target.sizing));
  return [...(next.target === null ? [] : [{ id: target.id, sizing: next.target }]), { id: droppedId, sizing: next.dropped }];
}

/** A new layer beside a target, with the widths of the side drop rule. One result; the focus goes to the new layer. */
export function insertBeside(root: LayoutLayer, at: SideTarget, layer: LayoutLayer): TreeResult {
  const place = sidePlace(root, at);
  if (!place.ok) return place.refusal;
  if (UNSIZED_TYPES.has(layer.type)) return refuse('no_sizing', MSG.noSizingType);
  const inserted = insertLayer(root, { parentId: place.parent.id, index: place.index }, withSizing(layer, null));
  if (!inserted.ok) return inserted;
  return ok(placeAll(inserted.root, besideChanges(place.target, layer.id)), layer.id);
}

/** An existing layer moved beside a target, with the widths of the side drop rule. The focus stays on the moved layer. */
export function moveBeside(root: LayoutLayer, id: string, at: SideTarget): TreeResult {
  if (id === at.targetId) return refuse('bad_value', MSG.besideItself);
  const place = sidePlace(root, at);
  if (!place.ok) return place.refusal;
  const located = findLayer(root, id);
  if (located === null) return refuse('not_found', MSG.gone);
  if (located.parent === null) return refuse('root_locked', MSG.rootLocked);
  if (UNSIZED_TYPES.has(located.layer.type)) return refuse('no_sizing', MSG.noSizingType);
  const moved = moveLayer(root, id, { parentId: place.parent.id, index: place.index });
  if (!moved.ok) return moved;
  return ok(placeAll(moved.root, besideChanges(place.target, id)), id);
}

/** Writes the placement of a layer; the whole row deletes the block. The same placement again is ok with the same root (no Undo step). */
export function setSizing(root: LayoutLayer, id: string, next: { width: string; grow: boolean }): TreeResult {
  if (typeof next !== 'object' || next === null) return refuse('bad_value', MSG.pickWidth);
  const width = next.width;
  if (typeof width !== 'string' || !(LAYER_WIDTHS as readonly string[]).includes(width) || typeof next.grow !== 'boolean') return refuse('bad_value', MSG.pickWidth);
  const found = sizable(root, id);
  if (!found.ok) return found.refusal;
  const wanted: LayerSizing = { width: width as LayerWidth, grow: width === 'full' ? false : next.grow };
  if (samePlacement(readSizing(found.layer.sizing), wanted)) return ok(root, id);
  return ok(replaceAtPath(found.path, withSizing(found.layer, wanted)), id);
}

/** The line of each item of a row, by greedy packing in twelfths (fit counts 0). */
function linesOf(items: readonly LayoutLayer[]): number[] {
  const out: number[] = [];
  let line = 0;
  let used = 0;
  for (const item of items) {
    const units = WIDTH_UNITS[readSizing(item.sizing).width];
    if (used > 0 && used + units > 12) {
      line += 1;
      used = 0;
    }
    out.push(line);
    used += units;
  }
  return out;
}

/** The line of each child of a parent, numbered across the whole parent: a whole-row child has a line of its own. */
function lineIds(parentType: string, children: readonly LayoutLayer[]): number[] {
  const out = children.map(() => 0);
  let next = 0;
  for (const segment of sizingSegments(parentType, children)) {
    if (segment.kind === 'single') {
      out[segment.index] = next;
      next += 1;
      continue;
    }
    const lines = linesOf(segment.indexes.map((i) => children[i]));
    segment.indexes.forEach((i, k) => {
      out[i] = next + lines[k];
    });
    next += lines[lines.length - 1] + 1;
  }
  return out;
}

/** True when every child but `skip` shares a line with the same neighbours before and after (lines only grow in order). */
function keepsLines(before: readonly number[], after: readonly number[], skip = -1): boolean {
  const kept = before.map((_, i) => i).filter((i) => i !== skip);
  return kept.every((i, k) => k === 0 || (before[kept[k - 1]] === before[i]) === (after[kept[k - 1]] === after[i]));
}

/** The pairs a resize handle sits between in one parent: neighbours on one line of a row, both share widths, neither growing. */
export function resizeHandles(root: LayoutLayer, parentId: string): Array<{ leftId: string; rightId: string }> {
  const path = pathOf(root, parentId);
  if (path === null || path.some(isBlock)) return [];
  const parent = path[path.length - 1];
  if (!SIZED_PARENTS.has(parent.type)) return [];
  const children = kids(parent);
  const out: Array<{ leftId: string; rightId: string }> = [];
  for (const segment of sizingSegments(parent.type, children)) {
    if (segment.kind !== 'row') continue;
    const items = segment.indexes.map((i) => children[i]);
    const lines = linesOf(items);
    for (let i = 0; i + 1 < items.length; i += 1) {
      const a = readSizing(items[i].sizing);
      const b = readSizing(items[i + 1].sizing);
      if (lines[i] === lines[i + 1] && isShareWidth(a.width) && isShareWidth(b.width) && !a.grow && !b.grow) out.push({ leftId: items[i].id, rightId: items[i + 1].id });
    }
  }
  return out;
}

/**
 * The positions a handle can take, in order, with the step offset of each (the current one is 0). A step right moves the left
 * one a rung up the share ladder (quarter, third, half, two-thirds, three-quarters) and the right one a rung down, so a pair
 * that fills one row keeps filling it (the pair table) and any other pair keeps its sum of rungs. A step off the ladder is not offered.
 */
export function pairCandidates(left: ShareWidth, right: ShareWidth): Array<{ left: ShareWidth; right: ShareWidth; steps: number }> {
  const l = SHARE_WIDTHS.indexOf(left);
  const r = SHARE_WIDTHS.indexOf(right);
  const last = SHARE_WIDTHS.length - 1;
  const out: Array<{ left: ShareWidth; right: ShareWidth; steps: number }> = [];
  for (let k = Math.max(-l, r - last); k <= Math.min(last - l, r); k += 1) out.push({ left: SHARE_WIDTHS[l + k], right: SHARE_WIDTHS[r - k], steps: k });
  return out;
}

/**
 * The positions the handle right of `leftId` can take, in order, the current one included: the pairCandidates around the
 * current position, cut at the first one that would move any part of the parent to another line (a pair that does not fill
 * its row could push the next part onto a new line). Empty when the layer has no handle on its right.
 */
export function handleCandidates(root: LayoutLayer, leftId: string): Array<{ left: ShareWidth; right: ShareWidth; steps: number }> {
  const located = findLayer(root, leftId);
  if (located === null || located.parent === null || located.inBlock) return [];
  const parent = located.parent;
  const pair = resizeHandles(root, parent.id).find((h) => h.leftId === leftId);
  const children = kids(parent);
  const right = pair === undefined ? undefined : children.find((c) => c.id === pair.rightId);
  const l = readSizing(located.layer.sizing).width;
  const r = right === undefined ? 'full' : readSizing(right.sizing).width;
  if (pair === undefined || !isShareWidth(l) || !isShareWidth(r)) return [];
  const before = lineIds(parent.type, children);
  const fits = (c: { left: ShareWidth; right: ShareWidth }): boolean => {
    const next = children.map((x) => (x.id === leftId ? withSizing(x, { width: c.left, grow: false }) : x.id === pair.rightId ? withSizing(x, { width: c.right, grow: false }) : x));
    return keepsLines(before, lineIds(parent.type, next));
  };
  const all = pairCandidates(l, r);
  const current = all.findIndex((c) => c.steps === 0);
  let lo = current;
  while (lo > 0 && fits(all[lo - 1])) lo -= 1;
  let hi = current;
  while (hi < all.length - 1 && fits(all[hi + 1])) hi += 1;
  return all.slice(lo, hi + 1);
}

/** Moves the handle right of `leftId` by `steps` (positive widens the left one), stopping at the last position that keeps every line; at_end when it cannot move at all. */
export function resizePair(root: LayoutLayer, leftId: string, steps: number): TreeResult {
  const located = findLayer(root, leftId);
  if (located === null) return refuse('not_found', MSG.gone);
  if (located.parent === null) return refuse('root_locked', MSG.rootLocked);
  if (located.inBlock) return refuse('inside_block', MSG.inBlock);
  if (!Number.isInteger(steps)) return refuse('bad_value', MSG.place);
  const pair = resizeHandles(root, located.parent.id).find((h) => h.leftId === leftId);
  const candidates = handleCandidates(root, leftId);
  if (pair === undefined || candidates.length === 0) return refuse('not_paired', MSG.notPaired);
  if (steps === 0) return ok(root, leftId);
  const reach = steps > 0 ? Math.min(steps, candidates[candidates.length - 1].steps) : Math.max(steps, candidates[0].steps);
  const chosen = candidates.find((c) => c.steps === reach);
  if (reach === 0 || chosen === undefined) return refuse('at_end', MSG.handleEnd);
  return ok(
    placeAll(root, [
      { id: leftId, sizing: { width: chosen.left, grow: false } },
      { id: pair.rightId, sizing: { width: chosen.right, grow: false } },
    ]),
    leftId,
  );
}

/**
 * Shrink (-1) and Widen (+1): the handle of the layer's pair moves first; at its end, or with no pair, the layer steps alone,
 * unless that would move another part of the parent to a different line (then at_end).
 */
export function stepWidth(root: LayoutLayer, id: string, delta: -1 | 1): TreeResult {
  if (delta !== -1 && delta !== 1) return refuse('bad_value', MSG.place);
  const found = sizable(root, id);
  if (!found.ok) return found.refusal;
  const handles = resizeHandles(root, found.parent.id);
  if (handles.some((h) => h.leftId === id)) {
    const paired = resizePair(root, id, delta);
    if (paired.ok) return ok(paired.root, id);
  }
  const before = handles.find((h) => h.rightId === id);
  if (before !== undefined) {
    const paired = resizePair(root, before.leftId, -delta);
    if (paired.ok) return ok(paired.root, id);
  }
  const current = readSizing(found.layer.sizing);
  const at = ALONE.indexOf(current.width) + delta;
  if (at < 0) return refuse('at_end', MSG.narrowest);
  if (at >= ALONE.length) return refuse('at_end', MSG.widest);
  const alone = setSizing(root, id, { width: ALONE[at], grow: current.grow });
  if (!alone.ok || alone.root === root) return alone;
  const after = findLayer(alone.root, id);
  if (after === null || after.parent === null) return refuse('not_found', MSG.gone);
  const parentType = found.parent.type;
  if (!keepsLines(lineIds(parentType, kids(found.parent)), lineIds(parentType, kids(after.parent)), after.index)) return refuse('at_end', MSG.otherLine);
  return alone;
}

// ---------------------------------------------------------------------------------------------
// Settings of a built-in part
// ---------------------------------------------------------------------------------------------

/** Sets the string at "children" or "props.<path>" on a copy of the layer; false when the place does not hold text. */
function writeSlot(layer: LayoutLayer, target: string, value: string): boolean {
  if (target === 'children') {
    if (typeof layer.children !== 'string') return false;
    layer.children = value;
    return true;
  }
  const segments = target.split('.').slice(1);
  let cursor: unknown = layer.props;
  for (const key of segments.slice(0, -1)) {
    if (typeof cursor !== 'object' || cursor === null || !Object.hasOwn(cursor, key)) return false;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  const last = segments[segments.length - 1];
  if (typeof cursor !== 'object' || cursor === null || !Object.hasOwn(cursor, last)) return false;
  (cursor as Record<string, unknown>)[last] = value;
  return true;
}

/** Removes the value at "props.<path>" from a copy of the layer. */
function dropProp(layer: LayoutLayer, target: string): void {
  const segments = target.split('.').slice(1);
  let cursor: unknown = layer.props;
  for (const key of segments.slice(0, -1)) {
    if (typeof cursor !== 'object' || cursor === null || !Object.hasOwn(cursor, key)) return;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  if (typeof cursor === 'object' && cursor !== null) delete (cursor as Record<string, unknown>)[segments[segments.length - 1]];
}

const slotAt = (layer: LayoutLayer, target: string): Slot | undefined => slotsOf(layer).find((s) => s.target === target);

/** The fields a field slot may take in this layer, or null when the table it depends on is not known. */
function fieldChoices(layer: LayoutLayer, slot: Slot, ctx: PartContext, editable = false): string[] | null {
  const ofSlot = slot.of === undefined ? undefined : slotAt(layer, slot.of);
  if (ofSlot === undefined || typeof ofSlot.value !== 'string') return null;
  const table = ofSlot.kind === 'table' ? (ctx.tableIds.includes(ofSlot.value) ? ofSlot.value : null) : (ctx.sources[ofSlot.value]?.table ?? null);
  if (table === null) return null;
  return fieldIdsOf(ctx, [table], { ...(slot.fieldTypes === undefined ? {} : { types: slot.fieldTypes }), ...(editable ? { editable: true } : {}) });
}

/** Why a value does not fit a slot, or null when it does. */
function slotProblem(layer: LayoutLayer, slot: Slot, value: string, ctx: PartContext): string | null {
  if (slot.kind === 'text') {
    if (value.length < 1 || value.length > LIMITS.layerTextChars) return `Use 1 to ${LIMITS.layerTextChars} characters.`;
    return CONTROL_RE.test(value) ? 'Remove the special characters.' : null;
  }
  if (slot.kind === 'table') return ctx.tableIds.includes(value) ? null : 'Pick a table of this app.';
  if (slot.kind === 'page') {
    // The back link of a breadcrumb must lead to a page that opens without a record.
    const pages = slot.target === 'props.page' ? linkablePageIds(ctx) : ctx.pageIds;
    return pages.includes(value) ? null : 'Pick a page of this app.';
  }
  if (slot.kind === 'source') {
    const source = Object.hasOwn(ctx.sources, value) ? ctx.sources[value] : undefined;
    return source !== undefined && (slot.mode === undefined || source.mode === slot.mode) ? null : 'Pick a list or record of this page.';
  }
  const choices = fieldChoices(layer, slot, ctx);
  return choices !== null && choices.includes(value) ? null : 'Pick a field of that table.';
}

const shallow = (layer: LayoutLayer): LayoutLayer => ({ ...layer, children: typeof layer.children === 'string' ? layer.children : [] });

/**
 * Settings of a built-in part by slot target ("children" or "props.<path>"). Text, table, list, page and field slots can be written,
 * plus the choice and number props of choiceProps.ts (checked against the part's zod shape). Nothing else.
 */
export function configureLayer(root: LayoutLayer, id: string, values: Readonly<Record<string, string>>, ctx: PartContext, place: LayerPlace = 'page'): TreeResult {
  const located = findLayer(root, id);
  if (located === null) return refuse('not_found', MSG.gone);
  if (located.inBlock || located.layer.feature !== undefined) return refuse('inside_block', 'Change a feature block through its own settings.');
  const original = located.layer;
  const slots = slotsOf(original).filter((s) => CONFIGURABLE.has(s.kind));
  const choices = new Map(choicePropsOf(original.type).map((c) => [choiceKey(c), c]));
  const special = specialKeysOf(original.type);
  const all = Object.entries(values);
  const bad = (message: string): TreeResult => refuse('bad_value', message);
  for (const [key, value] of all) {
    if (key.split('.').some((s) => FORBIDDEN_SEGMENTS.has(s))) return bad('That setting cannot be changed.');
    if (typeof value !== 'string' || !(choices.has(key) || special.includes(key) || slots.some((s) => s.target === key))) return bad('That setting cannot be changed.');
  }
  const entries = all.filter(([key]) => !choices.has(key) && !special.includes(key));

  const next: LayoutLayer = { ...original, props: clone(original.props) as Record<string, JsonValue> };
  for (const [key, value] of all) {
    const choice = choices.get(key);
    if (choice === undefined) continue;
    const read = readChoice(original.type, choice, value, ctx);
    if (!read.ok) return bad(read.message);
    if (read.value === null) delete next.props[choice.prop];
    else next.props[choice.prop] = read.value;
  }
  for (const [key, value] of entries) if (!writeSlot(next, key, value)) return bad('That setting cannot be changed.');
  for (const [key, value] of entries) {
    const slot = slotsOf(next).find((s) => s.target === key);
    const problem = slot === undefined ? 'That setting cannot be changed.' : slotProblem(next, slot, value, ctx);
    if (problem !== null) return bad(problem);
  }

  // A new list or table makes the old field choices meaningless: lists of fields go, single fields go when they no longer fit.
  for (const [key, value] of entries) {
    const before = slots.find((s) => s.target === key);
    if (before === undefined || (before.kind !== 'source' && before.kind !== 'table') || before.value === value) continue;
    for (const dependent of slotsOf(original)) {
      if (dependent.of !== key || entries.some(([k]) => k === dependent.target)) continue;
      if (dependent.kind === 'fields') {
        dropProp(next, dependent.target);
      } else if (dependent.kind === 'field' && !/\.\d+$/.test(dependent.target)) {
        const fresh = slotAt(next, dependent.target);
        const choices = fresh === undefined ? null : fieldChoices(next, fresh, ctx);
        if (fresh !== undefined && typeof fresh.value === 'string' && !(choices ?? []).includes(fresh.value)) dropProp(next, dependent.target);
      }
    }
  }

  for (const [key, value] of all) {
    if (!special.includes(key)) continue;
    const problem = applySpecial(next, key, value);
    if (problem !== null) return bad(problem);
  }

  const known = checkLayer(shallow(original), ctx, 'layer', LIMITS.issues, place);
  const introduced = checkLayer(shallow(next), ctx, 'layer', LIMITS.issues, place).filter((i) => !known.some((k) => k.path === i.path && k.code === i.code));
  if (introduced.length > 0) return bad('That choice does not fit with the other settings of this part.');
  const path = pathOf(root, id);
  return path === null ? refuse('not_found', MSG.gone) : ok(replaceAtPath(path, next), id);
}

// ---------------------------------------------------------------------------------------------
// New layers
// ---------------------------------------------------------------------------------------------

const REFUSAL_FOR: Readonly<Record<SlotKind, string>> = {
  text: 'This part needs text.',
  table: 'This app has no table yet.',
  source: 'Add a list to this page first, in Page settings.',
  page: 'This app has no pages.',
  field: 'No table has a field of the right kind for this part.',
  fields: 'The table has no field this part can show.',
};

/** An example prop a new part does not keep: Columns starts with equal widths, not the example's wide left. */
const DROPPED_PROPS: Readonly<Record<string, readonly string[]>> = { Columns: ['layout'] };

/** True when the prop may be left out of the layer (an optional prop of the part's zod shape). Nested props count as required. */
function isOptionalProp(def: PartDefinition, ctx: PartContext, prop: string): boolean {
  if (prop.includes('.')) return false;
  const shape = def.props(ctx).shape;
  return Object.hasOwn(shape, prop) && z.safeParse(shape[prop], undefined).success;
}

/** The first table or list that has a candidate for every required field prop that depends on it, else the first one. */
function ownerChoice(def: PartDefinition, l: LayoutLayer, bind: PartDefinition['binds'][number], ctx: PartContext): string | undefined {
  const pool = bind.kind === 'table' ? ctx.tableIds : ctx.sourceIds.filter((s) => bind.mode === undefined || ctx.sources[s].mode === bind.mode);
  const needs = def.binds.filter((b) => b.kind === 'field' && b.of === bind.prop && !isOptionalProp(def, ctx, b.prop) && slotAt(l, `props.${b.prop}`) !== undefined);
  const fits = (id: string): boolean => {
    const table = bind.kind === 'table' ? id : ctx.sources[id]?.table;
    return table !== undefined && needs.every((b) => fieldIdsOf(ctx, [table], { ...(b.fieldTypes ? { types: b.fieldTypes } : {}), ...(b.editable ? { editable: true } : {}) }).length > 0);
  };
  return pool.find(fits) ?? pool[0];
}

/** Example texts that name the sample app's own data; a new part gets a neutral word instead. */
const GENERIC_TEXT: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  StatCard: { label: 'Total' },
  ReferencePicker: { label: 'Linked record' },
  RecordForm: { submitLabel: 'Save' },
};

/** Props a part takes when its optional `field` had nothing to point at: a number tile with no number field counts rows (B9). */
const WHEN_FIELD_DROPPED: Readonly<Record<string, Readonly<Record<string, string>>>> = { StatCard: { stat: 'count' } };

export function uniqueId(prefix: string, taken: Set<string>): string {
  let n = 1;
  while (taken.has(`${prefix}_${n}`)) n += 1;
  const id = `${prefix}_${n}`;
  taken.add(id);
  return id;
}

/** A new built-in part with example settings, fresh ids and every list, table, page and field pointed at this page. */
export function newPartLayer(type: string, ctx: PartContext, takenIds: ReadonlySet<string>): LayoutLayer | { refusal: string } {
  const def = getPartDefinition(type);
  if (def === undefined || def.name === 'Page' || def.name === 'Tab') return { refusal: "This part can't be added on its own." };
  if (def.name === 'Column') return { refusal: 'A column can only be added to Columns, with Add a column.' };
  const taken = new Set(takenIds);
  const layer = clone(def.example);
  const stack: LayoutLayer[] = [layer];
  for (let l = stack.pop(); l !== undefined; l = stack.pop()) {
    const own = getPartDefinition(l.type);
    l.id = uniqueId(l.type.toLowerCase(), taken);
    if (own === undefined) continue;
    if (own.children === 'text') l.children = own.textDefault ?? own.name;
    for (const prop of DROPPED_PROPS[l.type] ?? []) delete l.props[prop];
    for (const [prop, text] of Object.entries(GENERIC_TEXT[l.type] ?? {})) if (typeof l.props[prop] === 'string') l.props[prop] = text;
    // Optional row and form actions of the example point at a record page this page may not have.
    for (const [prop, value] of Object.entries(l.props)) {
      if ((prop === 'rowAction' || prop === 'afterSave') && typeof value === 'object' && value !== null) delete l.props[prop];
    }
    for (const bind of own.binds) if (bind.kind === 'fields') dropProp(l, `props.${bind.prop}`);
    for (const bind of own.binds) {
      const target = `props.${bind.prop}`;
      const slot = slotAt(l, target);
      if (slot === undefined || typeof slot.value !== 'string') continue;
      let choice: string | undefined;
      if (bind.kind === 'table' || bind.kind === 'source') choice = ownerChoice(own, l, bind, ctx);
      else if (bind.kind === 'page') choice = linkablePageIds(ctx)[0] ?? ctx.pageIds[0];
      else if (bind.kind === 'field') {
        const options = fieldChoices(l, slot, ctx, bind.editable === true) ?? [];
        const owner = bind.of === undefined ? undefined : slotAt(l, `props.${bind.of}`);
        const ownerTable = owner === undefined || typeof owner.value !== 'string' ? undefined : owner.kind === 'table' ? owner.value : ctx.sources[owner.value]?.table;
        choice = rankFieldIds(options, bind.fieldTypes, ownerTable === undefined ? [] : (ctx.fields[ownerTable] ?? []))[0];
      }
      if (choice === undefined) {
        // An optional prop with nothing to point at is left out; a required one refuses the part.
        if (isOptionalProp(own, ctx, bind.prop)) {
          dropProp(l, target);
          continue;
        }
        return { refusal: REFUSAL_FOR[bind.kind] };
      }
      writeSlot(l, target, choice);
    }
    if (l.props.field === undefined) Object.assign(l.props, WHEN_FIELD_DROPPED[l.type] ?? {});
    // A new Columns, Tabs or Grid starts with empty columns, tabs or cells (each says Add here), not a placeholder Text to delete later.
    if (l.type === 'Column' || l.type === 'Tab' || l.type === 'Grid') l.children = [];
    stack.push(...kids(l));
  }
  let problems = checkLayer(layer, ctx, 'layer', 1);
  if (problems.length > 0) {
    // A list of fields some parts need: give them the first fitting field.
    const retry = clone(layer);
    for (const l of [retry, ...kids(retry)]) {
      const own = getPartDefinition(l.type);
      for (const bind of own?.binds ?? []) {
        if (bind.kind !== 'fields' || bind.prop.includes('.')) continue;
        const ofSlot = bind.of === undefined ? undefined : slotAt(l, `props.${bind.of}`);
        if (ofSlot === undefined || typeof ofSlot.value !== 'string') continue;
        const table = ofSlot.kind === 'table' ? ofSlot.value : ctx.sources[ofSlot.value]?.table;
        const options = table === undefined ? [] : fieldIdsOf(ctx, [table], { ...(bind.fieldTypes ? { types: bind.fieldTypes } : {}), ...(bind.editable ? { editable: true } : {}) });
        if (options.length > 0) l.props[bind.prop] = [options[0]];
      }
    }
    problems = checkLayer(retry, ctx, 'layer', 1);
    if (problems.length === 0) return retry;
    return { refusal: "This part can't be added to this page yet. Check the page settings." };
  }
  return layer;
}

/** A new tab panel at the end of a Tabs part: "Tab N", empty. Refused like any insert (limits, feature blocks, a part that is not Tabs). */
export function addTab(root: LayoutLayer, tabsId: string, ctx: PartContext, takenIds: ReadonlySet<string>): TreeResult {
  const found = findLayer(root, tabsId);
  if (found === null) return refuse('not_found', MSG.gone);
  const tabs = found.layer;
  const def = getPartDefinition('Tab');
  if (def === undefined) return refuse('not_allowed_here', notAllowedMessage(tabs, 'Tab'));
  const taken = new Set(takenIds);
  const tab = clone(def.example);
  tab.id = uniqueId('tab', taken);
  const siblings = kids(tabs);
  const labels = new Set(siblings.map((t) => t.props.label));
  let n = siblings.length + 1;
  while (labels.has(`Tab ${n}`)) n += 1;
  tab.props = { ...tab.props, label: `Tab ${n}` };
  tab.children = [];
  return insertLayer(root, { parentId: tabsId, index: siblings.length }, tab);
}

/** A new column at the end of a Columns part: "Column N", empty. Refused like any insert (a fifth column, feature blocks, a part that is not Columns). */
export function addColumn(root: LayoutLayer, columnsId: string, ctx: PartContext, takenIds: ReadonlySet<string>): TreeResult {
  const found = findLayer(root, columnsId);
  if (found === null) return refuse('not_found', MSG.gone);
  const columns = found.layer;
  const def = getPartDefinition('Column');
  if (def === undefined) return refuse('not_allowed_here', notAllowedMessage(columns, 'Column'));
  const taken = new Set(takenIds);
  const column = clone(def.example);
  column.id = uniqueId('column', taken);
  column.children = [];
  return insertLayer(root, { parentId: columnsId, index: kids(columns).length }, column);
}

/**
 * A feature expanded at a free id, with the page's current layer count as the budget. `rootId` keeps a given id (a block
 * being re-expanded in place); the caller then leaves the block's own ids out of `takenIds`.
 */
export function newFeatureLayer(
  def: FeatureDefinition,
  values: Record<string, string>,
  ctx: PartContext,
  lib: FeatureLibrary,
  takenIds: Set<string>,
  rootId?: string,
): ExpandResult<LayoutLayer> {
  const taken = new Set(takenIds);
  let n = 1;
  while (rootId === undefined && taken.has(`${def.id}_${n}`)) n += 1;
  return expandFeature(def, values, ctx, lib, {
    rootId: rootId ?? `${def.id}_${n}`,
    takenIds: taken,
    budget: { left: LIMITS.layersPerPage - takenIds.size },
  });
}

/**
 * One valid value per setting, or null when any setting has no choice on this page. A table setting that shares a slot with a list
 * setting (pairedParams) takes the table of the page's first list, so the two always agree. A text setting starts with the words
 * in the feature's own parts (textDefault); a field setting with pickField.
 */
export function autoValues(def: FeatureDefinition, ctx: PartContext): Record<string, string> | null {
  const values: Record<string, string> = {};
  const pairs = pairedParams(def);
  for (const p of def.params) {
    if (p.type === 'text') values[p.name] = textDefault(def, p);
    else if (p.type === 'table') {
      const pair = pairs.find((x) => x.table.name === p.name);
      const list = pair === undefined ? undefined : ctx.sourceIds.find((s) => ctx.sources[s].mode === 'list');
      const table = pair === undefined ? ctx.tableIds[0] : list === undefined ? undefined : ctx.sources[list].table;
      if (table === undefined) return null;
      values[p.name] = table;
    } else if (p.type === 'page') {
      if (ctx.pageIds.length === 0) return null;
      values[p.name] = ctx.pageIds[0];
    } else if (p.type === 'source') {
      const found = ctx.sourceIds.find((s) => ctx.sources[s].mode === (p.mode ?? 'list'));
      if (found === undefined) return null;
      values[p.name] = found;
    }
  }
  for (const p of def.params) {
    if (p.type !== 'field') continue;
    const dep = def.params.find((q) => q.name === p.of);
    const ref = dep === undefined ? undefined : values[dep.name];
    const table = dep === undefined || ref === undefined ? undefined : dep.type === 'table' ? ref : ctx.sources[ref]?.table;
    const options = table === undefined ? [] : fieldIdsOf(ctx, [table], p.fieldTypes === undefined ? {} : { types: p.fieldTypes });
    const choice = table === undefined ? undefined : pickField(p, options, ctx.fields[table] ?? []);
    if (choice === undefined) return null;
    values[p.name] = choice;
  }
  return checkParamValues(def, values, ctx, '').length === 0 ? values : null;
}
