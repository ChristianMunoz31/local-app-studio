import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  DB_FILENAME,
  DbError,
  FOREIGN_KEYS,
  IMPORT_ORDER,
  TABLES,
  closeDb,
  getDb,
  httpErrorFor,
  openDb,
  pingDb,
  resolveDbPath,
  toDbError,
} from '../db/index.js';
import { currentVersion, loadMigrations, migrate } from '../db/migrate.js';

let dir;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-app-studio-mig-'));
});
afterAll(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  } catch {
    /* ignore */
  }
});

// Highest shipped migration; every fresh database ends up here.
const LATEST = loadMigrations().length;

const tableNames = (db) =>
  db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);

describe('openDb and migrations', () => {
  it('creates the foundation tables plus schema_version, with WAL, FK and busy_timeout', () => {
    const file = path.join(dir, 'fresh.db');
    const db = openDb({ filename: file });
    try {
      const names = tableNames(db);
      expect(names).toHaveLength(9);
      expect(names).toContain('schema_version');
      expect(db.prepare('SELECT COUNT(*) AS n FROM schema_version').get().n).toBe(LATEST);
      expect(db.prepare('PRAGMA journal_mode').get().journal_mode).toBe('wal');
      expect(db.prepare('PRAGMA foreign_keys').get().foreign_keys).toBe(1);
      expect(db.prepare('PRAGMA busy_timeout').get().timeout).toBe(5000);
      expect(pingDb(db)).toBe(true);
    } finally {
      db.close();
    }
  });

  it('is idempotent on re-open', () => {
    const file = path.join(dir, 'idem.db');
    openDb({ filename: file }).close();
    const db = openDb({ filename: file });
    try {
      expect(db.prepare('SELECT COUNT(*) AS n FROM schema_version').get().n).toBe(LATEST);
      expect(migrate(db, { filename: file })).toEqual({ from: LATEST, to: LATEST, applied: [] });
    } finally {
      db.close();
    }
  });

  it('registers app_icontains and rejects double-quoted string literals', () => {
    const db = openDb({ filename: ':memory:' });
    try {
      expect(db.prepare("SELECT app_icontains('MUÑOZ', 'muñoz') AS r").get().r).toBe(1);
      expect(db.prepare('SELECT app_icontains(NULL, ?) AS r').get('x').r).toBe(0);
      expect(() => db.prepare('SELECT "no_such_column_literal"').get()).toThrow();
    } finally {
      db.close();
    }
  });

  it('closes the handle and throws a DbError when open fails', () => {
    const bad = path.join(dir, 'missing-dir', 'x.db');
    try {
      openDb({ filename: bad });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DbError);
      expect(e.code).toBe('db_unavailable');
      expect(e.status).toBe(503);
    }
  });

  it('refuses a database newer than the app and writes nothing', () => {
    const file = path.join(dir, 'newer.db');
    const db = openDb({ filename: file });
    db.prepare("INSERT INTO schema_version (version, name, applied_at) VALUES (99, 'future', 'now')").run();
    db.close();
    try {
      openDb({ filename: file });
      expect.unreachable();
    } catch (e) {
      expect(e.code).toBe('db_too_new');
    }
    const raw = new DatabaseSync(file);
    try {
      expect(raw.prepare('SELECT COUNT(*) AS n FROM schema_version').get().n).toBe(LATEST + 1);
      expect(currentVersion(raw)).toBe(99);
    } finally {
      raw.close();
    }
  });

  it('rolls back a failing migration and keeps the version', () => {
    const file = path.join(dir, 'fail.db');
    const db = openDb({ filename: file });
    try {
      const migrations = [
        ...loadMigrations(),
        { version: LATEST + 1, name: 'broken', sql: 'CREATE TABLE half_done (id TEXT); SELECT * FROM does_not_exist;' },
      ];
      try {
        migrate(db, { migrations, filename: file });
        expect.unreachable();
      } catch (e) {
        expect(e.code).toBe('migration_failed');
        expect(e.status).toBe(503);
      }
      expect(currentVersion(db)).toBe(LATEST);
      expect(tableNames(db)).not.toContain('half_done');
      // the handle is not left inside a transaction
      db.exec('BEGIN IMMEDIATE; ROLLBACK');
    } finally {
      db.close();
    }
  });

  it('applies a pending migration and backs up the existing database first', () => {
    const file = path.join(dir, 'upgrade.db');
    openDb({ filename: file }).close();
    const db = openDb({ filename: file, migrate: false });
    try {
      const migrations = [
        ...loadMigrations(),
        { version: LATEST + 1, name: 'extra', sql: 'CREATE TABLE extra_t (id TEXT PRIMARY KEY NOT NULL) STRICT;' },
      ];
      expect(migrate(db, { migrations, filename: file })).toEqual({ from: LATEST, to: LATEST + 1, applied: [LATEST + 1] });
      expect(fs.existsSync(`${file}.pre-v${LATEST + 1}.bak`)).toBe(true);
      expect(tableNames(db)).toContain('extra_t');
      expect(currentVersion(db)).toBe(LATEST + 1);
    } finally {
      db.close();
    }
    const backup = new DatabaseSync(`${file}.pre-v${LATEST + 1}.bak`);
    try {
      expect(tableNames(backup)).not.toContain('extra_t');
    } finally {
      backup.close();
    }
  });

  it('002_items.sql upgrades a v1 database: items appear, and the automatic pre-v2 .bak is the v1 file', () => {
    const file = path.join(dir, 'items-upgrade.db');
    const all = loadMigrations();
    const v1 = openDb({ filename: file, migrate: false });
    try {
      migrate(v1, { migrations: all.filter((m) => m.version <= 1), filename: file });
      expect(tableNames(v1)).not.toContain('items');
    } finally {
      v1.close();
    }
    const db = openDb({ filename: file, migrate: false });
    try {
      // Only 001 and 002: the backup is named after the target version, so this keeps it `pre-v2`.
      expect(migrate(db, { migrations: all.filter((m) => m.version <= 2), filename: file })).toMatchObject({ from: 1, to: 2 });
      expect(tableNames(db)).toContain('items');
      expect(fs.existsSync(`${file}.pre-v2.bak`)).toBe(true);
    } finally {
      db.close();
    }
    const backup = new DatabaseSync(`${file}.pre-v2.bak`);
    try {
      expect(currentVersion(backup)).toBe(1);
      expect(tableNames(backup)).not.toContain('items');
    } finally {
      backup.close();
    }
  });

  it('does not back up a fresh database', () => {
    const file = path.join(dir, 'nobackup.db');
    openDb({ filename: file }).close();
    expect(fs.existsSync(`${file}.pre-v1.bak`)).toBe(false);
  });
});

