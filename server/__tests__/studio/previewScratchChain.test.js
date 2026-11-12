// Preview keeps rows through the same migration chain a built app takes: real temp databases and the real app-track runner.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../db/index.js';
import { loadAppMigrations, migrateApp } from '../../db/migrate.js';
import { starterSpec } from '../../studio/specCheck.js';
import { prepareScratch } from '../../studio/preview/scratch.js';

let root;
let dir;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'las-chain-'));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
beforeEach(() => {
  dir = path.join(root, crypto.randomUUID());
});

const base = () => {
  const spec = starterSpec('Crew Roster', 'crew-roster');
  spec.tables = [{ id: 'crews', label: 'Crews', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] }];
  return spec;
};

/** What the child does on start: apply the chain to data/app.db. */
function startChild(out) {
  const filename = path.join(out.dataDir, 'app.db');
  const db = openDb({ filename, migrate: false });
  migrateApp(db, { migrations: loadAppMigrations({ mode: 'runtime', dir: out.appMigrationsDir, compiled: null }), filename });
  return db;
}
const count = (db, table) => db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n;
const insertCrew = (db, name) =>
  db.prepare('INSERT INTO "crews" ("id","name","created_at","updated_at") VALUES (?,?,?,?)').run(crypto.randomUUID(), name, 't', 't');

function seeded() {
  const spec = base();
  const out = prepareScratch(dir, spec, root);
  const db = startChild(out);
  insertCrew(db, 'North');
  insertCrew(db, 'South');
  db.close();
  return spec;
}

