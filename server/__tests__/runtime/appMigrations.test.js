// The app-track runner: app_schema_version, hash checks, .bak, rebuilds and the in-memory 001.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../../db/index.js';
import { applyFtsIndexes, loadMigrations, loadAppMigrations, loadDerivedIndexSql, loadFtsSql, migrate, migrateApp, sha256Text } from '../../db/migrate.js';
import { compileSpec, planMigration } from '../../spec/compile.js';

const fixture = () => JSON.parse(fs.readFileSync(new URL('../../../packages/runtime/src/spec/fixtures/crew-roster.json', import.meta.url), 'utf8'));
const crews = (s) => s.tables.find((t) => t.id === 'crews');
const mig = (version, sql) => ({ version, name: 'app', sql, sha256: sha256Text(sql) });

let root;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'las-appmig-'));
});
afterAll(() => {
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  } catch {
    /* Windows EBUSY: leak tmp */
  }
});

const tableExists = (db, name) => db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;
const now = '2026-01-01T00:00:00.000Z';

describe('loadAppMigrations', () => {
  it('is empty in studio mode', () => {
    expect(loadAppMigrations({ mode: 'studio', dir: root, compiled: compileSpec(fixture()) })).toEqual([]);
  });

  it('builds the in-memory 001 from createSql when the folder has no files', () => {
    const compiled = compileSpec(fixture());
    const list = loadAppMigrations({ mode: 'runtime', dir: path.join(root, 'absent'), compiled });
    expect(list).toEqual([{ version: 1, name: 'app', sql: compiled.createSql, sha256: sha256Text(compiled.createSql) }]);
    expect(loadAppMigrations({ mode: 'runtime', dir: path.join(root, 'absent'), compiled: null })).toEqual([]);
  });

  it('reads contiguous files and checks the lock', () => {
    const dir = fs.mkdtempSync(path.join(root, 'files-'));
    const first = compileSpec(fixture()).createSql;
    fs.writeFileSync(path.join(dir, '001_app.sql'), first.replaceAll('\n', '\r\n'));
    expect(loadAppMigrations({ mode: 'runtime', dir, compiled: null })[0].sha256).toBe(sha256Text(first));
    fs.writeFileSync(path.join(dir, 'migrations.lock.json'), JSON.stringify({ '001_app.sql': sha256Text(first) }));
    expect(loadAppMigrations({ mode: 'runtime', dir, compiled: null })).toHaveLength(1);
    fs.writeFileSync(path.join(dir, 'migrations.lock.json'), JSON.stringify({ '001_app.sql': 'f'.repeat(64) }));
    expect(() => loadAppMigrations({ mode: 'runtime', dir, compiled: null })).toThrow(/lock/);
    fs.writeFileSync(path.join(dir, 'migrations.lock.json'), '{}');
    expect(() => loadAppMigrations({ mode: 'runtime', dir, compiled: null })).toThrow(/lock/);
    fs.rmSync(path.join(dir, 'migrations.lock.json'));
    fs.writeFileSync(path.join(dir, '003_app.sql'), '-- x\n');
    expect(() => loadAppMigrations({ mode: 'runtime', dir, compiled: null })).toThrow(/contiguous/);
  });
});

const indexNames = (db) =>
  db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx:%' ORDER BY name")
    .all()
    .map((r) => r.name);

