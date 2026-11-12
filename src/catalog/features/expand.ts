// Feature expansion (docs/FEATURES.md, ADR-007). Copies a feature's parts into a page, writes typed string values into
// catalog-declared slots at paths that already exist, and stamps a marker on the root. Pure: no I/O, never throws on
// bad input. The caller re-validates the whole page after expansion (checkSpec / validateAppSpec with checkLayout).
import type { AppSpecInput, LayoutLayer, SpecIssue } from '@local-app-studio/runtime/spec/schema.ts';
import { LIMITS } from '@local-app-studio/runtime/spec/schema.ts';
import { getPartDefinition } from '../definitions.ts';
import type { PartContext } from '../types.ts';
import { partContextFor } from '../validateLayout.ts';
import { FEATURE_LIMITS, FEATURE_TYPE } from './limits.ts';
import { slotsOf } from './slots.ts';
import type { FeatureDefinition, FeatureLibrary, FeatureParam } from './types.ts';

export interface ExpandOptions {
  /** Dotted path of the layer in the document, for issues. */
  path?: string;
  /** Layer ids already on the page. Updated with every id this call assigns. */
  takenIds?: Set<string>;
  /** Nesting level of the feature being expanded (1 for the outermost). */
  depth?: number;
  /** Feature ids being expanded around this one (set by the expander itself). */
  chain?: readonly string[];
  /** Layers still allowed on the page (set by the expander itself). */
  budget?: { left: number };
}

export type ExpandResult<T> = { ok: true; value: T; used: string[] } | { ok: false; issues: SpecIssue[] };

const FORBIDDEN_SEGMENTS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);
const SEGMENT_RE = /^([A-Za-z][A-Za-z0-9]*|[0-9]{1,3})$/;
// Control characters other than newline.
export const CONTROL_RE = /[\u0000-\u0009\u000b-\u001f\u007f]/;
const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const issue = (path: string, code: string, message: string): SpecIssue => ({ path, code, message });
const listOf = (names: readonly string[]): string => (names.length > 0 ? names.join(', ') : 'none yet');
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

interface Entry {
  layer: LayoutLayer;
  /** The array holding the layer, null for the root. */
  siblings: LayoutLayer[] | null;
  index: number;
  path: string;
}

/** Pre-order walk (iterative). Skips anything that is not a layer-shaped object. */
function walk(root: LayoutLayer, base: string): Entry[] {
  const out: Entry[] = [];
  const stack: Entry[] = [{ layer: root, siblings: null, index: 0, path: base }];
  for (let e = stack.pop(); e !== undefined; e = stack.pop()) {
    out.push(e);
    const kids = e.layer.children;
    if (Array.isArray(kids)) {
      for (let i = kids.length - 1; i >= 0; i -= 1) {
        if (isPlain(kids[i])) stack.push({ layer: kids[i], siblings: kids, index: i, path: `${e.path}.children.${i}` });
      }
    }
  }
  return out;
}

const isIndexKey = (holder: unknown, key: string): boolean => Array.isArray(holder) && /^[0-9]+$/.test(key);

/** Writes a string into an existing string leaf. Returns a problem text, or null when written. */
function setExisting(layer: LayoutLayer, target: string, value: string): string | null {
  if (target === 'children') {
    if (getPartDefinition(layer.type)?.children !== 'text' || typeof layer.children !== 'string') return 'it has no text to fill';
    layer.children = value;
    return null;
  }
  const segments = target.split('.');
  if (segments[0] !== 'props' || segments.length < 2) return 'it is not "children" or a "props." path';
  const path = segments.slice(1);
  if (path.some((s) => FORBIDDEN_SEGMENTS.has(s) || !SEGMENT_RE.test(s))) return 'the path has a part that is not allowed';
  let cursor: unknown = layer.props;
  for (const key of path.slice(0, -1)) {
    if (!(isPlain(cursor) || isIndexKey(cursor, key)) || !Object.hasOwn(cursor as object, key)) return 'the path does not exist';
    cursor = (cursor as Record<string, unknown>)[key];
  }
  const last = path[path.length - 1];
  if (!(isPlain(cursor) || isIndexKey(cursor, last)) || !Object.hasOwn(cursor as object, last)) return 'the path does not exist';
  const holder = cursor as Record<string, unknown>;
  if (typeof holder[last] !== 'string') return 'it does not hold text or an id';
  holder[last] = value;
  return null;
}

