// Importer for Local App Studio export archives. Idempotent: rows are upserted by
// primary key and overwrite existing rows; nothing is ever deleted. One transaction per archive.
import { WAITING_KEY_PREFIX } from '../waitingKey.js';
import { unzipSync, strFromU8 } from 'fflate';
import {
  FOREIGN_KEYS,
  IMPORT_ORDER,
  TABLES,
  DbError,
  encodeValue,
  getDb,
  op,
  select,
  upsert,
  withTransaction,
} from '../db/index.js';
import { REDACTED } from '../redact.js';
import { getAppSpec } from '../spec/source.js';
import { readAutoNumberStates, resyncAutoNumbers } from '@local-app-studio/runtime/server/autoNumberStore.js';

export const IMPORT_MAX_ENTRY_BYTES = 64 * 1024 * 1024;
export const IMPORT_MAX_TOTAL_BYTES = 256 * 1024 * 1024; // CLI default
export const IMPORT_API_MAX_TOTAL_BYTES = 64 * 1024 * 1024; // HTTP path: the archive is inflated in memory
// app_state keys an archive may never set: restoring them could silently enable outbound features
// (network.optIn), roll back the license clock or trial, replace the license activation, or switch automatic backups off or on (backup.auto).
export const PROTECTED_APP_STATE_KEYS = new Set(['network.optIn', 'license.clock', 'license.trial', 'license.trialNotices', 'license.activation', 'backup.auto']);
// Cloud AI consent, categories and hint (`ai.cloudConsent`, `ai.cloudCategories`, `ai.cloudHint`)
// are written only by the consent routes: an archive or a generic state write that set them would
// turn cloud AI on, or widen what it sees, without the consent flow.
const CLOUD_STATE_PREFIX = 'ai.cloud';
// `studio.*` keys are reserved for the Studio module's own state and are written only by its validating routes, so
// the generic state route refuses them. An archive may restore them (export then import must not lose the user's
// work): every reader re-validates whatever is stored. No such key exists today (apps live in their own table).
const STUDIO_STATE_PREFIX = 'studio.';
// `studio.waiting.<appId>` (the helper's waiting design) is the one `studio.*` key an archive may not set: the app an
// import creates gets a new id, so an old entry would belong to no app, and an import must never plant a design that
// waits for an app it did not create. The export leaves these keys out for the same reason (the design is not saved yet).
const isWaitingStateKey = (key) => typeof key === 'string' && key.startsWith(WAITING_KEY_PREFIX);
// The cloud keys that exist today, for code that needs exact names (backup restore keeps the live rows).
export const CLOUD_APP_STATE_KEYS = Object.freeze(['ai.cloudConsent', 'ai.cloudCategories', 'ai.cloudHint']);
// `ai.settings` has its own routes (provider and cloud endpoint). The state route refuses it and
// the importer keeps only harmless local model preferences from it.
export const AI_SETTINGS_STATE_KEY = 'ai.settings';

/**
 * Whether an app_state key may never be set by an import or the generic state route.
 * @param {unknown} key
 * @returns {boolean}
 */
export const isProtectedAppStateKey = (key) =>
  typeof key === 'string' && (PROTECTED_APP_STATE_KEYS.has(key) ||
    key.toLowerCase().startsWith(CLOUD_STATE_PREFIX));

// `autonumber.<table>.<field>` is the counter of a numbered field (packages/runtime/server/autoNumberStore.js). Only the data
// routes and the bulk paths move it, and only upward: the state route cannot set it, an archive can only raise it (L4).
const AUTO_NUMBER_STATE_PREFIX = 'autonumber.';

/**
 * Whether the generic `PUT /api/state/:key` must refuse a key (protected keys, `studio.*`, `autonumber.*` and `ai.settings`).
 * @param {unknown} key
 * @returns {boolean}
 */
export const isStateRouteDeniedKey = (key) =>
  isProtectedAppStateKey(key) ||
  key === AI_SETTINGS_STATE_KEY ||
  (typeof key === 'string' && (key.toLowerCase().startsWith(STUDIO_STATE_PREFIX) || key.toLowerCase().startsWith(AUTO_NUMBER_STATE_PREFIX)));