describe('derived indexes with no migration files (ADR-014)', () => {
  it('loadDerivedIndexSql is the compiled indexSql only in runtime mode with no files', () => {
    const compiled = compileSpec(fixture());
    expect(compiled.indexSql).toContain('CREATE INDEX IF NOT EXISTS "idx:crews:name"');
    const absent = path.join(root, 'absent-idx');
    expect(loadDerivedIndexSql({ mode: 'runtime', dir: absent, compiled })).toBe(compiled.indexSql);
    expect(loadDerivedIndexSql({ mode: 'studio', dir: absent, compiled })).toBe('');
    expect(loadDerivedIndexSql({ mode: 'runtime', dir: absent, compiled: null })).toBe('');
    const dir = fs.mkdtempSync(path.join(root, 'withfiles-'));
    fs.writeFileSync(path.join(dir, '001_app.sql'), compiled.createSql);
    expect(loadDerivedIndexSql({ mode: 'runtime', dir, compiled })).toBe('');
  });

  it('a database first opened with the base createSql starts again and gains the indexes, unrecorded', () => {
    const filename = path.join(fs.mkdtempSync(path.join(root, 'db-idx-')), 'app.db');
    const compiled = compileSpec(fixture());
    // The old compiler recorded sha256(createSql); createSql is byte-identical today, so the same text and sha are used.
    const first = mig(1, compiled.createSql);
    const old = openDb({ filename, migrate: false });
    migrateApp(old, { migrations: [first], filename });
    expect(indexNames(old)).toEqual(['idx:crews:lead_id']);
    old.close();

    for (let start = 0; start < 2; start += 1) {
      const db = openDb({ filename, migrate: false });
      expect(() => migrate(db, { appMigrations: [first], derivedIndexSql: compiled.indexSql, filename })).not.toThrow();
      expect(indexNames(db)).toEqual(['idx:crews:lead_id', 'idx:crews:name', 'idx:crews:status']);
      expect(db.prepare('SELECT version, sha256 FROM app_schema_version').all()).toEqual([{ version: 1, sha256: first.sha256 }]);
      db.close();
    }
  });

  it('a failing index script rolls back as a whole and says migration_failed', () => {
    const db = openDb({ filename: ':memory:' });
    migrateApp(db, { migrations: [mig(1, compileSpec(fixture()).createSql)] });
    const sql = 'CREATE INDEX IF NOT EXISTS "idx:crews:name" ON "crews" ("name");\nCREATE INDEX IF NOT EXISTS "idx:crews:nope" ON "crews" ("nope");\n';
    expect(() => migrate(db, { appMigrations: [mig(1, compileSpec(fixture()).createSql)], derivedIndexSql: sql })).toThrow(expect.objectContaining({ code: 'migration_failed' }));
    expect(indexNames(db)).toEqual(['idx:crews:lead_id']);
    db.close();
  });
});

describe('full text indexes with no migration files (ADR-016)', () => {
  const ftsNames = (db) =>
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'fts:%' AND name NOT LIKE 'fts:%!_%' ESCAPE '!' ORDER BY name")
      .all()
      .map((r) => r.name);
  const hitIds = (db, term) =>
    db
      .prepare('SELECT "id" FROM "crews" WHERE rowid IN (SELECT rowid FROM "fts:crews" WHERE "fts:crews" MATCH ?) ORDER BY "id"')
      .all(`"${term}"`)
      .map((r) => r.id);

  it('loadFtsSql is the compiled ftsSql only in runtime mode with no files', () => {
    const compiled = compileSpec(fixture());
    expect(compiled.ftsSql).toContain('CREATE VIRTUAL TABLE IF NOT EXISTS "fts:crews"');
    const absent = path.join(root, 'absent-fts');
    expect(loadFtsSql({ mode: 'runtime', dir: absent, compiled })).toBe(compiled.ftsSql);
    expect(loadFtsSql({ mode: 'studio', dir: absent, compiled })).toBe('');
    expect(loadFtsSql({ mode: 'runtime', dir: absent, compiled: null })).toBe('');
    const dir = fs.mkdtempSync(path.join(root, 'withfiles-fts-'));
    fs.writeFileSync(path.join(dir, '001_app.sql'), compiled.createSql);
    expect(loadFtsSql({ mode: 'runtime', dir, compiled })).toBe('');
  });

  it('an old database with rows gains the indexes once, filled from the rows, and later starts do not rebuild', () => {
    const filename = path.join(fs.mkdtempSync(path.join(root, 'db-fts-')), 'app.db');
    const compiled = compileSpec(fixture());
    const first = mig(1, compiled.createSql);
    const old = openDb({ filename, migrate: false });
    migrateApp(old, { migrations: [first], filename });
    expect(ftsNames(old)).toEqual([]);
    for (const [id, name] of [['c1', 'Pump crew'], ['c2', 'Roof crew']]) {
      old.prepare('INSERT INTO "crews" ("id","name","size","status","created_at","updated_at") VALUES (?,?,?,?,?,?)').run(id, name, 1, 'active', now, now);
    }
    old.close();

    const db = openDb({ filename, migrate: false });
    migrate(db, { appMigrations: [first], ftsSql: compiled.ftsSql, filename });
    expect(ftsNames(db)).toEqual(['fts:crews', 'fts:people']);
    expect(hitIds(db, 'pump')).toEqual(['c1']);
    expect(db.prepare('SELECT version, sha256 FROM app_schema_version').all()).toEqual([{ version: 1, sha256: first.sha256 }]);
    // A later start must not rebuild: poison the index with a row the table lacks and see that it survives a second start.
    db.exec(`INSERT INTO "fts:crews"(rowid, "name") VALUES (999, 'ghost')`);
    expect(hitIds(db, 'ghost')).toEqual([]);
    expect(applyFtsIndexes(db, compiled.ftsSql)).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM "fts:crews" WHERE "fts:crews" MATCH ?').get('"ghost"').n).toBe(1);
    db.close();
  });

  it('only the index that is missing is created and filled', () => {
    const db = openDb({ filename: ':memory:' });
    const compiled = compileSpec(fixture());
    migrateApp(db, { migrations: [mig(1, compiled.createSql)] });
    expect(applyFtsIndexes(db, compiled.ftsSql)).toEqual(['fts:people', 'fts:crews']);
    db.exec('DROP TRIGGER "fts:people:ai"; DROP TRIGGER "fts:people:ad"; DROP TRIGGER "fts:people:au"; DROP TABLE "fts:people";');
    expect(applyFtsIndexes(db, compiled.ftsSql)).toEqual(['fts:people']);
    expect(applyFtsIndexes(db, '')).toEqual([]);
    db.close();
  });

  it('a failing script rolls back as a whole and says migration_failed', () => {
    const db = openDb({ filename: ':memory:' });
    const compiled = compileSpec(fixture());
    migrateApp(db, { migrations: [mig(1, compiled.createSql)] });
    const sql = `${compiled.ftsSql}CREATE VIRTUAL TABLE IF NOT EXISTS "fts:zzz" USING fts5("nope", content='zzz', content_rowid='rowid');
`;
    expect(() => applyFtsIndexes(db, sql)).toThrow(expect.objectContaining({ code: 'migration_failed' }));
    expect(ftsNames(db)).toEqual([]);
    db.close();
  });
});

