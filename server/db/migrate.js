// Forward-only SQL migrations. server/db/migrations/NNN_name.sql files are applied in order.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DbError } from './errors.js';
import { currentRequestId, startStage, withRequestId } from '../log.js';
import { nowIso } from './codec.js';
import { chmodBestEffort } from '../paths.js';
import { envDir } from '../runtime.js';
import { BUNDLED_APP_MODE, getAppMode } from '../appMode.js';
import { ftsTablesIn } from '../spec/fts.js';
import { getCompiledSpec } from '../spec/source.js';

export const MIGRATIONS_DIR = envDir('APP_MIGRATIONS_DIR') ?? fileURLToPath(new URL('./migrations/', import.meta.url));

const FILE_RE = /^(\d{3})_([a-z0-9_]+)\.sql$/;

const SCHEMA_VERSION_SQL = `CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
) STRICT;`;

/**
 * Reads migration files, sorted. Versions must be contiguous from 1.
 * @param {string} [dir]
 * @returns {Array<{ version: number, name: string, sql: string }>}
 */
export function loadMigrations(dir = MIGRATIONS_DIR) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (cause) {
    throw new DbError('migration_failed', 'Cannot read migrations directory', { cause });
  }
  const found = [];
  for (const file of names) {
    const m = FILE_RE.exec(file);
    if (!m) continue;
    found.push({ version: Number(m[1]), name: m[2], file });
  }
  found.sort((a, b) => a.version - b.version);
  found.forEach((entry, i) => {
    if (entry.version !== i + 1) {
      throw new DbError('migration_failed', 'Migration versions must be contiguous starting at 1');
    }
  });
  try {
    return found.map(({ version, name, file }) => ({
      version,
      name,
      sql: fs.readFileSync(path.join(dir, file), 'utf8'),
    }));
  } catch (cause) {
    throw new DbError('migration_failed', 'Cannot read migration file', { cause });
  }
}

/**
 * Highest applied version, 0 when none. Creates schema_version if missing.
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {number}
 */
export function currentVersion(db) {
  db.exec(SCHEMA_VERSION_SQL);
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get();
  return row && typeof row.v === 'number' ? row.v : 0;
}

function appliedVersion(db) {
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get();
  return row && typeof row.v === 'number' ? row.v : 0;
}

/**
 * Applies pending core-track migrations, each in its own transaction.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ migrations?: Array<{ version: number, name: string, sql: string }>, filename?: string }} [opts]
 * @returns {{ from: number, to: number, applied: number[] }}
 */
function migrateCore(db, { migrations = loadMigrations(), filename } = {}) {
  const from = currentVersion(db);
  const known = migrations.length ? migrations[migrations.length - 1].version : 0;
  if (from > known) {
    throw new DbError('db_too_new', 'Database was created by a newer version of the app');
  }
  const pending = migrations.filter((m) => m.version > from);
  if (pending.length === 0) return { from, to: from, applied: [] };

  const to = pending[pending.length - 1].version;
  const isRealFile = typeof filename === 'string' && filename !== '' && filename !== ':memory:' && fs.existsSync(filename);
  if (from > 0 && isRealFile) {
    const backup = `${filename}.pre-v${to}.bak`;
    const endBackup = startStage('migrate.backup', { track: 'core' });
    try {
      fs.rmSync(backup, { force: true });
      db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
      chmodBestEffort(backup, 0o600);
      endBackup();
    } catch (cause) {
      throw new DbError('migration_failed', 'Could not back up the database before migrating', { cause, step: 'backup' });
    }
  }

  const applied = [];
  for (const m of pending) {
    const endApply = startStage('migrate.apply', { track: 'core', version: m.version });
    try {
      db.exec('BEGIN IMMEDIATE');
    } catch (cause) {
      throw new DbError('migration_failed', `Migration ${m.version} could not start`, { cause });
    }
    try {
      // Another process may have applied this migration between our version read and taking the
      // write lock: re-read under the lock and skip it.
      if (appliedVersion(db) >= m.version) {
        db.exec('COMMIT');
        continue;
      }
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)').run(
        m.version,
        m.name,
        nowIso(),
      );
      db.exec('COMMIT');
      applied.push(m.version);
      endApply();
    } catch (cause) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // already rolled back by SQLite
      }
      throw new DbError('migration_failed', `Migration ${m.version} (${m.name}) failed`, { cause });
    }
  }
  return { from, to, applied };
}

