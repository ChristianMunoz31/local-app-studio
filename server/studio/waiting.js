// The helper's waiting design, kept with the app: one app_state row per app under `studio.waiting.<appId>`.
// Value: { mode, instruction, asks, proposal, replaced, fallbacks, baseRevision, at }. No migration and no spec schema
// change; every read re-checks the stored proposal (as every store read does), so an unreadable body answers with the
// words kept and the design null. All database access goes through server/db (no SQL here); the writes are
// synchronous so a caller can run them inside its own transaction.
import { isDeepStrictEqual } from 'node:util';
import { nowIso, op, remove, select, selectOne, upsert, withTransaction } from '../db/index.js';
import { checkSpec } from './specCheck.js';
import { WAITING_KEY_PREFIX } from '../waitingKey.js';

export { WAITING_KEY_PREFIX };
const ASKS_MAX = 50;
const TEXT_MAX = 2000;
const FALLBACKS_MAX = 50;
const FALLBACK_TEXT_MAX = 500;

/** @param {string} appId */
export const waitingKey = (appId) => `${WAITING_KEY_PREFIX}${appId}`;

/** The words of the first (create) prompt, kept after Use this clears the entry: `studio.prompt.<appId>`, value { instruction }. */
const promptKey = (appId) => `studio.prompt.${appId}`;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The stored spec when it still passes the checks, else null. */
function checked(body) {
  if (body === null || body === undefined) return null;
  try {
    const result = checkSpec(body);
    return result.ok ? result.spec : null;
  } catch {
    return null;
  }
}

const short = (text, max) => (text.length > max ? text.slice(0, max) : text);

/** Only the {part, pageId, message} strings the client reads, capped in count and length. */
function readFallbacks(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const f of value) {
    if (!isObject(f) || typeof f.part !== 'string' || typeof f.message !== 'string') continue;
    out.push({
      part: short(f.part, FALLBACK_TEXT_MAX),
      ...(typeof f.pageId === 'string' ? { pageId: short(f.pageId, FALLBACK_TEXT_MAX) } : {}),
      message: short(f.message, FALLBACK_TEXT_MAX),
    });
    if (out.length >= FALLBACKS_MAX) break;
  }
  return out;
}

/** Tolerant reader of a stored value: always the full shape with the words kept. */
function normalize(value) {
  const v = isObject(value) ? value : {};
  return {
    mode: v.mode === 'edit' ? 'edit' : 'create',
    instruction: typeof v.instruction === 'string' ? short(v.instruction, TEXT_MAX) : '',
    asks: Array.isArray(v.asks) ? v.asks.filter((a) => typeof a === 'string').slice(-ASKS_MAX).map((a) => short(a, TEXT_MAX)) : [],
    proposal: v.proposal ?? null,
    replaced: v.replaced ?? null,
    fallbacks: readFallbacks(v.fallbacks),
    baseRevision: Number.isSafeInteger(v.baseRevision) && v.baseRevision >= 1 ? v.baseRevision : null,
    // A version is a date: anything else (a hand edited row) is no version, so no later write builds on it.
    at: typeof v.at === 'string' && Number.isFinite(Date.parse(v.at)) ? v.at : null,
  };
}

function readRaw(appId) {
  const row = selectOne('app_state', { columns: ['value'], where: { key: waitingKey(appId) } });
  return row ? normalize(row.value) : null;
}

// The entry's `at` is its version: a write never repeats the one before it, even inside one millisecond.
function nextAt(previousAt) {
  const now = nowIso();
  if (previousAt === null || previousAt === undefined || now > previousAt) return now;
  return new Date(Date.parse(previousAt) + 1).toISOString();
}

/** Writes the entry under a new version and returns that version. */
function write(appId, entry, previousAt = readRaw(appId)?.at ?? null) {
  const at = nextAt(previousAt);
  upsert('app_state', { key: waitingKey(appId), value: { ...entry, at }, updated_at: nowIso() }, { conflict: ['key'] });
  return at;
}

/**
 * The waiting entry with its proposal and replaced design re-checked (an invalid body becomes null).
 * @param {string} appId
 * @returns {object | null}
 */
export function getWaiting(appId) {
  const raw = readRaw(appId);
  if (!raw) return null;
  return { ...raw, proposal: checked(raw.proposal), replaced: checked(raw.replaced) };
}

/**
 * A run starts. A plain run drops the old waiting design (the person asked for a new one); a refine keeps the entry as is.
 * @param {string} appId
 * @param {{ mode: 'create' | 'edit', instruction: string, baseRevision: number, refine: boolean }} run
 */
export function startRun(appId, { mode, instruction, baseRevision, refine }) {
  if (refine && readRaw(appId)) return;
  write(appId, { mode, instruction, asks: [], proposal: null, replaced: null, fallbacks: [], baseRevision });
}

