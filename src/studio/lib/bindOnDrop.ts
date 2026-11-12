// What a built-in data part is connected to when it is dropped on a page (docs/DESIGN.md "Connect a part to a table"). One
// planner decides every data binding: a source of the page that fits, else a new source on the one table that fits, else
// a choice for the person, else a refusal in plain words. It builds the layer through newPartLayer with a steered context
// (the chosen source or table first), so layoutTree.ts stays unchanged. Pure: nothing is mutated.
import { getPartDefinition } from '@/catalog/definitions';
import type { PartContext, PartDefinition } from '@/catalog/types';
import { checkLayer, partContextFor } from '@/catalog/validateLayout';
import { LIMITS } from '@local-app-studio/runtime/spec/schema';
import type { AppSpec, Field, LayoutLayer, Page, Table } from '@local-app-studio/runtime/spec/schema';
import { dataBindOf, defaultRowPage, fittingTables, pickSource, quickAddFits, steer, tableFits, tablePreference } from './bindChoice';
import type { DataBind } from './bindChoice';
import { toId } from './ids';
import { configureLayer, findLayer, newPartLayer, replaceLayer } from './layoutTree';
import type { TreeResult } from './layoutTree';
import { chartTitleWords, fieldLabelOf, progressLabelWords, quickAddPlaceholder } from './followWords';
import { fieldNeedsOf, needWords } from './partFields';
import { rowActionTo } from './rowColumns';
import { statLabelFor } from './statLabel';
import type { FieldNeed } from './partFields';

export type Source = Page['sources'][number];

/** The page being edited: its saved identity plus the sources of the session (saved ones and drafts). */
export interface DraftPage {
  id: string;
  title: string;
  route: string;
  sources: Source[];
}

/** The value of a data prop of a part that is not connected yet. */
export const NOT_CONNECTED = '';
/** Prefix of a settings choice that means "a new list of this table". */
export const NEW_SOURCE_PREFIX = '@new:';

/** What a part that no table fits can be offered: a new table, or a new field on a table that can take one more; nothing when the page has no room for another list. */
export type ConnectOffer =
  | { kind: 'no_table' }
  // the page already has LIMITS.sourcesPerPage lists, so neither a table nor a field could connect the part
  | { kind: 'full' }
  // tables that can take one more field (fewer than LIMITS.fieldsPerTable), in tablePreference order
  | { kind: 'no_field'; needs: FieldNeed[]; tables: string[] };

export type DropPlan =
  | { kind: 'bound'; layer: LayoutLayer; sources: Source[]; added: Source | null }
  | { kind: 'choose'; layer: LayoutLayer; sources: Source[]; target: 'props.source' | 'props.table' }
  | { kind: 'offer'; layer: LayoutLayer; sources: Source[]; target: 'props.source' | 'props.table'; offer: ConnectOffer }
  | { kind: 'refused'; refusal: string };

export type ConnectChoice = { sourceId: string } | { newSourceOn: string } | { table: string };

export const MSG = {
  full: `This page already has ${LIMITS.sourcesPerPage} lists. Remove one in Page settings first.`,
  quickAdd: 'Quick add needs a table where only one text field must be filled in. Use a Form instead.',
  notYet: "This part can't be added to this page yet. Check the page settings.",
  /** A record part on a plain page when the app has no record page: the Page actions item makes this page one. */
  oneRecordHere: 'This part shows one record, so it goes on a page that shows one record. Press Page actions, then Show one record on this page.',
} as const;

export const OFFER = {
  noTable: 'This app has no table yet.',
  noField: (needs: readonly FieldNeed[]): string => {
    const words = needWords(needs);
    return words === '' ? 'No table has the field this part needs.' : `No table has the field this part needs: ${words}.`;
  },
} as const;

/** The offer sentence (OFFER words). */
export function offerWords(offer: ConnectOffer): string {
  if (offer.kind === 'full') return MSG.full;
  return offer.kind === 'no_table' ? OFFER.noTable : OFFER.noField(offer.needs);
}

/** Why a record part cannot go on this page: it names the page that opens from a list when the app has one. */
export function oneRecordRefusal(spec: AppSpec): string {
  const recordPage = spec.pages.find((p) => p.route.includes('/:'));
  if (recordPage !== undefined) return `This part shows one record. Open the page ${recordPage.title} (it opens from a list) and add it there.`;
  return MSG.oneRecordHere;
}