// ---------------------------------------------------------------------------------------------
// App track (ADR-004): server/db/migrations/app/NNN_app.sql, table app_schema_version.
// ---------------------------------------------------------------------------------------------

export const APP_MIGRATIONS_DIR =
  (BUNDLED_APP_MODE !== 'runtime' ? envDir('APP_SPEC_MIGRATIONS_DIR') : undefined) ?? path.join(MIGRATIONS_DIR, 'app');

export const APP_SCHEMA_VERSION_SQL = `CREATE TABLE IF NOT EXISTS app_schema_version (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  applied_at TEXT NOT NULL
) STRICT;`;

const APP_LOCK_FILE = 'migrations.lock.json';
const REBUILD_MARKER = '-- app-migration: rebuild';

/**
 * sha256 hex of the text with CRLF normalized to LF.
 * @param {string} text
 * @returns {string}
 */
export function sha256Text(text) {
  return crypto.createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
}

function appMigrationFiles(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    names = [];
  }
  const found = [];
  for (const file of names) {
    const m = FILE_RE.exec(file);
    if (m) found.push({ version: Number(m[1]), name: m[2], file });
  }
  return found;
}

/**
 * The derived index statements (ADR-014) a runtime start with no app-migration files applies after the migrations: the
 * compiled spec's `indexSql`, else ''. A folder with migration files gets its indexes from the plans in those files.
 * @param {{ dir?: string, mode?: 'studio' | 'runtime', compiled?: { indexSql?: string } | null }} [opts]
 * @returns {string}
 */
export function loadDerivedIndexSql({ dir = APP_MIGRATIONS_DIR, mode = getAppMode(), compiled } = {}) {
  if (mode !== 'runtime' || appMigrationFiles(dir).length > 0) return '';
  const spec = compiled === undefined ? getCompiledSpec() : compiled;
  return typeof spec?.indexSql === 'string' ? spec.indexSql : '';
}

/**
 * The full text index statements (ADR-016) a runtime start with no app-migration files applies after the derived indexes:
 * the compiled spec's `ftsSql`, else ''. Same rule as loadDerivedIndexSql.
 * @param {{ dir?: string, mode?: 'studio' | 'runtime', compiled?: { ftsSql?: string } | null }} [opts]
 * @returns {string}
 */
export function loadFtsSql({ dir = APP_MIGRATIONS_DIR, mode = getAppMode(), compiled } = {}) {
  if (mode !== 'runtime' || appMigrationFiles(dir).length > 0) return '';
  const spec = compiled === undefined ? getCompiledSpec() : compiled;
  return typeof spec?.ftsSql === 'string' ? spec.ftsSql : '';
}

/**
 * Reads the app-track migrations. Studio mode has none. With no files in the folder and a compiled spec, the single
 * in-memory migration 1 is the spec's createSql (preview child, `npm start` with a baked spec, tests).
 * @param {{ dir?: string, mode?: 'studio' | 'runtime', compiled?: { createSql: string } | null }} [opts]
 * @returns {Array<{ version: number, name: string, sql: string, sha256: string }>}
 */