describe('prepareScratch migration chain', () => {
  it('keeps both rows across a restart with unchanged tables and touches no file', () => {
    const spec = seeded();
    const files = ['app-migrations/001_app.sql', 'app-migrations/migrations.lock.json', 'preview-state.json', 'applied-spec.json'].map((f) => path.join(dir, f));
    const before = files.map((f) => fs.statSync(f).mtimeMs);
    const out = prepareScratch(dir, spec, root);
    expect(out.data).toEqual({ kept: true, reason: 'unchanged' });
    expect(files.map((f) => fs.statSync(f).mtimeMs)).toEqual(before);
    const db = startChild(out);
    expect(count(db, 'crews')).toBe(2);
    db.close();
  });

  it('keeps the rows and adds the column when an optional field is added', () => {
    const spec = seeded();
    spec.tables[0].fields.push({ id: 'size', label: 'Size', type: 'integer', required: false });
    const out = prepareScratch(dir, spec, root);
    expect(out).toMatchObject({ data: { kept: true, reason: 'tables_updated' }, migrated: true });
    expect(fs.existsSync(path.join(out.appMigrationsDir, '002_app.sql'))).toBe(true);
    const db = startChild(out);
    expect(count(db, 'crews')).toBe(2);
    expect(db.prepare('SELECT "size" FROM "crews"').all()).toHaveLength(2);
    db.close();
    expect(prepareScratch(dir, spec, root).data.reason).toBe('unchanged');
  });

  it('keeps the rows when a table is added', () => {
    const spec = seeded();
    spec.tables.push({ id: 'tasks', label: 'Tasks', fields: [{ id: 'title', label: 'Title', type: 'text', required: true }] });
    const out = prepareScratch(dir, spec, root);
    expect(out.data).toEqual({ kept: true, reason: 'tables_updated' });
    const db = startChild(out);
    expect(count(db, 'crews')).toBe(2);
    expect(count(db, 'tasks')).toBe(0);
    db.close();
  });

  it('chains a second change on top of the first', () => {
    const spec = seeded();
    spec.tables[0].fields.push({ id: 'size', label: 'Size', type: 'integer', required: false });
    startChild(prepareScratch(dir, spec, root)).close();
    spec.tables[0].fields.push({ id: 'note', label: 'Note', type: 'text', required: false });
    const out = prepareScratch(dir, spec, root);
    expect(fs.existsSync(path.join(out.appMigrationsDir, '003_app.sql'))).toBe(true);
    const db = startChild(out);
    expect(count(db, 'crews')).toBe(2);
    db.close();
  });

  it('clears the data with tables_replaced when a field is removed', () => {
    const spec = seeded();
    spec.tables[0].fields.push({ id: 'size', label: 'Size', type: 'integer', required: false });
    startChild(prepareScratch(dir, spec, root)).close();
    spec.tables[0].fields = spec.tables[0].fields.filter((f) => f.id !== 'size');
    const out = prepareScratch(dir, spec, root);
    expect(out).toMatchObject({ data: { kept: false, reason: 'tables_replaced' }, migrated: false });
    const db = startChild(out);
    expect(count(db, 'crews')).toBe(0);
    db.close();
    expect(fs.readdirSync(out.appMigrationsDir).filter((n) => n.endsWith('.sql'))).toEqual(['001_app.sql']);
  });

  it('goes fresh when the lock does not match the files', () => {
    const spec = seeded();
    fs.writeFileSync(path.join(dir, 'app-migrations', 'migrations.lock.json'), JSON.stringify({ '001_app.sql': 'f'.repeat(64) }));
    const out = prepareScratch(dir, spec, root);
    expect(out.data).toEqual({ kept: false, reason: 'tables_replaced' });
    const db = startChild(out);
    expect(count(db, 'crews')).toBe(0);
    db.close();
  });

  it('honors fresh with a reason', () => {
    const spec = seeded();
    expect(prepareScratch(dir, spec, root, { fresh: true, reason: 'repaired' }).data).toEqual({ kept: false, reason: 'repaired' });
  });

  it('plans the table change again when its child never became ready, and keeps the rows', () => {
    const spec = seeded();
    const changed = structuredClone(spec);
    changed.tables[0].fields.push({ id: 'size', label: 'Size', type: 'integer', required: false });
    const first = prepareScratch(dir, changed, root, { deferCommit: true });
    expect(first).toMatchObject({ migrated: true, data: { kept: true, reason: 'tables_updated' } });
    // The child timed out before ready: commit() is never called. The next start sees the same change again.
    const second = prepareScratch(dir, changed, root, { deferCommit: true });
    expect(second).toMatchObject({ migrated: true, data: { kept: true, reason: 'tables_updated' } });
    second.commit();
    const db = startChild(second);
    expect(count(db, 'crews')).toBe(2);
    db.close();
    expect(prepareScratch(dir, changed, root)).toMatchObject({ migrated: false, data: { kept: true, reason: 'unchanged' } });
  });

  it('drops a pending migration when the tables go back before any child was ready', () => {
    const spec = seeded();
    const changed = structuredClone(spec);
    changed.tables[0].fields.push({ id: 'size', label: 'Size', type: 'integer', required: false });
    prepareScratch(dir, changed, root, { deferCommit: true });
    const back = prepareScratch(dir, spec, root);
    expect(back.data).toEqual({ kept: true, reason: 'unchanged' });
    const db = startChild(back);
    expect(count(db, 'crews')).toBe(2);
    db.close();
  });
});