/** A new source as SourcesEditor makes it: id toId(table, taken), list or record, empty where and orderBy, the default limit. */
export function newSourceFor(table: string, mode: 'list' | 'record', sources: readonly Source[]): Source {
  return { id: toId(table, new Set(sources.map((s) => s.id)), () => false), table, mode, where: [], orderBy: [], limit: LIMITS.sourceLimitDefault };
}

/** The spec with this page's sources replaced (for the session's ctx and sample rows). */
export function withPageSources(spec: AppSpec, pageId: string, sources: readonly Source[]): AppSpec {
  return { ...spec, pages: spec.pages.map((p) => (p.id === pageId ? { ...p, sources: [...sources] } : p)) };
}

/** The context of the draft page: its route and its sources, every table, page and field of the spec. */
function contextOf(spec: AppSpec, page: DraftPage, sources: readonly Source[]): PartContext {
  const base = spec.pages.find((p) => p.id === page.id) ?? spec.pages[0];
  return partContextFor(spec, { ...base, id: page.id, title: page.title, route: page.route, sources: [...sources] });
}

const labelOf = (spec: AppSpec, table: string): string => spec.tables.find((t) => t.id === table)?.label ?? table;


function freshId(type: string, taken: ReadonlySet<string>): string {
  const prefix = type.toLowerCase();
  let n = 1;
  while (taken.has(`${prefix}_${n}`)) n += 1;
  return `${prefix}_${n}`;
}

/** A layer of a part that is not connected yet: it only exists in the Design session and cannot be saved. */
function unconnected(type: string, prop: 'source' | 'table', taken: ReadonlySet<string>): LayoutLayer {
  return { id: freshId(type, taken), type, props: { [prop]: NOT_CONNECTED }, children: [] };
}

/** The layer with props changed, or the layer itself when the result would not pass checkLayer. */
function tryProps(layer: LayoutLayer, ctx: PartContext, change: (props: LayoutLayer['props']) => void): LayoutLayer {
  const next: LayoutLayer = { ...layer, props: { ...layer.props } };
  change(next.props);
  return checkLayer(next, ctx, 'layer', 1).length === 0 ? next : layer;
}

/** B2 (a form on a record page edits the page record) and B7 (words that name the table). Each step is skipped when it breaks the layer. */
function polish(layer: LayoutLayer, spec: AppSpec, ctx: PartContext, sources: readonly Source[]): LayoutLayer {
  const props = layer.props;
  const table = typeof props.table === 'string' ? props.table : typeof props.source === 'string' ? ctx.sources[props.source]?.table : undefined;
  if (table === undefined) return layer;
  if (layer.type === 'RecordForm') {
    const record = props.source === undefined ? sources.find((s) => s.mode === 'record' && s.table === table) : undefined;
    if (record === undefined) return layer;
    return tryProps(layer, ctx, (p) => {
      p.source = record.id;
      p.mode = 'edit';
      delete p.fields;
      p.submitLabel = 'Save';
    });
  }
  if (layer.type === 'QuickAdd') {
    return tryProps(layer, ctx, (p) => {
      p.placeholder = quickAddPlaceholder(labelOf(spec, table));
    });
  }
  if (layer.type === 'Chart') {
    const group = fieldLabelOf(spec, table, props.groupBy);
    if (group === undefined) return layer;
    return tryProps(layer, ctx, (p) => {
      p.title = chartTitleWords(labelOf(spec, table), group);
    });
  }
  if (layer.type === 'ProgressBar') {
    return tryProps(layer, ctx, (p) => {
      p.label = progressLabelWords(labelOf(spec, table));
    });
  }
  if (layer.type === 'StatCard') {
    const label = statLabelFor(spec, table, props.stat, props.field);
    if (label === null) return layer;
    return tryProps(layer, ctx, (p) => {
      p.label = label;
    });
  }
  // A list opens the one record page of its table when a row is clicked (not on a record page, where it would open itself).
  if ((layer.type === 'DataTable' || layer.type === 'RecordList') && props.rowAction === undefined && !ctx.recordPage) {
    const record = defaultRowPage(spec, table);
    if (record === null) return layer;
    return tryProps(layer, ctx, (p) => {
      p.rowAction = rowActionTo(record);
    });
  }
  return layer;
}

