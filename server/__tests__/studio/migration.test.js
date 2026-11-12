import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeTestDb, createTestDb } from '../helpers/testDb.js';
import { DATA_TABLES } from '../../dataTables.js';
import { FOREIGN_KEYS, IMPORT_ORDER, TABLES, insert, remove, select } from '../../db/index.js';
import { CLOUD_CATEGORY_DEFAULTS, CLOUD_CATEGORY_IDS } from '../../ai/index.js';

let db;
beforeAll(() => {
  db = createTestDb();
});
afterAll(() => closeTestDb(db));

const appRow = (over = {}) => insert('apps', { name: 'Crew Roster', slug: 'crew-roster', spec: { a: 1 }, ...over });
const rawApp = (id, slug, spec, revision, migrations) =>
  db
    .prepare('INSERT INTO apps (id, name, slug, spec, revision, app_migrations) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, 'Name', slug, spec, revision, migrations);

describe('003_studio', () => {
  it('creates both tables as STRICT', () => {
    for (const t of ['apps', 'builds']) {
      expect(db.prepare('SELECT strict FROM pragma_table_list WHERE name = ?').get(t).strict).toBe(1);
    }
  });

  it('refuses bad rows with CHECK constraints', () => {
    expect(() => rawApp('i1', 'Bad Slug', '{}', 1, '[]')).toThrow();
    expect(() => rawApp('i1', 'ok-slug', 'not json', 1, '[]')).toThrow();
    expect(() => rawApp('i1', 'ok-slug', '{}', 0, '[]')).toThrow();
    expect(() => rawApp('i1', 'ok-slug', '{}', 1, '{}')).toThrow();
    expect(() => rawApp('i1', 'ok-slug', '{}', 1, '[]')).not.toThrow();
    expect(() => rawApp('i1', 'other-slug', '{}', 1, '[]')).toThrow();
    expect(() => rawApp('i2', 'ok-slug', '{}', 1, '[]')).toThrow();
    const a = appRow({ slug: 'build-owner' });
    const build = (status, sha = null) => () =>
      db
        .prepare('INSERT INTO builds (id, app_id, status, started_at, installer_sha256) VALUES (?, ?, ?, ?, ?)')
        .run(crypto.randomUUID(), a.id, status, 'now', sha);
    expect(build('bogus')).toThrow();
    expect(build('queued', 'XYZ')).toThrow();
    expect(build('queued', 'a'.repeat(64))).not.toThrow();
  });

  it('cascades builds when an app is deleted', () => {
    const a = appRow({ slug: 'cascade-me' });
    db.prepare('INSERT INTO builds (id, app_id, status, started_at) VALUES (?, ?, ?, ?)').run(crypto.randomUUID(), a.id, 'queued', 'now');
    expect(select('builds', { where: { app_id: a.id } })).toHaveLength(1);
    remove('apps', { where: { id: a.id } });
    expect(select('builds', { where: { app_id: a.id } })).toHaveLength(0);
  });

  it('is registered in the table, export and cloud registries', () => {
    expect(Object.keys(TABLES)).toEqual(expect.arrayContaining(['apps', 'builds']));
    expect(IMPORT_ORDER.indexOf('apps')).toBeLessThan(IMPORT_ORDER.indexOf('builds'));
    expect(FOREIGN_KEYS.find((k) => k.table === 'builds')).toMatchObject({ column: 'app_id', onDelete: 'cascade' });
    expect(DATA_TABLES.map((d) => d.id)).toEqual(expect.arrayContaining(['apps', 'builds']));
    expect(CLOUD_CATEGORY_IDS).not.toContain('studio_specs');
    expect(CLOUD_CATEGORY_DEFAULTS.studio_specs).toBeUndefined();
  });

  it('exports an empty descriptor in runtime mode', async () => {
    const { resetAppModeCache } = await import('../../appMode.js');
    process.env.APP_MODE = 'runtime';
    resetAppModeCache();
    vi.resetModules();
    try {
      const mod = (await import('../../modules/studio.data.js')).default;
      expect(mod.tables).toEqual({});
      expect(mod.cloudCategories).toEqual([]);
    } finally {
      delete process.env.APP_MODE;
      resetAppModeCache();
      vi.resetModules();
    }
  });
});