/** The checked contents of a Feature node, or the issues that explain what is wrong with it. */
export function readFeatureNode(
  node: LayoutLayer,
  path: string,
): { ok: true; featureId: string; params: Record<string, string> } | { ok: false; issues: SpecIssue[] } {
  const issues: SpecIssue[] = [];
  const props: unknown = node.props;
  const featureId = isPlain(props) ? props.featureId : undefined;
  const params = isPlain(props) ? props.params : undefined;
  const valid =
    isPlain(props) &&
    Object.keys(props).length === 2 &&
    typeof featureId === 'string' &&
    isPlain(params) &&
    Object.keys(params).length <= FEATURE_LIMITS.params &&
    Object.values(params).every((v) => typeof v === 'string');
  if (!valid) {
    issues.push(issue(`${path}.props`, 'feature_props', 'A Feature needs exactly featureId (text) and params (an object of text values, at most 6).'));
  }
  const kids = node.children;
  if (!(kids === '' || (Array.isArray(kids) && kids.length === 0))) {
    issues.push(issue(`${path}.children`, 'feature_children', 'A Feature takes no children. Leave children empty.'));
  }
  if (issues.length > 0 || typeof featureId !== 'string' || !isPlain(params)) return { ok: false, issues };
  return { ok: true, featureId, params: params as Record<string, string> };
}

/** Param values against the page: types, ids from this page, field types. One issue per problem. */
export function checkParamValues(def: FeatureDefinition, params: unknown, ctx: PartContext, path: string): SpecIssue[] {
  const issues: SpecIssue[] = [];
  const where = (name: string): string => `${path}.props.params.${name}`;
  if (!isPlain(params)) return [issue(path, 'feature_props', `Feature "${def.id}": params must be an object of text values.`)];
  const names = def.params.map((p) => p.name);
  for (const key of Object.keys(params)) {
    if (!names.includes(key)) issues.push(issue(where(key), 'unknown_param', `Feature "${def.id}" has no parameter "${key}". Use: ${listOf(names)}.`));
  }
  const tableOf = (p: FeatureParam): string | null => {
    const target = def.params.find((q) => q.name === p.of);
    const v = target === undefined ? undefined : params[target.name];
    if (target === undefined || typeof v !== 'string') return null;
    if (target.type === 'table') return ctx.tableIds.includes(v) ? v : null;
    return Object.hasOwn(ctx.sources, v) ? ctx.sources[v].table : null;
  };
  for (const p of def.params) {
    const at = where(p.name);
    if (!Object.hasOwn(params, p.name)) {
      issues.push(issue(at, 'missing_param', `Feature "${def.id}" needs a value for "${p.name}" (${p.label}).`));
      continue;
    }
    const v = params[p.name];
    const bad = (message: string): void => {
      issues.push(issue(at, 'param_type', `Feature "${def.id}": "${p.name}" ${message}`));
    };
    if (typeof v !== 'string') {
      bad('must be text.');
    } else if (p.type === 'text') {
      if (v.length < 1 || v.length > FEATURE_LIMITS.textValueChars) bad(`must be 1 to ${FEATURE_LIMITS.textValueChars} characters.`);
      else if (CONTROL_RE.test(v)) bad('must not contain control characters.');
    } else if (p.type === 'table') {
      if (!ctx.tableIds.includes(v)) bad(`must be a table of this app. Use one of: ${listOf(ctx.tableIds)}.`);
    } else if (p.type === 'page') {
      if (!ctx.pageIds.includes(v)) bad(`must be a page of this app. Use one of: ${listOf(ctx.pageIds)}.`);
    } else if (p.type === 'source') {
      const mode = p.mode ?? 'list';
      const right = ctx.sourceIds.filter((id) => ctx.sources[id].mode === mode);
      if (!Object.hasOwn(ctx.sources, v) || ctx.sources[v].mode !== mode) bad(`must be a ${mode} source of this page. Use one of: ${listOf(right)}.`);
    } else {
      const table = tableOf(p);
      if (table === null) continue; // The parameter it depends on is already reported (or the definition is broken).
      const known = Object.hasOwn(ctx.fields, table) ? ctx.fields[table] : [];
      const usable = known.filter((f) => p.fieldTypes === undefined || p.fieldTypes.includes(f.type)).map((f) => f.id);
      const field = known.find((f) => f.id === v);
      if (field === undefined || (p.fieldTypes !== undefined && !p.fieldTypes.includes(field.type))) {
        bad(`must be a field of table "${table}"${p.fieldTypes ? ` of type ${p.fieldTypes.join(' or ')}` : ''}. Use one of: ${listOf(usable)}.`);
      }
    }
  }
  return issues;
}