type Built = { layer: LayoutLayer } | { refusal: string };

function build(type: string, spec: AppSpec, ctx: PartContext, sources: readonly Source[], taken: ReadonlySet<string>): Built {
  const made = newPartLayer(type, ctx, taken);
  if ('refusal' in made) return { refusal: made.refusal };
  return { layer: polish(made, spec, ctx, sources) };
}

const toPlan = (built: Built, sources: Source[], added: Source | null): DropPlan =>
  'refusal' in built ? { kind: 'refused', refusal: built.refusal } : { kind: 'bound', layer: built.layer, sources, added };

/** Every data binding of a built-in part dropped on a page. Parts with no data bind go straight to newPartLayer. Never mutates. */
export function planDrop(type: string, spec: AppSpec, page: DraftPage, takenIds: ReadonlySet<string>): DropPlan {
  const def = getPartDefinition(type);
  const ctx = contextOf(spec, page, page.sources);
  const bind = def === undefined ? null : dataBindOf(def);
  if (def === undefined || bind === null) return toPlan(build(type, spec, ctx, page.sources, takenIds), page.sources, null);
  return bind.kind === 'source' ? planSource(def, bind, spec, page, ctx, takenIds) : planTable(def, bind, spec, page, ctx, takenIds);
}

/** What a part that no table fits is offered: New table when the app has none, else Add a field on the tables that have room for one. */
function missingOffer(def: PartDefinition, spec: AppSpec, ctx: PartContext): ConnectOffer {
  if (ctx.tableIds.length === 0) return { kind: 'no_table' };
  const room = (id: string): boolean => (spec.tables.find((t) => t.id === id)?.fields.length ?? 0) < LIMITS.fieldsPerTable;
  const needs = fieldNeedsOf(def.name);
  // A link field needs another table to point to: with a single table Add a field would have nothing to link to, so only New table is offered.
  const needsLink = needs.some((n) => n.types[0] === 'reference');
  return { kind: 'no_field', needs, tables: needsLink && spec.tables.length < 2 ? [] : tablePreference(ctx, false).filter(room) };
}

function planSource(def: PartDefinition, bind: DataBind, spec: AppSpec, page: DraftPage, ctx: PartContext, taken: ReadonlySet<string>): DropPlan {
  if (bind.mode === 'record' && !ctx.recordPage) return { kind: 'refused', refusal: oneRecordRefusal(spec) };
  const bindTo = (sourceId: string): DropPlan => toPlan(build(def.name, spec, steer(ctx, { sourceId }), page.sources, taken), page.sources, null);
  // A list of the page that fits with declared fields wins; then a table of the app that fits with declared fields (B4); only then runtime columns.
  const declaredHit = pickSource(def, bind, ctx, spec.tables, true);
  const tables = fittingTables(def, bind, ctx, spec.tables);
  const declared = tables.filter((t) => tableFits(def, bind, t, ctx, true));
  const room = page.sources.length < LIMITS.sourcesPerPage;
  if (declaredHit !== null) {
    // P17-14: another table of the app fits too, so the person is asked (the page's own lists come first in the choice) rather than joined to the page's list unasked.
    const hitTable = ctx.sources[declaredHit].table;
    // A record part on a record page stays on the page's own record: another table's record has no address there.
    if (room && bind.mode !== 'record' && declared.some((t) => t !== hitTable)) return { kind: 'choose', layer: unconnected(def.name, 'source', taken), sources: page.sources, target: 'props.source' };
    return bindTo(declaredHit);
  }
  if (declared.length > 0 && room) {
    if (declared.length === 1) return withNewSource(def, bind, declared[0], spec, page, taken);
    return { kind: 'choose', layer: unconnected(def.name, 'source', taken), sources: page.sources, target: 'props.source' };
  }
  const found = pickSource(def, bind, ctx, spec.tables);
  if (found !== null) return bindTo(found);
  if (tables.length === 0) {
    if (!room) return { kind: 'refused', refusal: MSG.full };
    return { kind: 'offer', layer: unconnected(def.name, 'source', taken), sources: page.sources, target: 'props.source', offer: missingOffer(def, spec, ctx) };
  }
  if (!room) return { kind: 'refused', refusal: MSG.full };
  if (tables.length > 1) return { kind: 'choose', layer: unconnected(def.name, 'source', taken), sources: page.sources, target: 'props.source' };
  return withNewSource(def, bind, tables[0], spec, page, taken);
}

