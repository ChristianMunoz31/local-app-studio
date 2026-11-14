// The full text index DDL (ADR-016): a golden file, which fields are indexed, the create/alter/rebuild plans, and the
// triggers keeping the index in step on a plain SQLite database (no query.js, so no runtime mode is needed here).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { compileSpec, planMigration } from '../../spec/compile.js';
import { createFtsStatements, dropFtsStatements, ftsColumns, ftsSqlText, ftsTableName, ftsTablesIn, ftsTriggerName, recreateFtsStatements } from '../../spec/fts.js';

const FIXTURE = new URL('../../../packages/runtime/src/spec/fixtures/crew-roster.json', import.meta.url);
const GOLDEN = new URL('./golden/', import.meta.url);
const fixture = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const crews = (s) => s.tables.find((t) => t.id === 'crews');
const withEdit = (edit) => {
  const spec = fixture();
  edit(spec);
  return spec;
};

function golden(name, actual) {
  const file = new URL(name, GOLDEN);
  if (process.env.UPDATE_GOLDEN === '1') fs.writeFileSync(file, actual, 'utf8');
  expect(actual).toBe(fs.readFileSync(file, 'utf8'));
}

const now = '2026-01-01T00:00:00.000Z';
const memoryDb = () => new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
// What a built app has: createSql, then the full text step of a start with no migration files.
const builtDb = (spec = fixture()) => {
  const db = memoryDb();
  const compiled = compileSpec(spec);
  db.exec(compiled.createSql);
  db.exec(compiled.ftsSql);
  return db;
};
const integrity = (db, table) => db.exec(`INSERT INTO "fts:${table}"("fts:${table}", rank) VALUES('integrity-check', 1)`);
const hits = (db, table, columns, term) =>
  db
    .prepare(`SELECT "id" FROM "${table}" WHERE rowid IN (SELECT rowid FROM "fts:${table}" WHERE "fts:${table}" MATCH ?) ORDER BY "id"`)
    .all(`{${columns.map((c) => `"${c}"`).join(' ')}} : "${term.replaceAll('"', '""')}"`)
    .map((r) => r.id);
const addCrew = (db, id, name) =>
  db.prepare('INSERT INTO "crews" ("id","name","size","status","created_at","updated_at") VALUES (?,?,?,?,?,?)').run(id, name, 1, 'active', now, now);

const SAMPLE_TABLE = {
  id: 'tickets',
  fields: [
    { id: 'subject', type: 'text' },
    { id: 'rank', type: 'text' },
    { id: 'or', type: 'longtext' },
    { id: 'priority', type: 'integer' },
    { id: 'kind', type: 'select', options: ['a'] },
    { id: 'owner', type: 'reference', table: 'people' },
  ],
};

describe('which fields are indexed', () => {
  it('indexes text and longtext, in field order, and leaves out the names FTS5 reserves', () => {
    expect(ftsColumns(SAMPLE_TABLE)).toEqual(['subject', 'or']);
    expect(ftsColumns({ fields: [{ id: 'n', type: 'integer' }, { id: 'k', type: 'select' }, { id: 'r', type: 'real' }] })).toEqual([]);
    expect(createFtsStatements({ id: 'nums', fields: [{ id: 'n', type: 'integer' }] })).toEqual([]);
    expect(recreateFtsStatements({ id: 'nums', fields: [{ id: 'n', type: 'integer' }] })).toEqual([]);
  });

  it('names the index and the triggers from the table id', () => {
    expect(ftsTableName('crews')).toBe('fts:crews');
    expect(['ai', 'ad', 'au'].map((k) => ftsTriggerName('crews', k))).toEqual(['fts:crews:ai', 'fts:crews:ad', 'fts:crews:au']);
    expect(dropFtsStatements({ id: 'crews' })).toEqual([
      'DROP TRIGGER IF EXISTS "fts:crews:ai";',
      'DROP TRIGGER IF EXISTS "fts:crews:ad";',
      'DROP TRIGGER IF EXISTS "fts:crews:au";',
      'DROP TABLE IF EXISTS "fts:crews";',
    ]);
  });

  it('the DDL matches the golden file and creates on a database (reserved and keyword field names included)', () => {
    const sql = `${createFtsStatements(SAMPLE_TABLE).join('\n')}\n`;
    golden('fts-table.sql', sql);
    const db = memoryDb();
    db.exec('CREATE TABLE "tickets" ("id" TEXT PRIMARY KEY NOT NULL, "subject" TEXT, "rank" TEXT, "or" TEXT) STRICT;');
    db.exec(sql);
    db.prepare('INSERT INTO "tickets" VALUES (?, ?, ?, ?)').run('t1', 'Broken pump', 'high', 'not near');
    expect(hits(db, 'tickets', ['subject', 'or'], 'pump')).toEqual(['t1']);
    expect(hits(db, 'tickets', ['or'], 'not near')).toEqual(['t1']);
    expect(hits(db, 'tickets', ['subject'], 'high')).toEqual([]);
  });
});

