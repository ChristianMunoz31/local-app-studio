// The only query surface for app code. Identifiers come from the TABLES allowlist and are always
// double-quoted; every value is bound as a positional parameter.
import { performance } from 'node:perf_hooks';
import { getDb, withTransaction } from './index.js';
import { DbError, toDbError } from './errors.js';
import { encodeRow, decodeRow, encodeValue } from './codec.js';
import { getTable } from './tables.js';
import { SLOW_QUERY_MS, isDebug, log } from '../log.js';

const OPS = Object.freeze({ eq: '=', ne: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' });

const q = (ident) => `"${ident}"`;

function colType(def, table, column) {
  if (typeof column !== 'string' || !Object.hasOwn(def.columns, column)) {
    throw new DbError('unknown_column', `Unknown column for ${table}`, { column: String(column) });
  }
  return def.columns[column];
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);

// Operator conditions can only be built through `op`. A plain object from a request body, query string
// (Express parses `?a[gte]=x` into an object) or LLM tool args is never an operator map: it is rejected.
const OP_BRAND = Symbol('app.op');

function makeOp(ops) {
  return Object.freeze({ [OP_BRAND]: true, ops: Object.freeze({ ...ops }) });
}

const isOp = (v) => v !== null && typeof v === 'object' && v[OP_BRAND] === true;

export const op = Object.freeze({
  eq: (v) => makeOp({ eq: v }),
  ne: (v) => makeOp({ ne: v }),
  gt: (v) => makeOp({ gt: v }),
  gte: (v) => makeOp({ gte: v }),
  lt: (v) => makeOp({ lt: v }),
  lte: (v) => makeOp({ lte: v }),
  in: (values) => makeOp({ in: values }),
  /** Combines several operators on one column, e.g. op.and(op.gte(a), op.lt(b)). */
  and: (...conds) => {
    const merged = {};
    for (const c of conds) {
      if (!isOp(c)) throw new DbError('invalid_query', 'op.and requires operator conditions');
      for (const key of Object.keys(c.ops)) {
        if (Object.hasOwn(merged, key)) throw new DbError('invalid_query', 'op.and received a duplicate operator');
      }
      Object.assign(merged, c.ops);
    }
    return makeOp(merged);
  },
});

/** Ids must be strings or finite numbers: never objects/arrays. */
export function assertId(id, what = 'id') {
  if (typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id))) return id;
  throw new DbError('invalid_query', `${what} must be a string or number`);
}

function assertScalar(v, column) {
  if (v !== null && typeof v === 'object' && !(v instanceof Date)) {
    throw new DbError('invalid_query', 'Condition values must be scalars', { column });
  }
  return v;
}

function buildCond(def, table, column, cond, params) {
  const type = colType(def, table, column);
  const col = q(column);
  if (cond === undefined) throw new DbError('invalid_query', 'Undefined condition value', { column });
  if (!isOp(cond)) {
    if (cond === null) return `${col} IS NULL`;
    assertScalar(cond, column);
    params.push(encodeValue(type, cond, column));
    return `${col} = ?`;
  }
  const parts = [];
  for (const [name, operand] of Object.entries(cond.ops)) {
    if (name === 'in') {
      if (!Array.isArray(operand)) throw new DbError('invalid_query', 'in requires an array', { column });
      if (operand.length === 0) {
        parts.push('0');
        continue;
      }
      parts.push(`${col} IN (${operand.map(() => '?').join(', ')})`);
      for (const v of operand) params.push(encodeValue(type, assertScalar(v, column), column));
      continue;
    }
    if (!Object.hasOwn(OPS, name)) throw new DbError('invalid_query', 'Unknown operator', { column });
    if (operand === undefined) throw new DbError('invalid_query', 'Undefined condition value', { column });
    if (operand === null) {
      if (name === 'eq') parts.push(`${col} IS NULL`);
      else if (name === 'ne') parts.push(`${col} IS NOT NULL`);
      else throw new DbError('invalid_query', 'Null is only valid with eq/ne', { column });
      continue;
    }
    const bound = encodeValue(type, assertScalar(operand, column), column);
    params.push(bound);
    // A yes or no left empty is stored as NULL and reads as No: "is No" and "is not Yes" must keep that row.
    const nullIsNo = type === 'boolean' && ((name === 'eq' && bound === 0) || (name === 'ne' && bound === 1));
    parts.push(nullIsNo ? `(${col} ${OPS[name]} ? OR ${col} IS NULL)` : `${col} ${OPS[name]} ?`);
  }
  if (parts.length === 0) throw new DbError('invalid_query', 'Empty condition', { column });
  return parts.length === 1 ? parts[0] : `(${parts.join(' AND ')})`;
}

