// The AppSpec compiler (ADR-004): pure JS, no zod, no I/O, deterministic (same spec in, byte-identical output out).
// compileSpec turns a spec into what the kit's data layer expects; planMigration (plan.js) diffs two specs.
import { normalizeSpec, titleFieldOf } from './normalize.js';
import { TEXT_MAX, canonicalDatetime, createSqlText, isCanonicalDate } from './sql.js';

export { normalizeSpec } from './normalize.js';
export { TEXT_MAX } from './sql.js';
export { planMigration } from './plan.js';

/** @typedef {'uuid'|'text'|'date'|'timestamptz'|'numeric'|'integer'|'real'|'boolean'|'jsonb'|'text[]'} ColType */
/** @typedef {{ path: string, code: string, message: string }} SpecIssue */

/**
 * @typedef {object} CompiledSpec
 * @property {Record<string, { primaryKey: 'id', autoNow: ['created_at', 'updated_at'], columns: Record<string, ColType> }>} tables
 *   TABLES entries; column types text (text, longtext, select), integer, real, boolean, date, timestamptz, uuid
 * @property {string[]} importOrder spec table ids, parents before children
 * @property {Array<{ table: string, column: string, references: { table: string, column: 'id' }, onDelete: 'set null' | 'restrict' }>} foreignKeys
 *   one per reference field; 'set null' for optional, 'restrict' for required references
 * @property {Array<{ id: string, label: string, group: string, primaryKey: 'id', columns: { name: string, type: ColType }[] }>} dataTables
 *   one DATA_TABLES def per table, `group` = the app name
 * @property {Record<string, Record<string, object>>} validators per table, the field rules the generic data API checks before a write
 * @property {Array<{ id: string, default: false, noun: string, plural: boolean }>} categories one cloud category per table (id = table id)
 * @property {Record<string, string>} titleFields per table, the field shown as the record title (`id` when none)
 * @property {string} createSql the full schema, for a first build and for preview scratch databases
 */

export const FIELD_COLTYPE = Object.freeze({
  text: 'text',
  longtext: 'text',
  select: 'text',
  integer: 'integer',
  real: 'real',
  boolean: 'boolean',
  date: 'date',
  datetime: 'timestamptz',
  reference: 'uuid',
});

const ID_RE = /^[a-z][a-z0-9_]{0,30}$/;
const MAX_TABLES = 30;
const MAX_FIELDS = 60;
const RESERVED_TABLES = new Set([
  'items', 'app_state', 'assistant_conversations', 'assistant_messages', 'app_secrets', 'audit_log',
  'schema_version', 'app_schema_version', 'apps', 'builds', 'notes', 'memory', 'mixed',
]);
const RESERVED_PREFIXES = ['sqlite_', 'app_', 'assistant_', 'studio_'];
const RESERVED_COLUMNS = new Set(['id', 'created_at', 'updated_at', 'rowid', 'oid']);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Kahn's algorithm: repeatedly take, in spec order, the first table whose references are all placed.
 * @param {object[]} tables
 * @returns {string[] | null} null when the references loop (or point at an unknown table)
 */
export function computeImportOrder(tables) {
  const placed = new Set();
  const order = [];
  const remaining = [...tables];
  while (remaining.length) {
    const at = remaining.findIndex((t) =>
      t.fields.every((f) => f.type !== 'reference' || placed.has(f.table)),
    );
    if (at === -1) return null;
    const [t] = remaining.splice(at, 1);
    placed.add(t.id);
    order.push(t.id);
  }
  return order;
}

function defaultProblem(table, field) {
  const d = field.default;
  if (d === undefined) return null;
  const where = `Field "${field.id}" of table "${table.id}"`;
  switch (field.type) {
    case 'text':
    case 'longtext':
      if (typeof d !== 'string') return `${where} has a default that is not text.`;
      if (d.includes('\u0000')) return `${where} has a default with a NUL character, which cannot be stored.`;
      return d.length <= TEXT_MAX[field.type] ? null : `${where} has a default longer than ${TEXT_MAX[field.type]} characters.`;
    case 'select':
      if (typeof d !== 'string') return `${where} has a default that is not text.`;
      return field.options.includes(d) ? null : `${where} has a default that is not one of its options.`;
    case 'date':
      if (typeof d !== 'string') return `${where} has a default that is not text.`;
      return isCanonicalDate(d) ? null : `${where} has a default that is not a real date like 2025-01-31.`;
    case 'integer':
      return Number.isSafeInteger(d) ? null : `${where} has a default that is not a whole number.`;
    case 'real':
      return typeof d === 'number' && Number.isFinite(d) ? null : `${where} has a default that is not a number.`;
    case 'boolean':
      return typeof d === 'boolean' ? null : `${where} has a default that is not true or false.`;
    case 'datetime':
      return canonicalDatetime(d) !== null
        ? null
        : `${where} has a default that is not a real date and time with a time zone.`;
    default:
      return `${where} cannot have a default.`;
  }
}

function fieldProblem(table, field, ids, seen) {
  if (!isObject(field)) return `Table "${table.id}" has a field that is not an object.`;
  if (typeof field.id !== 'string' || !ID_RE.test(field.id)) return `Table "${table.id}" has a field id that is not valid.`;
  if (RESERVED_COLUMNS.has(field.id)) return `Field id "${field.id}" in table "${table.id}" is reserved.`;
  if (seen.has(field.id)) return `Table "${table.id}" has the field id "${field.id}" twice.`;
  seen.add(field.id);
  if (typeof field.type !== 'string' || !Object.hasOwn(FIELD_COLTYPE, field.type)) {
    return `Field "${field.id}" of table "${table.id}" has an unknown type.`;
  }
  if (field.type === 'select') {
    const ok = Array.isArray(field.options) && field.options.length > 0 && field.options.every((o) => typeof o === 'string');
    if (!ok) return `Field "${field.id}" of table "${table.id}" needs a list of options.`;
    // The options are written into a CHECK clause; SQLite cuts an SQL literal at a NUL.
    if (field.options.some((o) => o.includes('\u0000'))) return `Field "${field.id}" of table "${table.id}" has an option with a NUL character, which cannot be stored.`;
  }
  if (field.type === 'reference') {
    if (typeof field.table !== 'string' || !ids.has(field.table)) {
      return `Field "${field.id}" of table "${table.id}" refers to a table that is not in the app.`;
    }
  }
  return defaultProblem(table, field);
}

