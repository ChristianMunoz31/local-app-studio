// Pure logic of the Features UI: turning a selected block of parts into a feature record (Save as feature), the value
// choices of a feature's settings form, and the export file. No React, no store, no fetch.
import { safeParse } from 'zod';
import { getPartDefinition } from '@/catalog/definitions';
import { FEATURE_LIMITS, FEATURE_TYPE, slotsOf } from '@/catalog/features';
import type { FeatureDefinition, FeatureLibrary, FeatureParam, Slot, SlotKind } from '@/catalog/features';
import { SPIKE_PART_CONTEXT } from '@/catalog/types';
import type { PartContext } from '@/catalog/types';
import { LIMITS, isReservedFieldId, isReservedTableId } from '@local-app-studio/runtime/spec/schema';
import type { FieldType, JsonValue, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { FEATURE_FILE_FORMAT } from '../types';
import type { FeatureFile, FeatureInput, FeatureRecord } from '../types';
import { newSourceFor } from './bindOnDrop';
import type { Source } from './bindOnDrop';
import { pairedParams, pickField, textDefault } from './featureParams';
import type { FeatureShape, ParamPair } from './featureParams';
import { toId } from './ids';

export type GroupKind = Exclude<SlotKind, 'fields'>;

export interface SlotGroup {
  /** Stable within one selection: kind, value (and for a field, the table or source it belongs to). */
  key: string;
  kind: GroupKind;
  value: string;
  mode?: 'list' | 'record';
  /** For a field: the key of the group naming its table or source. */
  of?: string;
  fieldTypes?: FieldType[];
  uses: { layer: string; target: string }[];
  /** Ids and fields are always settings; texts are the user's choice. */
  forced: boolean;
}

export interface DroppedList {
  layer: string;
  target: string;
}

export interface FeatureChoices {
  id: string;
  label: string;
  description: string;
  params: { group: string; name: string; label: string }[];
}

type RecordWithFragment = FeatureRecord & { fragment: LayoutLayer };

const PLACEHOLDER: Record<Exclude<GroupKind, 'text'>, string> = { table: 't', source: 's', page: 'p', field: 'x' };
// Control characters other than newline.
const CONTROL_RE = /[\u0000-\u0009\u000b-\u001f\u007f]/;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const hasFragment = (r: FeatureRecord): r is RecordWithFragment => r.fragment !== null;

/**
 * A copy of the selection ready to become a fragment: markers removed, and every expanded block inside it (not the
 * selection itself) replaced by a Feature node with the block's values, so the outer feature follows the inner one's
 * latest version.
 */
function normalize(selection: LayoutLayer, lib: FeatureLibrary): LayoutLayer {
  const walk = (l: LayoutLayer, root: boolean): LayoutLayer => {
    // Placement travels with every layer, and with the Feature node made from an inner block.
    const sizing = l.sizing === undefined ? undefined : { width: l.sizing.width, grow: l.sizing.grow };
    const grid = root || l.grid === undefined ? undefined : { col: l.grid.col, span: l.grid.span, row: l.grid.row, rowSpan: l.grid.rowSpan };
    if (!root && l.feature !== undefined && lib.has(l.feature.id)) {
      const node: LayoutLayer = { id: l.id, type: FEATURE_TYPE, props: { featureId: l.feature.id, params: { ...l.feature.params } }, children: [] };
      if (sizing !== undefined) node.sizing = sizing;
      if (grid !== undefined) node.grid = grid;
      return node;
    }
    const out: LayoutLayer = {
      id: l.id,
      type: l.type,
      props: clone(l.props),
      children: Array.isArray(l.children) ? l.children.map((c) => walk(c, false)) : l.children,
    };
    if (l.name) out.name = l.name;
    if (sizing !== undefined) out.sizing = sizing;
    if (grid !== undefined) out.grid = grid;
    return out;
  };
  return walk(selection, true);
}

/** True when a part accepts a missing value for this top-level prop (the part default then applies). */
function propIsOptional(type: string, prop: string): boolean {
  const def = getPartDefinition(type);
  if (def === undefined || prop.includes('.')) return false;
  const field = def.props(SPIKE_PART_CONTEXT).shape[prop];
  return field !== undefined && safeParse(field, undefined).success;
}

function layersOf(root: LayoutLayer): LayoutLayer[] {
  const out: LayoutLayer[] = [];
  const stack: LayoutLayer[] = [root];
  for (let l = stack.pop(); l !== undefined; l = stack.pop()) {
    out.push(l);
    if (Array.isArray(l.children)) for (let i = l.children.length - 1; i >= 0; i -= 1) stack.push(l.children[i]);
  }
  return out;
}

interface Analysis {
  norm: LayoutLayer;
  groups: SlotGroup[];
  dropped: DroppedList[];
}

const fieldKey = (ofKey: string, s: Slot): string => `field|${ofKey}|${s.fieldTypes?.join(',') ?? ''}|${s.value as string}`;

function analyse(selection: LayoutLayer, lib: FeatureLibrary): Analysis {
  const norm = normalize(selection, lib);
  const groups = new Map<string, SlotGroup>();
  const dropped: DroppedList[] = [];
  for (const layer of layersOf(norm)) {
    const slots = slotsOf(layer, lib);
    const droppedHere: string[] = [];
    for (const s of slots) {
      if (s.kind === 'fields' && propIsOptional(layer.type, s.target.replace(/^props\./, ''))) {
        droppedHere.push(s.target);
        dropped.push({ layer: layer.id, target: s.target });
      }
    }
    const keyOfTarget = new Map<string, string>();
    const add = (s: Slot, key: string, ofKey?: string): void => {
      const use = { layer: layer.id, target: s.target };
      const existing = groups.get(key);
      if (existing !== undefined) {
        existing.uses.push(use);
      } else {
        groups.set(key, {
          key,
          kind: s.kind as GroupKind,
          value: s.value as string,
          ...(s.mode === undefined ? {} : { mode: s.mode }),
          ...(ofKey === undefined ? {} : { of: ofKey }),
          ...(s.fieldTypes === undefined ? {} : { fieldTypes: s.fieldTypes }),
          uses: [use],
          forced: s.kind !== 'text',
        });
      }
      keyOfTarget.set(s.target, key);
    };
    const usable = slots.filter(
      (s) =>
        s.kind !== 'fields' &&
        typeof s.value === 'string' &&
        !droppedHere.some((d) => s.target.startsWith(`${d}.`)) &&
        (s.kind !== 'text' || (s.value.length >= 1 && s.value.length <= FEATURE_LIMITS.textValueChars && !CONTROL_RE.test(s.value))),
    );
    for (const s of usable) if (s.kind !== 'field') add(s, `${s.kind}|${s.value as string}`);
    for (const s of usable) {
      if (s.kind !== 'field') continue;
      const ofKey = s.of === undefined ? undefined : keyOfTarget.get(s.of);
      if (ofKey !== undefined) add(s, fieldKey(ofKey, s), ofKey);
    }
  }
  return { norm, groups: [...groups.values()], dropped };
}

/** The values in a selection that can become settings, merged by kind and value. */
export function slotGroups(selection: LayoutLayer, lib: FeatureLibrary): { groups: SlotGroup[]; droppedLists: DroppedList[] } {
  const { groups, dropped } = analyse(selection, lib);
  return { groups, droppedLists: dropped };
}

const KIND_LABEL: Record<GroupKind, string> = { table: 'Table', source: 'List', page: 'Page', field: 'Field', text: 'Text' };

/** What the labels of an app are read from: the tables with their fields, and the pages with their lists. Any AppSpec fits. */
export interface AppWords {
  tables: readonly { id: string; label: string; fields: readonly { id: string; label: string }[] }[];
  pages: readonly { id: string; title: string; sources?: readonly { id: string; table: string }[] }[];
}

const SETTING_KIND_WORD: Record<GroupKind, string> = { text: 'Text', source: 'List', table: 'Table', page: 'Page', field: 'Field' };

/** The table a group stands for: a table itself, or the table behind a list. Null when it cannot be told. */
function tableIdOf(group: SlotGroup, words: AppWords): string | null {
  if (group.kind === 'table') return group.value;
  if (group.kind !== 'source') return null;
  for (const page of words.pages) {
    const src = page.sources?.find((s) => s.id === group.value);
    if (src !== undefined) return src.table;
  }
  return null;
}

/** The value of a setting in the app's own words ("Open crews", "Status"); the stored name when the app does not say. */
export function groupValueWords(group: SlotGroup, groups: readonly SlotGroup[], words: AppWords | null | undefined): string {
  if (words === null || words === undefined) return group.value;
  if (group.kind === 'page') return words.pages.find((p) => p.id === group.value)?.title ?? group.value;
  if (group.kind === 'table' || group.kind === 'source') {
    const table = words.tables.find((t) => t.id === tableIdOf(group, words));
    return table?.label ?? group.value;
  }
  if (group.kind === 'field') {
    const parent = groups.find((g) => g.key === group.of);
    const table = parent === undefined ? undefined : words.tables.find((t) => t.id === tableIdOf(parent, words));
    const field = (table?.fields ?? words.tables.flatMap((t) => t.fields)).find((f) => f.id === group.value);
    return field?.label ?? group.value;
  }
  return group.value;
}

/** "List: Open crews", "Field: Status", "Record: Crew", "Text: Crews" for a row of Save as feature. */
export function groupNote(group: SlotGroup, groups: readonly SlotGroup[], words: AppWords | null | undefined): string {
  const kind = group.kind === 'source' && group.mode === 'record' ? 'Record' : SETTING_KIND_WORD[group.kind];
  const value = groupValueWords(group, groups, words);
  return `${kind}: ${value.length > 50 ? `${value.slice(0, 50)}...` : value}`;
}

/** A setting name from a label: a-z, 0-9 and _, at most 24, unique among `taken`, not a reserved field id. */
export function paramName(label: string, taken: ReadonlySet<string>): string {
  const base = toId(label, new Set(), isReservedFieldId).slice(0, FEATURE_LIMITS.paramNameChars).replace(/_+$/g, '');
  let name = base;
  for (let n = 2; taken.has(name) || isReservedFieldId(name); n += 1) {
    const suffix = `_${n}`;
    name = `${base.slice(0, FEATURE_LIMITS.paramNameChars - suffix.length).replace(/_+$/g, '')}${suffix}`;
  }
  return name;
}

/** The feature id for a label, unique among the library. */
export const featureIdFor = (label: string, lib: FeatureLibrary): string => toId(label, new Set(lib.keys()), isReservedTableId);

/** Default setting names and labels for every group: unique, ready to edit. The caller keeps the forced ones and the texts the user ticks. */
export function defaultChoices(groups: readonly SlotGroup[], lib: FeatureLibrary): FeatureChoices {
  const counts = new Map<string, number>();
  const names = new Set<string>();
  const params = groups
    .map((g) => {
      const base = g.kind === 'text' ? g.value.trim().slice(0, FEATURE_LIMITS.labelChars).trim() : g.kind === 'source' && g.mode === 'record' ? 'Record' : KIND_LABEL[g.kind];
      const n = (counts.get(base) ?? 0) + 1;
      counts.set(base, n);
      const label = n === 1 ? base : `${base} ${n}`;
      const name = paramName(label, names);
      names.add(name);
      return { group: g.key, name, label };
    });
  return { id: featureIdFor('my feature', lib), label: '', description: '', params };
}

function setAtPath(root: Record<string, unknown>, dotted: string, value: JsonValue): void {
  const parts = dotted.split('.');
  let cursor: unknown = root;
  for (const key of parts.slice(0, -1)) {
    if (Array.isArray(cursor)) cursor = cursor[Number(key)];
    else if (isPlain(cursor)) cursor = cursor[key];
    else return;
  }
  const leaf = parts[parts.length - 1];
  if (Array.isArray(cursor)) cursor[Number(leaf)] = value;
  else if (isPlain(cursor)) cursor[leaf] = value;
}

/** The record to save: params from the chosen groups, bindings from their uses, ids replaced by placeholders, optional lists removed. */
export function buildFeatureInput(selection: LayoutLayer, choices: FeatureChoices, lib: FeatureLibrary): FeatureInput {
  const { norm, groups, dropped } = analyse(selection, lib);
  const nameOf = new Map(choices.params.map((p) => [p.group, p.name]));
  const params: FeatureParam[] = [];
  const bindings: FeatureInput['bindings'] = [];
  const byId = new Map(layersOf(norm).map((l) => [l.id, l]));
  for (const choice of choices.params) {
    const g = groups.find((x) => x.key === choice.group);
    if (g === undefined) continue;
    const param: FeatureParam = { name: choice.name, label: choice.label, type: g.kind };
    if (g.kind === 'source') param.mode = g.mode ?? 'list';
    if (g.kind === 'field') {
      const of = g.of === undefined ? undefined : nameOf.get(g.of);
      if (of !== undefined) param.of = of;
      if (g.fieldTypes !== undefined) param.fieldTypes = g.fieldTypes;
    }
    params.push(param);
    for (const use of g.uses) {
      bindings.push({ param: choice.name, layer: use.layer, target: use.target });
      const layer = byId.get(use.layer);
      if (layer !== undefined && g.kind !== 'text') setAtPath({ props: layer.props }, use.target, PLACEHOLDER[g.kind]);
    }
  }
  for (const d of dropped) {
    const layer = byId.get(d.layer);
    if (layer !== undefined) delete layer.props[d.target.replace(/^props\./, '')];
  }
  return { id: choices.id, label: choices.label, description: choices.description, params, fragment: norm, bindings };
}

/** The values to place the saved selection back with: each chosen setting gets the value the selection had. */
export function valuesOf(groups: readonly SlotGroup[], choices: FeatureChoices): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of choices.params) {
    const g = groups.find((x) => x.key === p.group);
    if (g !== undefined) out[p.name] = g.value;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Settings form: the choices a page offers for each setting
// ---------------------------------------------------------------------------------------------

/** The table behind a field setting, from the values chosen so far. */
function tableBehind(def: Pick<FeatureDefinition, 'params'>, p: FeatureParam, ctx: PartContext, values: Record<string, string>): string | null {
  const target = def.params.find((q) => q.name === p.of);
  const v = target === undefined ? undefined : values[target.name];
  if (target === undefined || v === undefined) return null;
  if (target.type === 'table') return ctx.tableIds.includes(v) ? v : null;
  return Object.hasOwn(ctx.sources, v) ? ctx.sources[v].table : null;
}

/** The ids a setting may take on this page; null for a text setting. */
export function optionsFor(def: Pick<FeatureDefinition, 'params'>, p: FeatureParam, ctx: PartContext, values: Record<string, string>): string[] | null {
  if (p.type === 'text') return null;
  if (p.type === 'table') return ctx.tableIds;
  if (p.type === 'page') return ctx.pageIds;
  if (p.type === 'source') return ctx.sourceIds.filter((id) => ctx.sources[id].mode === (p.mode ?? 'list'));
  const table = tableBehind(def, p, ctx, values);
  const known = table !== null && Object.hasOwn(ctx.fields, table) ? ctx.fields[table] : [];
  return known.filter((f) => p.fieldTypes === undefined || p.fieldTypes.includes(f.type)).map((f) => f.id);
}

/** The page's lists as far as newSourceFor reads them (their ids). */
const listStubs = (ctx: PartContext): Source[] =>
  ctx.sourceIds.map((id) => ({ id, table: ctx.sources[id].table, mode: ctx.sources[id].mode, where: [], orderBy: [], limit: LIMITS.sourceLimitDefault }));

/** `ctx` with these new lists in it, as the page will have them once they are added. */
export const withLists = (ctx: PartContext, lists: readonly Source[]): PartContext => ({
  ...ctx,
  sourceIds: [...ctx.sourceIds, ...lists.map((l) => l.id)],
  sources: { ...ctx.sources, ...Object.fromEntries(lists.map((l) => [l.id, { table: l.table, mode: l.mode }])) },
});

/** The values chosen, the lists the choice needs that the page does not have yet, and the context those lists belong to. */
export interface Settled {
  values: Record<string, string>;
  /** New lists (newSourceFor) for a table setting whose table the page has no list of. The caller adds them to the page. */
  made: Source[];
  /** `ctx` with `made` in it: expand and check against this one. */
  ctx: PartContext;
}

/**
 * Keeps the values that still fit and fills the rest: a table or list setting that shares a slot (pairedParams) settles first, the
 * list leading (its table is the table), unless `changed` names the table setting the person just changed, which then leads and the
 * list follows it, making one with newSourceFor when the page has none. A field setting starts on pickField. Texts stay as they are
 * (empty when missing). Fields are settled last.
 */
export function settleValues(def: Pick<FeatureDefinition, 'params'>, ctx: PartContext, current: Record<string, string>, changed?: string): Settled {
  const out: Record<string, string> = {};
  const made: Source[] = [];
  let live = ctx;
  const pairs = pairedParams(def);
  const folded = new Set(pairs.map((p) => p.list.name));
  const isList = (v: string | undefined): v is string => v !== undefined && Object.hasOwn(ctx.sources, v) && ctx.sources[v].mode === 'list';
  const isTable = (v: string | undefined): v is string => v !== undefined && ctx.tableIds.includes(v);
  const settlePair = (pair: ParamPair): void => {
    const { table, list } = pair;
    const typed = current[table.name];
    const kept = current[list.name];
    const firstList = ctx.sourceIds.find((id) => ctx.sources[id].mode === 'list');
    const chosen =
      changed === table.name && isTable(typed)
        ? typed
        : isList(kept)
          ? ctx.sources[kept].table
          : isTable(typed)
            ? typed
            : firstList !== undefined
              ? ctx.sources[firstList].table
              : ctx.tableIds[0];
    if (chosen === undefined) {
      out[table.name] = '';
      out[list.name] = '';
      return;
    }
    out[table.name] = chosen;
    const own = isList(kept) && ctx.sources[kept].table === chosen ? kept : ctx.sourceIds.find((id) => ctx.sources[id].mode === 'list' && ctx.sources[id].table === chosen);
    if (own !== undefined) {
      out[list.name] = own;
      return;
    }
    const added = newSourceFor(chosen, 'list', listStubs(live));
    made.push(added);
    live = withLists(live, [added]);
    out[list.name] = added.id;
  };
  const settle = (p: FeatureParam): void => {
    const options = optionsFor(def, p, live, out);
    const kept = current[p.name];
    if (options === null) out[p.name] = kept ?? '';
    else if (kept !== undefined && options.includes(kept)) out[p.name] = kept;
    else if (p.type === 'field') out[p.name] = pickField(p, options, tableFieldsOf(def, p, live, out)) ?? '';
    else out[p.name] = options[0] ?? '';
  };
  for (const p of def.params) {
    const pair = pairs.find((x) => x.table.name === p.name);
    if (pair !== undefined) settlePair(pair);
    else if (p.type !== 'field' && !folded.has(p.name)) settle(p);
  }
  for (const p of def.params) if (p.type === 'field') settle(p);
  return { values: out, made, ctx: live };
}

/**
 * The values for a feature dropped on a page that has no list for its table setting while the app has tables (autoValues says null
 * then): the first table every setting fits (a field setting needs a field of that table; a table that lacks one is skipped), a list
 * of it made for the page (`made`), every other setting settled as in settleValues. Null when no table fits, or a setting still has
 * no choice (a page or record source the page lacks): the caller then asks for a new table. A table whose id or label shares a word
 * with the feature's name or its table settings' labels is tried first (L-15: "Repair log" settles on Maintenance, not Units).
 */
export function settleOnFirstTable(def: Pick<FeatureDefinition, 'params'>, ctx: PartContext, name = '', words?: AppWords | null): Settled | null {
  const tables = def.params.filter((p) => p.type === 'table');
  const bits = (t: string): string[] => t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2).map((w) => w.replace(/s$/, ''));
  const wanted = new Set(bits([name, ...tables.map((p) => p.label)].join(' ')));
  const likes = (id: string): boolean => bits(`${id} ${words?.tables.find((t) => t.id === id)?.label ?? ''}`).some((w) => wanted.has(w));
  const order = [...ctx.tableIds.filter(likes), ...ctx.tableIds.filter((id) => !likes(id))];
  for (const id of order) {
    const settled = settleValues(def, ctx, Object.fromEntries(tables.map((p) => [p.name, id])), tables[0]?.name);
    if (!def.params.some((p) => p.type !== 'text' && settled.values[p.name] === '')) return settled;
  }
  return null;
}

