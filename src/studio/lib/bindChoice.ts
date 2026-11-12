// Which table or list a new data part should use (docs/DESIGN.md "Connect a part to a table"). Pure: it only reads part
// definitions and a PartContext, so Design can choose before it builds a layer. Declared fields count before the runtime
// columns created_at and updated_at, so a Timeline lands on a real date field and not on "Created".
import { READ_ONLY_COLUMNS, fieldIdsOf } from '@/catalog/bindings';
import { SPIKE_PART_CONTEXT } from '@/catalog/types';
import type { PartContext, PartDefinition } from '@/catalog/types';
import type { AppSpec, FieldType, Page, Table } from '@local-app-studio/runtime/spec/schema';
import * as z from 'zod';

export const RUNTIME_COLUMNS: ReadonlySet<string> = new Set(READ_ONLY_COLUMNS);

export interface DataBind {
  prop: 'source' | 'table';
  kind: 'source' | 'table';
  mode: 'list' | 'record' | undefined;
}

/** True when a top-level prop may be left out (its zod shape accepts undefined). Optionality does not depend on the context. */
function isOptional(def: PartDefinition, prop: string): boolean {
  const shape = def.props(SPIKE_PART_CONTEXT).shape;
  return Object.hasOwn(shape, prop) && z.safeParse(shape[prop], undefined).success;
}

/** The bind that ties a part to its rows: its required `source` bind, else its `table` bind (QuickAdd, RecordForm). Null for parts with neither. */
export function dataBindOf(def: PartDefinition): DataBind | null {
  const source = def.binds.find((b) => b.kind === 'source' && b.prop === 'source' && !isOptional(def, b.prop));
  if (source !== undefined) return { prop: 'source', kind: 'source', mode: source.mode };
  const table = def.binds.find((b) => b.kind === 'table' && b.prop === 'table');
  return table === undefined ? null : { prop: 'table', kind: 'table', mode: undefined };
}

/**
 * Tables in the order a new part tries them: the tables of the page's sources in page order (record sources first when
 * `preferRecord`), then the rest of ctx.tableIds. No duplicates.
 */
export function tablePreference(ctx: PartContext, preferRecord: boolean): string[] {
  const ids = preferRecord
    ? [...ctx.sourceIds.filter((id) => ctx.sources[id].mode === 'record'), ...ctx.sourceIds.filter((id) => ctx.sources[id].mode !== 'record')]
    : ctx.sourceIds;
  return [...new Set([...ids.map((id) => ctx.sources[id].table), ...ctx.tableIds])];
}

/** The field binds of the part that must have a field to point at, once the part is bound through `bind`. */
export function neededFields(def: PartDefinition, bind: DataBind): PartDefinition['binds'] {
  return def.binds.filter(
    (b) => b.kind === 'field' && b.of === bind.prop && !b.prop.includes('.') && !isOptional(def, b.prop) && Object.hasOwn(def.example.props, b.prop),
  );
}

/**
 * True when the table has a candidate for every required field bind of the part that depends on `bind`.
 * `declaredOnly`: created_at and updated_at do not count (B4).
 */
export function tableFits(def: PartDefinition, bind: DataBind, table: string, ctx: PartContext, declaredOnly: boolean): boolean {
  return neededFields(def, bind).every((b) => {
    const ids = fieldIdsOf(ctx, [table], { ...(b.fieldTypes ? { types: b.fieldTypes } : {}), ...(b.editable ? { editable: true } : {}) });
    return ids.some((id) => !declaredOnly || !RUNTIME_COLUMNS.has(id));
  });
}

/**
 * B8: a Quick add fills the first editable text field, so the table fits when no other required field lacks a default
 * (a yes/no field is never a problem, the database fills it). A table with no text field does not fit.
 */