/** Returns a SQL fragment ('' when where is empty) and pushes bound values onto params. */
function buildWhere(def, table, where, params) {
  if (where === undefined || where === null) return '';
  if (!isPlainObject(where)) throw new DbError('invalid_query', 'where must be an object');
  const parts = [];
  for (const [key, cond] of Object.entries(where)) {
    if (key === '$or') {
      if (!Array.isArray(cond)) throw new DbError('invalid_query', '$or requires an array');
      if (cond.length === 0) {
        parts.push('0');
        continue;
      }
      const alts = cond.map((w) => {
        const sql = buildWhere(def, table, w, params);
        return sql === '' ? '1' : `(${sql})`;
      });
      parts.push(`( ${alts.join(' OR ')} )`);
      continue;
    }
    parts.push(buildCond(def, table, key, cond, params));
  }
  return parts.join(' AND ');
}

function buildSearch(def, table, search, params) {
  if (!search || !Array.isArray(search.columns)) return '';
  const term = typeof search.term === 'string' ? search.term : '';
  if (term.trim() === '' || search.columns.length === 0) return '';
  const parts = search.columns.map((c) => {
    colType(def, table, c);
    params.push(term);
    return `app_icontains(${q(c)}, ?)`;
  });
  return `(${parts.join(' OR ')})`;
}

function whereClause(def, table, where, search, params) {
  const parts = [buildWhere(def, table, where, params), buildSearch(def, table, search, params)].filter(Boolean);
  return parts.length ? ` WHERE ${parts.join(' AND ')}` : '';
}

function buildOrder(def, table, orderBy) {
  if (orderBy === undefined || orderBy === null) return '';
  if (!Array.isArray(orderBy)) throw new DbError('invalid_query', 'orderBy must be an array');
  if (orderBy.length === 0) return '';
  const parts = orderBy.map((o) => {
    if (!isPlainObject(o)) throw new DbError('invalid_query', 'Invalid orderBy entry');
    const dir = o.dir === undefined ? 'asc' : o.dir;
    if (dir !== 'asc' && dir !== 'desc') throw new DbError('invalid_query', 'Invalid order direction');
    if (o.column === 'rowid') return `rowid ${dir === 'asc' ? 'ASC' : 'DESC'}`;
    colType(def, table, o.column);
    const nulls = o.nulls === undefined ? (dir === 'asc' ? 'last' : 'first') : o.nulls;
    if (nulls !== 'first' && nulls !== 'last') throw new DbError('invalid_query', 'Invalid nulls placement');
    const collate = o.nocase ? ' COLLATE NOCASE' : '';
    return `${q(o.column)}${collate} ${dir === 'asc' ? 'ASC' : 'DESC'} NULLS ${nulls === 'first' ? 'FIRST' : 'LAST'}`;
  });
  return ` ORDER BY ${parts.join(', ')}`;
}

function nonNegInt(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new DbError('invalid_query', `${name} must be a non-negative integer`);
  return value;
}

function buildLimit(limit, offset, params) {
  const hasLimit = limit !== undefined && limit !== null;
  const hasOffset = offset !== undefined && offset !== null && offset !== 0;
  if (!hasLimit && !hasOffset) return '';
  if (hasLimit) {
    params.push(nonNegInt(limit, 'limit'));
    if (!hasOffset) return ' LIMIT ?';
    params.push(nonNegInt(offset, 'offset'));
    return ' LIMIT ? OFFSET ?';
  }
  params.push(nonNegInt(offset, 'offset'));
  return ' LIMIT -1 OFFSET ?';
}

function selectList(def, table, columns) {
  if (columns === '*' || columns === undefined) return Object.keys(def.columns).map(q).join(', ');
  if (!Array.isArray(columns) || columns.length === 0) throw new DbError('invalid_query', 'columns must be a non-empty array');
  for (const c of columns) colType(def, table, c);
  return columns.map(q).join(', ');
}

const allColumns = (def) => Object.keys(def.columns).map(q).join(', ');

// In debug mode (APP_DEBUG=1 or the Diagnostics toggle) every statement is timed; one over SLOW_QUERY_MS logs db.slow_query
// with the operation and table only, never SQL text or values.
function run(fn, opName, table) {
  const timed = isDebug();
  const t0 = timed ? performance.now() : 0;
  try {
    return fn();
  } catch (e) {
    throw toDbError(e);
  } finally {
    if (timed) {
      const durationMs = Math.round((performance.now() - t0) * 10) / 10;
      if (durationMs > SLOW_QUERY_MS) log('warn', 'db.slow_query', { op: opName, table, durationMs });
    }
  }
}