// Imported `ai.settings`: never `provider`, `cloud` or `ollamaHost` (provider stays local; the
// existing provider, cloud endpoint and Ollama host are kept as they are, so an archive cannot
// repoint chat at another host). Other fields are local model preferences.
function safeAiSettingsValue(imported, existing) {
  const out = {};
  if (isObject(imported)) {
    for (const [k, v] of Object.entries(imported)) if (k !== 'provider' && k !== 'cloud' && k !== 'ollamaHost') out[k] = v;
  }
  if (isObject(existing)) {
    if (Object.hasOwn(existing, 'provider')) out.provider = existing.provider;
    if (Object.hasOwn(existing, 'cloud')) out.cloud = existing.cloud;
    if (Object.hasOwn(existing, 'ollamaHost')) out.ollamaHost = existing.ollamaHost;
  }
  return out;
}
// app_state keys of removed features: list them here (with a migration that deletes them) so an old
// archive cannot bring them back.
export const RETIRED_APP_STATE_KEYS = new Set([]);
export const IMPORT_MAX_ENTRIES = 500;
export const IMPORT_MAX_ROWS_PER_TABLE = 200_000;
const EXISTS_CHUNK = 500;
const NOT_IMPORTABLE = new Set(['app_secrets', 'audit_log']);
// A table id may hold digits after its first letter (ID_RE), so `q2_sales` is read like `sales`.
const ENTRY_RE = /^json\/[a-z][a-z0-9_]{0,39}\.json$/;
const CURRENT_FORMAT = 'local-app-studio-export';
const CURRENT_VERSION = 1;

const MESSAGES = Object.freeze({
  invalid_archive: 'The file is not a valid export archive.',
  unsupported_format: 'Unsupported export format.',
  invalid_table_file: 'An export table file is malformed.',
  import_too_large: 'The export archive is too large to import.',
});

export class ImportError extends Error {
  /** @param {string} code @param {string} [message] @param {number} [status] */
  constructor(code, message, status) {
    super(message ?? MESSAGES[code] ?? code);
    this.name = 'ImportError';
    this.code = code;
    this.status = status ?? (code === 'import_too_large' ? 413 : 400);
  }
}

class DryRunRollback extends Error {}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function isSupportedManifest(manifest) {
  const { format, formatVersion } = manifest;
  return format === CURRENT_FORMAT && formatVersion === CURRENT_VERSION;
}

/**
 * Unzips and validates an export archive in memory (nothing touches the disk).
 * @param {Uint8Array} u8
 * @param {{ maxTotalBytes?: number }} [opts]
 * @returns {{ manifest: object, format: string, formatVersion: number, tables: Map<string, unknown[]>,
 *   ignored: { id: string, reason: 'unknown_table'|'missing_file'|'not_importable' }[] }}
 */
export function parseExportZip(u8, { maxTotalBytes = IMPORT_MAX_TOTAL_BYTES } = {}) {
  let entries = 0;
  let total = 0;
  let files;
  try {
    files = unzipSync(u8, {
      filter: (file) => {
        entries += 1;
        if (entries > IMPORT_MAX_ENTRIES) throw new ImportError('import_too_large');
        if (file.name !== 'manifest.json' && !ENTRY_RE.test(file.name)) return false;
        total += file.originalSize;
        if (file.originalSize > IMPORT_MAX_ENTRY_BYTES || total > maxTotalBytes) {
          throw new ImportError('import_too_large');
        }
        return true;
      },
    });
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError('invalid_archive');
  }
  let actual = 0;
  for (const data of Object.values(files)) {
    actual += data.length;
    if (data.length > IMPORT_MAX_ENTRY_BYTES || actual > maxTotalBytes) {
      throw new ImportError('import_too_large');
    }
  }
  if (!files['manifest.json']) throw new ImportError('invalid_archive');
  let manifest;
  try {
    manifest = JSON.parse(strFromU8(files['manifest.json']));
  } catch {
    throw new ImportError('invalid_archive');
  }
  if (!isObject(manifest)) throw new ImportError('invalid_archive');
  if (!isSupportedManifest(manifest)) throw new ImportError('unsupported_format');
  if (!Array.isArray(manifest.tables)) throw new ImportError('invalid_archive');

  const tables = new Map();
  const ignored = [];
  const seen = new Set();
  for (const entry of manifest.tables) {
    const id = isObject(entry) ? entry.id : undefined;
    if (typeof id !== 'string' || seen.has(id)) continue;
    seen.add(id);
    if (NOT_IMPORTABLE.has(id)) {
      ignored.push({ id, reason: 'not_importable' });
      continue;
    }
    if (!Object.hasOwn(TABLES, id) || !IMPORT_ORDER.includes(id)) {
      ignored.push({ id, reason: 'unknown_table' });
      continue;
    }
    const data = files[`json/${id}.json`];
    if (!data) {
      ignored.push({ id, reason: 'missing_file' });
      continue;
    }
    let rows;
    try {
      rows = JSON.parse(strFromU8(data));
    } catch {
      throw new ImportError('invalid_table_file');
    }
    if (!Array.isArray(rows)) throw new ImportError('invalid_table_file');
    if (rows.length > IMPORT_MAX_ROWS_PER_TABLE) throw new ImportError('import_too_large');
    tables.set(id, rows);
  }
  return { manifest, format: manifest.format, formatVersion: manifest.formatVersion, tables, ignored };
}

