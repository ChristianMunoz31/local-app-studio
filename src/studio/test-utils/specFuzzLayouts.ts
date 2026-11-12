// Random layer trees for the spec fuzz tests (DESIGN-phase11.md 2.0), built only through the real Design helpers
// (newPartLayer, insertLayer at a dropTargets entry, addColumn, addTab, setSizing, newMenuLayer, composeMenu). The helpers use the "@/" alias.
// The shared core is src/test-utils/specFuzz.ts. This file lives under src/studio because it imports Studio code and the runtime template excludes src/studio.
import { PART_DEFINITIONS } from '../../catalog/definitions.ts';
import { menuPartContext, partContextFor } from '../../catalog/validateLayout.ts';
import { MENU_PARTS } from '@local-app-studio/runtime/spec/menuSlots.ts';
import type { AppSpecInput, LayoutLayer, Menu } from '@local-app-studio/runtime/spec/schema.ts';
import { LAYER_WIDTHS } from '@local-app-studio/runtime/spec/sizing.ts';
import { addColumn, addTab, canSize, dropTargets, findLayer, insertLayer, newPartLayer, setSizing } from '../lib/layoutTree.ts';
import { composeMenu, menuTreeOf, newMenuLayer } from '../lib/menuTree.ts';
import { chance, int, pick } from '../../test-utils/specFuzz.ts';
import type { Obj, Rand } from '../../test-utils/specFuzz.ts';

const PART_TYPES = PART_DEFINITIONS.map((d) => d.name).filter((n) => n !== 'Page' && n !== 'Tab' && n !== 'Column');
const CONTAINERS = ['Section', 'Columns', 'Tabs', 'Grid', 'Row', 'Card', 'Collapsible'];

const kids = (l: LayoutLayer): LayoutLayer[] => (Array.isArray(l.children) ? l.children : []);

function idsOf(root: LayoutLayer): Set<string> {
  const out = new Set<string>();
  const stack = [root];
  for (let l = stack.pop(); l !== undefined; l = stack.pop()) {
    out.add(l.id);
    stack.push(...kids(l));
  }
  return out;
}

function allLayers(root: LayoutLayer): LayoutLayer[] {
  const out: LayoutLayer[] = [];
  const stack = [root];
  for (let l = stack.pop(); l !== undefined; l = stack.pop()) {
    out.push(l);
    stack.push(...kids(l));
  }
  return out;
}

/**
 * The layers that canSize accepts, in allLayers order. canSize walks the whole tree to find a layer's path, so asking it of every
 * layer of a 400-layer page is quadratic; it only reads the path, so each layer is asked about a tree holding just its own path.
 */
function sizableLayers(root: LayoutLayer): LayoutLayer[] {
  const layers = allLayers(root);
  const parentOf = new Map<LayoutLayer, LayoutLayer>();
  for (const l of layers) for (const k of kids(l)) parentOf.set(k, l);
  return layers.filter((l) => {
    if (l.id === root.id) return false;
    let chain: LayoutLayer = { ...l, children: [] };
    for (let p = parentOf.get(l); p !== undefined; p = parentOf.get(p)) chain = { ...p, children: [chain] };
    return canSize(chain, l.id);
  });
}

export interface LayoutStats {
  /** Deepest layer count reached by any page (the Page is level 1). */
  maxDepth: number;
  /** Most layers on one page. */
  maxLayers: number;
}

const depthOf = (root: LayoutLayer): number => {
  let best = 0;
  const stack: Array<[LayoutLayer, number]> = [[root, 1]];
  for (let e = stack.pop(); e !== undefined; e = stack.pop()) {
    best = Math.max(best, e[1]);
    for (const k of kids(e[0])) stack.push([k, e[1] + 1]);
  }
  return best;
};

