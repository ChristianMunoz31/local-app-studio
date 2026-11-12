// The sample records an example app comes with (docs/phase20/DESIGN-phase20.md, section 4.1). Pure: no DOM, no database.
// The server imports this file, so it follows the ADR-006 rules: erasable TypeScript, relative or bare imports with the
// `.ts` extension, type-only imports as `import type`, no `@/` alias.
import type { AppSpec, Table } from '@local-app-studio/runtime/spec/schema.ts';

/** A date relative to the day the records are used: `{ $days: -3 }`, or with a local time for a datetime field. */
export type SampleToken = { $days: number; time?: string };
export type SampleValue = string | number | boolean | null | SampleToken;
/** One record: field ids to values, plus an optional `_id` key that other rows can point at. */
export type SampleRow = Record<string, SampleValue>;
export interface SampleRecords {
  v: 1;
  tables: Record<string, SampleRow[]>;
}

export const SAMPLE_LIMITS = Object.freeze({
  tables: 30,
  rowsPerTable: 50,
  totalRows: 200,
  textChars: 2000,
  keyChars: 40,
  maxDays: 3650,
  jsonChars: 65536,
} as const);

const KEY_RE = /^[a-z0-9_-]{1,40}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const BAD = 'The sample records do not fit this app.';

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function isToken(v: unknown): v is SampleToken {
  if (!isObject(v)) return false;
  const keys = Object.keys(v);
  if (!keys.includes('$days') || keys.some((k) => k !== '$days' && k !== 'time')) return false;
  const days = v.$days;
  if (typeof days !== 'number' || !Number.isInteger(days) || Math.abs(days) > SAMPLE_LIMITS.maxDays) return false;
  return v.time === undefined || (typeof v.time === 'string' && TIME_RE.test(v.time));
}

function isValue(v: unknown): v is SampleValue {
  return v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || isToken(v);
}

/** Structure and limits only (no spec): the reader of a stored value. Returns a rebuilt copy (no extra keys), or null. */
export function checkSampleShape(value: unknown): SampleRecords | null {
  if (!isObject(value) || value.v !== 1 || !isObject(value.tables)) return null;
  const tables = Object.entries(value.tables);
  if (tables.length > SAMPLE_LIMITS.tables) return null;
  let total = 0;
  for (const [id, rows] of tables) {
    if (id.length > SAMPLE_LIMITS.keyChars || !Array.isArray(rows) || rows.length > SAMPLE_LIMITS.rowsPerTable) return null;
    total += rows.length;
    if (total > SAMPLE_LIMITS.totalRows) return null;
    for (const row of rows) {
      if (!isObject(row)) return null;
      for (const [key, v] of Object.entries(row)) {
        if (key.length > SAMPLE_LIMITS.keyChars || !isValue(v)) return null;
        if (typeof v === 'string' && v.length > SAMPLE_LIMITS.textChars) return null;
        if (key === '_id' && (typeof v !== 'string' || !KEY_RE.test(v))) return null;
      }
    }
  }
  try {
    if (JSON.stringify(value).length > SAMPLE_LIMITS.jsonChars) return null;
  } catch {
    return null;
  }
  const copy: Record<string, SampleRow[]> = {};
  for (const [id, rows] of tables) copy[id] = (rows as SampleRow[]).map((row) => ({ ...row }));
  return { v: 1, tables: copy };
}

function fits(field: Table['fields'][number], v: SampleValue): boolean {
  if (v === null) return !field.required;
  switch (field.type) {
    case 'text':
    case 'longtext':
      return typeof v === 'string' && !v.includes('\u0000');
    case 'select':
      return typeof v === 'string' && field.options.includes(v);
    case 'integer':
      return typeof v === 'number' && Number.isSafeInteger(v);
    case 'real':
      return typeof v === 'number';
    case 'boolean':
      return typeof v === 'boolean';
    case 'date':
      return isToken(v) && v.time === undefined;
    case 'datetime':
      return isToken(v) && v.time !== undefined;
    case 'reference':
      return typeof v === 'string';
    default:
      return false;
  }
}

