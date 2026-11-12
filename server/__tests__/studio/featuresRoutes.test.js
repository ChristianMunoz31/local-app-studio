// Feature library routes, store and spec expansion. The router is mounted on a small Express app (no server.js boot).
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEED_FEATURES, validateFeatureInput } from '../../../src/catalog/features/index.ts';
import { closeTestDb, createTestDb, resetDb, rowsOf } from '../helpers/testDb.js';
import { listFeatureSummaries, loadLibrary } from '../../studio/features/store.js';
import { registerFeatureRoutes } from '../../studio/features/routes.js';
import { registerAppsRoutes } from '../../studio/appsRoutes.js';
import { studioGuard } from '../../studio/http.js';
import { checkSpec, expandAndCheck, starterSpec } from '../../studio/specCheck.js';

vi.mock('../../../loadEnv.js', () => ({}));
vi.mock('../../../src/catalog/features/index.ts', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, validateFeatureInput: vi.fn(real.validateFeatureInput) };
});

let app;
let db;
const strip = (def) => {
  const copy = structuredClone(def);
  delete copy.version;
  delete copy.updatedAt;
  return copy;
};
const KPI = strip(SEED_FEATURES.find((f) => f.id === 'kpi_row'));
const SEARCH = strip(SEED_FEATURES.find((f) => f.id === 'search_list'));
const NESTED = {
  id: 'wrapper',
  label: 'Wrapper',
  description: 'Wraps the number row.',
  params: [
    { name: 'src', label: 'List', type: 'source', mode: 'list' },
    { name: 'num', label: 'Number field', type: 'field', of: 'src', fieldTypes: ['integer', 'real'] },
    { name: 'ttl', label: 'Title', type: 'text' },
  ],
  fragment: {
    id: 'o1',
    type: 'Section',
    props: {},
    children: [{ id: 'o2', type: 'Feature', props: { featureId: 'kpi_row', params: { source: 's', amount: 'x', title: 'T' } }, children: [] }],
  },
  bindings: [
    { param: 'src', layer: 'o2', target: 'props.params.source' },
    { param: 'num', layer: 'o2', target: 'props.params.amount' },
    { param: 'ttl', layer: 'o2', target: 'props.params.title' },
  ],
};
const api = (method, url) => request(app)[method](url);

beforeAll(() => {
  db = createTestDb();
  app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/studio', studioGuard);
  registerFeatureRoutes(app);
  registerAppsRoutes(app);
});
beforeEach(() => resetDb(db));
afterAll(() => closeTestDb(db));

const create = async (input = KPI) => (await api('post', '/api/studio/features').send({ feature: input })).body.data;
const insertRaw = (id, body) =>
  db.prepare('INSERT INTO studio_features (id, label, description, version, body) VALUES (?, ?, ?, 1, ?)').run(id, id, 'raw row', JSON.stringify(body));

/** An app with a table, a list source and a Feature layer for kpi_row. */
function appWithFeature(overrides = {}) {
  const spec = starterSpec('Crew Roster', 'crew-roster');
  spec.tables = [
    {
      id: 'crews',
      label: 'Crews',
      titleField: 'name',
      fields: [
        { id: 'name', label: 'Name', required: false, type: 'text' },
        { id: 'size', label: 'Size', required: false, type: 'integer' },
      ],
    },
  ];
  spec.pages[0].sources = [{ id: 'open_crews', table: 'crews', mode: 'list' }];
  spec.pages[0].layout.children.push({
    id: 'kpi_block',
    type: 'Feature',
    props: { featureId: 'kpi_row', params: { source: 'open_crews', amount: 'size', title: 'Crew size', ...overrides } },
    children: [],
  });
  return spec;
}

