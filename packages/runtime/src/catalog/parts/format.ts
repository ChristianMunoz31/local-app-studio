// Display formatting for field values (docs/CATALOG.md). The UI only formats what the server computed; it never
// computes a number itself. Types only from the schema, so no zod reaches the runtime chunk through this file.
import type { FieldType } from '../../spec/schema.ts';

export interface FormatRule {
  type: FieldType;
  options?: string[];
}

const isEmpty = (value: unknown): boolean => value === null || value === undefined || value === '';

/** The date part of a stored "2026-01-31" shown in the user's locale, without a time zone shift. */
function formatDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return value;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function formatDateTime(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** A stored value as text for a cell, detail row or badge. Empty values give ''. */
export function formatValue(rule: FormatRule, value: unknown): string {
  if (isEmpty(value)) return '';
  switch (rule.type) {
    case 'boolean':
      return value === true || value === 1 ? 'Yes' : 'No';
    case 'integer':
      return typeof value === 'number' ? value.toLocaleString(undefined, { maximumFractionDigits: 0 }) : String(value);
    case 'real':
      return typeof value === 'number' ? value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(value);
    case 'date':
      return formatDate(String(value));
    case 'datetime':
      return formatDateTime(String(value));
    default:
      return String(value);
  }
}

/** The number a StatCard shows: counts are whole numbers, a Decimal field has two decimals, an average of whole numbers up to two. */
export function formatStat(stat: string, fieldType: FieldType | null, value: number | null): string {
  if (value === null) return '';
  if (stat === 'count') return formatValue({ type: 'integer' }, value);
  if (fieldType === 'real') return formatValue({ type: 'real' }, value);
  if (stat === 'avg') return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return formatValue({ type: 'integer' }, value);
}

/**
 * The field that names a record: the table's titleField when it names a real field of the table, else its first text
 * field, else the id. Mirrors titleFieldOf in src/runtime/normalizeSpec.js (this file stays import free of runtime code
 * under ADR-006); titleField.test.ts pins the two together.
 */
export function titleFieldOf(table: { titleField?: string; fields: ReadonlyArray<{ id: string; type: FieldType }> }): string {
  const named = table.titleField !== undefined && table.fields.some((f) => f.id === table.titleField);
  if (named) return table.titleField as string;
  return table.fields.find((f) => f.type === 'text')?.id ?? 'id';
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** An ISO timestamp as the "YYYY-MM-DDTHH:mm" a datetime-local input wants, in local time ('' when it is not a date). */
export function isoToLocal(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** What a datetime-local input holds (local time) as an ISO timestamp, or undefined when it is empty or not a date. */
export function localToIso(local: string): string | undefined {
  const d = new Date(local);
  return local === '' || Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