/** A new source on the table (a list, or a record when the part is a record part) and the part bound to it. */
function withNewSource(def: PartDefinition, bind: DataBind, table: string, spec: AppSpec, page: DraftPage, taken: ReadonlySet<string>): DropPlan {
  const added = newSourceFor(table, bind.mode ?? 'list', page.sources);
  const sources = [...page.sources, added];
  const next = contextOf(spec, page, sources);
  return toPlan(build(def.name, spec, steer(next, { sourceId: added.id, tableId: table }), sources, taken), sources, added);
}

/** Tables a write part may use, in the order a new part tries them. */
function writeTables(def: PartDefinition, bind: DataBind, spec: AppSpec, ctx: PartContext): string[] {
  return tablePreference(ctx, def.name === 'RecordForm' && ctx.recordPage).filter((t) => {
    if (!tableFits(def, bind, t, ctx, false)) return false;
    if (def.name !== 'QuickAdd') return true;
    const table = spec.tables.find((x) => x.id === t);
    return table !== undefined && quickAddFits(table);
  });
}

function planTable(def: PartDefinition, bind: DataBind, spec: AppSpec, page: DraftPage, ctx: PartContext, taken: ReadonlySet<string>): DropPlan {
  const candidates = writeTables(def, bind, spec, ctx);
  const shown = new Set(page.sources.map((s) => s.table));
  const table = candidates.find((t) => shown.has(t)) ?? (candidates.length === 1 ? candidates[0] : undefined);
  // P17-14: a page that shows a table no longer settles it alone when another table fits too (the page's table comes first in the choice).
  if (table !== undefined && !(shown.has(table) && candidates.length > 1 && !ctx.recordPage)) return toPlan(build(def.name, spec, steer(ctx, { tableId: table }), page.sources, taken), page.sources, null);
  if (candidates.length > 1) return { kind: 'choose', layer: unconnected(def.name, 'table', taken), sources: page.sources, target: 'props.table' };
  if (ctx.tableIds.length === 0) return { kind: 'offer', layer: unconnected(def.name, 'table', taken), sources: page.sources, target: 'props.table', offer: { kind: 'no_table' } };
  return { kind: 'refused', refusal: def.name === 'QuickAdd' ? MSG.quickAdd : MSG.notYet };
}

/**
 * What a part that is not connected can be offered on this draft page, or null when a table fits (then Connect and the chooser
 * apply). Null for a part that is connected, has no data bind, or is a feature block.
 */
export function offerFor(layer: LayoutLayer, spec: AppSpec, page: DraftPage): ConnectOffer | null {
  if (layer.feature !== undefined) return null;
  const def = getPartDefinition(layer.type);
  const bind = def === undefined ? null : dataBindOf(def);
  if (def === undefined || bind === null) return null;
  const ctx = contextOf(spec, page, page.sources);
  if (bind.kind === 'source') {
    const id = layer.props.source;
    if (id === undefined && def.menuProps !== undefined) return null;
    if (typeof id === 'string' && Object.hasOwn(ctx.sources, id)) return null;
    if (bind.mode === 'record' && !ctx.recordPage) return null;
    if (fittingTables(def, bind, ctx, spec.tables).length > 0) return null;
    return page.sources.length >= LIMITS.sourcesPerPage ? { kind: 'full' } : missingOffer(def, spec, ctx);
  }
  const table = layer.props.table;
  if (typeof table === 'string' && ctx.tableIds.includes(table)) return null;
  if (writeTables(def, bind, spec, ctx).length > 0) return null;
  return ctx.tableIds.length === 0 ? { kind: 'no_table' } : null;
}

const refuse = (reason: 'not_found' | 'bad_value', message: string): TreeResult => ({ ok: false, reason, message });

/**
 * Connects a part (not connected, or changing its source to a new one): builds it again with planDrop's rules on the choice,
 * keeping its id and, through replaceLayer, its width. One result for the editor plus the page's next sources.
 */