describe('feature routes', () => {
  it('lists empty, no-store', async () => {
    const res = await api('get', '/api/studio/features');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [] });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('creates at version 1, gets, lists, and refuses a taken id', async () => {
    const res = await api('post', '/api/studio/features').send({ feature: KPI });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ id: 'kpi_row', version: 1, ok: true, issues: [], usedBy: { apps: [], features: [] } });
    expect((await api('get', '/api/studio/features/kpi_row')).body.data.label).toBe('Number row');
    expect((await api('get', '/api/studio/features')).body.data).toHaveLength(1);
    const again = await api('post', '/api/studio/features').send({ feature: KPI });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('feature_id_taken');
  });

  it('answers 400 for a missing or invalid feature, reserved ids included', async () => {
    expect((await api('post', '/api/studio/features').send({})).status).toBe(400);
    const cases = [{ ...KPI, id: 'select' }, { ...KPI, id: 'items' }, { ...KPI, id: 'Bad-Id' }, { ...KPI, label: ' x' }, { ...KPI, extra: 1 }, { ...KPI, bindings: [] }];
    for (const bad of cases) {
      const res = await api('post', '/api/studio/features').send({ feature: bad });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_feature');
      expect(res.body.issues.length).toBeGreaterThan(0);
    }
    expect(rowsOf(db, 'studio_features')).toHaveLength(0);
  });

  it('answers 404 for unknown and malformed ids', async () => {
    const calls = [
      ['get', '/api/studio/features/nope'],
      ['get', '/api/studio/features/Bad-Id'],
      ['delete', '/api/studio/features/nope'],
      ['post', '/api/studio/features/nope/duplicate'],
    ];
    for (const [m, u] of calls) {
      const res = await api(m, u);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('feature_not_found');
    }
    const put = await api('put', '/api/studio/features/nope').send({ feature: KPI, baseVersion: 1 });
    expect(put.status).toBe(404);
  });

  it('puts: version bumps only when the body changes', async () => {
    await create();
    const label = await api('put', '/api/studio/features/kpi_row').send({ feature: { ...KPI, label: 'Numbers' }, baseVersion: 1 });
    expect(label.status).toBe(200);
    expect(label.body.data).toMatchObject({ label: 'Numbers', version: 1 });
    const params = structuredClone(KPI);
    params.params[2].label = 'Heading';
    const bumped = await api('put', '/api/studio/features/kpi_row').send({ feature: params, baseVersion: 1 });
    expect(bumped.body.data.version).toBe(2);
    const stale = await api('put', '/api/studio/features/kpi_row').send({ feature: params, baseVersion: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'version_conflict', version: 2 });
    const mismatch = await api('put', '/api/studio/features/kpi_row').send({ feature: { ...KPI, id: 'other' }, baseVersion: 2 });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.code).toBe('invalid_request');
    expect((await api('put', '/api/studio/features/kpi_row').send({ feature: KPI })).status).toBe(400);
    const invalid = await api('put', '/api/studio/features/kpi_row').send({ feature: { ...KPI, bindings: [] }, baseVersion: 2 });
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe('invalid_feature');
  });

  it('duplicates with _copy, _copy_2 and a cut id and label', async () => {
    await create();
    const one = await api('post', '/api/studio/features/kpi_row/duplicate');
    expect(one.status).toBe(201);
    expect(one.body.data).toMatchObject({ id: 'kpi_row_copy', label: 'Number row copy', version: 1 });
    expect((await api('post', '/api/studio/features/kpi_row/duplicate')).body.data.id).toBe('kpi_row_copy_2');
    const long = await create({ ...KPI, id: 'a'.repeat(31), label: 'L'.repeat(40) });
    const dup = (await api('post', `/api/studio/features/${long.id}/duplicate`)).body.data;
    expect(dup.id).toHaveLength(31);
    expect(dup.id.endsWith('_copy')).toBe(true);
    expect(dup.label).toHaveLength(40);
  });

  it('enforces the 100 feature limit', async () => {
    await create();
    for (let i = 0; i < 99; i += 1) insertRaw(`f${i}`, KPI);
    const res = await api('post', '/api/studio/features').send({ feature: SEARCH });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('too_many_features');
    expect((await api('post', '/api/studio/features/kpi_row/duplicate')).status).toBe(409);
  });

  it('reads a broken stored row as ok:false and keeps it out of the library', async () => {
    await create();
    insertRaw('broken', {});
    const rec = (await api('get', '/api/studio/features/broken')).body.data;
    expect(rec.ok).toBe(false);
    expect(rec.issues.length).toBeGreaterThan(0);
    expect([...loadLibrary().keys()]).toEqual(['kpi_row']);
    expect((await api('delete', '/api/studio/features/broken')).status).toBe(200);
  });

  it('summaries for the Assistant filter by query and count apps in code', async () => {
    await create();
    await create(SEARCH);
    const all = listFeatureSummaries();
    expect(all.total).toBe(2);
    const kpi = all.features.find((f) => f.id === 'kpi_row');
    expect(kpi).toMatchObject({ name: 'Number row', version: 1, usedByApps: 0 });
    expect(kpi.settings[0]).toEqual({ name: 'source', label: 'List', type: 'source' });
    expect(listFeatureSummaries({ query: 'SEARCH' }).features.map((f) => f.id)).toEqual(['search_list']);
    expect(listFeatureSummaries({ query: "x'; DROP TABLE studio_features; --" }).total).toBe(0);
  });
});