/** One feature with values, as a layer tree rooted at rootId. Checks the values against ctx first. */
export function expandFeature(
  def: FeatureDefinition,
  params: Record<string, string>,
  ctx: PartContext,
  lib: FeatureLibrary,
  opts: ExpandOptions & { rootId: string },
): ExpandResult<LayoutLayer> {
  const path = opts.path ?? '';
  const depth = opts.depth ?? 1;
  const chain = opts.chain ?? [];
  const taken = opts.takenIds ?? new Set<string>();
  const budget = opts.budget ?? { left: LIMITS.layersPerPage };
  if (chain.includes(def.id)) {
    return { ok: false, issues: [issue(path, 'feature_cycle', `Feature "${def.id}" would contain itself: ${[...chain, def.id].join(' -> ')}.`)] };
  }
  if (depth > FEATURE_LIMITS.nestDepth) {
    return {
      ok: false,
      issues: [issue(path, 'feature_too_deep', `Features may be nested at most ${FEATURE_LIMITS.nestDepth} levels deep (${[...chain, def.id].join(' -> ')}).`)],
    };
  }
  const paramIssues = checkParamValues(def, params, ctx, path);
  if (paramIssues.length > 0) return { ok: false, issues: paramIssues };

  let root: LayoutLayer;
  try {
    root = clone(def.fragment);
  } catch {
    return { ok: false, issues: [issue(path, 'invalid_fragment', `Feature "${def.id}" is damaged and cannot be placed.`)] };
  }
  const entries = walk(root, path);
  budget.left -= entries.length;
  if (budget.left < 0) {
    return { ok: false, issues: [issue(path, 'feature_too_large', `Placing "${def.id}" would make the page hold more than ${LIMITS.layersPerPage} parts.`)] };
  }
  if (root.type === FEATURE_TYPE) {
    return { ok: false, issues: [issue(path, 'invalid_fragment', `Feature "${def.id}" is damaged: its top part cannot be a Feature.`)] };
  }
  const byId = new Map<string, LayoutLayer>();
  for (const e of entries) if (!byId.has(e.layer.id)) byId.set(e.layer.id, e.layer);

  for (const b of def.bindings) {
    const fail = (message: string): ExpandResult<LayoutLayer> => ({
      ok: false,
      issues: [issue(path, 'invalid_binding', `Feature "${def.id}": binding of "${b.param}" to ${b.layer} ${b.target}: ${message}.`)],
    });
    const param = def.params.find((p) => p.name === b.param);
    const layer = byId.get(b.layer);
    if (param === undefined) return fail('there is no such parameter');
    if (layer === undefined) return fail('there is no such part');
    const slot = slotsOf(layer, lib).find((s) => s.target === b.target);
    if (slot === undefined) return fail('that is not a place a parameter may fill');
    if (slot.kind !== param.type) return fail(`that place takes ${slot.kind}, not ${param.type}`);
    const problem = setExisting(layer, b.target, params[param.name]);
    if (problem !== null) return fail(problem);
  }

  const used = new Set<string>([def.id]);
  const nestedChain = [...chain, def.id];
  for (const e of entries) {
    if (e.layer.type !== FEATURE_TYPE) continue;
    const node = readFeatureNode(e.layer, e.path);
    if (!node.ok) return { ok: false, issues: node.issues };
    const inner = lib.get(node.featureId);
    if (inner === undefined) {
      return { ok: false, issues: [issue(e.path, 'unknown_feature', `Feature "${def.id}" uses "${node.featureId}", which does not exist.`)] };
    }
    const result = expandFeature(inner, node.params, ctx, lib, {
      rootId: e.layer.id,
      path: e.path,
      depth: depth + 1,
      chain: nestedChain,
      budget,
      takenIds: new Set<string>(),
    });
    if (!result.ok) return result;
    budget.left += 1;
    for (const u of result.used) used.add(u);
    if (e.siblings === null) return { ok: false, issues: [issue(path, 'invalid_fragment', `Feature "${def.id}" is damaged: its top part cannot be a Feature.`)] };
    // Placement belongs to the place: the node's sizing wins over the inner fragment root's.
    if (e.layer.sizing !== undefined) result.value.sizing = e.layer.sizing;
    if (e.layer.grid !== undefined) result.value.grid = e.layer.grid;
    else delete result.value.grid;
    e.siblings[e.index] = result.value;
  }

  // Ids: the root keeps rootId, every other layer is numbered in document order and avoids the page's ids.
  taken.add(opts.rootId);
  root.id = opts.rootId;
  const prefix = `${opts.rootId.slice(0, 56)}-`;
  const kidsOf = (l: LayoutLayer): LayoutLayer[] => (Array.isArray(l.children) ? l.children : []);
  let n = 0;
  const stack: LayoutLayer[] = [];
  for (let i = kidsOf(root).length - 1; i >= 0; i -= 1) stack.push(kidsOf(root)[i]);
  for (let l = stack.pop(); l !== undefined; l = stack.pop()) {
    do {
      n += 1;
    } while (taken.has(`${prefix}${n}`));
    l.id = `${prefix}${n}`;
    taken.add(l.id);
    const k = kidsOf(l);
    for (let i = k.length - 1; i >= 0; i -= 1) stack.push(k[i]);
  }

  root.name = def.label;
  root.feature = {
    id: def.id,
    version: def.version,
    params: Object.fromEntries(Object.keys(params).sort().map((k) => [k, params[k]])),
  };
  return { ok: true, value: root, used: [...used] };
}