describe('loadMigrations', () => {
  it('loads every migration in order and rejects gaps', () => {
    expect(loadMigrations().map((m) => m.version)).toEqual(loadMigrations().map((_, i) => i + 1));
    const gap = fs.mkdtempSync(path.join(dir, 'gap-'));
    fs.writeFileSync(path.join(gap, '001_a.sql'), 'SELECT 1;');
    fs.writeFileSync(path.join(gap, '003_c.sql'), 'SELECT 1;');
    fs.writeFileSync(path.join(gap, 'notes.txt'), 'ignored');
    try {
      loadMigrations(gap);
      expect.unreachable();
    } catch (e) {
      expect(e.code).toBe('migration_failed');
    }
  });
});

describe('TABLES consistency', () => {
  it('matches PRAGMA table_info for every table', () => {
    const db = openDb({ filename: ':memory:' });
    try {
      for (const [name, def] of Object.entries(TABLES)) {
        const cols = db.prepare(`PRAGMA table_info("${name}")`).all().map((c) => c.name);
        expect(cols, name).toEqual(Object.keys(def.columns));
        expect(cols).toContain(def.primaryKey);
        for (const col of def.autoNow) expect(cols).toContain(col);
      }
      expect(tableNames(db).filter((n) => n !== 'schema_version').sort()).toEqual(Object.keys(TABLES).sort());
      expect(IMPORT_ORDER).toHaveLength(6);
      for (const fk of FOREIGN_KEYS) {
        expect(TABLES[fk.table].columns[fk.column]).toBe('uuid');
        expect(IMPORT_ORDER.indexOf(fk.references.table)).toBeLessThan(IMPORT_ORDER.indexOf(fk.table));
      }
    } finally {
      db.close();
    }
  });
  it('is frozen', () => {
    expect(Object.isFrozen(TABLES)).toBe(true);
    expect(Object.isFrozen(TABLES.app_state.columns)).toBe(true);
    expect(Object.isFrozen(IMPORT_ORDER)).toBe(true);
  });
});