describe('app save with features', () => {
  it('PUT stores the expansion with its marker', async () => {
    await create();
    const made = (await api('post', '/api/studio/apps').send({ name: 'Crew Roster' })).body.data;
    const res = await api('put', `/api/studio/apps/${made.id}`).send({ spec: appWithFeature(), baseRevision: 1 });
    expect(res.status).toBe(200);
    const block = res.body.data.spec.pages[0].layout.children.find((c) => c.feature);
    expect(block.feature).toMatchObject({ id: 'kpi_row', version: 1 });
    expect(JSON.stringify(rowsOf(db, 'apps')[0].spec)).not.toContain('"Feature"');
  });

  it('PUT with an unknown feature or bad params is 400 invalid_spec', async () => {
    const made = (await api('post', '/api/studio/apps').send({ name: 'Crew Roster' })).body.data;
    const unknown = await api('put', `/api/studio/apps/${made.id}`).send({ spec: appWithFeature(), baseRevision: 1 });
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe('invalid_spec');
    expect(unknown.body.issues.some((i) => i.code === 'unknown_feature')).toBe(true);
    await create();
    const bad = await api('put', `/api/studio/apps/${made.id}`).send({ spec: appWithFeature({ source: 'nope' }), baseRevision: 1 });
    expect(bad.status).toBe(400);
    expect(rowsOf(db, 'apps')[0].revision).toBe(1);
  });

  it('import expands too, and expandAndCheck skips the library read without a Feature layer', async () => {
    await create();
    const imp = await api('post', '/api/studio/apps/import').send({ spec: appWithFeature() });
    expect(imp.status).toBe(201);
    const noRead = () => {
      throw new Error('library read');
    };
    expect(expandAndCheck(starterSpec('Free Name', 'free-name'), noRead).ok).toBe(true);
    expect(expandAndCheck(appWithFeature(), new Map()).ok).toBe(false);
  });

  it('a Feature layer fails checkSpec as unknown_part', () => {
    const res = checkSpec(appWithFeature());
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.code === 'unknown_part')).toBe(true);
  });
});