/** The deepest nesting (root = 1) of a tree. Iterative. */
function depthOf(root: LayoutLayer): number {
  let max = 0;
  const stack: Array<{ layer: LayoutLayer; depth: number }> = [{ layer: root, depth: 1 }];
  for (let e = stack.pop(); e !== undefined; e = stack.pop()) {
    max = Math.max(max, e.depth);
    if (Array.isArray(e.layer.children)) for (const c of e.layer.children) if (isPlain(c)) stack.push({ layer: c, depth: e.depth + 1 });
  }
  return max;
}

/** True when the tree holds a Feature node anywhere. Iterative. */
function treeHasFeature(root: unknown): boolean {
  const stack: unknown[] = [root];
  for (let l = stack.pop(); l !== undefined; l = stack.pop()) {
    if (!isPlain(l)) continue;
    if (l.type === FEATURE_TYPE) return true;
    if (Array.isArray(l.children)) stack.push(...l.children);
  }
  return false;
}

/** Replaces every Feature node in a layout (any depth) by its expansion. No Feature node: the same object back, used []. */
export function expandLayout(root: LayoutLayer, lib: FeatureLibrary, ctx: PartContext, opts: ExpandOptions = {}): ExpandResult<LayoutLayer> {
  if (!treeHasFeature(root)) return { ok: true, value: root, used: [] };
  const base = opts.path ?? '';
  let copy: LayoutLayer;
  try {
    copy = clone(root);
  } catch {
    return { ok: false, issues: [issue(base, 'invalid_feature', 'This layout could not be read.')] };
  }
  const entries = walk(copy, base);
  const taken = opts.takenIds ?? new Set<string>();
  for (const e of entries) if (typeof e.layer.id === 'string') taken.add(e.layer.id);
  const budget = { left: LIMITS.layersPerPage - entries.filter((e) => e.layer.type !== FEATURE_TYPE).length };
  const issues: SpecIssue[] = [];
  const used = new Set<string>();
  let result = copy;
  for (const e of entries) {
    if (e.layer.type !== FEATURE_TYPE) continue;
    const node = readFeatureNode(e.layer, e.path);
    if (!node.ok) {
      issues.push(...node.issues);
      continue;
    }
    const def = lib.get(node.featureId);
    if (def === undefined) {
      const known = [...lib.keys()].slice(0, 10);
      issues.push(issue(`${e.path}.props.featureId`, 'unknown_feature', `There is no feature "${node.featureId}". Use one of: ${listOf(known)}.`));
      continue;
    }
    const expanded = expandFeature(def, node.params, ctx, lib, { rootId: e.layer.id, path: e.path, takenIds: taken, depth: 1, budget });
    if (!expanded.ok) {
      issues.push(...expanded.issues);
      continue;
    }
    for (const u of expanded.used) used.add(u);
    if (e.layer.sizing !== undefined) expanded.value.sizing = e.layer.sizing;
    if (e.layer.grid !== undefined) expanded.value.grid = e.layer.grid;
    else delete expanded.value.grid;
    if (e.siblings === null) result = expanded.value;
    else e.siblings[e.index] = expanded.value;
  }
  if (issues.length > 0) return { ok: false, issues: issues.slice(0, LIMITS.issues) };
  if (depthOf(result) > LIMITS.layerDepth) {
    return { ok: false, issues: [issue(base, 'feature_too_large', `Placing features would nest parts deeper than ${LIMITS.layerDepth} levels.`)] };
  }
  return { ok: true, value: result, used: [...used] };
}

