// SQL text for the app track (ADR-004). Pure and deterministic: LF only, no timestamps. Identifiers come only from a
// spec that passed checkSpecShape (ids match ^[a-z][a-z0-9_]{0,30}$); they are still always double-quoted.

export const TEXT_MAX = Object.freeze({ text: 500, longtext: 20000 });

const SQL_TYPE = Object.freeze({
  text: 'TEXT',
  longtext: 'TEXT',
  select: 'TEXT',
  date: 'TEXT',
  datetime: 'TEXT',
  reference: 'TEXT',
  integer: 'INTEGER',
  boolean: 'INTEGER',
  real: 'REAL',
});

// Mirrors server/db/codec.js canonicalTimestamp/canonicalDate (kept local so the spec compiler stays pure). The zone is
// required, so the result never depends on the host time zone.
const TS_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?\s*(Z|z|[+-]\d{2}(?::?\d{2})?)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True for a canonical, real calendar date 'YYYY-MM-DD'.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isCanonicalDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * UTC ISO timestamp of a date and time that carries an explicit zone, or null when it has no zone or is not real.
 * @param {unknown} value
 * @returns {string | null}
 */
export function canonicalDatetime(value) {
  if (typeof value !== 'string') return null;
  const m = TS_RE.exec(value.trim());
  if (!m) return null;
  const [, date, hh, mi, ss = '00', frac = '', zoneRaw] = m;
  if (!isCanonicalDate(date)) return null;
  let zone = 'Z';
  if (zoneRaw.toUpperCase() !== 'Z') {
    const digits = zoneRaw.slice(1).replace(':', '');
    zone = `${zoneRaw[0]}${digits.slice(0, 2)}:${digits.length > 2 ? digits.slice(2, 4) : '00'}`;
  }
  const t = Date.parse(`${date}T${hh}:${mi}:${ss}.${(frac + '000').slice(0, 3)}${zone}`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** @param {string} id */
export const quoteId = (id) => `"${String(id).replaceAll('"', '""')}"`;
/** @param {string} text */
export const quoteText = (text) => `'${String(text).replaceAll("'", "''")}'`;

/**
 * The DEFAULT literal of a field, or null when it has no default.
 * @param {{ type: string, default?: unknown }} field
 * @returns {string | null}
 */
export function defaultLiteral(field) {
  const value = field.default;
  if (value === undefined || value === null) return null;
  switch (field.type) {
    case 'boolean':
      return value ? '1' : '0';
    case 'integer':
    case 'real':
      return String(value);
    case 'datetime':
      return quoteText(canonicalDatetime(value) ?? String(value));
    default:
      return quoteText(String(value));
  }
}

function checkExpression(field) {
  const col = quoteId(field.id);
  switch (field.type) {
    case 'text':
    case 'longtext':
      return `length(${col}) <= ${TEXT_MAX[field.type]}`;
    case 'select':
      return `${col} IS NULL OR ${col} IN (${field.options.map(quoteText).join(', ')})`;
    case 'boolean':
      return `${col} IN (0, 1)`;
    case 'date':
      return `${col} IS NULL OR ${col} = date(${col})`;
    case 'datetime':
      return `${col} IS NULL OR ${col} = strftime('%Y-%m-%dT%H:%M:%fZ', ${col})`;
    default:
      return null;
  }
}

/**
 * One column definition without indent or trailing comma.
 * @param {object} field a normalized spec field
 * @returns {string}
 */
export function columnLine(field) {
  let line = `${quoteId(field.id)} ${SQL_TYPE[field.type]}`;
  if (field.required) line += ' NOT NULL';
  const def = defaultLiteral(field);
  if (def !== null) line += ` DEFAULT ${def}`;
  if (field.type === 'reference') {
    line += ` REFERENCES ${quoteId(field.table)} ("id") ON DELETE ${field.required ? 'RESTRICT' : 'SET NULL'}`;
  }
  const check = checkExpression(field);
  if (check !== null) line += ` CHECK (${check})`;
  return line;
}

/**
 * CREATE TABLE statement (no indexes).
 * @param {{ id: string, fields: object[] }} table
 * @param {string} [name] table name to create (the rebuild uses "<id>:new")
 * @returns {string}
 */
export function createTableStatement(table, name = table.id) {
  const lines = [
    `${quoteId('id')} TEXT PRIMARY KEY NOT NULL`,
    ...table.fields.map(columnLine),
    `${quoteId('created_at')} TEXT NOT NULL`,
    `${quoteId('updated_at')} TEXT NOT NULL`,
  ];
  return `CREATE TABLE ${quoteId(name)} (\n${lines.map((l) => `  ${l}`).join(',\n')}\n) STRICT;`;
}

/**
 * @param {string} tableId
 * @param {string} fieldId
 * @returns {string}
 */
export const createIndexStatement = (tableId, fieldId) =>
  `CREATE INDEX ${quoteId(`idx:${tableId}:${fieldId}`)} ON ${quoteId(tableId)} (${quoteId(fieldId)});`;

/**
 * @param {{ id: string, fields: object[] }} table
 * @returns {string[]} one CREATE INDEX per reference field, field order
 */
export const indexStatements = (table) =>
  table.fields.filter((f) => f.type === 'reference').map((f) => createIndexStatement(table.id, f.id));

/**
 * CREATE TABLE plus its indexes.
 * @param {{ id: string, fields: object[] }} table
 * @returns {string}
 */
export const tableBlock = (table) => [createTableStatement(table), ...indexStatements(table)].join('\n');

/**
 * A whole migration file: 3 line header, blocks separated by an empty line, one final newline.
 * @param {'create' | 'alter' | 'rebuild'} kind
 * @param {string[]} blocks
 * @returns {string}
 */
export function fileText(kind, blocks) {
  const head = `-- app-migration: ${kind}\n-- Generated from the app spec by Local App Studio. Do not edit.\n`;
  return blocks.length ? `${head}\n${blocks.join('\n\n')}\n` : head;
}

/**
 * The full create script for tables already in import order.
 * @param {Array<{ id: string, fields: object[] }>} tablesInOrder
 * @returns {string}
 */
export const createSqlText = (tablesInOrder) => fileText('create', tablesInOrder.map(tableBlock));
