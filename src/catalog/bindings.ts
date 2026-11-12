// Which ids a bindable prop may name, derived from a PartContext (docs/CATALOG.md, "Data binding to page sources").
// Pure. The part definitions use these to narrow their zod enums; validateLayout uses the same helpers to word its
// binding issues.
import type { FieldType } from '@local-app-studio/runtime/spec/schema.ts';
import type { PartContext } from './types.ts';

/** Columns the runtime adds to every table that a user cannot edit (id is never offered at all). */
export const READ_ONLY_COLUMNS: readonly string[] = ['created_at', 'updated_at'];

/** Source ids of the page with the given mode (any mode when omitted), in page order. */
export function sourceIdsOf(ctx: PartContext, mode?: 'list' | 'record'): string[] {
  return ctx.sourceIds.filter((id) => mode === undefined || ctx.sources[id]?.mode === mode);
}

/** The distinct tables the page's sources of the given mode (any mode when omitted) read, in page order. */
export function sourceTablesOf(ctx: PartContext, mode?: 'list' | 'record'): string[] {
  return [...new Set(sourceIdsOf(ctx, mode).map((id) => ctx.sources[id].table))];
}

export interface FieldFilter {
  /** Keep only fields of these types. */
  types?: readonly FieldType[];
  /** Drop the runtime columns a user cannot edit. */
  editable?: boolean;
}

/** The distinct field ids of the given tables that pass the filter, in table then field order. */
export function fieldIdsOf(ctx: PartContext, tables: readonly string[], filter: FieldFilter = {}): string[] {
  const ids = new Set<string>();
  for (const table of tables) {
    for (const field of ctx.fields[table] ?? []) {
      if (filter.types && !filter.types.includes(field.type)) continue;
      if (filter.editable && READ_ONLY_COLUMNS.includes(field.id)) continue;
      ids.add(field.id);
    }
  }
  return [...ids];
}

/** Page ids a link may target without a record: every page except those whose route ends in /:id. */
export function linkablePageIds(ctx: PartContext): string[] {
  const skip = ctx.recordPageIds ?? [];
  return ctx.pageIds.filter((id) => !skip.includes(id));
}
