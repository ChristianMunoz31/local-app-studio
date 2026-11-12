// T21: pending-spec.json is an envelope tied to the pending migration (name and sha256). Real temp folders and databases.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../db/index.js';
import { loadAppMigrations, migrateApp } from '../../db/migrate.js';
import { starterSpec } from '../../studio/specCheck.js';
import { prepareScratch } from '../../studio/preview/scratch.js';

let root;
let dir;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'las-pend-'));
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
const withSize = (spec) => {
  const next = structuredClone(spec);
  next.tables[0].fields.push({ id: 'size', label: 'Size', type: 'integer', required: false });
  return next;
};
const startChild = (out) => {
  const filename = path.join(out.dataDir, 'app.db');
  const db = openDb({ filename, migrate: false });
  migrateApp(db, { migrations: loadAppMigrations({ mode: 'runtime', dir: out.appMigrationsDir, compiled: null }), filename });
  return db;
};
const count = (db) => db.prepare('SELECT COUNT(*) AS n FROM "crews"').get().n;
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const pendingPath = () => path.join(dir, 'pending-spec.json');

/** Two kept rows, then a deferred start of `changed` whose child applied 002 and died before ready. Returns both specs. */
function appliedPending() {
  const spec = base();
  const first = prepareScratch(dir, spec, root);
  const seed = startChild(first);
  for (const name of ['North', 'South']) {
    seed.prepare('INSERT INTO "crews" ("id","name","created_at","updated_at") VALUES (?,?,?,?)').run(crypto.randomUUID(), name, 't', 't');
  }
  seed.close();
  const changed = withSize(spec);
  startChild(prepareScratch(dir, changed, root, { deferCommit: true })).close();
  return { spec, changed };
}

/** The next start after a lost or untrusted pending spec: data cleared, say why, state follows the requested tables. */
function expectReplaced(spec) {
  const out = prepareScratch(dir, spec, root);
  expect(out.data).toEqual({ kept: false, reason: 'tables_replaced' });
  expect(readJson('applied-spec.json')).toEqual(spec);
  expect(readJson('preview-state.json').files).toEqual(['001_app.sql']);
  const db = startChild(out);
  expect(count(db)).toBe(0);
  db.close();
}

describe('prepareScratch pending spec envelope', () => {
  it('writes the envelope with the file name and the hash of the pending SQL', () => {
    const { changed } = appliedPending();
    const sql = fs.readFileSync(path.join(dir, 'app-migrations', '002_app.sql'), 'utf8').replaceAll('\r\n', '\n');
    expect(readJson('pending-spec.json')).toEqual({ v: 1, file: '002_app.sql', sha256: crypto.createHash('sha256').update(sql).digest('hex'), spec: changed });
  });

  it('(a) commits a matching envelope: the data is kept and applied-spec.json is the pending spec', () => {
    const { changed } = appliedPending();
    const out = prepareScratch(dir, changed, root);
    expect(out.data).toEqual({ kept: true, reason: 'unchanged' });
    expect(readJson('applied-spec.json')).toEqual(changed);
    expect(readJson('preview-state.json').files).toEqual(['001_app.sql', '002_app.sql']);
    const db = startChild(out);
    expect(count(db)).toBe(2);
    db.close();
  });

  it('(b) a hash that differs from the lock is not trusted', () => {
    const { spec, changed } = appliedPending();
    fs.writeFileSync(pendingPath(), JSON.stringify({ ...readJson('pending-spec.json'), sha256: 'f'.repeat(64) }));
    expect(readJson('pending-spec.json').spec).toEqual(changed);
    expectReplaced(spec);
  });

  it('(c) a legacy plain spec is not trusted', () => {
    const { changed } = appliedPending();
    fs.writeFileSync(pendingPath(), JSON.stringify(changed));
    // The same tables are requested again: the old reader trusted the plain file and kept the rows.
    expectReplaced(changed);
  });

  it.each([
    ['an unterminated object', '{'],
    ['an array', '[]'],
    ['an envelope with a path as file', '{"v":1,"file":"../x"}'],
    ['a 3 MB file', `{"v":1,"pad":"${'x'.repeat(3 * 1024 * 1024)}"}`],
  ])('(d) %s is not trusted and nothing throws', (_label, text) => {
    const { spec } = appliedPending();
    fs.writeFileSync(pendingPath(), text);
    expect(() => expectReplaced(spec)).not.toThrow();
  });

  it('(e) an envelope that names a different version is not trusted', () => {
    const { spec } = appliedPending();
    const lock = readJson('app-migrations/migrations.lock.json');
    fs.writeFileSync(pendingPath(), JSON.stringify({ ...readJson('pending-spec.json'), file: '003_app.sql', sha256: lock['002_app.sql'] }));
    expectReplaced(spec);
  });
});