/** @returns {object[]} */
export function select(table, { columns = '*', where, search, orderBy = [], limit, offset = 0, db } = {}) {
  const def = getTable(table);
  const params = [];
  const list = selectList(def, table, columns);
  const w = whereClause(def, table, where, search, params);
  const order = buildOrder(def, table, orderBy);
  const lim = buildLimit(limit, offset, params);
  const sql = `SELECT ${list} FROM ${q(table)}${w}${order}${lim}`;
  return run(() =>
    (db ?? getDb())
      .prepare(sql)
      .all(...params)
      .map((r) => decodeRow(table, r)),
    'select',
    table,
  );
}

/** @returns {object | null} */
export function selectOne(table, { columns, where, orderBy, db } = {}) {
  return select(table, { columns, where, orderBy, limit: 1, db })[0] ?? null;
}

/** @returns {number} */
export function count(table, { where, search, db } = {}) {
  const def = getTable(table);
  const params = [];
  const w = whereClause(def, table, where, search, params);
  const sql = `SELECT COUNT(*) AS n FROM ${q(table)}${w}`;
  return run(() => Number((db ?? getDb()).prepare(sql).get(...params).n), 'count', table);
}

const GROUP_KEY_TYPES = new Set(['text', 'boolean', 'date', 'timestamptz', 'uuid']);
const BUCKET_LENGTH = Object.freeze({ month: 7, day: 10 });
const MAX_GROUP_LIMIT = 50;

/**
 * Count (and sum of one number column) for each value of one column, the only aggregate query. Every identifier goes
 * through the table's column map and is double quoted; the SQL is one of a few fixed shapes and the limit is bound.
 * Dates and timestamps group by their UTC month or day (a prefix of the canonical text).
 * @param {string} table
 * @param {{ column: string, bucket?: 'day' | 'month', measureColumn?: string, where?: object, search?: object,
 *   order?: 'count' | 'key-desc', limit: number, db?: object }} opts
 * @returns {{ groups: Array<{ key: string | boolean | null, count: number, sum: number, n: number }>,
 *   total: { count: number, sum: number, n: number, groups: number } }}
 */
export function groupStats(table, { column, bucket, measureColumn, where, search, order = 'count', limit, db } = {}) {
  const def = getTable(table);
  const type = colType(def, table, column);
  if (!GROUP_KEY_TYPES.has(type)) throw new DbError('invalid_query', 'Cannot group by this column', { column });
  const dated = type === 'date' || type === 'timestamptz';
  if (bucket !== undefined && (!dated || !Object.hasOwn(BUCKET_LENGTH, bucket))) throw new DbError('invalid_query', 'Invalid bucket', { column });
  if (order !== 'count' && order !== 'key-desc') throw new DbError('invalid_query', 'Invalid group order');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_GROUP_LIMIT) throw new DbError('invalid_query', 'Invalid group limit');
  let measure = '0 AS s, 0 AS n';
  if (measureColumn !== undefined) {
    const mType = colType(def, table, measureColumn);
    if (mType !== 'integer' && mType !== 'real') throw new DbError('invalid_query', 'Cannot add up this column', { column: measureColumn });
    measure = `SUM(${q(measureColumn)}) AS s, COUNT(${q(measureColumn)}) AS n`;
  }
  const key = bucket === undefined ? q(column) : `substr(${q(column)}, 1, ${BUCKET_LENGTH[bucket]})`;
  const params = [];
  const w = whereClause(def, table, where, search, params);
  const byKey = order === 'key-desc';
  // key-desc keeps the "no value" group out of the limited query and reads it on its own, so the limit never drops it.
  const groupWhere = byKey ? `${w}${w === '' ? ' WHERE' : ' AND'} ${key} IS NOT NULL` : w;
  const orderSql = byKey ? 'ORDER BY 1 DESC' : 'ORDER BY 2 DESC, 1 ASC NULLS LAST';
  const groupSql = `SELECT ${key} AS k, COUNT(*) AS c, ${measure} FROM ${q(table)}${groupWhere} GROUP BY 1 ${orderSql} LIMIT ?`;
  const emptyWhere = `${w}${w === '' ? ' WHERE' : ' AND'} ${key} IS NULL`;
  const emptySql = `SELECT ${key} AS k, COUNT(*) AS c, ${measure} FROM ${q(table)}${emptyWhere} HAVING COUNT(*) > 0`;
  const totalSql = `SELECT COUNT(*) AS c, ${measure}, COUNT(DISTINCT ${key}) + (COUNT(*) > COUNT(${key})) AS g FROM ${q(table)}${w}`;
  return run(() => {
    const handle = db ?? getDb();
    const rows = handle.prepare(groupSql).all(...params, limit);
    if (byKey) rows.push(...handle.prepare(emptySql).all(...params));
    const t = handle.prepare(totalSql).get(...params);
    return {
      groups: rows.map((r) => ({
        key: r.k === null ? null : type === 'boolean' ? Number(r.k) === 1 : String(r.k),
        count: Number(r.c),
        sum: Number(r.s ?? 0),
        n: Number(r.n),
      })),
      total: { count: Number(t.c), sum: Number(t.s ?? 0), n: Number(t.n), groups: Number(t.g) },
    };
  }, 'stats', table);
}