/** True when any string anywhere inside value contains the redaction placeholder. */
function containsRedacted(value, depth = 0) {
  if (depth > 50) return true;
  if (typeof value === 'string') return value.includes(REDACTED);
  if (Array.isArray(value)) return value.some((v) => containsRedacted(v, depth + 1));
  if (isObject(value)) return Object.values(value).some((v) => containsRedacted(v, depth + 1));
  return false;
}

const isBlank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

function existingKeys(table, column, keys, db) {
  const found = new Set();
  for (let i = 0; i < keys.length; i += EXISTS_CHUNK) {
    const chunk = keys.slice(i, i + EXISTS_CHUNK);
    for (const r of select(table, { columns: [column], where: { [column]: op.in(chunk) }, db })) found.add(r[column]);
  }
  return found;
}

function existingAppStateValue(key, db) {
  return select('app_state', { columns: ['value'], where: { key }, limit: 1, db })[0]?.value ?? null;
}

function encodeRef(fk, ref) {
  try {
    return encodeValue(TABLES[fk.references.table].columns[fk.references.column], ref, fk.column);
  } catch {
    return null;
  }
}

function importTable(id, rows, db) {
  const def = TABLES[id];
  const pk = def.primaryKey;
  const result = {
    id,
    received: rows.length,
    inserted: 0,
    updated: 0,
    skipped: 0,
    skippedReasons: { invalid: 0, orphan: 0, redacted: 0, missing_id: 0, protected: 0 },
    invalidValues: 0,
  };
  const skip = (reason) => {
    result.skipped += 1;
    result.skippedReasons[reason] += 1;
  };
  const fks = FOREIGN_KEYS.filter((f) => f.table === id);
  const prepared = [];
  for (const raw of rows) {
    if (!isObject(raw)) {
      skip('invalid');
      continue;
    }
    if (isBlank(raw[pk])) {
      skip('missing_id');
      continue;
    }
    if (id === 'app_state' && (isProtectedAppStateKey(raw[pk]) || RETIRED_APP_STATE_KEYS.has(raw[pk]) || isWaitingStateKey(raw[pk]))) {
      skip('protected');
      continue;
    }
    if (id === 'app_state' && containsRedacted(raw.value)) {
      skip('redacted');
      continue;
    }
    const row = {};
    const dropped = new Set();
    const aiSettingsRow = id === 'app_state' && raw[pk] === AI_SETTINGS_STATE_KEY;
    for (const [col, type] of Object.entries(def.columns)) {
      if (!Object.hasOwn(raw, col) || raw[col] === undefined) continue;
      try {
        encodeValue(type, raw[col], col);
        row[col] = aiSettingsRow && col === 'value' ? safeAiSettingsValue(raw[col], existingAppStateValue(AI_SETTINGS_STATE_KEY, db)) : raw[col];
      } catch (e) {
        if (!(e instanceof DbError) || e.code !== 'invalid_value') throw e;
        // An unreadable value is null for a fresh insert (a required column then fails its
        // constraint and the row is skipped as invalid) but never overwrites an existing value.
        row[col] = null;
        dropped.add(col);
        result.invalidValues += 1;
      }
    }
    let key;
    try {
      key = encodeValue(def.columns[pk], row[pk], pk);
    } catch {
      skip('invalid');
      continue;
    }
    if (key === null) {
      skip('missing_id');
      continue;
    }
    prepared.push({ key, row, dropped });
  }

  // Parent keys: one query per referenced table/column into a Set (not one lookup per row).
  const parentSets = new Map();
  for (const fk of fks) {
    const refs = new Set();
    for (const { row } of prepared) {
      const ref = row[fk.column];
      if (ref === null || ref === undefined) continue;
      const refKey = encodeRef(fk, ref);
      if (refKey !== null) refs.add(refKey);
    }
    parentSets.set(fk, existingKeys(fk.references.table, fk.references.column, [...refs], db));
  }
  const accepted = [];
  for (const entry of prepared) {
    let orphan = false;
    for (const fk of fks) {
      const ref = entry.row[fk.column];
      if (ref === null || ref === undefined) continue;
      const refKey = encodeRef(fk, ref);
      if (refKey !== null && parentSets.get(fk).has(refKey)) continue;
      if (fk.onDelete === 'set null' || fk.onDelete === 'set_null') {
        entry.row[fk.column] = null;
        entry.dropped.delete(fk.column);
      } else orphan = true;
    }
    if (orphan) skip('orphan');
    else accepted.push(entry);
  }

  const existing = existingKeys(id, pk, [...new Set(accepted.map((p) => p.key))], db);
  for (const { key, row, dropped } of accepted) {
    try {
      // A failed single statement rolls back only itself, so no per-row savepoint is needed.
      upsert(id, row, { db, preserve: [...dropped] });
    } catch (e) {
      if (e instanceof DbError && (e.code === 'constraint' || e.code === 'invalid_value')) {
        skip('invalid');
        continue;
      }
      throw e;
    }
    if (existing.has(key)) result.updated += 1;
    else {
      result.inserted += 1;
      existing.add(key);
    }
  }
  return result;
}

