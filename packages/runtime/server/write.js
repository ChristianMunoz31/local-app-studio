// The one writer of a record (docs/phase28 design, sections 2 and 3): the data routes, the Assistant's save and the CSV import all
// create and change records here, so they share one order of steps and one handle. Per write, in one transaction:
//   1. the numbered field check, 2. validateRecord on what the person sent, 3. the rules of the table (applyRules),
//   4. validateRecord and checkReferences again on the merged record, 5. a number, 6. insert or update, 7. the counter.
// Every read and write uses the caller's `db` (M2). Nothing here awaits, so no other request runs in between.
import { getDb, nowIso, selectOne, updateById, insert, withTransaction } from '../../../server/db/index.js';
import { readAutoNumber } from '@local-app-studio/runtime/spec/autoNumber.ts';
import { applyRules, readRules, sameValue } from '@local-app-studio/runtime/spec/rules.ts';
import { createNumberer } from './autoNumberStore.js';
import { checkReferences, validateRecord } from './validate.js';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const fail = (field, message) => ({ ok: false, field, message });

const specTable = (spec, table) => (spec?.tables ?? []).find((t) => t.id === table);
const labelsOf = (spec) => Object.fromEntries((spec?.tables ?? []).map((t) => [t.id, t.label]));
const fieldLabel = (st, id) => st?.fields?.find((f) => f.id === id)?.label ?? id;
const withoutKey = (obj, key) => {
  const { [key]: _dropped, ...rest } = obj;
  void _dropped;
  return rest;
};

/**
 * Runs the rules of the table on the validated values and checks the merged record again.
 * @returns {{ ok: true, row: Record<string, unknown>, applied: object[] } | { ok: false, field: string, message: string }}
 */
function withRules({ compiled, table, st, before, v1, partial, autoField, now, applyAutomations }) {
  if (!applyAutomations || !st || readRules(st).length === 0) return { ok: true, row: v1.row, applied: [] };
  const { changes, applied } = applyRules({ table: st, before, given: v1.row, now });
  if (Object.keys(changes).length === 0) return { ok: true, row: v1.row, applied: [] };
  const v2 = validateRecord(compiled, table, { ...v1.row, ...changes }, { partial, autoField });
  return v2.ok ? { ok: true, row: v2.row, applied } : v2;
}

/**
 * Creates a record. Returns `{ ok: true, row, applied }` or the field and sentence that refused it; a database failure throws.
 * A batch passes one `numberer` for all its rows, and calls its commit() itself.
 * @param {{ compiled: object, spec: object | null, table: string, body: unknown, applyAutomations?: boolean, now?: Date,
 *   db?: import('node:sqlite').DatabaseSync, numberer?: ReturnType<typeof createNumberer> }} opts
 */
export function createRecord({ compiled, spec, table, body, applyAutomations = true, now = new Date(), db = getDb(), numberer }) {
  const st = specTable(spec, table);
  const cfg = st ? readAutoNumber(st) : null;
  return withTransaction(() => {
    let input = body;
    if (cfg && isPlainObject(body) && Object.hasOwn(body, cfg.field)) {
      const given = body[cfg.field];
      if (given !== undefined && given !== null && given !== '') return fail(cfg.field, `${fieldLabel(st, cfg.field)} is numbered automatically.`);
      input = withoutKey(body, cfg.field);
    }
    const autoField = cfg?.field ?? null;
    const v1 = validateRecord(compiled, table, input, { partial: false, autoField });
    if (!v1.ok) return v1;
    const ruled = withRules({ compiled, table, st, before: null, v1, partial: false, autoField, now, applyAutomations });
    if (!ruled.ok) return ruled;
    const refs = checkReferences(compiled, table, ruled.row, { labels: labelsOf(spec), db });
    if (!refs.ok) return refs;
    const owner = cfg && !numberer ? createNumberer({ db, table, cfg }) : null;
    const nb = numberer ?? owner;
    const row = cfg ? { ...ruled.row, [cfg.field]: nb.next() } : ruled.row;
    let saved;
    try {
      saved = insert(table, row, { db });
    } catch (e) {
      nb?.unuse();
      throw e;
    }
    owner?.commit();
    return { ok: true, row: saved, applied: ruled.applied };
  }, db);
}

/**
 * Changes a record. A numbered field in the body is dropped when it equals the stored value and refused when it differs.
 * @param {{ compiled: object, spec: object | null, table: string, id: string, body: unknown, applyAutomations?: boolean, now?: Date,
 *   db?: import('node:sqlite').DatabaseSync }} opts
 */
export function updateRecord({ compiled, spec, table, id, body, applyAutomations = true, now = new Date(), db = getDb() }) {
  const st = specTable(spec, table);
  const cfg = st ? readAutoNumber(st) : null;
  return withTransaction(() => {
    const before = selectOne(table, { where: { id }, db });
    if (!before) return { ok: false, notFound: true };
    let input = body;
    if (cfg && isPlainObject(body) && Object.hasOwn(body, cfg.field)) {
      if (!sameValue(body[cfg.field], before[cfg.field])) {
        return fail(cfg.field, `${fieldLabel(st, cfg.field)} is numbered automatically and cannot be changed.`);
      }
      input = withoutKey(body, cfg.field);
    }
    const autoField = cfg?.field ?? null;
    const v1 = validateRecord(compiled, table, input, { partial: true, autoField });
    if (!v1.ok) return v1;
    const ruled = withRules({ compiled, table, st, before, v1, partial: true, autoField, now, applyAutomations });
    if (!ruled.ok) return ruled;
    const refs = checkReferences(compiled, table, ruled.row, { labels: labelsOf(spec), db });
    if (!refs.ok) return refs;
    const saved = updateById(table, id, { ...ruled.row, updated_at: nowIso() }, { db });
    return saved ? { ok: true, row: saved, applied: ruled.applied } : { ok: false, notFound: true };
  }, db);
}
