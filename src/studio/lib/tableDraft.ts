// Makes tables and fields for the Data step and the Design step's New table and Add a field dialogs, so both use the same ids,
// labels and rules (DESIGN-phase13.md 3.1). Pure: no React, nothing is mutated.
import { isReservedFieldId, isReservedTableId } from '@local-app-studio/runtime/spec/schema';
import type { AppSpec, Field, FieldType, SpecIssue, Table } from '@local-app-studio/runtime/spec/schema';
import { changeFieldType } from './fields';
import { toId } from './ids';
import { issuesAt, validateSpec } from './validate';

/** A table being made in the New table dialog: its name and its fields in order (ids are made from the labels by tableFromDraft). */
export interface TableDraft {
  label: string;
  fields: Field[];
}

export const TITLE_FIELD_LABEL = 'Name';
/** The three example choices a new choice field starts with. */
export const EXAMPLE_OPTIONS: readonly string[] = ['To do', 'Doing', 'Done'];

/** Exactly the Data step's Add table: id from "New table", label "New table" or "New table <n+1>", one required text field "Name" that names each record. */
export function blankTable(tables: readonly Table[], alsoTaken: readonly string[] = []): Table {
  const taken = new Set([...tables.map((t) => t.id), ...alsoTaken]);
  const id = toId('New table', taken, isReservedTableId);
  const label = tables.some((t) => t.label === 'New table') ? `New table ${tables.length + 1}` : 'New table';
  return { id, label, titleField: 'name', fields: [{ id: 'name', label: TITLE_FIELD_LABEL, type: 'text', required: true }] };
}

/** Exactly the Data step's Add field: id from "New field", label "New field", text, not required. */
export function blankField(table: Pick<Table, 'fields'>): Field {
  const taken = new Set(table.fields.map((f) => f.id));
  return { id: toId('New field', taken, isReservedFieldId), label: 'New field', type: 'text', required: false };
}

/** A field of a type with its id made from the label (unique in `taken`), not required, with the extras of its type. */
export function fieldOfType(
  label: string,
  type: FieldType,
  taken: ReadonlySet<string>,
  otherTables: readonly { id: string }[],
  options?: readonly string[],
): Field {
  const id = toId(label, taken, isReservedFieldId);
  const field = changeFieldType({ id, label, type: 'text', required: false }, type, [...otherTables]);
  return field.type === 'select' && options !== undefined ? { ...field, options: [...options] } : field;
}

/** The table a draft makes: its id and field ids come from the labels, the title field is the first text, long text or choice field. */
export function tableFromDraft(draft: TableDraft, tables: readonly Table[]): Table {
  const id = toId(draft.label, new Set(tables.map((t) => t.id)), isReservedTableId);
  const used = new Set<string>();
  const fields = draft.fields.map((f): Field => {
    const fieldId = toId(f.label, used, isReservedFieldId);
    used.add(fieldId);
    return { ...f, id: fieldId };
  });
  const title = fields.find((f) => f.type === 'text' || f.type === 'longtext' || f.type === 'select');
  return { id, label: draft.label, ...(title === undefined ? {} : { titleField: title.id }), fields };
}

/** The table with one more field and that field. */
export function withField(
  table: Table,
  label: string,
  type: FieldType,
  otherTables: readonly { id: string }[],
  options?: readonly string[],
): { table: Table; field: Field } {
  const field = fieldOfType(label, type, new Set(table.fields.map((f) => f.id)), otherTables, options);
  return { table: { ...table, fields: [...table.fields, field] }, field };
}

/** The Data step's check for a changed table list: the issues at "tables" (the count cap) and at or below "tables.<index>". */
export function tableIssues(spec: AppSpec, tables: readonly Table[], index: number): SpecIssue[] {
  const { issues } = validateSpec({ ...spec, tables: [...tables] });
  return [...issues.filter((i) => i.path === 'tables'), ...issuesAt(issues, `tables.${index}`)];
}

/** The labels the Data step gives a table or field it makes, whose inside name comes from the base label ("New table 3" is "new_table_3"). */
const BLANK_LABEL_RE = /^(New table|New field)(?: \d+)?$/;

/**
 * The inside name a table or field has after its label changes (DESIGN-phase14.md P-17, the rule of tableFromDraft). It follows the
 * label while the thing is not in the saved base and its inside name is still the one its old label made (an inside name the
 * person typed under More options is kept); once saved it never changes. `taken` holds the inside names of the others.
 */
export function followedId(
  old: { id: string; label: string },
  label: string,
  taken: ReadonlySet<string>,
  saved: boolean,
  reserved: (id: string) => boolean,
): string {
  if (saved) return old.id;
  const blank = BLANK_LABEL_RE.exec(old.label);
  const made = [toId(old.label, taken, reserved), ...(blank ? [toId(blank[1], taken, reserved)] : [])];
  return made.includes(old.id) ? toId(label, taken, reserved) : old.id;
}
