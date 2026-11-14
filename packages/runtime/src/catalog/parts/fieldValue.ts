// How one field's value travels between a row, an input and a save. Shared by the record form and the inline edit of a
// table cell, so both send the same thing and show the rules' words the same way.
import type { Field } from '../../spec/schema.ts';
import type { DataRow } from '../../../../../src/catalog/context.tsx';
import { isoToLocal, localToIso } from './format.ts';

/** What an input holds for a stored value: text for most types, a flag for a yes/no field. */
export function toInput(field: Field, value: unknown): string | boolean {
  if (field.type === 'boolean') return value === true || value === 1;
  if (value === null || value === undefined) return '';
  return field.type === 'datetime' ? isoToLocal(String(value)) : String(value);
}

/** The value sent for a field, or undefined to leave it out (a new record's empty optional field). */
export function toPayload(field: Field, raw: string | boolean, editing: boolean): unknown {
  if (field.type === 'boolean') return raw === true;
  const text = typeof raw === 'string' ? raw : '';
  if (text.trim() === '') return editing ? null : undefined;
  if (field.type === 'integer' || field.type === 'real') return Number.isFinite(Number(text)) ? Number(text) : text;
  return field.type === 'datetime' ? (localToIso(text) ?? text) : text;
}

/** The words of the rules a save ran ("Paid on was set to today."), from the row's non-enumerable `applied`. */
export function appliedText(row: DataRow): string {
  const applied = (row as { applied?: unknown }).applied;
  if (!Array.isArray(applied)) return '';
  return applied.map((a) => (typeof a?.words === 'string' ? a.words : '')).filter(Boolean).join(' ');
}
