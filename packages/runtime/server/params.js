// Query parameters of the generic data API (ADR-004), parsed and revalidated in plain JS: a page source, run-time
// filters, search, sort and paging. Everything that reaches server/db/query.js is an identifier from the compiled
// spec or a bound value; nothing from the request is ever used as SQL text.
import { canonicalDate, canonicalTimestamp } from '../../../server/db/codec.js';
import { op } from '../../../server/db/query.js';

export const MAX_FILTERS = 8;
export const MAX_IN_VALUES = 50;
export const MAX_SEARCH_CHARS = 200;
export const MAX_SORTS = 3;
export const MAX_LIMIT = 200;
export const MAX_OFFSET = 100000;
export const DEFAULT_LIMIT = 50;
export const MAX_STRING_VALUE = 20000;

const OPS = Object.freeze(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in']);
const ORDERING_OPS = new Set(['gt', 'gte', 'lt', 'lte']);
const NO_ORDERING_TYPES = new Set(['boolean', 'select', 'reference', 'id']);
const RUNTIME_COLUMNS = Object.freeze({ id: 'id', created_at: 'datetime', updated_at: 'datetime' });
const ZONE_RE = /(?:Z|z|[+-]\d{2}(?::?\d{2})?)$/;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * The rule of a column a client may filter or sort on: a table field or a runtime column (id, created_at, updated_at).
 * @param {object} compiled
 * @param {string} table
 * @param {unknown} field
 * @returns {{ type: string, options?: string[], label?: string } | null}
 */
export function columnRule(compiled, table, field) {
  if (typeof field !== 'string') return null;
  if (Object.hasOwn(RUNTIME_COLUMNS, field)) return { type: RUNTIME_COLUMNS[field] };
  const rules = compiled?.validators?.[table];
  if (rules && Object.hasOwn(rules, field)) return rules[field];
  return null;
}

/** @returns {string[]} the text and longtext field ids of a table, in spec order */
export function textFieldIds(compiled, table) {
  return Object.entries(compiled?.validators?.[table] ?? {})
    .filter(([, rule]) => rule.type === 'text' || rule.type === 'longtext')
    .map(([id]) => id);
}

const bad = (field, message) => ({ ok: false, field, message });

/**
 * One filter value checked against its column. Returns the canonical value, or a message.
 * @returns {{ ok: true, value: unknown } | { ok: false, message: string }}
 */
function checkValue(rule, field, value) {
  const no = (message) => ({ ok: false, message });
  switch (rule.type) {
    case 'text':
    case 'longtext':
    case 'reference':
    case 'id':
      if (typeof value !== 'string' || value.length > MAX_STRING_VALUE) return no(`The value for ${field} must be text.`);
      return { ok: true, value };
    case 'select':
      if (typeof value !== 'string' || !(rule.options ?? []).includes(value)) {
        return no(`The value for ${field} must be one of: ${(rule.options ?? []).join(', ')}.`);
      }
      return { ok: true, value };
    case 'integer':
      if (!Number.isSafeInteger(value)) return no(`The value for ${field} must be a whole number.`);
      return { ok: true, value };
    case 'real':
      if (typeof value !== 'number' || !Number.isFinite(value)) return no(`The value for ${field} must be a number.`);
      return { ok: true, value };
    case 'boolean':
      if (typeof value !== 'boolean') return no(`The value for ${field} must be true or false.`);
      return { ok: true, value };
    case 'date':
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return no(`The value for ${field} must be a date like 2025-01-31.`);
      try {
        return { ok: true, value: canonicalDate(value, field) };
      } catch {
        return no(`The value for ${field} must be a real date.`);
      }
    case 'datetime':
      if (typeof value !== 'string' || !ZONE_RE.test(value.trim())) return no(`The value for ${field} must be a date and time with a time zone.`);
      try {
        return { ok: true, value: canonicalTimestamp(value, field) };
      } catch {
        return no(`The value for ${field} must be a real date and time.`);
      }
    default:
      return no(`${field} cannot be filtered.`);
  }
}

/**
 * Validates a list of `{ field, op, value }` conditions against a table and builds the query.js where object.
 * Used for run-time filters (strict) and for the Assistant's `match`.
 * @param {object} compiled
 * @param {string} table
 * @param {unknown} list
 * @param {string} [paramName] the query parameter reported in errors
 * @returns {{ ok: true, where: Record<string, unknown> | undefined } | { ok: false, field: string, message: string }}
 */
export function validateFilters(compiled, table, list, paramName = 'filter') {
  if (!Array.isArray(list)) return bad(paramName, 'Filters must be a list.');
  if (list.length > MAX_FILTERS) return bad(paramName, `Use at most ${MAX_FILTERS} filters.`);
  const seen = new Set();
  /** @type {Array<{ field: string, op: string, value: unknown }>} */
  const clean = [];
  for (const entry of list) {
    if (!isPlainObject(entry)) return bad(paramName, 'Each filter must be an object with field, op and value.');
    const { field, op: opName, value } = entry;
    const rule = columnRule(compiled, table, field);
    if (!rule) return bad(paramName, 'A filter names a field this table does not have.');
    if (typeof opName !== 'string' || !OPS.includes(opName)) return bad(paramName, `Filter operator must be one of: ${OPS.join(', ')}.`);
    if (ORDERING_OPS.has(opName) && NO_ORDERING_TYPES.has(rule.type)) {
      return bad(paramName, `Filter operator ${opName} does not apply to the ${field} field.`);
    }
    const key = `${field}\u0000${opName}`;
    if (seen.has(key)) return bad(paramName, `The ${field} field has the ${opName} filter twice.`);
    seen.add(key);
    if (opName === 'in') {
      if (!Array.isArray(value) || value.length > MAX_IN_VALUES) return bad(paramName, `The in filter takes a list of at most ${MAX_IN_VALUES} values.`);
      const values = [];
      for (const v of value) {
        const checked = checkValue(rule, field, v);
        if (!checked.ok) return bad(paramName, checked.message);
        values.push(checked.value);
      }
      clean.push({ field, op: opName, value: values });
      continue;
    }
    if (value === null) {
      if (opName !== 'eq' && opName !== 'ne') return bad(paramName, 'A null value only works with eq and ne.');
      clean.push({ field, op: opName, value: null });
      continue;
    }
    const checked = checkValue(rule, field, value);
    if (!checked.ok) return bad(paramName, checked.message);
    clean.push({ field, op: opName, value: checked.value });
  }
  return { ok: true, where: conditionsToWhere(clean) };
}

/**
 * Conditions to a query.js where object (several operators on one field are merged with op.and). The last
 * duplicate field and operator wins, so a source from the spec can never make this throw.
 * @param {Array<{ field: string, op: string, value: unknown }>} conditions
 * @returns {Record<string, unknown> | undefined}
 */
export function conditionsToWhere(conditions) {
  /** @type {Map<string, Map<string, unknown>>} */
  const byField = new Map();
  for (const c of conditions) {
    if (!byField.has(c.field)) byField.set(c.field, new Map());
    byField.get(c.field).set(c.op, c.value);
  }
  if (byField.size === 0) return undefined;
  const where = {};
  for (const [field, ops] of byField) {
    where[field] = op.and(...[...ops].map(([name, value]) => op[name](value)));
  }
  return where;
}

function parseInteger(raw, name, min, max, fallback) {
  if (raw === undefined) return { ok: true, value: fallback };
  if (typeof raw !== 'string' || !/^\d{1,9}$/.test(raw)) return bad(name, `${name} must be a whole number.`);
  const n = Number(raw);
  if (n < min || n > max) return bad(name, `${name} must be from ${min} to ${max}.`);
  return { ok: true, value: n };
}

function parseSort(compiled, table, raw) {
  if (typeof raw !== 'string') return bad('sort', 'sort must be text like name:asc.');
  const parts = raw.split(',').filter((p) => p.trim() !== '');
  if (parts.length === 0 || parts.length > MAX_SORTS) return bad('sort', `Sort by 1 to ${MAX_SORTS} fields.`);
  const orderBy = [];
  for (const part of parts) {
    const [field, dir = 'asc', extra] = part.trim().split(':');
    if (extra !== undefined || (dir !== 'asc' && dir !== 'desc')) return bad('sort', 'Sort looks like field:asc or field:desc.');
    const rule = columnRule(compiled, table, field);
    if (!rule) return bad('sort', 'Sort names a field this table does not have.');
    orderBy.push({ field, dir });
  }
  return { ok: true, orderBy };
}

const orderEntry = (compiled, table, { field, dir }) => {
  const type = columnRule(compiled, table, field)?.type;
  const nocase = type === 'text' || type === 'longtext' || type === 'select';
  return { column: field, dir, ...(nocase ? { nocase: true } : {}) };
};

/**
 * Parses the list and stats query string of GET /api/data/:table.
 * @param {object} compiled the compiled spec
 * @param {object | null} spec the normalized spec (pages and sources)
 * @param {string} table
 * @param {Record<string, unknown>} query req.query
 * @param {{ stats?: boolean }} [opts] stats: sort, limit and offset are ignored
 * @returns {{ ok: true, where: object | undefined, search: { term: string, columns: string[] } | undefined,
 *   orderBy: object[], limit: number, offset: number } | { ok: false, field: string, message: string }}
 */
export function parseDataQuery(compiled, spec, table, query, { stats = false } = {}) {
  const q = isPlainObject(query) ? query : {};
  let sourceWhere;
  let sourceOrder = [];
  let sourceLimit = DEFAULT_LIMIT;

  const hasPage = q.page !== undefined;
  const hasSource = q.source !== undefined;
  if (hasPage !== hasSource) return bad(hasPage ? 'source' : 'page', 'Send page and source together.');
  if (hasPage) {
    if (typeof q.page !== 'string' || typeof q.source !== 'string') return bad('source', 'page and source must be text.');
    const page = (spec?.pages ?? []).find((p) => p.id === q.page);
    if (!page) return bad('page', 'That page does not exist.');
    const source = (page.sources ?? []).find((s) => s.id === q.source);
    if (!source || (source.mode ?? 'list') !== 'list' || source.table !== table) {
      return bad('source', 'That source is not a list of this table.');
    }
    sourceWhere = conditionsToWhere(source.where ?? []);
    sourceOrder = (source.orderBy ?? []).filter((o) => columnRule(compiled, table, o.field));
    if (Number.isSafeInteger(source.limit) && source.limit >= 1) sourceLimit = Math.min(source.limit, MAX_LIMIT);
  }

  let runtimeWhere;
  if (q.filter !== undefined) {
    if (typeof q.filter !== 'string' || q.filter.length > 20000) return bad('filter', 'filter must be JSON text.');
    let list;
    try {
      list = JSON.parse(q.filter);
    } catch {
      return bad('filter', 'filter must be valid JSON.');
    }
    const checked = validateFilters(compiled, table, list, 'filter');
    if (!checked.ok) return checked;
    runtimeWhere = checked.where;
  }
  // Run-time conditions narrow the source: they are one alternative inside it, so they may repeat a source field and operator.
  let where = sourceWhere;
  if (runtimeWhere) where = { ...(sourceWhere ?? {}), $or: [runtimeWhere] };

  let search;
  if (q.search !== undefined) {
    if (typeof q.search !== 'string' || q.search.length > MAX_SEARCH_CHARS) return bad('search', `search must be text of at most ${MAX_SEARCH_CHARS} characters.`);
    const all = textFieldIds(compiled, table);
    let columns = all;
    if (q.searchFields !== undefined) {
      if (typeof q.searchFields !== 'string') return bad('searchFields', 'searchFields must be a comma separated list.');
      columns = [...new Set(q.searchFields.split(',').map((f) => f.trim()).filter(Boolean))];
      if (columns.some((c) => !all.includes(c))) return bad('searchFields', 'searchFields must name text fields of this table.');
    }
    if (columns.length === 0) return bad(q.searchFields !== undefined ? 'searchFields' : 'search', 'This table has no text field to search.');
    if (q.search.trim() !== '') search = { term: q.search, columns };
  }

  if (stats) return { ok: true, where, search, orderBy: [], limit: DEFAULT_LIMIT, offset: 0 };

  let order = sourceOrder.map((o) => ({ field: o.field, dir: o.dir === 'desc' ? 'desc' : 'asc' }));
  if (q.sort !== undefined) {
    const parsed = parseSort(compiled, table, q.sort);
    if (!parsed.ok) return parsed;
    order = parsed.orderBy;
  }
  if (order.length === 0) order = [{ field: 'created_at', dir: 'desc' }];
  if (!order.some((o) => o.field === 'id')) order = [...order, { field: 'id', dir: 'asc' }];

  const limit = parseInteger(q.limit, 'limit', 1, MAX_LIMIT, sourceLimit);
  if (!limit.ok) return limit;
  const offset = parseInteger(q.offset, 'offset', 0, MAX_OFFSET, 0);
  if (!offset.ok) return offset;

  return {
    ok: true,
    where,
    search,
    orderBy: order.map((o) => orderEntry(compiled, table, o)),
    limit: limit.value,
    offset: offset.value,
  };
}

const GROUP_TYPES = new Set(['select', 'boolean', 'date', 'datetime', 'reference']);
const MEASURES = new Set(['count', 'sum', 'avg']);
const BUCKETS = new Set(['day', 'month']);

/**
 * The group-by part of the stats query string. Only meaningful when `groupBy` is present; the field names are checked
 * against the compiled table, never used as SQL text.
 * @param {object} compiled
 * @param {string} table
 * @param {Record<string, unknown>} query req.query
 * @returns {{ ok: true, groupBy: string, type: string, measure: string, field?: string, bucket?: string }
 *   | { ok: false, field: string, message: string }}
 */
export function parseGroupQuery(compiled, table, query) {
  const { groupBy, measure = 'count', field, bucket } = isPlainObject(query) ? query : {};
  const rule = typeof groupBy === 'string' && groupBy !== 'id' ? columnRule(compiled, table, groupBy) : null;
  if (!rule || !GROUP_TYPES.has(rule.type)) return bad('groupBy', 'groupBy must name a select, yes/no, date or reference field of this table.');
  if (typeof measure !== 'string' || !MEASURES.has(measure)) return bad('measure', 'measure must be count, sum or avg.');
  let measureField;
  if (measure !== 'count') {
    const fieldRule = typeof field === 'string' ? columnRule(compiled, table, field) : null;
    if (!fieldRule || (fieldRule.type !== 'integer' && fieldRule.type !== 'real')) return bad('field', 'field must be a number field of this table.');
    measureField = field;
  } else if (field !== undefined && (typeof field !== 'string' || columnRule(compiled, table, field) === null)) {
    return bad('field', 'field must name a field of this table.');
  }
  const dated = rule.type === 'date' || rule.type === 'datetime';
  if (bucket !== undefined && (!dated || typeof bucket !== 'string' || !BUCKETS.has(bucket))) {
    return bad('bucket', 'bucket must be day or month and only works with a date field.');
  }
  return { ok: true, groupBy, type: rule.type, measure, ...(measureField ? { field: measureField } : {}), ...(dated ? { bucket: bucket ?? 'month' } : {}) };
}