/** One page layout: `attempts` random inserts, Columns and Tabs growth and sizing edits, leaning on the last container so trees get deep. */
function buildPage(rand: Rand, spec: AppSpecInput, pageIndex: number, attempts: number): LayoutLayer {
  const page = spec.pages[pageIndex];
  const ctx = partContextFor(spec, page);
  let root = page.layout as LayoutLayer;
  let taken = idsOf(root);
  let lastContainer: string | null = null;
  for (let n = 0; n < attempts; n += 1) {
    const roll = rand();
    if (roll < 0.08) {
      const columns = allLayers(root).filter((l) => l.type === 'Columns' && l.feature === undefined);
      if (columns.length === 0) continue;
      const r = addColumn(root, pick(rand, columns).id, ctx, taken);
      if (r.ok) {
        root = r.root;
        taken = idsOf(root);
      }
    } else if (roll < 0.14) {
      const tabs = allLayers(root).filter((l) => l.type === 'Tabs' && l.feature === undefined);
      if (tabs.length === 0) continue;
      const r = addTab(root, pick(rand, tabs).id, ctx, taken);
      if (r.ok) {
        root = r.root;
        taken = idsOf(root);
      }
    } else if (roll < 0.28) {
      const sized = sizableLayers(root);
      if (sized.length === 0) continue;
      const r = setSizing(root, pick(rand, sized).id, { width: pick(rand, LAYER_WIDTHS), grow: chance(rand, 0.4) });
      if (r.ok) root = r.root;
    } else {
      const type = chance(rand, 0.35) ? pick(rand, CONTAINERS) : pick(rand, PART_TYPES);
      const made = newPartLayer(type, ctx, taken);
      if ('refusal' in made) continue;
      let targets = dropTargets(root, made.type);
      if (targets.length === 0) continue;
      if (lastContainer !== null && chance(rand, 0.7)) {
        const inside = targets.filter((t) => t.parentId === lastContainer);
        if (inside.length > 0) targets = inside;
      }
      const r = insertLayer(root, pick(rand, targets), made);
      if (!r.ok) continue;
      root = r.root;
      taken = idsOf(root);
      if (CONTAINERS.includes(made.type) && findLayer(root, made.id) !== null) lastContainer = made.type === 'Columns' ? (kids(made)[0]?.id ?? made.id) : made.type === 'Tabs' ? (kids(made)[0]?.id ?? made.id) : made.id;
    }
  }
  return root;
}

/** The menu bar slots, filled with small parts through the menu helpers. */
function buildMenu(rand: Rand, spec: AppSpecInput, menu: Menu, attempts: number): Menu {
  const ctx = menuPartContext(spec);
  let tree = menuTreeOf(menu);
  let taken = idsOf(tree);
  for (let n = 0; n < attempts; n += 1) {
    const type = pick(rand, MENU_PARTS);
    const made = newMenuLayer(type, ctx, taken);
    if ('refusal' in made) continue;
    const targets = dropTargets(tree, made.type);
    if (targets.length === 0) continue;
    const r = insertLayer(tree, pick(rand, targets), made);
    if (!r.ok) continue;
    tree = r.root;
    taken = idsOf(tree);
  }
  return composeMenu(menu, tree) ?? menu;
}

/**
 * Replaces every page layout of a generated spec with a random tree and fills the menu slots. Mutates and returns the spec.
 * Most pages get a few dozen attempts, about one in eight gets 400 (the page limit is 300 layers, nesting 16).
 */
export function fillLayouts(rand: Rand, spec: AppSpecInput): { spec: AppSpecInput; stats: LayoutStats } {
  const stats: LayoutStats = { maxDepth: 0, maxLayers: 0 };
  spec.pages.forEach((_, i) => {
    const attempts = chance(rand, 0.08) ? 400 : int(rand, 0, 40);
    const layout = buildPage(rand, spec, i, attempts);
    (spec.pages[i] as Obj).layout = layout;
    stats.maxDepth = Math.max(stats.maxDepth, depthOf(layout));
    stats.maxLayers = Math.max(stats.maxLayers, allLayers(layout).length);
  });
  if (spec.menu !== undefined) (spec as Obj).menu = buildMenu(rand, spec, spec.menu as Menu, int(rand, 0, 30));
  return { spec, stats };
}