export function loadAppMigrations({ dir = APP_MIGRATIONS_DIR, mode = getAppMode(), compiled } = {}) {
  if (mode !== 'runtime') return [];
  const found = appMigrationFiles(dir);
  if (found.length === 0) {
    const spec = compiled === undefined ? getCompiledSpec() : compiled;
    if (!spec) return [];
    return [{ version: 1, name: 'app', sql: spec.createSql, sha256: sha256Text(spec.createSql) }];
  }
  found.sort((a, b) => a.version - b.version);
  found.forEach((entry, i) => {
    if (entry.version !== i + 1) {
      throw new DbError('migration_failed', 'App migration versions must be contiguous starting at 1');
    }
  });
  let lock = null;
  const lockPath = path.join(dir, APP_LOCK_FILE);
  if (fs.existsSync(lockPath)) {
    try {
      lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    } catch (cause) {
      throw new DbError('migration_failed', 'Cannot read the app migrations lock', { cause });
    }
  }
  try {
    return found.map(({ version, name, file }) => {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      const sha256 = sha256Text(sql);
      if (lock && (typeof lock !== 'object' || !Object.hasOwn(lock, file) || lock[file] !== sha256)) {
        throw new DbError('migration_failed', `App migration ${file} does not match the lock`);
      }
      return { version, name, sql, sha256 };
    });
  } catch (cause) {
    if (cause instanceof DbError) throw cause;
    throw new DbError('migration_failed', 'Cannot read app migration file', { cause });
  }
}

/**
 * Applies pending app-track migrations. An empty list creates nothing.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ migrations?: Array<{ version: number, name: string, sql: string, sha256: string }>, filename?: string, upTo?: number }} [opts]
 * @returns {{ from: number, to: number, applied: number[] }}
 */
export function migrateApp(db, { migrations = loadAppMigrations(), filename, upTo } = {}) {
  if (migrations.length === 0) return { from: 0, to: 0, applied: [] };
  db.exec(APP_SCHEMA_VERSION_SQL);
  const recorded = db.prepare('SELECT version, sha256 FROM app_schema_version ORDER BY version').all();
  const from = recorded.length ? recorded[recorded.length - 1].version : 0;
  const known = migrations[migrations.length - 1].version;
  if (from > known) throw new DbError('db_too_new', 'Database was created by a newer version of the app');
  for (const row of recorded) {
    const m = migrations.find((x) => x.version === row.version);
    if (!m || m.sha256 !== row.sha256) {
      throw new DbError('migration_failed', `App migration ${row.version} changed after it was applied`);
    }
  }
  const pending = migrations.filter((m) => m.version > from && (!Number.isInteger(upTo) || m.version <= upTo));
  if (pending.length === 0) return { from, to: from, applied: [] };

  const to = pending[pending.length - 1].version;
  const isRealFile = typeof filename === 'string' && filename !== '' && filename !== ':memory:' && fs.existsSync(filename);
  if (from > 0 && isRealFile) {
    const backup = `${filename}.pre-app-v${to}.bak`;
    const endBackup = startStage('migrate.backup', { track: 'app' });
    try {
      fs.rmSync(backup, { force: true });
      db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
      chmodBestEffort(backup, 0o600);
      endBackup();
    } catch (cause) {
      throw new DbError('migration_failed', 'Could not back up the database before migrating', { cause, step: 'backup' });
    }
  }

  const appliedNow = [];
  for (const m of pending) {
    const endApply = startStage('migrate.apply', { track: 'app', version: m.version });
    const rebuild = m.sql.split('\n', 1)[0].replace(/\r$/, '') === REBUILD_MARKER;
    try {
      if (rebuild) db.exec('PRAGMA foreign_keys = OFF');
      try {
        db.exec('BEGIN IMMEDIATE');
      } catch (cause) {
        throw new DbError('migration_failed', `App migration ${m.version} could not start`, { cause });
      }
      try {
        const row = db.prepare('SELECT MAX(version) AS v FROM app_schema_version').get();
        if (row && typeof row.v === 'number' && row.v >= m.version) {
          db.exec('COMMIT');
          continue;
        }
        db.exec(m.sql);
        if (rebuild && db.prepare('PRAGMA foreign_key_check').all().length > 0) {
          throw new Error('foreign_key_check failed');
        }
        db.prepare('INSERT INTO app_schema_version (version, name, sha256, applied_at) VALUES (?, ?, ?, ?)').run(
          m.version,
          m.name,
          m.sha256,
          nowIso(),
        );
        db.exec('COMMIT');
        appliedNow.push(m.version);
        endApply();
      } catch (cause) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // already rolled back by SQLite
        }
        if (cause instanceof DbError) throw cause;
        throw new DbError('migration_failed', `App migration ${m.version} (${m.name}) failed`, { cause });
      }
    } finally {
      if (rebuild) db.exec('PRAGMA foreign_keys = ON');
    }
  }
  return { from, to, applied: appliedNow };
}

