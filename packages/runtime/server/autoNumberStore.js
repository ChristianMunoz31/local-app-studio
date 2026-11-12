// The counters of the numbered fields (docs/phase28 design, section 2). A counter lives in app_state under
// `autonumber.<table>.<field>` as `{ last }`, the last number handed out. It only ever goes up: a delete never lowers it, a bulk
// path (ZIP import) raises it to the highest stored value. Everything here is synchronous and runs inside the caller's transaction.
import { getDb, nowIso, select, upsert } from '../../../server/db/index.js';
import { getAppSpec } from '../../../server/spec/source.js';
import { autoNumberStateKey, formatAutoNumber, nextCounter, parseAutoNumber, readAutoNumber } from '@local-app-studio/runtime/spec/autoNumber.ts';

/** The stored `last` of a counter, or null when it is missing or not a safe integer (M1). */
function readLast(key, db) {
  const value = select('app_state', { columns: ['value'], where: { key }, limit: 1, db })[0]?.value;
  const last = value !== null && typeof value === 'object' ? value.last : undefined;
  return typeof last === 'number' && Number.isSafeInteger(last) ? last : null;
}

function writeLast(key, last, db) {
  upsert('app_state', { key, value: { last }, updated_at: nowIso() }, { conflict: ['key'], db });
}

/** The highest counter in a column, from one sequential read of that column alone. */
function maxStored(table, cfg, db) {
  let max = null;
  for (const row of select(table, { columns: [cfg.field], db })) {
    const n = parseAutoNumber(cfg, row[cfg.field]);
    if (n !== null && (max === null || n > max)) max = n;
  }
  return max;
}

/**
 * Hands out the numbers of one transaction. The first next() reads the state and scans the column once; later calls add one in
 * memory. commit() writes the state once. unuse() gives the last number back (a row the batch skipped consumes none).
 * @param {{ db: import('node:sqlite').DatabaseSync, table: string, cfg: import('@local-app-studio/runtime/spec/autoNumber.ts').AutoNumberConfig }} opts
 */
export function createNumberer({ db, table, cfg }) {
  const key = autoNumberStateKey(table, cfg.field);
  let first = null;
  let given = 0;
  return {
    next() {
      if (first === null) first = nextCounter(cfg, readLast(key, db), maxStored(table, cfg, db));
      const n = first + given;
      given += 1;
      return formatAutoNumber(cfg, n);
    },
    unuse() {
      if (given > 0) given -= 1;
    },
    commit() {
      if (first !== null && given > 0) writeLast(key, first + given - 1, db);
    },
  };
}

/** The numbered fields of a spec: `{ table, cfg }` for every table that has one. */
function numberedTables(spec) {
  const out = [];
  for (const t of spec?.tables ?? []) {
    const cfg = readAutoNumber(t);
    if (cfg !== null) out.push({ table: t.id, cfg });
  }
  return out;
}

/**
 * The stored counters of every numbered field, key to `last`, for a bulk path that must never lower one (L4).
 * @param {{ db?: import('node:sqlite').DatabaseSync, spec?: object | null }} [opts]
 * @returns {Record<string, number>}
 */
export function readAutoNumberStates({ db = getDb(), spec = getAppSpec() } = {}) {
  const out = {};
  for (const { table, cfg } of numberedTables(spec)) {
    const key = autoNumberStateKey(table, cfg.field);
    const last = readLast(key, db);
    if (last !== null) out[key] = last;
  }
  return out;
}

/**
 * Sets every counter to the highest of: the value it had before the bulk path (`before`), the state now and the highest number
 * stored in the column. A no-op without a spec (the Studio). Returns how many counters were written.
 * @param {{ db?: import('node:sqlite').DatabaseSync, spec?: object | null, before?: Record<string, number> }} [opts]
 * @returns {number}
 */
export function resyncAutoNumbers({ db = getDb(), spec = getAppSpec(), before = {} } = {}) {
  let touched = 0;
  for (const { table, cfg } of numberedTables(spec)) {
    const key = autoNumberStateKey(table, cfg.field);
    const current = readLast(key, db);
    const candidates = [before[key], current, maxStored(table, cfg, db)].filter((n) => typeof n === 'number' && Number.isSafeInteger(n));
    if (candidates.length === 0) continue;
    const next = Math.max(...candidates);
    if (next !== current) {
      writeLast(key, next, db);
      touched += 1;
    }
  }
  return touched;
}
