// Studio app storage: every read re-validates the stored spec, every write is revision-checked.
// All database access goes through server/db/index.js (query.js); no SQL is built here.
import { strToU8, unzipSync, zipSync } from 'fflate';
import { DbError, count, insert, nowIso, op, remove, select, selectOne, update, withTransaction } from '../db/index.js';
import { RESERVED_APP_NAMES, isWindowsDeviceName } from '../spec/index.js';
import { clearSample, copySample, sampleAppIds, writeSample } from './sample.js';
import { clearFirstPrompt, clearWaiting, waitingSummaries } from './waiting.js';
import { MAX_APPS, checkSpec, copyName, deriveIdentifier, deriveSlug, isValidAppName, jsonShapeProblem, starterSpec } from './specCheck.js';

const RAW_MAX_CHARS = 1048576;
const SLUG_MAX = 40;
const NAME_RULE = 'Use 2 to 40 letters, digits and single spaces, starting with a letter.';
const RESERVED = 'That name is reserved. Pick another name.';
const RESERVED_ON_WINDOWS = 'That name is reserved on Windows. Pick another name.';

/** A user-safe failure with the HTTP status and extra body fields the routes send. */
export class StudioError extends Error {
  /**
   * @param {string} code
   * @param {number} status
   * @param {string} message
   * @param {{ issues?: object[], revision?: number }} [extra]
   */
  constructor(code, status, message, extra = {}) {
    super(message);
    this.name = 'StudioError';
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

const tooMany = () => new StudioError('too_many_apps', 409, `You can keep up to ${MAX_APPS} apps. Delete one first.`);
const slugTaken = () => new StudioError('slug_taken', 409, 'Another app already uses that name. Pick another name.');
const notFound = () => new StudioError('app_not_found', 404, 'That app does not exist. It may have been deleted.');
const specInvalid = (issues) => new StudioError('spec_invalid', 409, 'This app has a problem that must be fixed first.', { issues });

const COLUMNS = ['id', 'name', 'slug', 'spec', 'revision', 'created_at', 'updated_at'];

function toRecord(row) {
  const checked = checkSpec(row.spec);
  const base = { id: row.id, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at };
  if (checked.ok) return { ...base, name: checked.spec.app.name, slug: checked.spec.app.slug, spec: checked.spec, issues: [] };
  const record = { ...base, name: row.name, slug: row.slug, spec: null, issues: checked.issues };
  // Stringify only after the shape check passed (a hostile deep value must not overflow the stack).
  if (jsonShapeProblem(row.spec) === null && JSON.stringify(row.spec).length <= RAW_MAX_CHARS) record.raw = row.spec;
  return record;
}

/** Validation outcome per app id for list rows, valid only while (revision, updated_at) match. Holds at most MAX_APPS ids. */
const summaryCache = new Map();

function toSummary(row, built, waiting, withSample) {
  let size = -1;
  try {
    size = JSON.stringify(row.spec)?.length ?? -1;
  } catch {
    // a hostile deep value: the key still differs from any valid spec's
  }
  const key = `${row.revision}|${row.updated_at}|${size}`;
  let checks = summaryCache.get(row.id);
  if (!checks || checks.key !== key) {
    const checked = checkSpec(row.spec);
    checks = {
      key,
      name: checked.ok ? checked.spec.app.name : row.name,
      slug: checked.ok ? checked.spec.app.slug : row.slug,
      ok: checked.ok,
      issueCount: checked.issues.length,
      tableCount: checked.ok ? checked.spec.tables.length : 0,
      pageCount: checked.ok ? checked.spec.pages.length : 0,
      description: checked.ok ? checked.spec.app.description : '',
    };
    summaryCache.set(row.id, checks);
  }
  return {
    id: row.id,
    name: checks.name,
    slug: checks.slug,
    revision: row.revision,
    ok: checks.ok,
    issueCount: checks.issueCount,
    tableCount: checks.tableCount,
    pageCount: checks.pageCount,
    description: checks.description,
    hasInstaller: built.has(row.id),
    waiting: waiting.get(row.id) ?? null,
    sample: withSample.has(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** @returns {object[]} newest first, at most MAX_APPS */
export function listApps() {
  const rows = select('apps', { columns: COLUMNS, orderBy: [{ column: 'updated_at', dir: 'desc' }], limit: MAX_APPS });
  // a build does not bump the app revision, so this is read on every call and never cached
  const built = new Set(
    rows.length === 0
      ? []
      : select('builds', { columns: ['app_id'], where: { app_id: op.in(rows.map((r) => r.id)), status: 'succeeded', installer_path: op.ne(null) } }).map((r) => r.app_id),
  );
  const waiting = waitingSummaries(rows.map((r) => ({ id: r.id, revision: r.revision })));
  const withSample = sampleAppIds(rows.map((r) => r.id));
  const summaries = rows.map((row) => toSummary(row, built, waiting, withSample));
  const listed = new Set(rows.map((r) => r.id));
  for (const id of summaryCache.keys()) if (!listed.has(id)) summaryCache.delete(id);
  return summaries;
}

/** @param {string} id @returns {boolean} */
export function appExists(id) {
  return selectOne('apps', { columns: ['id'], where: { id } }) !== null;
}

/** @param {string} id */
export function getApp(id) {
  const row = selectOne('apps', { columns: COLUMNS, where: { id } });
  return row ? toRecord(row) : null;
}

/**
 * First free slug: base, base-2, base-3 ... (base is cut so the suffix fits).
 * @param {string} base
 * @param {string | null} [exceptId] the app that may keep its own slug
 */
export function uniqueSlug(base, exceptId = null) {
  const taken = new Set(select('apps', { columns: ['id', 'slug'], limit: MAX_APPS + 50 }).filter((r) => r.id !== exceptId).map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

const assertRoom = () => {
  if (count('apps') >= MAX_APPS) throw tooMany();
};

function insertSpec(spec) {
  try {
    return toRecord(insert('apps', { name: spec.app.name, slug: spec.app.slug, spec }));
  } catch (err) {
    if (err instanceof DbError && err.code === 'constraint') throw slugTaken();
    throw err;
  }
}

function assertValidName(name) {
  if (!isValidAppName(name)) {
    const text = typeof name === 'string' ? name : '';
    const why = isWindowsDeviceName(text) ? RESERVED_ON_WINDOWS : RESERVED_APP_NAMES.has(text.toLowerCase()) ? RESERVED : NAME_RULE;
    throw new StudioError('invalid_request', 400, `That name cannot be used. ${why}`);
  }
}

/** @param {{ name: unknown }} input */
export function createApp({ name }) {
  assertValidName(name);
  return withTransaction(() => {
    assertRoom();
    const starter = starterSpec(name, uniqueSlug(deriveSlug(name)));
    if (!checkSpec(starter).ok) throw new StudioError('invalid_request', 400, `That name cannot be used. ${NAME_RULE}`);
    return insertSpec(starter);
  });
}

/**
 * @param {object} spec an already checked spec
 * @param {{ sample?: object | null }} [options] checked sample records, kept with the app in the same transaction
 */
export function importApp(spec, { sample = null } = {}) {
  return withTransaction(() => {
    assertRoom();
    const slug = uniqueSlug(spec.app.slug);
    let record;
    if (slug === spec.app.slug) record = insertSpec(spec);
    else {
      // A suffixed slug gets its own bundle identifier, derived as createApp and duplicateApp do.
      const renamed = { ...spec, app: { ...spec.app, slug, identifier: deriveIdentifier(slug) } };
      const checked = checkSpec(renamed);
      if (!checked.ok) throw specInvalid(checked.issues);
      record = insertSpec(checked.spec);
    }
    if (sample) writeSample(record.id, sample);
    return record;
  });
}

/**
 * @param {string} id
 * @param {{ name?: unknown }} [options] the copy's name; the default copy name when absent
 * @returns {object | null}
 */
export function duplicateApp(id, { name: wanted } = {}) {
  if (wanted !== undefined) assertValidName(wanted);
  return withTransaction(() => {
    const source = getApp(id);
    if (!source) return null;
    if (!source.spec) throw specInvalid(source.issues);
    assertRoom();
    const name = wanted ?? copyName(source.spec.app.name);
    const slug = uniqueSlug(deriveSlug(name));
    const copy = { ...source.spec, app: { ...source.spec.app, name, slug, identifier: deriveIdentifier(slug) } };
    const checked = checkSpec(copy);
    if (!checked.ok) throw specInvalid(checked.issues);
    const record = insertSpec(checked.spec);
    copySample(id, record.id);
    return record;
  });
}

/**
 * The kit export ZIP of an app's records with the saved design added as `app.json` (two-space JSON), for Export with records.
 * The ZIP keeps its own entries (manifest, json and csv); the kit importer reads only the manifest and the json files and skips
 * `app.json`, so the same file restores the records through Settings > Import in a built app.
 * @param {Uint8Array} zipBytes
 * @param {object} spec the saved design
 * @returns {Uint8Array}
 */
export function withDesignEntry(zipBytes, spec) {
  const files = unzipSync(zipBytes);
  files['app.json'] = strToU8(`${JSON.stringify(spec, null, 2)}
`);
  return zipSync(files);
}

/**
 * Replaces the draft spec when `baseRevision` is still current.
 * @param {string} id
 * @param {object} spec an already checked spec
 * @param {number} baseRevision
 * @param {{ clearWaiting?: boolean, waitingAt?: string | null }} [options] drop the app's waiting design in the same
 *   transaction as the save; with `waitingAt` only the entry that still has that version (another window's newer one stays)
 */
export function saveSpec(id, spec, baseRevision, { clearWaiting: clearWaitingToo = false, waitingAt = null } = {}) {
  return withTransaction(() => {
    const other = selectOne('apps', { columns: ['id'], where: { slug: spec.app.slug } });
    if (other && other.id !== id) throw slugTaken();
    let rows;
    try {
      rows = update(
        'apps',
        { spec, name: spec.app.name, slug: spec.app.slug, revision: baseRevision + 1, updated_at: nowIso() },
        { where: { id, revision: baseRevision } },
      );
    } catch (err) {
      if (err instanceof DbError && err.code === 'constraint') throw slugTaken();
      throw err;
    }
    if (rows.length === 0) {
      const current = selectOne('apps', { columns: ['revision'], where: { id } });
      if (!current) throw notFound();
      throw new StudioError('revision_conflict', 409, 'This app changed in another window. Reload it and try again.', { revision: current.revision });
    }
    if (clearWaitingToo) clearWaiting(id, waitingAt, true);
    return toRecord(rows[0]);
  });
}

/**
 * Deletes an app. With `ifRevision`, the delete only happens while the stored revision still matches (a save from another
 * window changes it), otherwise the same revision_conflict as a save is thrown.
 * @param {string} id
 * @param {number} [ifRevision]
 * @returns {boolean}
 */
export function deleteApp(id, ifRevision) {
  return withTransaction(() => {
    if (ifRevision !== undefined) {
      const current = selectOne('apps', { columns: ['revision'], where: { id } });
      if (!current) return false;
      if (current.revision !== ifRevision) {
        throw new StudioError('revision_conflict', 409, 'This app changed in another window. Reload it and try again.', { revision: current.revision });
      }
    }
    const removed = remove('apps', { where: { id } }) > 0;
    if (removed) {
      clearWaiting(id);
      clearFirstPrompt(id);
      clearSample(id);
    }
    return removed;
  });
}

/** Marks builds left `running` by a crashed session as interrupted. @returns {number} rows changed */
export function markInterruptedBuilds() {
  const now = nowIso();
  return update('builds', { status: 'interrupted', finished_at: now, error_code: 'interrupted' }, { where: { status: 'running' } }).length;
}