export function connectLayer(
  root: LayoutLayer,
  id: string,
  choice: ConnectChoice,
  spec: AppSpec,
  page: DraftPage,
  takenIds: ReadonlySet<string>,
): { result: TreeResult; sources: Source[]; added: Source | null } {
  const same = (result: TreeResult) => ({ result, sources: page.sources, added: null });
  const located = findLayer(root, id);
  if (located === null) return same(refuse('not_found', 'That part is no longer on the page.'));
  const def = getPartDefinition(located.layer.type);
  const bind = def === undefined ? null : dataBindOf(def);
  if (def === undefined || bind === null) return same(refuse('bad_value', 'That part has no table to connect.'));
  const taken = new Set(takenIds);
  taken.delete(id);
  const ctx = contextOf(spec, page, page.sources);
  let plan: DropPlan;
  if ('sourceId' in choice) {
    const known = Object.hasOwn(ctx.sources, choice.sourceId) && (bind.mode === undefined || ctx.sources[choice.sourceId].mode === bind.mode);
    if (bind.kind !== 'source' || !known) return same(refuse('bad_value', 'Pick a list of this page.'));
    plan = toPlan(build(def.name, spec, steer(ctx, { sourceId: choice.sourceId }), page.sources, taken), page.sources, null);
  } else if ('newSourceOn' in choice) {
    if (!fittingTables(def, bind, ctx, spec.tables).includes(choice.newSourceOn)) return same(refuse('bad_value', OFFER.noField(fieldNeedsOf(def.name))));
    if (page.sources.length >= LIMITS.sourcesPerPage) return same(refuse('bad_value', MSG.full));
    plan = withNewSource(def, bind, choice.newSourceOn, spec, page, taken);
  } else {
    if (bind.kind !== 'table' || !writeTables(def, bind, spec, ctx).includes(choice.table)) return same(refuse('bad_value', 'Pick a table of this app.'));
    plan = toPlan(build(def.name, spec, steer(ctx, { tableId: choice.table }), page.sources, taken), page.sources, null);
  }
  if (plan.kind !== 'bound') return same(refuse('bad_value', plan.kind === 'refused' ? plan.refusal : OFFER.noField(fieldNeedsOf(def.name))));
  const result = replaceLayer(root, id, { ...plan.layer, id });
  return result.ok ? { result, sources: plan.sources, added: plan.added } : same(result);
}

interface Connected {
  /** False when the table or field was added but the part could not be connected to it (the part stays as it was). */
  connected: boolean;
  result: TreeResult;
  sources: Source[];
  tables: Table[];
  added: Source | null;
}

/**
 * Adds `table` to the draft and connects the part to it: a new list (newSourceFor) for a source part, the table for a write part,
 * through connectLayer on the spec with the table. A refusal leaves tables and sources as they were.
 */
export function connectToNewTable(
  root: LayoutLayer,
  layerId: string,
  table: Table,
  spec: AppSpec,
  page: DraftPage,
  takenIds: ReadonlySet<string>,
): Connected {
  const refused = (message: string): Connected => ({ connected: false, result: refuse('bad_value', message), sources: page.sources, tables: spec.tables, added: null });
  const located = findLayer(root, layerId);
  if (located === null) return { connected: false, result: refuse('not_found', 'That part is no longer on the page.'), sources: page.sources, tables: spec.tables, added: null };
  const def = getPartDefinition(located.layer.type);
  const bind = def === undefined ? null : dataBindOf(def);
  if (def === undefined || bind === null) return refused('That part has no table to connect.');
  if (spec.tables.some((t) => t.id === table.id)) return refused('That table already exists.');
  const next: AppSpec = { ...spec, tables: [...spec.tables, table] };
  // A table the part cannot use (a Linked record picker on a blank app: the first table has no link field) is still added, tables only.
  const ctx = contextOf(next, page, page.sources);
  const fits = bind.kind === 'source' ? fittingTables(def, bind, ctx, next.tables).includes(table.id) : writeTables(def, bind, next, ctx).includes(table.id);
  if (!fits) return { connected: false, result: { ok: true, root, focusId: layerId }, sources: page.sources, tables: next.tables, added: null };
  const choice: ConnectChoice = bind.kind === 'source' ? { newSourceOn: table.id } : { table: table.id };
  const out = connectLayer(root, layerId, choice, next, page, takenIds);
  if (!out.result.ok) return { connected: false, result: out.result, sources: page.sources, tables: spec.tables, added: null };
  return { connected: true, result: out.result, sources: out.sources, tables: next.tables, added: out.added };
}

