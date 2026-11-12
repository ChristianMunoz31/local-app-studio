import crypto from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDb, createTestDb, resetDb, rowsOf } from '../helpers/testDb.js';
import { insert, nowIso, openDb } from '../../db/index.js';
import { buildExportZip } from '../../exportRoutes.js';
import { importZipBuffer } from '../../import/importExport.js';
import {
  StudioError,
  createApp,
  deleteApp,
  duplicateApp,
  getApp,
  importApp,
  listApps,
  markInterruptedBuilds,
  saveSpec,
  uniqueSlug,
} from '../../studio/apps.js';
import { checkSpec, starterSpec } from '../../studio/specCheck.js';

// A finished build row, written the way the build service records one (the service is pro, which a public build lacks).
const finishedBuild = (appId, { status, installerPath = null }) =>
  insert('builds', { app_id: appId, status, spec_revision: 2, app_version: '1.0.0', started_at: nowIso(), finished_at: nowIso(), installer_path: installerPath });

let db;
beforeAll(() => {
  db = createTestDb();
});
beforeEach(() => resetDb(db));
afterAll(() => closeTestDb(db));

const rawInsert = (slug, specText) => {
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO apps (id, name, slug, spec) VALUES (?, ?, ?, ?)').run(id, 'Broken App', slug, specText);
  return id;
};
const expectError = (fn, code, extra) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(StudioError);
    expect(err.code).toBe(code);
    if (extra) expect(err.extra).toMatchObject(extra);
    return;
  }
  throw new Error('expected a StudioError');
};