describe('prepareScratch when a child applied the pending migration without becoming ready', () => {
  const addSize = (spec) => {
    const next = structuredClone(spec);
    next.tables[0].fields.push({ id: 'size', label: 'Size', type: 'integer', required: false });
    return next;
  };

  it('never gets stuck when the tables are reverted: plans from the pending spec or starts fresh with a reason', () => {
    const spec = seeded();
    const changed = addSize(spec);
    // The child applied 002 (migrateApp runs before listening), then was killed before ready: commit() never ran.
    startChild(prepareScratch(dir, changed, root, { deferCommit: true })).close();
    const out = prepareScratch(dir, spec, root, { deferCommit: true });
    expect(out.data.reason === 'tables_updated' || (out.data.kept === false && out.data.reason === 'tables_replaced')).toBe(true);
    const db = startChild(out);
    expect(count(db, 'crews')).toBe(out.data.kept ? 2 : 0);
    db.close();
    out.commit();
    expect(prepareScratch(dir, spec, root).data.reason).toBe('unchanged');
  });

  it('keeps the rows when a different additive change follows the applied pending migration', () => {
    const spec = seeded();
    startChild(prepareScratch(dir, addSize(spec), root, { deferCommit: true })).close();
    const other = addSize(spec);
    other.tables[0].fields.push({ id: 'note', label: 'Note', type: 'text', required: false });
    const out = prepareScratch(dir, other, root, { deferCommit: true });
    expect(out).toMatchObject({ migrated: true, data: { kept: true, reason: 'tables_updated' } });
    expect(fs.existsSync(path.join(out.appMigrationsDir, '003_app.sql'))).toBe(true);
    const db = startChild(out);
    expect(count(db, 'crews')).toBe(2);
    db.close();
    out.commit();
    expect(prepareScratch(dir, other, root).data.reason).toBe('unchanged');
  });

  it('keeps the rows and the applied migration when the same change is saved again', () => {
    const spec = seeded();
    const changed = addSize(spec);
    startChild(prepareScratch(dir, changed, root, { deferCommit: true })).close();
    const out = prepareScratch(dir, changed, root, { deferCommit: true });
    expect(out.data).toEqual({ kept: true, reason: 'unchanged' });
    const db = startChild(out);
    expect(count(db, 'crews')).toBe(2);
    db.close();
  });

  it('keeps the rows when the pending migration was never applied and the tables go back', () => {
    const spec = seeded();
    prepareScratch(dir, addSize(spec), root, { deferCommit: true });
    const out = prepareScratch(dir, spec, root);
    expect(out.data).toEqual({ kept: true, reason: 'unchanged' });
    const db = startChild(out);
    expect(count(db, 'crews')).toBe(2);
    db.close();
  });

  it('starts fresh with a reason when the applied pending migration lost its spec file', () => {
    const spec = seeded();
    startChild(prepareScratch(dir, addSize(spec), root, { deferCommit: true })).close();
    fs.rmSync(path.join(dir, 'pending-spec.json'));
    const out = prepareScratch(dir, spec, root);
    expect(out.data).toEqual({ kept: false, reason: 'tables_replaced' });
    const db = startChild(out);
    expect(count(db, 'crews')).toBe(0);
    db.close();
  });
});

describe('prepareScratch when the preview database is held by another process', () => {
  const addSize = (spec) => {
    const next = structuredClone(spec);
    next.tables[0].fields.push({ id: 'size', label: 'Size', type: 'integer', required: false });
    return next;
  };
  const snapshot = () =>
    ['app-migrations/001_app.sql', 'app-migrations/002_app.sql', 'app-migrations/migrations.lock.json', 'preview-state.json', 'applied-spec.json', 'pending-spec.json'].map((f) => {
      const file = path.join(dir, f);
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    });

  it('fails without touching any state, then keeps the rows once the lock is released', () => {
    const spec = seeded();
    const changed = addSize(spec);
    startChild(prepareScratch(dir, changed, root, { deferCommit: true })).close();
    const before = snapshot();
    const filename = path.join(dir, 'data', 'app.db');
    const holder = new DatabaseSync(filename);
    holder.exec('PRAGMA locking_mode = EXCLUSIVE');
    holder.exec('BEGIN EXCLUSIVE');
    holder.prepare('SELECT COUNT(*) FROM "crews"').get();
    try {
      expect(() => prepareScratch(dir, changed, root, { deferCommit: true })).toThrow(/in use by another process/);
      expect(snapshot()).toEqual(before);
    } finally {
      holder.exec('COMMIT');
      holder.close();
    }
    const out = prepareScratch(dir, changed, root, { deferCommit: true });
    expect(out.data).toEqual({ kept: true, reason: 'unchanged' });
    const db = startChild(out);
    expect(count(db, 'crews')).toBe(2);
    db.close();
  });

  it('reads the applied version without modifying the database file', () => {
    const spec = seeded();
    startChild(prepareScratch(dir, addSize(spec), root, { deferCommit: true })).close();
    const files = fs.readdirSync(path.join(dir, 'data')).map((n) => path.join(dir, 'data', n));
    const before = files.map((f) => fs.readFileSync(f).toString('hex'));
    prepareScratch(dir, addSize(spec), root, { deferCommit: true });
    expect(files.map((f) => fs.readFileSync(f).toString('hex'))).toEqual(before);
  });
});