function pagesOf(spec: unknown): unknown[] {
  return isPlain(spec) && Array.isArray(spec.pages) ? spec.pages : [];
}

/** True when any page of a raw spec holds a Feature node. */
export function hasFeatureNodes(spec: unknown): boolean {
  return pagesOf(spec).some((p) => isPlain(p) && treeHasFeature(p.layout));
}

/** Feature ids of every marker in a raw spec, with counts. Iterative. */
export function featureMarkers(spec: unknown): Map<string, number> {
  const counts = new Map<string, number>();
  for (const page of pagesOf(spec)) {
    const stack: unknown[] = isPlain(page) ? [page.layout] : [];
    for (let l = stack.pop(); l !== undefined; l = stack.pop()) {
      if (!isPlain(l)) continue;
      const marker = l.feature;
      if (isPlain(marker) && typeof marker.id === 'string') counts.set(marker.id, (counts.get(marker.id) ?? 0) + 1);
      if (Array.isArray(l.children)) stack.push(...l.children);
    }
  }
  return counts;
}

/**
 * Every page of a raw (unvalidated) spec, with partContextFor per page. Never throws; malformed input passes through
 * unchanged for validateAppSpec to report.
 */
export function expandSpecFeatures(spec: unknown, lib: FeatureLibrary): ExpandResult<unknown> {
  if (!hasFeatureNodes(spec) || !isPlain(spec)) return { ok: true, value: spec, used: [] };
  const issues: SpecIssue[] = [];
  const used = new Set<string>();
  const pages = pagesOf(spec).map((page, i) => {
    if (!isPlain(page) || !isPlain(page.layout) || !treeHasFeature(page.layout)) return page;
    try {
      const ctx = partContextFor(spec as unknown as AppSpecInput, page as unknown as AppSpecInput['pages'][number]);
      const done = expandLayout(page.layout as unknown as LayoutLayer, lib, ctx, { path: `pages.${i}.layout` });
      if (!done.ok) {
        issues.push(...done.issues);
        return page;
      }
      for (const u of done.used) used.add(u);
      return { ...page, layout: done.value };
    } catch {
      return page;
    }
  });
  if (issues.length > 0) return { ok: false, issues: issues.slice(0, LIMITS.issues) };
  return { ok: true, value: { ...spec, pages }, used: [...used] };
}