function tablesProblem(tables) {
  if (!Array.isArray(tables)) return 'The tables must be a list.';
  if (tables.length > MAX_TABLES) return `An app can have at most ${MAX_TABLES} tables.`;
  const ids = new Set();
  for (const table of tables) {
    if (!isObject(table)) return 'A table is not an object.';
    const id = table.id;
    if (typeof id !== 'string' || !ID_RE.test(id)) return 'A table id is not valid.';
    if (ids.has(id)) return `The table id "${id}" is used twice.`;
    if (RESERVED_TABLES.has(id) || RESERVED_PREFIXES.some((p) => id.startsWith(p))) {
      return `The table id "${id}" is reserved.`;
    }
    ids.add(id);
  }
  for (const table of tables) {
    if (!Array.isArray(table.fields) || table.fields.length < 1 || table.fields.length > MAX_FIELDS) {
      return `Table "${table.id}" needs between 1 and ${MAX_FIELDS} fields.`;
    }
    const seen = new Set();
    for (const field of table.fields) {
      const problem = fieldProblem(table, field, ids, seen);
      if (problem) return problem;
    }
  }
  if (computeImportOrder(tables) === null) return 'Tables refer to each other in a loop.';
  return null;
}

function pagesProblem(pages, tableIds) {
  if (!Array.isArray(pages) || pages.length === 0) return 'The app needs at least one page.';
  for (const page of pages) {
    if (!isObject(page) || typeof page.id !== 'string' || typeof page.route !== 'string') {
      return 'A page needs an id and a route.';
    }
    if (!Array.isArray(page.sources)) return `Page "${page.id}" has sources that are not a list.`;
    for (const source of page.sources) {
      if (!isObject(source) || typeof source.table !== 'string' || !tableIds.has(source.table)) {
        return `A source of page "${page.id}" uses a table that is not in the app.`;
      }
    }
  }
  return null;
}

/**
 * First structural problem as one sentence, or null. Minimal check, no zod (ADR-006): it guarantees SQL safety and a
 * compilable spec; full validation is Studio's job.
 * @param {unknown} spec
 * @returns {string | null}
 */
export function checkSpecShape(spec) {
  const s = normalizeSpec(spec);
  if (!isObject(s)) return 'The spec is not an object.';
  if (s.specVersion !== 1) return 'The spec version must be 1.';
  if (!isObject(s.app) || typeof s.app.name !== 'string') return 'The app needs a name.';
  const tableProblem = tablesProblem(s.tables);
  if (tableProblem) return tableProblem;
  return pagesProblem(s.pages, new Set(s.tables.map((t) => t.id)));
}

function fieldRule(field) {
  const rule = { type: field.type, label: field.label, required: field.required === true };
  if (field.type === 'text' || field.type === 'longtext') rule.maxLength = TEXT_MAX[field.type];
  if (field.type === 'select') rule.options = [...field.options];
  if (field.type === 'reference') rule.table = field.table;
  if (field.default !== undefined && field.default !== null) rule.default = field.default;
  return rule;
}

/**
 * Compiles an AppSpec into everything the kit's data layer expects.
 * @param {object} spec an AppSpec (normalized here)
 * @returns {CompiledSpec}
 * @throws {Error} `invalid_spec: <problem>` when the spec has a structural problem
 */
export function compileSpec(spec) {
  const s = normalizeSpec(spec);
  const problem = checkSpecShape(s);
  if (problem) throw new Error(`invalid_spec: ${problem}`);

  const byId = new Map(s.tables.map((t) => [t.id, t]));
  const importOrder = computeImportOrder(s.tables);

  const tables = {};
  const dataTables = [];
  const validators = {};
  const categories = [];
  const titleFields = {};
  for (const t of s.tables) {
    const columns = { id: 'uuid' };
    for (const f of t.fields) columns[f.id] = FIELD_COLTYPE[f.type];
    columns.created_at = 'timestamptz';
    columns.updated_at = 'timestamptz';
    tables[t.id] = { primaryKey: 'id', autoNow: ['created_at', 'updated_at'], columns };
    dataTables.push({
      id: t.id,
      label: t.label,
      group: s.app.name,
      primaryKey: 'id',
      columns: Object.entries(columns).map(([name, type]) => ({ name, type })),
    });
    validators[t.id] = Object.fromEntries(t.fields.map((f) => [f.id, fieldRule(f)]));
    categories.push({ id: t.id, default: false, noun: String(t.label).toLowerCase(), plural: true });
    titleFields[t.id] = titleFieldOf(t);
  }

  const foreignKeys = [];
  for (const id of importOrder) {
    for (const f of byId.get(id).fields) {
      if (f.type !== 'reference') continue;
      foreignKeys.push({
        table: id,
        column: f.id,
        references: { table: f.table, column: 'id' },
        onDelete: f.required ? 'restrict' : 'set null',
      });
    }
  }

  return {
    tables,
    importOrder,
    foreignKeys,
    dataTables,
    validators,
    categories,
    titleFields,
    createSql: createSqlText(importOrder.map((id) => byId.get(id))),
  };
}