describe('the create script, the first plan and the fts step', () => {
  const nums = (s) => s.tables.push({ id: 'counters', label: 'Counters', fields: [{ id: 'n', label: 'N', type: 'integer' }] });

  it('createSql has no full text index (hashes of it are stored); ftsSql is its own idempotent text', () => {
    const { createSql, ftsSql } = compileSpec(withEdit(nums));
    expect(createSql).not.toContain('fts:');
    expect(ftsSql).toContain('CREATE VIRTUAL TABLE IF NOT EXISTS "fts:people" USING fts5("name", content=\'people\'');
    expect(ftsSql).toContain('CREATE TRIGGER IF NOT EXISTS "fts:crews:au"');
    expect(ftsSql).not.toContain('"fts:counters"');
    expect(ftsSql).not.toContain('\r');
    expect(ftsSql).not.toContain('rebuild');
    expect(ftsSql.endsWith('\n')).toBe(true);
    expect(ftsSqlText([{ id: 'n', fields: [{ id: 'n', type: 'integer' }] }])).toBe('');
    golden('crew-roster.fts.sql', compileSpec(fixture()).ftsSql);
  });

  it('the first plan follows each table that has a text field with its index, and only those', () => {
    const sql = planMigration(null, withEdit(nums)).file.sql;
    expect(sql).toContain('CREATE VIRTUAL TABLE "fts:people" USING fts5("name", content=\'people\'');
    expect(sql).toContain('CREATE VIRTUAL TABLE "fts:crews" USING fts5("name", content=\'crews\'');
    expect(sql).not.toContain('"fts:counters"');
    expect(sql).not.toContain("VALUES ('rebuild')");
    expect(sql.indexOf('CREATE TABLE "crews"')).toBeLessThan(sql.indexOf('CREATE VIRTUAL TABLE "fts:crews"'));
    expect(sql.indexOf('CREATE VIRTUAL TABLE "fts:people"')).toBeLessThan(sql.indexOf('CREATE TABLE "crews"'));
    expect(sql).not.toContain('\r');
  });

  it('the first plan runs on a fresh database and every statement is accepted', () => {
    const db = memoryDb();
    db.exec(planMigration(null, fixture()).file.sql);
    const names = db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'fts:%' ORDER BY name").all().map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['fts:crews', 'fts:crews:ad', 'fts:crews:ai', 'fts:crews:au', 'fts:people']));
    integrity(db, 'crews');
    integrity(db, 'people');
  });

  it('ftsSql runs on a database made from createSql, twice, and the second run changes nothing', () => {
    const db = builtDb();
    const before = db.prepare("SELECT name, sql FROM sqlite_master WHERE name LIKE 'fts:%' ORDER BY name").all();
    db.exec(compileSpec(fixture()).ftsSql);
    expect(db.prepare("SELECT name, sql FROM sqlite_master WHERE name LIKE 'fts:%' ORDER BY name").all()).toEqual(before);
    integrity(db, 'crews');
  });

  it('ftsTablesIn names the indexes a script creates', () => {
    expect(ftsTablesIn(compileSpec(fixture()).ftsSql)).toEqual(['fts:people', 'fts:crews']);
    expect(ftsTablesIn('')).toEqual([]);
  });
});