/** Strict check of a submitted sample against the app it will belong to (used at import). */
export function checkSample(value: unknown, spec: AppSpec): { ok: true; value: SampleRecords } | { ok: false; problem: string } {
  const sample = checkSampleShape(value);
  if (sample === null) return { ok: false, problem: BAD };
  const tables = new Map(spec.tables.map((t) => [t.id, t]));
  const keys = new Map<string, Map<string, number>>();
  for (const [id, rows] of Object.entries(sample.tables)) {
    if (!tables.has(id)) return { ok: false, problem: `${BAD} Table "${id}" is not in the app.` };
    const seen = new Map<string, number>();
    rows.forEach((row, index) => {
      const key = row._id;
      if (typeof key === 'string') seen.set(key, seen.has(key) ? -1 : index);
    });
    if ([...seen.values()].includes(-1)) return { ok: false, problem: `${BAD} A key is used twice in "${id}".` };
    keys.set(id, seen);
  }
  for (const [id, rows] of Object.entries(sample.tables)) {
    const table = tables.get(id) as Table;
    const fields = new Map(table.fields.map((f) => [f.id, f]));
    for (const [rowIndex, row] of rows.entries()) {
      for (const [key, v] of Object.entries(row)) {
        if (key === '_id') continue;
        const field = fields.get(key);
        if (!field) return { ok: false, problem: `${BAD} "${id}" has no field "${key}".` };
        if (!fits(field, v)) return { ok: false, problem: `${BAD} A value for "${id}.${key}" does not fit.` };
        if (field.type === 'reference' && typeof v === 'string') {
          const at = keys.get(field.table)?.get(v);
          // a same-table link is made while the table is filled in file order, so it may only point at an earlier row
          if (at === undefined || (field.table === id && at >= rowIndex)) {
            return { ok: false, problem: `${BAD} "${id}.${key}" points at a row that is not there.` };
          }
        }
      }
    }
  }
  return { ok: true, value: sample };
}

/** Table ids with the tables other tables point at first (spec order otherwise). */
export function seedOrder(spec: AppSpec): string[] {
  const ids = new Set(spec.tables.map((t) => t.id));
  const needs = new Map(
    spec.tables.map((t) => [t.id, new Set(t.fields.flatMap((f) => (f.type === 'reference' && f.table !== t.id && ids.has(f.table) ? [f.table] : [])))]),
  );
  const out: string[] = [];
  const done = new Set<string>();
  while (out.length < spec.tables.length) {
    const next = spec.tables.find((t) => !done.has(t.id) && [...(needs.get(t.id) ?? [])].every((n) => done.has(n)));
    // a reference loop the spec checks refuse: keep the rest in spec order rather than spin
    const pick = next ?? spec.tables.find((t) => !done.has(t.id));
    if (!pick) break;
    done.add(pick.id);
    out.push(pick.id);
  }
  return out;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

function dayAt(today: Date, days: number, hours = 0, minutes = 0): Date {
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() + days, hours, minutes, 0, 0);
}

/** "YYYY-MM-DD" in local time, `days` calendar days from `today`. */
export function localDate(today: Date, days: number): string {
  const d = dayAt(today, days);
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The local wall time "HH:MM" on that local day, as an ISO string with Z (the instant it names). */
export function localDateTime(today: Date, days: number, time: string): string {
  const [h, m] = time.split(':').map(Number);
  return dayAt(today, days, h, m).toISOString();
}

/**
 * One row as the app's data route takes it. Tolerant (the app may have changed since): drops `_id` and keys the table no
 * longer has, resolves tokens (a token on a field that is not a date or datetime is dropped), maps a reference through
 * `idOf` (unknown: dropped).
 */
export function resolveRow(
  table: Table,
  row: SampleRow,
  today: Date,
  idOf: (table: string, key: string) => string | undefined,
): Record<string, string | number | boolean | null> {
  const fields = new Map(table.fields.map((f) => [f.id, f]));
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, v] of Object.entries(row)) {
    const field = fields.get(key);
    if (key === '_id' || !field) continue;
    if (isToken(v)) {
      if (field.type === 'date') out[key] = localDate(today, v.$days);
      else if (field.type === 'datetime') out[key] = localDateTime(today, v.$days, v.time ?? '00:00');
      continue;
    }
    if (field.type === 'reference') {
      const id = typeof v === 'string' ? idOf(field.table, v) : undefined;
      if (id !== undefined) out[key] = id;
      continue;
    }
    out[key] = v;
  }
  return out;
}
