// Snapshot and inspection of SQLite files: VACUUM INTO (same technique as the pre-migration .bak),
// integrity and shape checks, and a content fingerprint used to skip unchanged daily backups.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { TABLES } from '../db/tables.js';
import { loadAppMigrations, loadMigrations, migrate } from '../db/migrate.js';
import { createFsOps } from './fsops.js';

const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1');
const QUOTE = (name) => `"${String(name).replaceAll('"', '""')}"`;

let latestCache = null;
/** Highest schema version this build knows. */
export function latestSchemaVersion() {
  if (latestCache === null) {
    const all = loadMigrations();
    latestCache = all.length ? all[all.length - 1].version : 0;
  }
  return latestCache;
}

/**
 * Writes a consistent copy of a live database with VACUUM INTO.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} partialPath must not exist yet
 */
export function takeSnapshot(db, partialPath) {
  fs.rmSync(partialPath, { force: true });
  db.exec(`VACUUM INTO '${partialPath.replaceAll("'", "''")}'`);
}

/**
 * Makes a copy self-contained: rollback journal mode, no -wal or -shm files, and no saved API keys.
 * app_secrets is emptied with secure_delete on, so the ciphertext is zeroed in the file and not left in
 * free pages. Restore never reads the backup's keys (it carries the live ones), so nothing depends on them.
 * The strip runs with journal_mode MEMORY (after leaving WAL), so the pre-strip pages, which still hold
 * the ciphertext, are never written to an on-disk rollback journal; the file is put back to DELETE at rest.
 * @param {string} file
 */
export function normalizeSnapshot(file) {
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA trusted_schema = OFF');
    db.exec('PRAGMA journal_mode = DELETE');
    if (tableColumns(db, 'app_secrets').size > 0) {
      db.exec('PRAGMA journal_mode = MEMORY');
      db.exec('PRAGMA secure_delete = ON');
      db.exec('DELETE FROM app_secrets');
      db.exec('PRAGMA journal_mode = DELETE');
    }
  } finally {
    db.close();
  }
  fs.rmSync(`${file}-wal`, { force: true });
  fs.rmSync(`${file}-shm`, { force: true });
}

/**
 * True when the file starts with the SQLite magic header.
 * @param {string} file
 * @param {import('./fsops.js').FsOps} [fsOps]
 */