/**
 * The helper answered. `proposal` is the checked one sent to the client. A refine appends `ask` to the asks and keeps the
 * previous waiting design as `replaced`, but only while the entry still has the version (`expectedAt`) the run started
 * from: another window's newer design, a start over or a deleted entry makes it `stale` and nothing is written. A plain
 * run starts the entry again. A plain answer equal to the saved design waits for nothing, so only the words are kept.
 * Nothing is written for an app that no longer exists (an orphan entry has no owner).
 * @param {string} appId
 * @param {{ mode: 'create' | 'edit', instruction: string, baseRevision: number, proposal: object, fallbacks: object[], refine: boolean, savedSpec: object, expectedAt?: string | null }} answer
 * @returns {{ at: string | null, stale: boolean }} the version written, or null when nothing was written
 */
export function storeProposal(appId, { mode, instruction, baseRevision, proposal, fallbacks, refine, savedSpec, expectedAt = null }) {
  return withTransaction(() => {
    if (selectOne('apps', { columns: ['id'], where: { id: appId } }) === null) return { at: null, stale: false };
    const previous = readRaw(appId);
    if (refine) {
      if (!previous || previous.at !== expectedAt) return { at: null, stale: true };
      const at = write(appId, { ...previous, asks: [...previous.asks, instruction].slice(-ASKS_MAX), replaced: previous.proposal, proposal, fallbacks }, previous.at);
      return { at, stale: false };
    }
    const same = isDeepStrictEqual(JSON.parse(JSON.stringify(proposal)), JSON.parse(JSON.stringify(savedSpec)));
    const at = write(appId, { mode, instruction, asks: [], proposal: same ? null : proposal, replaced: null, fallbacks: same ? [] : fallbacks, baseRevision }, previous?.at ?? null);
    return { at, stale: false };
  });
}

/**
 * Drops the entry. With `at` it only goes while it still has that version (another window's newer design stays). With
 * `keepPrompt` the words of a create entry stay under `studio.prompt.<appId>` (the app's first prompt, for another window).
 * @param {string} appId
 * @param {string | null} [at] the version the caller saw
 * @param {boolean} [keepPrompt]
 * @returns {boolean} whether an entry was removed
 */
export function clearWaiting(appId, at = null, keepPrompt = false) {
  const entry = at !== null || keepPrompt ? readRaw(appId) : null;
  if (at !== null && entry?.at !== at) return false;
  if (keepPrompt && entry?.mode === 'create' && entry.instruction !== '' && getFirstPrompt(appId) === null) {
    upsert('app_state', { key: promptKey(appId), value: { instruction: entry.instruction }, updated_at: nowIso() }, { conflict: ['key'] });
  }
  return remove('app_state', { where: { key: waitingKey(appId) } }) > 0;
}

/** The first prompt kept by Use this, or null. @param {string} appId @returns {string | null} */
export function getFirstPrompt(appId) {
  const value = selectOne('app_state', { columns: ['value'], where: { key: promptKey(appId) } })?.value;
  return isObject(value) && typeof value.instruction === 'string' && value.instruction !== '' ? short(value.instruction, TEXT_MAX) : null;
}

/** Forgets the first prompt (the app was deleted). @param {string} appId */
export function clearFirstPrompt(appId) {
  return remove('app_state', { where: { key: promptKey(appId) } }) > 0;
}

// Counts per app id, valid while the entry's version (`at`) and the app's revision are the same.
const summaryCache = new Map();

/**
 * Table and page counts of each listed app's waiting design, in one select. Apps without a readable design are absent, and so
 * are apps whose design was made before a later save (it can never be used, so the card does not claim it). A design is
 * checked once per version of its entry and revision of its app, not on every list call.
 * @param {{ id: string, revision: number }[]} apps
 * @returns {Map<string, { tableCount: number, pageCount: number }>}
 */
export function waitingSummaries(apps) {
  const out = new Map();
  const appIds = apps.map((a) => a.id);
  const revisions = new Map(apps.map((a) => [a.id, a.revision]));
  const listed = new Set(appIds);
  for (const id of summaryCache.keys()) if (!listed.has(id)) summaryCache.delete(id);
  if (appIds.length === 0) return out;
  const byKey = new Map(appIds.map((id) => [waitingKey(id), id]));
  const rows = select('app_state', { columns: ['key', 'value'], where: { key: op.in([...byKey.keys()]) } });
  const present = new Set(rows.map((r) => byKey.get(r.key)));
  for (const id of summaryCache.keys()) if (!present.has(id)) summaryCache.delete(id);
  for (const row of rows) {
    const id = byKey.get(row.key);
    const entry = normalize(row.value);
    const revision = revisions.get(id);
    const cached = summaryCache.get(id);
    if (cached && entry.at !== null && cached.at === entry.at && cached.revision === revision) {
      if (cached.summary) out.set(id, cached.summary);
      continue;
    }
    const stale = entry.baseRevision !== null && entry.baseRevision < revision;
    const spec = stale ? null : checked(entry.proposal);
    const summary = spec ? { tableCount: spec.tables.length, pageCount: spec.pages.length } : null;
    if (entry.at !== null) summaryCache.set(id, { at: entry.at, revision, summary });
    if (summary) out.set(id, summary);
  }
  return out;
}