describe('delete and usage', () => {
  it('refuses with 409 listing the apps, then allows once detached', async () => {
    await create();
    const made = (await api('post', '/api/studio/apps').send({ name: 'Crew Roster' })).body.data;
    await api('put', `/api/studio/apps/${made.id}`).send({ spec: appWithFeature(), baseRevision: 1 });
    expect((await api('get', '/api/studio/features/kpi_row')).body.data.usedBy.apps).toEqual([{ id: made.id, name: 'Crew Roster' }]);
    expect(listFeatureSummaries().features[0].usedByApps).toBe(1);
    const res = await api('delete', '/api/studio/features/kpi_row');
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'feature_in_use', apps: [{ id: made.id, name: 'Crew Roster' }], features: [] });
    expect(res.body.message).toBe('This feature is used by 1 app: Crew Roster. Remove or detach it there first.');
    expect(rowsOf(db, 'studio_features')).toHaveLength(1);
    await api('put', `/api/studio/apps/${made.id}`).send({ spec: starterSpec('Crew Roster', 'crew-roster'), baseRevision: 2 });
    expect((await api('delete', '/api/studio/features/kpi_row')).body).toEqual({ data: { id: 'kpi_row' } });
  });

  it('lists the features that nest it', async () => {
    await create();
    insertRaw('wrapper', {
      params: [],
      bindings: [],
      fragment: { id: 'o1', type: 'Section', props: {}, children: [{ id: 'o2', type: 'Feature', props: { featureId: 'kpi_row', params: {} }, children: [] }] },
    });
    db.prepare("UPDATE studio_features SET label = 'Wrapper' WHERE id = 'wrapper'").run();
    const res = await api('delete', '/api/studio/features/kpi_row');
    expect(res.status).toBe(409);
    expect(res.body.features).toEqual([{ id: 'wrapper', label: 'Wrapper' }]);
    expect(res.body.message).toBe('This feature is used by 1 feature: Wrapper. Remove or detach it there first.');
  });
});