/**
 * @typedef {{ id: string, received: number, inserted: number, updated: number, skipped: number,
 *   skippedReasons: { invalid: number, orphan: number, redacted: number, missing_id: number, protected: number },
 *   invalidValues: number }} ImportTableResult
 * @typedef {{ format: string, formatVersion: number, exportedAt: string|null, dryRun: boolean,
 *   tables: ImportTableResult[], ignoredTables: { id: string, reason: 'unknown_table'|'missing_file'|'not_importable' }[],
 *   totals: { received: number, inserted: number, updated: number, skipped: number } }} ImportResult
 */

/**
 * Applies a parsed archive in one transaction (rolled back for dryRun).
 * @param {ReturnType<typeof parseExportZip>} parsed
 * @param {{ db?: import('node:sqlite').DatabaseSync, dryRun?: boolean }} [opts]
 * @returns {ImportResult}
 */
export function importParsed(parsed, { db = getDb(), dryRun = false } = {}) {
  let tables = [];
  try {
    withTransaction(() => {
      // A numbered field's counter only goes up: remember it, import (an archive's own counter row is imported like any row),
      // then set it to the highest of the old state, the imported state and the highest stored number (also rolled back on a dry run).
      const spec = getAppSpec();
      const before = readAutoNumberStates({ db, spec });
      tables = IMPORT_ORDER.filter((id) => parsed.tables.has(id)).map((id) => importTable(id, parsed.tables.get(id), db));
      resyncAutoNumbers({ db, spec, before });
      if (dryRun) throw new DryRunRollback('dry run');
    }, db);
  } catch (e) {
    if (!(e instanceof DryRunRollback)) throw e;
  }
  const totals = { received: 0, inserted: 0, updated: 0, skipped: 0 };
  for (const t of tables) for (const k of Object.keys(totals)) totals[k] += t[k];
  return {
    format: parsed.format,
    formatVersion: parsed.formatVersion,
    exportedAt: typeof parsed.manifest?.exportedAt === 'string' ? parsed.manifest.exportedAt : null,
    dryRun,
    tables,
    ignoredTables: parsed.ignored ?? [],
    totals,
  };
}

/**
 * @param {Uint8Array} u8
 * @param {{ db?: import('node:sqlite').DatabaseSync, dryRun?: boolean, maxTotalBytes?: number }} [opts]
 * @returns {ImportResult}
 */
export function importZipBuffer(u8, { db, dryRun = false, maxTotalBytes } = {}) {
  return importParsed(parseExportZip(u8, { maxTotalBytes }), { db: db ?? getDb(), dryRun });
}