/** @returns {object} */
export function insert(table, row, { db } = {}) {
  const def = getTable(table);
  const { columns, values } = encodeRow(table, row, { forInsert: true });
  const sql = `INSERT INTO ${q(table)} (${columns.map(q).join(', ')}) VALUES (${columns.map(() => '?').join(', ')}) RETURNING ${allColumns(def)}`;
  return run(() => decodeRow(table, (db ?? getDb()).prepare(sql).get(...values)), 'insert', table);
}

/** @returns {object[]} */
export function insertMany(table, rows, { db } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const handle = db ?? getDb();
  return withTransaction(() => rows.map((r) => insert(table, r, { db: handle })), handle);
}

/** @returns {object[]} */
export function update(table, patch, { where, db } = {}) {
  const def = getTable(table);
  if (!isPlainObject(where) || Object.keys(where).length === 0) {
    throw new DbError('invalid_query', 'update requires a non-empty where');
  }
  const { columns, values } = encodeRow(table, patch);
  if (columns.length === 0) {
    // Validate the where clause shape, then return the unchanged rows (an empty PATCH is a no-op).
    return select(table, { where, db });
  }
  const params = [...values];
  const w = whereClause(def, table, where, undefined, params);
  const sql = `UPDATE ${q(table)} SET ${columns.map((c) => `${q(c)} = ?`).join(', ')}${w} RETURNING ${allColumns(def)}`;
  return run(() =>
    (db ?? getDb())
      .prepare(sql)
      .all(...params)
      .map((r) => decodeRow(table, r)),
    'update',
    table,
  );
}

/** @returns {object | null} */
export function updateById(table, id, patch, { db } = {}) {
  const def = getTable(table);
  assertId(id);
  return update(table, patch, { where: { [def.primaryKey]: id }, db })[0] ?? null;
}

/** @returns {object} */
export function upsert(table, row, { conflict, preserve = [], db } = {}) {
  const def = getTable(table);
  const target = conflict ?? [def.primaryKey];
  if (!Array.isArray(target) || target.length === 0) throw new DbError('invalid_query', 'conflict must be a non-empty array');
  for (const c of target) colType(def, table, c);
  const { columns, values } = encodeRow(table, row, { forInsert: true });
  const updateCols = columns.filter((c) => row[c] !== undefined && !target.includes(c) && !preserve.includes(c));
  const setSql = updateCols.length
    ? updateCols.map((c) => `${q(c)} = excluded.${q(c)}`).join(', ')
    : `${q(def.primaryKey)} = excluded.${q(def.primaryKey)}`;
  const sql =
    `INSERT INTO ${q(table)} (${columns.map(q).join(', ')}) VALUES (${columns.map(() => '?').join(', ')}) ` +
    `ON CONFLICT (${target.map(q).join(', ')}) DO UPDATE SET ${setSql} RETURNING ${allColumns(def)}`;
  return run(() => decodeRow(table, (db ?? getDb()).prepare(sql).get(...values)), 'upsert', table);
}

/** @returns {number} rows deleted */
export function remove(table, { where, db } = {}) {
  const def = getTable(table);
  if (!isPlainObject(where) || Object.keys(where).length === 0) {
    throw new DbError('invalid_query', 'remove requires a non-empty where');
  }
  const params = [];
  const w = whereClause(def, table, where, undefined, params);
  const sql = `DELETE FROM ${q(table)}${w}`;
  return run(() => Number((db ?? getDb()).prepare(sql).run(...params).changes), 'delete', table);
}
