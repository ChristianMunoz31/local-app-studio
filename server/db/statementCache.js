// Prepared statement cache for query.js. One bounded Map per database handle (insertion order, least recently used
// out first), keyed by the SQL text query.js builds from allowlisted, double quoted identifiers (values are always bound
// parameters, so the text never carries request input). A statement is never shared across handles: the cache hangs off the
// handle in a WeakMap, so a closed, swapped or restored handle takes its statements with it. Callers use all(), get() and
// run() only, each of which finishes before the next call, so one shared statement is safe; never hold an iterate()
// result from a cached statement.
export const STATEMENT_CACHE_MAX = 200;

/** @type {WeakMap<object, Map<string, import('node:sqlite').StatementSync>>} */
const caches = new WeakMap();
let enabled = true;

/**
 * Bench switch: false makes prepareCached() prepare fresh every time. On by default; never turned off in the app.
 * @param {boolean} on
 */
export function setStatementCacheEnabled(on) {
  enabled = Boolean(on);
}

/** @returns {boolean} */
export const isStatementCacheEnabled = () => enabled;

/**
 * The cached statement for sql on this handle, preparing it on a miss.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} sql
 * @returns {import('node:sqlite').StatementSync}
 */
export function prepareCached(db, sql) {
  if (!enabled) return db.prepare(sql);
  let cache = caches.get(db);
  if (cache === undefined) {
    cache = new Map();
    caches.set(db, cache);
  }
  const hit = cache.get(sql);
  if (hit !== undefined) {
    // Refresh recency.
    cache.delete(sql);
    cache.set(sql, hit);
    return hit;
  }
  // A throwing prepare (bad SQL, closed handle) caches nothing.
  const stmt = db.prepare(sql);
  if (cache.size >= STATEMENT_CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(sql, stmt);
  return stmt;
}

/**
 * Forgets every cached statement of a handle (called before it is closed).
 * @param {object | null | undefined} db
 */
export function dropStatementCache(db) {
  if (db) caches.delete(db);
}

/**
 * Number of statements cached for a handle (tests).
 * @param {object} db
 * @returns {number}
 */
export function statementCacheSize(db) {
  return caches.get(db)?.size ?? 0;
}