/**
 * Applies the derived indexes (ADR-014) of a runtime start with no app-migration files. They are CREATE INDEX IF NOT
 * EXISTS, so the step is idempotent and never recorded in app_schema_version: migration 1 stays byte-identical to the
 * createSql an older compiler recorded, and a later spec change cannot make a recorded version mismatch. It runs after the
 * migrations (and after their pre-migration backup) in one transaction, so a failure leaves no half set of indexes.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} sql
 * @returns {void}
 */
export function applyDerivedIndexes(db, sql) {
  if (typeof sql !== 'string' || sql === '') return;
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.exec('COMMIT');
    } catch (cause) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // already rolled back by SQLite
      }
      throw cause;
    }
  } catch (cause) {
    throw new DbError('migration_failed', 'Derived indexes could not be created', { cause });
  }
}

/**
 * Applies the full text indexes (ADR-016) of a runtime start with no app-migration files: the idempotent `ftsSql`, then a
 * `rebuild` of exactly the indexes this call created (an external content index created on a table that already holds rows
 * is empty until it is rebuilt). An index that already existed is never rebuilt, so a start after the first one does nothing.
 * Like applyDerivedIndexes it is never recorded as a migration version and runs in one transaction.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} sql the compiled spec's ftsSql
 * @returns {string[]} the names of the indexes it created and filled
 */
export function applyFtsIndexes(db, sql) {
  if (typeof sql !== 'string' || sql === '') return [];
  const exists = db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?");
  const created = ftsTablesIn(sql).filter((name) => !exists.get(name));
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      for (const name of created) db.exec(`INSERT INTO "${name.replaceAll('"', '""')}"("${name.replaceAll('"', '""')}") VALUES('rebuild');`);
      db.exec('COMMIT');
    } catch (cause) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // already rolled back by SQLite
      }
      throw cause;
    }
  } catch (cause) {
    throw new DbError('migration_failed', 'Full text indexes could not be created', { cause });
  }
  return created;
}

/**
 * Runs the core track, then the app track. Returns the core result only.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ migrations?: Array<{ version: number, name: string, sql: string }>, appMigrations?: Array<{ version: number, name: string, sql: string, sha256: string }>, appVersion?: number, filename?: string, derivedIndexSql?: string, ftsSql?: string }} [opts]
 * `derivedIndexSql` and `ftsSql` default to the compiled spec's when the app migrations are not passed in, else to none.
 * @returns {{ from: number, to: number, applied: number[] }}
 */
export function migrate(db, { migrations, appMigrations, appVersion, filename, derivedIndexSql, ftsSql } = {}) {
  const run = () => {
    const endTotal = startStage('migrate.total');
    const result = migrateCore(db, { migrations, filename });
    const app = migrateApp(db, { migrations: appMigrations, filename, upTo: appVersion });
    const indexes = derivedIndexSql ?? (appMigrations === undefined && appVersion === undefined ? loadDerivedIndexSql() : '');
    if (indexes !== '') applyDerivedIndexes(db, indexes);
    applyFtsIndexes(db, ftsSql ?? (appMigrations === undefined && appVersion === undefined ? loadFtsSql() : ''));
    endTotal({ applied: result.applied.length + app.applied.length });
    return result;
  };
  // Startup has no request: its stages share the id `startup`. A migration inside a request keeps that request's id.
  return currentRequestId() === null ? withRequestId('startup', run) : run();
}