describe('import', () => {
  const file = (feature, includes = []) => ({ format: 'local-app-studio-feature', formatVersion: 1, feature, includes });

  it('imports a new feature, reuses an identical one, renames a different one', async () => {
    const first = await api('post', '/api/studio/features/import').send({ file: file(KPI) });
    expect(first.status).toBe(201);
    expect(first.body.data.renamed).toEqual([]);
    expect(first.body.data.imported[0]).toMatchObject({ id: 'kpi_row', version: 1 });
    const same = await api('post', '/api/studio/features/import').send({ file: file(KPI) });
    expect(same.status).toBe(201);
    expect(rowsOf(db, 'studio_features')).toHaveLength(1);
    const changed = structuredClone(KPI);
    changed.params[2].label = 'Heading';
    const diff = await api('post', '/api/studio/features/import').send({ file: file(changed) });
    expect(diff.body.data.renamed).toEqual([{ from: 'kpi_row', to: 'kpi_row_2' }]);
    expect(rowsOf(db, 'studio_features')).toHaveLength(2);
  });

  it('rejects a bad file with 400 invalid_feature_file and writes nothing', async () => {
    const bads = [{}, { ...file(KPI), format: 'x' }, { ...file(KPI), formatVersion: 2 }, { ...file(KPI), feature: 5 }, { ...file(KPI), includes: {} }];
    for (const bad of bads) {
      const res = await api('post', '/api/studio/features/import').send({ file: bad });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_feature_file');
    }
    expect((await api('post', '/api/studio/features/import').send({})).status).toBe(400);
    const huge = file({ ...KPI, description: 'x'.repeat(300000) });
    expect((await api('post', '/api/studio/features/import').send({ file: huge })).body.code).toBe('invalid_feature_file');
  });

  it('is all or nothing', async () => {
    const res = await api('post', '/api/studio/features/import').send({ file: file({ ...KPI, id: 'select' }, [SEARCH]) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_feature_file');
    expect(rowsOf(db, 'studio_features')).toHaveLength(0);
  });

  it('rewrites Feature nodes of a renamed include', async () => {
    await create();
    const changed = structuredClone(KPI);
    changed.params[2].label = 'Heading';
    const res = await api('post', '/api/studio/features/import').send({ file: file(NESTED, [changed]) });
    expect(res.status).toBe(201);
    expect(res.body.data.renamed).toEqual([{ from: 'kpi_row', to: 'kpi_row_2' }]);
    const stored = rowsOf(db, 'studio_features').find((r) => r.id === 'wrapper');
    expect(JSON.stringify(stored.body)).toContain('kpi_row_2');
    expect(JSON.stringify(stored.body)).not.toContain('"kpi_row"');
  });
});

describe('validation cache', () => {
  it('reads and lists do not re-validate unchanged features', async () => {
    await create();
    await create(SEARCH);
    await api('get', '/api/studio/features/kpi_row');
    validateFeatureInput.mockClear();
    await api('get', '/api/studio/features/kpi_row');
    await api('get', '/api/studio/features');
    expect(listFeatureSummaries().total).toBe(2);
    expect(validateFeatureInput).not.toHaveBeenCalled();
  });

  it('create and update validate the written feature once, not the whole library twice', async () => {
    await create();
    await api('get', '/api/studio/features');
    validateFeatureInput.mockClear();
    const made = await create(SEARCH);
    expect(made.id).toBe('search_list');
    expect(validateFeatureInput).toHaveBeenCalledTimes(1);
    validateFeatureInput.mockClear();
    const res = await api('put', '/api/studio/features/kpi_row').send({ feature: { ...KPI, label: 'Number row 2' }, baseVersion: 1 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ label: 'Number row 2', version: 1, ok: true });
    // the edited feature is checked on input; kpi_row itself changed identity, so it is checked again once on the next read
    expect(validateFeatureInput.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('a changed row is checked again', async () => {
    await create();
    expect((await api('get', '/api/studio/features/kpi_row')).body.data.ok).toBe(true);
    db.prepare("UPDATE studio_features SET body = '{}' WHERE id = 'kpi_row'").run();
    expect((await api('get', '/api/studio/features/kpi_row')).body.data.ok).toBe(false);
  });
});

describe('a feature nesting an invalid feature', () => {
  it('is reported not ok, and neither is in the library', async () => {
    insertRaw('inner', { params: [], bindings: [], fragment: { id: 'x', type: 'NoSuchPart', props: {}, children: [] } });
    insertRaw('outer', {
      params: [],
      bindings: [],
      fragment: { id: 'o1', type: 'Section', props: {}, children: [{ id: 'o2', type: 'Feature', props: { featureId: 'inner', params: {} }, children: [] }] },
    });
    expect((await api('get', '/api/studio/features/inner')).body.data.ok).toBe(false);
    expect((await api('get', '/api/studio/features/outer')).body.data.ok).toBe(false);
    expect([...loadLibrary().keys()]).toEqual([]);
  });
});

describe('usage scan is complete', () => {
  const insertApp = (n, spec) =>
    db.prepare('INSERT INTO apps (id, name, slug, spec) VALUES (?, ?, ?, ?)').run(`app_${String(n).padStart(4, '0')}`, `App ${n}`, `app-${n}`, JSON.stringify(spec));
  const markerPage = (featureId) => ({ pages: [{ layout: { id: 'r', type: 'Section', props: {}, feature: { id: featureId, version: 1, params: {} }, children: [] } }] });

  it('refuses delete when only the 201st app uses the feature', async () => {
    await create();
    for (let i = 1; i <= 200; i += 1) insertApp(i, { pages: [] });
    insertApp(201, markerPage('kpi_row'));
    const res = await api('delete', '/api/studio/features/kpi_row');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('feature_in_use');
    expect(res.body.apps).toEqual([{ id: 'app_0201', name: 'App 201' }]);
    expect(rowsOf(db, 'studio_features')).toHaveLength(1);
  });

  it('refuses delete when a feature past the first 150 by recency nests it', async () => {
    await create();
    for (let i = 0; i < 160; i += 1) {
      insertRaw(`f${i}`, { params: [], bindings: [], fragment: { id: 'a', type: 'Section', props: {}, children: [] } });
      db.prepare('UPDATE studio_features SET updated_at = ? WHERE id = ?').run(`2026-02-01T00:00:${String(i % 60).padStart(2, '0')}.${String(i).padStart(3, '0')}Z`, `f${i}`);
    }
    insertRaw('oldest', {
      params: [],
      bindings: [],
      fragment: { id: 'o1', type: 'Section', props: {}, children: [{ id: 'o2', type: 'Feature', props: { featureId: 'kpi_row', params: {} }, children: [] }] },
    });
    db.prepare("UPDATE studio_features SET updated_at = '2020-01-01T00:00:00.000Z', label = 'Oldest' WHERE id = 'oldest'").run();
    const res = await api('delete', '/api/studio/features/kpi_row');
    expect(res.status).toBe(409);
    expect(res.body.features).toEqual([{ id: 'oldest', label: 'Oldest' }]);
  });
});