export function quickAddFits(table: Table): boolean {
  const first = table.fields.find((f) => f.type === 'text');
  if (first === undefined) return false;
  return table.fields.every((f) => f.id === first.id || !f.required || f.type === 'boolean' || ('default' in f && f.default !== undefined));
}

function fitsWith(def: PartDefinition, bind: DataBind, table: string, ctx: PartContext, tables: readonly Table[], declaredOnly: boolean): boolean {
  if (!tableFits(def, bind, table, ctx, declaredOnly)) return false;
  if (def.name !== 'QuickAdd') return true;
  const found = tables.find((t) => t.id === table);
  return found !== undefined && quickAddFits(found);
}

/**
 * The page source a new part should use: the first source of the bind's mode whose table fits with declared fields only,
 * then the first that fits with runtime columns; null when none fits (and always null for a table bind).
 * `declaredOnlyPass` given: only that pass (true: declared fields only).
 */
export function pickSource(def: PartDefinition, bind: DataBind, ctx: PartContext, tables: readonly Table[], declaredOnlyPass?: boolean): string | null {
  if (bind.kind !== 'source') return null;
  const pool = ctx.sourceIds.filter((id) => bind.mode === undefined || ctx.sources[id].mode === bind.mode);
  for (const declaredOnly of declaredOnlyPass === undefined ? [true, false] : [declaredOnlyPass]) {
    const hit = pool.find((id) => fitsWith(def, bind, ctx.sources[id].table, ctx, tables, declaredOnly));
    if (hit !== undefined) return hit;
  }
  return null;
}

/** Tables of the app a new source (or a write part) for this part could use, in tablePreference order, declared fits first. */
export function fittingTables(def: PartDefinition, bind: DataBind, ctx: PartContext, tables: readonly Table[]): string[] {
  const order = tablePreference(ctx, bind.mode === 'record');
  const declared = order.filter((t) => fitsWith(def, bind, t, ctx, tables, true));
  const rest = order.filter((t) => !declared.includes(t) && fitsWith(def, bind, t, ctx, tables, false));
  return [...declared, ...rest];
}

/**
 * Field ids in the order a part takes them: declared fields before created_at and updated_at, then by the position of the
 * field's type in `types` (the bind's own order), then table order.
 */
export function rankFieldIds(ids: readonly string[], types: readonly FieldType[] | undefined, fields: readonly { id: string; type: string }[]): string[] {
  const typeRank = (id: string): number => {
    if (types === undefined) return 0;
    const type = fields.find((f) => f.id === id)?.type;
    const at = types.findIndex((t) => t === type);
    return at < 0 ? types.length : at;
  };
  return ids
    .map((id, order) => ({ id, order, runtime: RUNTIME_COLUMNS.has(id) ? 1 : 0, type: typeRank(id) }))
    .sort((a, b) => a.runtime - b.runtime || a.type - b.type || a.order - b.order)
    .map((x) => x.id);
}

/** The same context with `sourceIds` and `tableIds` reordered so the given ids come first. Same members: validation is unchanged. */
export function steer(ctx: PartContext, first: { sourceId?: string; tableId?: string }): PartContext {
  const front = (ids: string[], id: string | undefined): string[] => (id !== undefined && ids.includes(id) ? [id, ...ids.filter((x) => x !== id)] : ids);
  return { ...ctx, sourceIds: front(ctx.sourceIds, first.sourceId), tableIds: front(ctx.tableIds, first.tableId) };
}

/** The pages that open from a list and show one record of `table`, in page order. */
export function recordPagesFor(spec: AppSpec, table: string): Page[] {
  return spec.pages.filter((p) => p.route.endsWith('/:id') && p.sources.some((s) => s.mode === 'record' && s.table === table));
}

/** The page a row of a list of `table` opens by default: the one record page of that table, or null when there is none or more than one. */
export function defaultRowPage(spec: AppSpec, table: string): string | null {
  const pages = recordPagesFor(spec, table);
  return pages.length === 1 ? pages[0].id : null;
}