/** `sources` without the lists in `added` that no block of `root` names any more (L-15), and the ids dropped. */
export function dropUnusedLists(sources: Source[], added: ReadonlySet<string>, root: LayoutLayer): { sources: Source[]; gone: string[] } {
  const text = added.size === 0 ? '' : JSON.stringify(root);
  const gone = [...added].filter((id) => !text.includes(`"${id}"`));
  return { sources: sources.filter((s) => !gone.includes(s.id)), gone };
}

/** The fields of the table behind a field setting, with their types. */
function tableFieldsOf(def: Pick<FeatureDefinition, 'params'>, p: FeatureParam, ctx: PartContext, values: Record<string, string>): { id: string; type: string }[] {
  const table = tableBehind(def, p, ctx, values);
  return table !== null && Object.hasOwn(ctx.fields, table) ? ctx.fields[table] : [];
}

/** Keeps the values that still fit and fills the rest (settleValues). */
export const withDefaults = (def: Pick<FeatureDefinition, 'params'>, ctx: PartContext, current: Record<string, string>): Record<string, string> =>
  settleValues(def, ctx, current).values;

/**
 * The values to move a block to the feature's newest version: settings the feature no longer has are dropped, values that still fit
 * are kept, and each new setting gets the feature's own words (a text) or the default it would get on a new block (everything else).
 */
