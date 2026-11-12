// Pure helpers of the data browser: which columns a table shows, which filter operators fit a field type, how a
// filter draft becomes a data API condition, how a header click moves the sort.
import { titleFieldOf } from '../normalizeSpec.js';

export const PAGE_SIZE = 50;

const RUNTIME_COLUMNS = [
  { id: 'created_at', label: 'Created', type: 'datetime' },
  { id: 'updated_at', label: 'Updated', type: 'datetime' },
];

const ORDERED = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'];
const OPS_BY_TYPE = {
  text: ['eq', 'ne'],
  longtext: ['eq', 'ne'],
  select: ['eq', 'ne'],
  boolean: ['eq', 'ne'],
  reference: ['eq', 'ne'],
  integer: ORDERED,
  real: ORDERED,
  date: ORDERED,
  datetime: ORDERED,
};

export const OP_LABELS = {
  eq: 'is',
  ne: 'is not',
  gt: 'is more than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
};

/** Fields of a spec table as shown in the browser: its own fields, then the two runtime columns. */
export function columnsOf(table) {
  return [...table.fields.map((f) => ({ id: f.id, label: f.label, type: f.type, options: f.options })), ...RUNTIME_COLUMNS];
}

/** Operators that make sense for a field type. */
export const opsFor = (type) => OPS_BY_TYPE[type] ?? ['eq', 'ne'];

/** Fields the search box looks in: the text and longtext ones. */
export const searchFieldsOf = (table) => table.fields.filter((f) => f.type === 'text' || f.type === 'longtext').map((f) => f.id);

/** The field that names a row (the shared titleFieldOf rule), or null when the table has none and falls back to the id. */
export function namedTitleField(table) {
  const field = titleFieldOf(table);
  return field === 'id' ? null : field;
}

/**
 * One filter draft to a data API condition, or null when the draft is empty or its value does not fit the type.
 * @param {{ field: string, op: string, value: string }} draft
 * @param {{ id: string, type: string }} column
 * @returns {{ field: string, op: string, value: string | number | boolean } | null}
 */
export function conditionFromDraft(draft, column) {
  const raw = draft.value;
  if (!column || raw === '' || raw === undefined) return null;
  const make = (value) => ({ field: draft.field, op: draft.op, value });
  switch (column.type) {
    case 'integer': {
      const n = Number(raw);
      return Number.isSafeInteger(n) ? make(n) : null;
    }
    case 'real': {
      const n = Number(raw);
      return Number.isFinite(n) ? make(n) : null;
    }
    case 'boolean':
      return raw === 'true' || raw === 'false' ? make(raw === 'true') : null;
    case 'datetime': {
      const t = new Date(raw);
      return Number.isNaN(t.getTime()) ? null : make(t.toISOString());
    }
    default:
      return make(String(raw));
  }
}

/** Header click: ascending, then descending, then back to the server's default order. */
export function nextSort(current, field) {
  if (current?.field !== field) return { field, dir: 'asc' };
  return current.dir === 'asc' ? { field, dir: 'desc' } : null;
}

/** The text a cell shows for a reference: the title of the row it points to, else the id. */
export function referenceText(titles, target, id) {
  if (id === null || id === undefined || id === '') return '';
  return titles?.[target]?.[id] ?? String(id);
}