describe('path resolution and singleton', () => {
  it('resolveDbPath uses APP_TEST_DATA_DIR under Vitest and throws without it', () => {
    expect(resolveDbPath()).toBe(path.join(process.env.APP_TEST_DATA_DIR, DB_FILENAME));
    const saved = process.env.APP_TEST_DATA_DIR;
    delete process.env.APP_TEST_DATA_DIR;
    try {
      expect(() => resolveDbPath()).toThrow(DbError);
    } finally {
      process.env.APP_TEST_DATA_DIR = saved;
    }
  });
  it('getDb opens a migrated singleton and closeDb is idempotent', () => {
    const a = getDb();
    expect(getDb()).toBe(a);
    expect(tableNames(a)).toContain('schema_version');
    closeDb();
    closeDb();
    expect(pingDb(a)).toBe(false);
    expect(getDb() === a).toBe(false);
    closeDb();
  });
  it('getDb failure is not cached and pingDb never throws', () => {
    const saved = process.env.APP_TEST_DATA_DIR;
    delete process.env.APP_TEST_DATA_DIR;
    try {
      expect(() => getDb()).toThrow(DbError);
      expect(pingDb()).toBe(false);
    } finally {
      process.env.APP_TEST_DATA_DIR = saved;
    }
    expect(pingDb()).toBe(true);
    closeDb();
  });
});

describe('errors', () => {
  it('toDbError passes DbError through and maps sqlite errors without leaking data', () => {
    const e = new DbError('not_found', 'x');
    expect(toDbError(e)).toBe(e);
    const db = openDb({ filename: ':memory:' });
    try {
      let raised;
      try {
        db.prepare('INSERT INTO app_state (key, value) VALUES (?, NULL)').run('secret-id');
      } catch (err) {
        raised = err;
      }
      const mapped = toDbError(raised);
      expect(mapped.code).toBe('constraint');
      expect(mapped.message).not.toContain('secret-id');
      let other;
      try {
        db.prepare('SELECT * FROM nope').get();
      } catch (err) {
        other = err;
      }
      expect(toDbError(other).code).toBe('sqlite_error');
      expect(toDbError(new Error('plain')).code).toBe('sqlite_error');
    } finally {
      db.close();
    }
  });
  it('httpErrorFor gives fixed, leak-free responses', () => {
    expect(httpErrorFor(new DbError('db_unavailable', 'x'))).toEqual({ status: 503, error: 'Local database is unavailable.' });
    expect(httpErrorFor(new DbError('migration_failed', 'x')).status).toBe(503);
    expect(httpErrorFor(new DbError('constraint', 'x'))).toEqual({ status: 400, error: 'Invalid input' });
    expect(httpErrorFor(new DbError('invalid_value', 'x')).status).toBe(400);
    expect(httpErrorFor(new DbError('not_found', 'x'))).toEqual({ status: 404, error: 'Not found' });
    expect(httpErrorFor(new DbError('unknown_table', 'x'))).toEqual({ status: 500, error: 'Server error' });
    expect(httpErrorFor(new Error('boom'))).toEqual({ status: 500, error: 'Server error' });
  });
});