export function latestValues(def: FeatureShape, ctx: PartContext, old: Record<string, string>): Settled {
  const kept: Record<string, string> = {};
  for (const p of def.params) {
    if (Object.hasOwn(old, p.name)) kept[p.name] = old[p.name];
    else if (p.type === 'text') kept[p.name] = textDefault(def, p);
  }
  return settleValues(def, ctx, kept);
}

/**
 * The choices of a setting in the app's own words, in the order of `options`: table labels, page titles, field labels (Created and
 * Updated included), and for a list the label of its table. Without `words` (or for an id the app does not know) the id. Two choices
 * with the same words get a number after the second ("Tasks", "Tasks 2").
 */
export function optionWords(def: Pick<FeatureDefinition, 'params'>, p: FeatureParam, options: readonly string[], ctx: PartContext, values: Record<string, string>, words: AppWords | null | undefined): string[] {
  if (words === null || words === undefined) return [...options];
  const tableLabel = (id: string): string => words.tables.find((t) => t.id === id)?.label ?? id;
  const behind = p.type === 'field' ? tableBehind(def, p, ctx, values) : null;
  const one = (id: string): string => {
    if (p.type === 'table') return tableLabel(id);
    if (p.type === 'source') return Object.hasOwn(ctx.sources, id) ? tableLabel(ctx.sources[id].table) : id;
    if (p.type === 'page') return words.pages.find((x) => x.id === id)?.title ?? id;
    if (id === 'created_at') return 'Created';
    if (id === 'updated_at') return 'Updated';
    return words.tables.find((t) => t.id === behind)?.fields.find((f) => f.id === id)?.label ?? id;
  };
  const seen = new Map<string, number>();
  return options.map((id) => {
    const text = one(id);
    const n = (seen.get(text) ?? 0) + 1;
    seen.set(text, n);
    return n === 1 ? text : `${text} ${n}`;
  });
}

