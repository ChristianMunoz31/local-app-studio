// What a part needs from a table, read from the catalog bind definitions (no hand list of parts), and the table a New table
// starts with for a part (DESIGN-phase13.md 3.2). Pure.
import { getPartDefinition } from '@/catalog/definitions';
import type { Field, FieldType, Table } from '@local-app-studio/runtime/spec/schema';
import { dataBindOf, neededFields } from './bindChoice';
import { FIELD_WORDS } from './fields';
import { EXAMPLE_OPTIONS, TITLE_FIELD_LABEL, fieldOfType } from './tableDraft';
import type { TableDraft } from './tableDraft';

/** A field bind a part needs on its table, with the types it accepts, in the bind's own order. */
export interface FieldNeed {
  prop: string;
  types: readonly FieldType[];
}

const NUMBER_TYPES: readonly FieldType[] = ['integer', 'real'];

/** The required field binds of the part's data bind that name types. */
export function fieldNeedsOf(type: string): FieldNeed[] {
  const def = getPartDefinition(type);
  const bind = def === undefined ? null : dataBindOf(def);
  if (def === undefined || bind === null) return [];
  return neededFields(def, bind).flatMap((b) => (b.fieldTypes !== undefined && b.fieldTypes.length > 0 ? [{ prop: b.prop, types: b.fieldTypes }] : []));
}

/** "a yes or no field", "a date field and a choice field". */
export function needWords(needs: readonly FieldNeed[]): string {
  return needs.map((n) => `a ${FIELD_WORDS[n.types[0]]} field`).join(' and ');
}

const LABELS: Readonly<Record<Exclude<FieldType, 'reference'>, string>> = {
  boolean: 'Done',
  select: 'Status',
  date: 'Date',
  datetime: 'Date and time',
  integer: 'Amount',
  real: 'Amount',
  text: 'Name',
  longtext: 'Notes',
};

/** The label a new field of this type starts with. */
export function suggestedLabel(type: FieldType, tables: readonly Table[], linkTo?: string): string {
  if (type !== 'reference') return LABELS[type];
  return tables.find((t) => t.id === linkTo)?.label ?? tables[0]?.label ?? 'Link';
}

/** The needs a New table covers: the part's required field binds, else (a part that measures a number) its number field bind. */
function startingNeeds(type: string): FieldNeed[] {
  const needs = fieldNeedsOf(type);
  if (needs.length > 0) return needs;
  const def = getPartDefinition(type);
  const bind = def === undefined ? null : dataBindOf(def);
  if (def === undefined || bind === null) return [];
  return def.binds.flatMap((b) =>
    b.kind === 'field' &&
    b.of === bind.prop &&
    !b.prop.includes('.') &&
    b.fieldTypes !== undefined &&
    b.fieldTypes.length > 0 &&
    b.fieldTypes.every((t) => NUMBER_TYPES.includes(t)) &&
    Object.hasOwn(def.example.props, b.prop)
      ? [{ prop: b.prop, types: b.fieldTypes }]
      : [],
  );
}

/** The draft a New table for this part starts with: label '' and the title field, the fields the part needs and, for a form, Notes. */
export function newTableDraft(type: string, tables: readonly Table[]): TableDraft {
  const fields: Field[] = [{ id: 'name', label: TITLE_FIELD_LABEL, type: 'text', required: true }];
  const taken = new Set<string>(['name']);
  const add = (field: Field): void => {
    fields.push(field);
    taken.add(field.id);
  };
  for (const need of startingNeeds(type)) {
    const t = need.types[0];
    if (t === 'text') continue;
    if (t === 'reference' && tables.length === 0) continue;
    const label = suggestedLabel(t, tables, tables[0]?.id);
    if (fields.some((f) => f.label === label)) continue;
    add(fieldOfType(label, t, taken, tables, t === 'select' ? EXAMPLE_OPTIONS : undefined));
  }
  const def = getPartDefinition(type);
  if ((def === undefined ? null : dataBindOf(def))?.kind === 'table') {
    add(fieldOfType(LABELS.longtext, 'longtext', taken, tables));
  }
  return { label: '', fields };
}