describe('migrateApp', () => {
  it('an empty list creates nothing', () => {
    const db = openDb({ filename: ':memory:' });
    expect(migrateApp(db, { migrations: [] })).toEqual({ from: 0, to: 0, applied: [] });
    expect(tableExists(db, 'app_schema_version')).toBe(false);
    db.close();
  });

  it('applies, records the hash, and is idempotent', () => {
    const db = openDb({ filename: ':memory:' });
    const list = [mig(1, compileSpec(fixture()).createSql)];
    expect(migrateApp(db, { migrations: list })).toEqual({ from: 0, to: 1, applied: [1] });
    expect(migrateApp(db, { migrations: list })).toEqual({ from: 1, to: 1, applied: [] });
    expect(db.prepare('SELECT version, name, sha256 FROM app_schema_version').all()).toEqual([{ version: 1, name: 'app', sha256: list[0].sha256 }]);
    expect(tableExists(db, 'crews')).toBe(true);
    db.close();
  });

  it('refuses a newer database and a changed migration', () => {
    const db = openDb({ filename: ':memory:' });
    const one = mig(1, 'CREATE TABLE "a" ("id" TEXT PRIMARY KEY) STRICT;');
    const two = mig(2, 'CREATE TABLE "b" ("id" TEXT PRIMARY KEY) STRICT;');
    migrateApp(db, { migrations: [one, two] });
    expect(() => migrateApp(db, { migrations: [one] })).toThrow(expect.objectContaining({ code: 'db_too_new' }));
    expect(() => migrateApp(db, { migrations: [one, mig(2, '-- changed\n')] })).toThrow(expect.objectContaining({ code: 'migration_failed' }));
    db.close();
  });

  it('rolls a failing migration back', () => {
    const db = openDb({ filename: ':memory:' });
    const bad = mig(1, 'CREATE TABLE "a" ("id" TEXT PRIMARY KEY) STRICT; INSERT INTO "nope" VALUES (1);');
    expect(() => migrateApp(db, { migrations: [bad] })).toThrow(expect.objectContaining({ code: 'migration_failed' }));
    expect(tableExists(db, 'a')).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS n FROM app_schema_version').get().n).toBe(0);
    db.close();
  });

  it('upTo applies only versions up to it', () => {
    const db = openDb({ filename: ':memory:' });
    const list = [mig(1, 'CREATE TABLE "a" ("id" TEXT PRIMARY KEY) STRICT;'), mig(2, 'CREATE TABLE "b" ("id" TEXT PRIMARY KEY) STRICT;')];
    expect(migrateApp(db, { migrations: list, upTo: 1 })).toEqual({ from: 0, to: 1, applied: [1] });
    expect(tableExists(db, 'b')).toBe(false);
    db.close();
  });

  it('takes a .bak before a pending migration and runs a rebuild that keeps rows and foreign keys', () => {
    const filename = path.join(fs.mkdtempSync(path.join(root, 'db-')), 'app.db');
    const db = openDb({ filename, migrate: false });
    const v1 = fixture();
    const v2 = fixture();
    crews(v2).fields.find((f) => f.id === 'status').options.push('retired');
    const first = mig(1, compileSpec(v1).createSql);
    migrateApp(db, { migrations: [first], filename });
    expect(fs.existsSync(`${filename}.pre-app-v1.bak`)).toBe(false);
    db.prepare('INSERT INTO "people" VALUES (?, ?, ?, ?)').run('p1', 'Ann', now, now);
    db.prepare('INSERT INTO "crews" ("id","name","lead_id","status","created_at","updated_at") VALUES (?,?,?,?,?,?)').run('c1', 'A', 'p1', 'paused', now, now);

    const plan = planMigration(v1, v2, { version: 2 });
    const second = mig(2, plan.file.sql);
    expect(second.sql.startsWith('-- app-migration: rebuild')).toBe(true);
    expect(migrateApp(db, { migrations: [first, second], filename })).toEqual({ from: 1, to: 2, applied: [2] });
    expect(fs.existsSync(`${filename}.pre-app-v2.bak`)).toBe(true);
    expect(db.prepare('SELECT "lead_id", "status" FROM "crews"').get()).toEqual({ lead_id: 'p1', status: 'paused' });
    expect(db.prepare('PRAGMA foreign_keys').get().foreign_keys).toBe(1);
    db.prepare('INSERT INTO "crews" ("id","name","status","created_at","updated_at") VALUES (?,?,?,?,?)').run('c2', 'B', 'retired', now, now);
    db.prepare('DELETE FROM "people" WHERE "id" = ?').run('p1');
    expect(db.prepare('SELECT "lead_id" FROM "crews" WHERE "id" = ?').get('c1').lead_id).toBeNull();
    db.close();
  });

  it('a rebuild that leaves a dangling foreign key is rolled back', () => {
    const db = openDb({ filename: ':memory:' });
    const first = mig(1, 'CREATE TABLE "p" ("id" TEXT PRIMARY KEY) STRICT; CREATE TABLE "c" ("id" TEXT PRIMARY KEY, "p_id" TEXT REFERENCES "p" ("id")) STRICT;');
    migrateApp(db, { migrations: [first] });
    const bad = mig(2, '-- app-migration: rebuild\nINSERT INTO "c" VALUES (\'x\', \'ghost\');\n');
    expect(() => migrateApp(db, { migrations: [first, bad] })).toThrow(expect.objectContaining({ code: 'migration_failed' }));
    expect(db.prepare('SELECT COUNT(*) AS n FROM "c"').get().n).toBe(0);
    expect(db.prepare('PRAGMA foreign_keys').get().foreign_keys).toBe(1);
    db.close();
  });
});

describe('migrate', () => {
  it('keeps the core result shape and runs the app track after it', () => {
    const db = openDb({ filename: ':memory:', migrate: false });
    const core = loadMigrations();
    const result = migrate(db, { migrations: core, appMigrations: [mig(1, 'CREATE TABLE "a" ("id" TEXT PRIMARY KEY) STRICT;')] });
    expect(result).toEqual({ from: 0, to: core.length, applied: core.map((m) => m.version) });
    expect(tableExists(db, 'a')).toBe(true);
    db.close();
  });

  it('appVersion limits the app track', () => {
    const db = openDb({ filename: ':memory:', migrate: false });
    migrate(db, { appMigrations: [mig(1, 'CREATE TABLE "a" ("id" TEXT PRIMARY KEY) STRICT;'), mig(2, 'CREATE TABLE "b" ("id" TEXT PRIMARY KEY) STRICT;')], appVersion: 1 });
    expect(tableExists(db, 'b')).toBe(false);
    db.close();
  });

  it('studio mode leaves no app table behind', () => {
    const db = openDb({ filename: ':memory:' });
    expect(tableExists(db, 'app_schema_version')).toBe(false);
    db.close();
  });
});