describe('apps service', () => {
  it('lists the description and whether a build produced an installer', () => {
    const a = createApp({ name: 'Crew Roster' });
    const b = createApp({ name: 'Dog Walks' });
    const flag = (id) => listApps().find((x) => x.id === id).hasInstaller;
    expect(listApps().every((x) => x.description === '' && x.hasInstaller === false)).toBe(true);

    const spec = structuredClone(getApp(a.id).spec);
    spec.app.description = 'Who works which job.';
    saveSpec(a.id, spec, 1);
    expect(listApps().find((x) => x.id === a.id).description).toBe('Who works which job.');
    const brokenId = rawInsert('broken-app', '{"specVersion":1}');
    expect(listApps().find((x) => x.id === brokenId)).toMatchObject({ description: '', hasInstaller: false });

    finishedBuild(a.id, { status: 'failed', installerPath: '/x/a.msi' });
    expect(flag(a.id)).toBe(false);
    finishedBuild(a.id, { status: 'succeeded' });
    expect(flag(a.id)).toBe(false);
    finishedBuild(a.id, { status: 'succeeded', installerPath: '/x/a.msi' });
    expect(flag(a.id)).toBe(true);
    expect(flag(b.id)).toBe(false);

    const next = structuredClone(getApp(a.id).spec);
    next.app.description = 'Changed.';
    saveSpec(a.id, next, 2);
    expect(flag(a.id)).toBe(true);
  });

  it('creates, gets and lists newest first', async () => {
    const a = createApp({ name: 'Crew Roster' });
    expect(a).toMatchObject({ name: 'Crew Roster', slug: 'crew-roster', revision: 1, issues: [] });
    expect(a.spec.app.identifier).toBe('com.example.crewroster');
    await new Promise((r) => setTimeout(r, 5));
    const b = createApp({ name: 'Crew Roster' });
    expect(b.slug).toBe('crew-roster-2');
    expect(getApp(a.id).spec.app.name).toBe('Crew Roster');
    expect(getApp(crypto.randomUUID())).toBeNull();
    const list = listApps();
    expect(list.map((x) => x.id)).toEqual([b.id, a.id]);
    expect(list[0]).toMatchObject({ ok: true, issueCount: 0, tableCount: 0, pageCount: 1 });
  });

  it('refuses an invalid name and a hit on the app limit', () => {
    expectError(() => createApp({ name: 'x' }), 'invalid_request');
    expectError(() => createApp({ name: 'Local App Studio' }), 'invalid_request');
    expectError(() => createApp({ name: 'Dev' }), 'invalid_request');
    const rows = Array.from({ length: 200 }, (_, i) => [crypto.randomUUID(), `app-${i}`]);
    const stmt = db.prepare('INSERT INTO apps (id, name, slug, spec) VALUES (?, ?, ?, ?)');
    for (const [id, slug] of rows) stmt.run(id, slug, slug, '{}');
    expectError(() => createApp({ name: 'One More' }), 'too_many_apps');
  });

  it('duplicates with a copy name, a unique slug and a new identifier', () => {
    const a = createApp({ name: 'Crew Roster' });
    const copy = duplicateApp(a.id);
    expect(copy.name).toBe('Crew Roster Copy');
    expect(copy.slug).toBe('crew-roster-copy');
    expect(copy.spec.app.identifier).toBe('com.example.crewrostercopy');
    expect(duplicateApp(a.id).slug).toBe('crew-roster-copy-2');
    expect(duplicateApp(crypto.randomUUID())).toBeNull();
    expectError(() => duplicateApp(rawInsert('broken-one', '{"x":1}')), 'spec_invalid');
  });

  it('imports with a slug suffix written into the spec', () => {
    createApp({ name: 'Crew Roster' });
    const spec = checkSpec(starterSpec('Crew Roster', 'crew-roster')).spec;
    const imported = importApp(spec);
    expect(imported.slug).toBe('crew-roster-2');
    expect(imported.spec.app.slug).toBe('crew-roster-2');
    expect(uniqueSlug('crew-roster')).toBe('crew-roster-3');
    expect(uniqueSlug('crew-roster-2', imported.id)).toBe('crew-roster-2');
  });

  it('gives an imported app a new identifier when its slug is suffixed', () => {
    createApp({ name: 'Crew Roster' });
    const spec = checkSpec(starterSpec('Crew Roster', 'crew-roster')).spec;
    const imported = importApp(spec);
    expect(imported.spec.app.slug).toBe('crew-roster-2');
    expect(imported.spec.app.identifier).toBe('com.example.crewroster2');
    const free = importApp(checkSpec(starterSpec('Other App', 'other-app')).spec);
    expect(free.spec.app.identifier).toBe('com.example.otherapp');
  });

  it('lists from a cache until the row changes', () => {
    const a = createApp({ name: 'Crew Roster' });
    expect(listApps()[0]).toMatchObject({ id: a.id, ok: true, pageCount: 1 });
    // A different spec under the same id, revision and updated_at (a data-import upsert) is validated again.
    db.prepare('UPDATE apps SET spec = ? WHERE id = ?').run('{"specVersion":1}', a.id);
    expect(listApps()[0]).toMatchObject({ id: a.id, ok: false, pageCount: 0 });
    expect(getApp(a.id).spec).toBeNull();
    // A changed row (new updated_at, as an import or a save writes) is validated again.
    db.prepare('UPDATE apps SET updated_at = ? WHERE id = ?').run('2099-01-01T00:00:00.000Z', a.id);
    expect(listApps()[0]).toMatchObject({ id: a.id, ok: false, pageCount: 0 });
    deleteApp(a.id);
    expect(listApps()).toEqual([]);
  });

  it('saves with a revision check', () => {
    const a = createApp({ name: 'Crew Roster' });
    const b = createApp({ name: 'Other Thing' });
    const next = structuredClone(a.spec);
    next.pages[0].title = 'Start';
    const saved = saveSpec(a.id, next, 1);
    expect(saved.revision).toBe(2);
    expect(getApp(a.id).spec.pages[0].title).toBe('Start');
    expectError(() => saveSpec(a.id, next, 1), 'revision_conflict', { revision: 2 });
    expectError(() => saveSpec(crypto.randomUUID(), starterSpec('Free Name', 'free-name'), 1), 'app_not_found');
    const clash = structuredClone(b.spec);
    clash.app.slug = 'crew-roster';
    expectError(() => saveSpec(b.id, clash, 1), 'slug_taken');
    const renamed = structuredClone(saved.spec);
    renamed.app.name = 'Renamed App';
    renamed.app.slug = 'renamed-app';
    expect(saveSpec(a.id, renamed, 2)).toMatchObject({ name: 'Renamed App', slug: 'renamed-app', revision: 3 });
  });

  it('reports a broken stored spec as null with issues and raw', () => {
    const unknownPart = starterSpec('Bad Part', 'bad-part');
    unknownPart.pages[0].layout.children[0].type = 'Nope';
    const deep = `${'['.repeat(200)}1${']'.repeat(200)}`;
    const ids = [rawInsert('bad-shape', '{"specVersion":1}'), rawInsert('bad-part', JSON.stringify(unknownPart)), rawInsert('bad-deep', deep)];
    const [shape, part, hostile] = ids.map(getApp);
    for (const r of [shape, part, hostile]) {
      expect(r.spec).toBeNull();
      expect(r.issues.length).toBeGreaterThan(0);
      expect(r.name).toBe('Broken App');
    }
    expect(shape.raw).toEqual({ specVersion: 1 });
    expect(part.raw.pages).toBeDefined();
    expect(hostile.issues[0].code).toBe('too_complex');
    expect('raw' in hostile).toBe(false);
    const summary = listApps().find((s) => s.id === ids[0]);
    expect(summary).toMatchObject({ ok: false, tableCount: 0, pageCount: 0 });
    expect(summary.issueCount).toBeGreaterThan(0);
  });

  it('deletes and marks running builds interrupted', () => {
    const a = createApp({ name: 'Crew Roster' });
    const ins = db.prepare('INSERT INTO builds (id, app_id, status, started_at) VALUES (?, ?, ?, ?)');
    ins.run(crypto.randomUUID(), a.id, 'running', 'now');
    ins.run(crypto.randomUUID(), a.id, 'succeeded', 'now');
    expect(markInterruptedBuilds()).toBe(1);
    const rows = rowsOf(db, 'builds');
    expect(rows.find((r) => r.status === 'interrupted')).toMatchObject({ error_code: 'interrupted' });
    expect(rows.find((r) => r.status === 'interrupted').finished_at).toBeTruthy();
    expect(deleteApp(a.id)).toBe(true);
    expect(deleteApp(a.id)).toBe(false);
    expect(rowsOf(db, 'builds')).toHaveLength(0);
  });

  it('survives an export and import, and a hostile imported spec reads as broken', async () => {
    const a = createApp({ name: 'Crew Roster' });
    db.prepare('INSERT INTO builds (id, app_id, status, started_at) VALUES (?, ?, ?, ?)').run(crypto.randomUUID(), a.id, 'succeeded', '2026-01-01T00:00:00.000Z');
    const { zip } = await buildExportZip({ db });
    const dest = openDb({ filename: ':memory:' });
    try {
      importZipBuffer(zip, { db: dest });
      expect(rowsOf(dest, 'apps')).toHaveLength(1);
      expect(rowsOf(dest, 'builds')).toHaveLength(1);
      expect(rowsOf(dest, 'apps')[0].spec).toEqual(a.spec);
    } finally {
      dest.close();
    }
    const id = rawInsert('hostile-one', JSON.stringify({ ...a.spec, pages: [{ id: 'home' }] }));
    expect(getApp(id).spec).toBeNull();
  });
});