/** The table a data part is connected to now, or null when it is not connected. */
function connectedTable(layer: LayoutLayer, bind: DataBind, ctx: PartContext): string | null {
  const value = layer.props[bind.prop];
  if (typeof value !== 'string') return null;
  if (bind.kind === 'table') return ctx.tableIds.includes(value) ? value : null;
  return Object.hasOwn(ctx.sources, value) ? ctx.sources[value].table : null;
}

/**
 * Adds `field` to the table `tableId` in the draft and points the part's `target` (props.<field bind>) at it. The part is first
 * connected to that table when it is not: by `choice` when given (the popover's pending List or Table value), else to a list of
 * the page on that table, else a new list (source part) or the table (write part). `target` null: the first need of the part
 * whose types include the field's type.
 */
export function connectWithNewField(
  root: LayoutLayer,
  layerId: string,
  tableId: string,
  field: Field,
  target: string | null,
  choice: ConnectChoice | null,
  spec: AppSpec,
  page: DraftPage,
  takenIds: ReadonlySet<string>,
): Connected {
  const failed = (result: TreeResult): Connected => ({ connected: false, result, sources: page.sources, tables: spec.tables, added: null });
  const located = findLayer(root, layerId);
  if (located === null) return failed(refuse('not_found', 'That part is no longer on the page.'));
  const def = getPartDefinition(located.layer.type);
  const bind = def === undefined ? null : dataBindOf(def);
  if (def === undefined || bind === null) return failed(refuse('bad_value', 'That part has no table to connect.'));
  const old = spec.tables.find((t) => t.id === tableId);
  if (old === undefined) return failed(refuse('bad_value', 'Pick a table of this app.'));
  if (old.fields.length >= LIMITS.fieldsPerTable) return failed(refuse('bad_value', `A table may have at most ${LIMITS.fieldsPerTable} fields.`));
  if (old.fields.some((f) => f.id === field.id)) return failed(refuse('bad_value', 'That table already has a field with that name.'));
  const next: AppSpec = { ...spec, tables: spec.tables.map((t) => (t === old ? { ...t, fields: [...t.fields, field] } : t)) };
  const ctx = contextOf(next, page, page.sources);

  let connected: { result: TreeResult; sources: Source[]; added: Source | null } = { result: { ok: true, root, focusId: layerId }, sources: page.sources, added: null };
  let wanted: ConnectChoice | null = choice;
  if (wanted === null && connectedTable(located.layer, bind, ctx) !== tableId) {
    const existing = bind.kind === 'source' ? page.sources.find((s) => s.table === tableId && (bind.mode === undefined || s.mode === bind.mode)) : undefined;
    wanted = bind.kind === 'table' ? { table: tableId } : existing !== undefined ? { sourceId: existing.id } : { newSourceOn: tableId };
  }
  if (wanted !== null) {
    connected = connectLayer(root, layerId, wanted, next, page, takenIds);
    if (!connected.result.ok) return failed(connected.result);
  }
  const aimed = target ?? (() => {
    const need = fieldNeedsOf(def.name).find((n) => n.types.includes(field.type));
    return need === undefined ? null : `props.${need.prop}`;
  })();
  if (aimed === null || !connected.result.ok) return { ...connected, connected: true, tables: next.tables };
  const set = configureLayer(connected.result.root, layerId, { [aimed]: field.id }, contextOf(next, page, connected.sources), 'page');
  if (!set.ok) return failed(set);
  return { connected: true, result: set, sources: connected.sources, tables: next.tables, added: connected.added };
}

/** The table a data part is connected to by its own props, for the line "Connected the Form to People." Null when it has none. */
export function connectedTableOf(layer: LayoutLayer, sources: readonly Source[]): string | null {
  const table = layer.props.table;
  if (typeof table === 'string' && table !== NOT_CONNECTED) return table;
  const source = layer.props.source;
  if (typeof source !== 'string' || source === NOT_CONNECTED) return null;
  return sources.find((s) => s.id === source)?.table ?? null;
}

/** Tables a write part of this type may use on this draft page, in the order a new part tries them ([] for a part with no table prop). */
export function writeTablesFor(type: string, spec: AppSpec, page: DraftPage): string[] {
  const def = getPartDefinition(type);
  const bind = def === undefined ? null : dataBindOf(def);
  if (def === undefined || bind === null || bind.kind !== 'table') return [];
  return writeTables(def, bind, spec, contextOf(spec, page, page.sources));
}
