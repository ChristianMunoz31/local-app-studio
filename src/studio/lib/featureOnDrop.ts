// A saved feature dropped on a page where no table fits: the table it needs is made first (New table, prefilled from the feature's
// field settings) and the feature is placed connected to it in one history step (DESIGN-phase16.md 4.2). Pure: nothing is mutated.
import { partContextFor } from '@/catalog/validateLayout';
import type { FeatureDefinition, FeatureLibrary } from '@/catalog/features';
import type { AppSpec, Field, Table } from '@local-app-studio/runtime/spec/schema';
import { newSourceFor, withPageSources } from './bindOnDrop';
import type { DraftPage, Source } from './bindOnDrop';
import { withOwnWords } from './featureWords';
import { autoValues, insertBeside, insertLayer, newFeatureLayer } from './layoutTree';
import type { DropTarget, SideTarget, TreeResult } from './layoutTree';
import { EXAMPLE_OPTIONS, TITLE_FIELD_LABEL, fieldOfType } from './tableDraft';
import type { TableDraft } from './tableDraft';

/** True when a new table could give the feature what it asks of a page: it has a table or list setting and none of them is one record. */
export function needsNewTable(def: Pick<FeatureDefinition, 'params'>): boolean {
  const holds = def.params.some((p) => p.type === 'table' || (p.type === 'source' && (p.mode ?? 'list') === 'list'));
  return holds && !def.params.some((p) => p.type === 'source' && p.mode === 'record');
}

/** Name (title) plus one field per field setting of the feature: its label, its first allowed type (select gets the example options). */
export function featureTableDraft(def: FeatureDefinition, tables: readonly Table[]): TableDraft {
  const fields: Field[] = [{ id: 'name', label: TITLE_FIELD_LABEL, type: 'text', required: true }];
  const taken = new Set<string>(['name']);
  for (const p of def.params) {
    if (p.type !== 'field') continue;
    const type = p.fieldTypes?.[0] ?? 'text';
    // A text field is covered by Name; a link needs a table to point at.
    if (type === 'text' || (type === 'reference' && tables.length === 0)) continue;
    if (fields.some((f) => f.label === p.label && f.type === type)) continue;
    const field = fieldOfType(p.label, type, taken, tables, type === 'select' ? EXAMPLE_OPTIONS : undefined);
    fields.push(field);
    taken.add(field.id);
  }
  return { label: '', fields };
}

/**
 * Adds the table, a list on it for each list setting, then the feature with autoValues on the new page context, at `at`. The page of
 * `spec` that `page` names holds the layout being edited (the session passes it with its current layout).
 */
export function placeFeatureOnNewTable(
  def: FeatureDefinition,
  table: Table,
  spec: AppSpec,
  page: DraftPage,
  at: DropTarget | SideTarget,
  takenIds: ReadonlySet<string>,
  library: FeatureLibrary,
): { result: TreeResult; sources: Source[]; tables: Table[] } | { refusal: string } {
  if (!needsNewTable(def)) return { refusal: 'This feature needs one record on this page. Add one in Page settings.' };
  if (spec.tables.some((t) => t.id === table.id)) return { refusal: 'That table already exists.' };
  const tables = [...spec.tables, table];
  const sources: Source[] = [...page.sources];
  for (const p of def.params) {
    if (p.type === 'source') sources.push(newSourceFor(table.id, 'list', sources));
  }
  const made = sources.slice(page.sources.length).map((s) => s.id);
  const next = withPageSources({ ...spec, tables }, page.id, sources);
  const holder = next.pages.find((p) => p.id === page.id);
  if (holder === undefined) return { refusal: 'This feature could not be added to this page.' };
  const ctx = partContextFor(next, holder);
  // The new table and its lists come first, so each table or list setting (and the fields chosen from it) finds the table made for it.
  const values = autoValues(def, { ...ctx, tableIds: [table.id, ...ctx.tableIds.filter((id) => id !== table.id)], sourceIds: [...made, ...ctx.sourceIds.filter((id) => !made.includes(id))] });
  if (values === null) return { refusal: 'This feature could not be added to this page.' };
  let k = 0;
  for (const p of def.params) {
    if (p.type === 'source') values[p.name] = made[k++];
    else if (p.type === 'table') values[p.name] = table.id;
  }
  const worded = withOwnWords(def, values, ctx, next);
  const layer = newFeatureLayer(worded.def, worded.values, ctx, library, new Set(takenIds));
  if (!layer.ok) return { refusal: 'This feature could not be added to this page.' };
  const root = holder.layout;
  const result = 'targetId' in at ? insertBeside(root, at, layer.value) : insertLayer(root, at, layer.value);
  return { result, sources, tables };
}
