// The sample records an example app comes with, kept beside the app: one app_state row per app under
// `studio.sample.<appId>` (no migration, no spec schema change). The value is a SampleRecords (src/studio/lib/sampleData.ts);
// every read re-checks its structure. All database access goes through server/db (no SQL here); the writes are synchronous
// so a caller can run them inside its own transaction.
import { nowIso, op, remove, select, selectOne, upsert } from '../db/index.js';
import { checkSampleShape } from '../../src/studio/lib/sampleData.ts';

export const SAMPLE_KEY_PREFIX = 'studio.sample.';

/** @param {string} appId */
export const sampleKey = (appId) => `${SAMPLE_KEY_PREFIX}${appId}`;

/**
 * @param {string} appId
 * @param {object} sample a checked SampleRecords
 */
export function writeSample(appId, sample) {
  upsert('app_state', { key: sampleKey(appId), value: sample, updated_at: nowIso() }, { conflict: ['key'] });
}

/**
 * @param {string} appId
 * @returns {object | null} the stored sample when it still has the right shape, else null. Never throws.
 */
export function readSample(appId) {
  try {
    const row = selectOne('app_state', { columns: ['value'], where: { key: sampleKey(appId) } });
    return row ? checkSampleShape(row.value) : null;
  } catch {
    return null;
  }
}

/** Gives `toId` a copy of the sample of `fromId`; nothing when the source has none. */
export function copySample(fromId, toId) {
  const sample = readSample(fromId);
  if (sample) writeSample(toId, sample);
}

/** @param {string} appId @returns {boolean} whether a row was removed */
export function clearSample(appId) {
  return remove('app_state', { where: { key: sampleKey(appId) } }) > 0;
}

/**
 * @param {string[]} appIds
 * @returns {Set<string>} the ids that have a sample (one select)
 */
export function sampleAppIds(appIds) {
  if (appIds.length === 0) return new Set();
  const byKey = new Map(appIds.map((id) => [sampleKey(id), id]));
  const rows = select('app_state', { columns: ['key'], where: { key: op.in([...byKey.keys()]) } });
  return new Set(rows.map((r) => byKey.get(r.key)));
}