export async function checkSqliteHeader(file, fsOps = createFsOps()) {
  let handle;
  try {
    handle = await fsOps.open(file, 'r');
    const buf = Buffer.alloc(SQLITE_MAGIC.length);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    return bytesRead === buf.length && buf.equals(SQLITE_MAGIC);
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * Streamed SHA-256 of a file.
 * @param {string} file
 * @param {import('./fsops.js').FsOps} [fsOps]
 * @returns {Promise<string>}
 */
export async function sha256File(file, fsOps = createFsOps()) {
  const hash = crypto.createHash('sha256');
  const handle = await fsOps.open(file, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    for (;;) {
      const { bytesRead } = await handle.read(buf, 0, buf.length, null);
      if (bytesRead === 0) break;
      hash.update(buf.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

/** @param {import('node:sqlite').DatabaseSync} db @param {string} table */
function tableColumns(db, table) {
  const rows = db.prepare(`PRAGMA table_info(${QUOTE(table)})`).all();
  return new Set(rows.map((r) => r.name));
}

/**
 * Size the file claims in its header: page_count times page_size (a cheap header read, no scan).
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {number}
 */
export function databaseBytes(db) {
  const count = Number(db.prepare('PRAGMA page_count').get()?.page_count ?? 0);
  const size = Number(db.prepare('PRAGMA page_size').get()?.page_size ?? 4096);
  return count * size;
}

/**
 * SHA-256 over every TABLES table except audit_log: rows ordered by primary key, only allowlisted
 * identifiers (quoted) and only columns that exist in this file. Tables missing from an older
 * schema are skipped.
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {string}
 */
export function contentFingerprint(db) {
  const hash = crypto.createHash('sha256');
  for (const [table, def] of Object.entries(TABLES)) {
    if (table === 'audit_log') continue;
    const present = tableColumns(db, table);
    if (present.size === 0) continue;
    const columns = Object.keys(def.columns).filter((c) => present.has(c));
    if (!columns.includes(def.primaryKey)) continue;
    hash.update(`#${table}\n`);
    const sql = `SELECT ${columns.map(QUOTE).join(', ')} FROM ${QUOTE(table)} ORDER BY ${QUOTE(def.primaryKey)}`;
    for (const row of db.prepare(sql).iterate()) {
      hash.update(JSON.stringify(columns.map((c) => row[c])));
      hash.update('\n');
    }
  }
  return hash.digest('hex');
}

/**
 * Row counts per TABLES table that exists (audit_log is not counted).
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {{ rowCounts: Record<string, number>, totalRows: number }}
 */
export function countRows(db) {
  const rowCounts = {};
  let totalRows = 0;
  for (const table of Object.keys(TABLES)) {
    if (table === 'audit_log') continue;
    if (tableColumns(db, table).size === 0) continue;
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${QUOTE(table)}`).get();
    const n = Number(row?.n ?? 0);
    rowCounts[table] = n;
    totalRows += n;
  }
  return { rowCounts, totalRows };
}

const shapeCache = new Map();

/** Highest app-track version this build knows (0 when it has no app migrations). */
function latestAppSchemaVersion() {
  const all = loadAppMigrations();
  return all.length ? all[all.length - 1].version : 0;
}

/** The app-track schema version a backup recorded (ADR-004, table app_schema_version); 0 when it has none. */
function appSchemaVersion(db) {
  if (tableColumns(db, 'app_schema_version').size === 0) return 0;
  const row = db.prepare('SELECT MAX(version) AS v FROM app_schema_version').get();
  return typeof row?.v === 'number' ? row.v : 0;
}

/**
 * Sorted schema object list (type, name, table, normalized SQL) a fresh database has at core version `version` and
 * app-track version `appVersion` (0: no app-track objects, not even app_schema_version).
 */
function expectedShape(version, appVersion = 0) {
  const key = `${version}:${appVersion}`;
  if (shapeCache.has(key)) return shapeCache.get(key);
  const db = new DatabaseSync(':memory:');
  try {
    migrate(db, {
      migrations: loadMigrations().filter((m) => m.version <= version),
      ...(appVersion > 0 ? { appVersion } : { appMigrations: [] }),
    });
    const shape = shapeOf(db);
    shapeCache.set(key, shape);
    return shape;
  } finally {
    db.close();
  }
}

function shapeOf(db) {
  return db
    .prepare(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY type, name",
    )
    .all()
    .map((r) => `${r.type}|${r.name}|${r.tbl_name}|${typeof r.sql === 'string' ? r.sql.replace(/\s+/g, ' ').trim() : ''}`);
}

/**
 * Opens a file read-only and reports integrity, schema version, counts, fingerprint and whether
 * its schema objects match a fresh database at the same version (no extra triggers or views). A core or app-track
 * version newer than this build knows gives shapeOk null.
 * Throws when the file cannot be opened as a database, or (code 'too_large', before any integrity scan)
 * when its header claims more than `maxBytes`.
 * @param {string} file
 * @param {{ latestVersion?: number, maxBytes?: number | null }} [opts]
 * @returns {{ integrityOk: boolean, schemaVersion: number | null, rowCounts: Record<string, number>,
 *   totalRows: number, fingerprint: string | null, shapeOk: boolean | null }}
 */
export function inspectDbFile(file, { latestVersion = latestSchemaVersion(), maxBytes = null } = {}) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec('PRAGMA trusted_schema = OFF');
    if (maxBytes !== null && databaseBytes(db) > maxBytes) {
      throw Object.assign(new Error('too_large'), { code: 'too_large' });
    }
    const integrity = db.prepare('PRAGMA integrity_check').all();
    const integrityOk = integrity.length === 1 && Object.values(integrity[0])[0] === 'ok';
    if (!integrityOk) {
      return { integrityOk, schemaVersion: null, rowCounts: {}, totalRows: 0, fingerprint: null, shapeOk: null };
    }
    let schemaVersion = null;
    if (tableColumns(db, 'schema_version').size > 0) {
      const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get();
      schemaVersion = typeof row?.v === 'number' ? row.v : null;
    }
    if (schemaVersion === null) {
      return { integrityOk, schemaVersion, rowCounts: {}, totalRows: 0, fingerprint: null, shapeOk: null };
    }
    const { rowCounts, totalRows } = countRows(db);
    const fingerprint = contentFingerprint(db);
    const appVersion = appSchemaVersion(db);
    // A newer version on either track (core or app) is unknown to this build: shapeOk null, as for the core track.
    const shapeOk =
      schemaVersion > latestVersion || (appVersion > 0 && appVersion > latestAppSchemaVersion())
        ? null
        : JSON.stringify(shapeOf(db)) === JSON.stringify(expectedShape(schemaVersion, appVersion));
    return { integrityOk, schemaVersion, rowCounts, totalRows, fingerprint, shapeOk };
  } finally {
    db.close();
  }
}