/** Labels of the settings that still have no value. */
export const missingLabels = (def: Pick<FeatureDefinition, 'params'>, values: Record<string, string>): string[] =>
  def.params.filter((p) => (values[p.name] ?? '').trim() === '').map((p) => p.label);

// ---------------------------------------------------------------------------------------------
// Records and export
// ---------------------------------------------------------------------------------------------

export const inputOf = (r: RecordWithFragment): FeatureInput => ({
  id: r.id,
  label: r.label,
  description: r.description,
  params: r.params,
  fragment: r.fragment,
  bindings: r.bindings,
});

/** Feature ids a fragment uses through Feature nodes. */
function usedFeatureIds(fragment: LayoutLayer): string[] {
  const ids: string[] = [];
  for (const l of layersOf(fragment)) {
    if (l.type === FEATURE_TYPE && typeof l.props.featureId === 'string') ids.push(l.props.featureId);
  }
  return ids;
}

/** The file for one feature: the feature and everything it uses, dependencies first. Null when the feature is broken or missing. */
export function featureFileOf(id: string, records: readonly FeatureRecord[]): FeatureFile | null {
  const byId = new Map(records.map((r) => [r.id, r]));
  const main = byId.get(id);
  if (main === undefined || !main.ok || !hasFragment(main)) return null;
  const includes: FeatureInput[] = [];
  const done = new Set<string>([id]);
  const visit = (r: RecordWithFragment): void => {
    for (const dep of usedFeatureIds(r.fragment)) {
      const rec = byId.get(dep);
      if (done.has(dep) || rec === undefined || !hasFragment(rec)) continue;
      done.add(dep);
      visit(rec);
      includes.push(inputOf(rec));
    }
  };
  visit(main);
  return { format: FEATURE_FILE_FORMAT, formatVersion: 1, feature: inputOf(main), includes };
}