describe('the alter, rebuild and unchanged plans', () => {
  it('a new searchable field drops, recreates and fills the index after the column exists', () => {
    const plan = planMigration(fixture(), withEdit((s) => crews(s).fields.push({ id: 'notes', label: 'Notes', type: 'longtext' })));
    const sql = plan.file.sql;
    expect(sql.startsWith('-- app-migration: alter\n')).toBe(true);
    const order = [
      'ADD COLUMN "notes"',
      'DROP TABLE IF EXISTS "fts:crews"',
      'CREATE VIRTUAL TABLE "fts:crews" USING fts5("name", "notes"',
      "VALUES ('rebuild')",
    ].map((s) => sql.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(sql).not.toContain('"fts:people"');
  });

  it('a new field that is not text leaves the index alone', () => {
    const plan = planMigration(fixture(), withEdit((s) => crews(s).fields.push({ id: 'cost', label: 'Cost', type: 'real' })));
    expect(plan.file.sql).not.toContain('fts:');
  });

  it('a new table in an alter is created with its index and no fill', () => {
    const plan = planMigration(
      fixture(),
      withEdit((s) => s.tables.push({ id: 'vehicles', label: 'Vehicles', fields: [{ id: 'plate', label: 'Plate', type: 'text' }] })),
    );
    expect(plan.file.sql).toContain('CREATE VIRTUAL TABLE "fts:vehicles"');
    expect(plan.file.sql).not.toContain("VALUES ('rebuild')");
    expect(plan.file.sql).not.toContain('"fts:crews"');
  });

  it('a table rebuild drops the index before the old table goes and recreates and fills it after the rename', () => {
    const plan = planMigration(fixture(), withEdit((s) => crews(s).fields.find((f) => f.id === 'status').options.push('retired')));
    const sql = plan.file.sql;
    expect(sql.startsWith('-- app-migration: rebuild\n')).toBe(true);
    const at = (s) => sql.indexOf(s);
    expect(at('DROP TABLE IF EXISTS "fts:crews"')).toBeGreaterThan(at('INSERT INTO "crews:new"'));
    expect(at('DROP TABLE IF EXISTS "fts:crews"')).toBeLessThan(at('DROP TABLE "crews";'));
    expect(at('CREATE VIRTUAL TABLE "fts:crews"')).toBeGreaterThan(at('RENAME TO "crews"'));
    expect(at("VALUES ('rebuild')")).toBeGreaterThan(at('CREATE TRIGGER "fts:crews:au"'));
    expect((sql.match(/DROP TABLE IF EXISTS "fts:crews"/g) ?? []).length).toBe(1);
    expect(sql).not.toContain('"fts:people"');
  });

  it('a spec with no change still plans nothing', () => {
    expect(planMigration(fixture(), fixture())).toEqual({ ok: true, file: null });
  });

  it('is deterministic', () => {
    const edit = (s) => crews(s).fields.push({ id: 'notes', label: 'Notes', type: 'longtext' });
    expect(planMigration(fixture(), withEdit(edit)).file.sql).toBe(planMigration(fixture(), withEdit(edit)).file.sql);
  });
});

describe('plans applied to a populated database', () => {
  // The schema of an app made before the index: the same tables with no index and no triggers.
  const oldSchema = () => {
    const db = memoryDb();
    db.exec(compileSpec(fixture()).createSql);
    return db;
  };

  it('an alter that adds a text field builds the index of an old app and fills it from the rows', () => {
    const db = oldSchema();
    addCrew(db, 'c1', 'Pump crew');
    addCrew(db, 'c2', 'Roof crew');
    db.exec(planMigration(fixture(), withEdit((s) => crews(s).fields.push({ id: 'notes', label: 'Notes', type: 'longtext' }))).file.sql);
    integrity(db, 'crews');
    expect(hits(db, 'crews', ['name'], 'pump')).toEqual(['c1']);
    expect(hits(db, 'crews', ['name', 'notes'], 'crew')).toEqual(['c1', 'c2']);
    db.prepare('UPDATE "crews" SET "notes" = ? WHERE "id" = ?').run('needs a ladder', 'c2');
    expect(hits(db, 'crews', ['notes'], 'ladder')).toEqual(['c2']);
    integrity(db, 'crews');
  });

  it('a rebuild (rowids change) leaves the index complete and consistent', () => {
    const db = builtDb();
    for (let i = 0; i < 40; i += 1) addCrew(db, `c${String(i).padStart(2, '0')}`, `Crew number ${i}`);
    db.exec("DELETE FROM \"crews\" WHERE \"id\" IN ('c03', 'c10')");
    const plan = planMigration(fixture(), withEdit((s) => crews(s).fields.find((f) => f.id === 'status').options.push('retired')));
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(plan.file.sql);
    db.exec('PRAGMA foreign_keys = ON');
    integrity(db, 'crews');
    expect(hits(db, 'crews', ['name'], 'number 1')).toEqual(['c01', 'c11', 'c12', 'c13', 'c14', 'c15', 'c16', 'c17', 'c18', 'c19']);
    expect(hits(db, 'crews', ['name'], 'number 3')).toEqual(['c30', 'c31', 'c32', 'c33', 'c34', 'c35', 'c36', 'c37', 'c38', 'c39']);
    addCrew(db, 'c99', 'Late crew');
    expect(hits(db, 'crews', ['name'], 'late')).toEqual(['c99']);
  });
});

describe('the triggers keep the index in step', () => {
  it('insert, update, delete, upsert and a delete of everything', () => {
    const db = builtDb();
    addCrew(db, 'c1', 'Alpha crew');
    addCrew(db, 'c2', 'Beta crew');
    expect(hits(db, 'crews', ['name'], 'crew')).toEqual(['c1', 'c2']);
    db.prepare('UPDATE "crews" SET "name" = ? WHERE "id" = ?').run('Gamma team', 'c1');
    expect(hits(db, 'crews', ['name'], 'alpha')).toEqual([]);
    expect(hits(db, 'crews', ['name'], 'gamma')).toEqual(['c1']);
    db.prepare('UPDATE "crews" SET "size" = 9 WHERE "id" = ?').run('c2');
    expect(hits(db, 'crews', ['name'], 'beta')).toEqual(['c2']);
    db.prepare(
      'INSERT INTO "crews" ("id","name","created_at","updated_at") VALUES (?,?,?,?) ON CONFLICT ("id") DO UPDATE SET "name" = excluded."name"',
    ).run('c2', 'Delta crew', now, now);
    expect(hits(db, 'crews', ['name'], 'beta')).toEqual([]);
    expect(hits(db, 'crews', ['name'], 'delta')).toEqual(['c2']);
    db.exec("DELETE FROM \"crews\" WHERE \"id\" = 'c1'");
    expect(hits(db, 'crews', ['name'], 'gamma')).toEqual([]);
    integrity(db, 'crews');
    db.exec('DELETE FROM "crews"');
    expect(hits(db, 'crews', ['name'], 'crew')).toEqual([]);
    integrity(db, 'crews');
  });

  it('a rolled back write leaves the index as it was', () => {
    const db = builtDb();
    addCrew(db, 'c1', 'Alpha crew');
    db.exec('BEGIN');
    addCrew(db, 'c2', 'Beta crew');
    db.exec("DELETE FROM \"crews\" WHERE \"id\" = 'c1'");
    db.exec('ROLLBACK');
    expect(hits(db, 'crews', ['name'], 'crew')).toEqual(['c1']);
    integrity(db, 'crews');
  });
});
