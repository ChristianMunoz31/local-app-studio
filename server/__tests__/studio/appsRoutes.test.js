// Routes 1 to 7 through the real app in studio mode.
import crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeTestDb, createTestDb, resetDb, rowsOf } from '../helpers/testDb.js';
import { getBuildService } from '../../studio/build/service.js';
import { starterSpec } from '../../studio/specCheck.js';

vi.mock('../../../loadEnv.js', () => ({}));

let app;
let db;
let n = 0;
const ip = () => `10.9.${Math.floor(n / 250)}.${(n += 1) % 250}`;
const req = (method, url) => request(app)[method](url).set('X-Forwarded-For', ip());
const make = async (name = 'Crew Roster') => (await req('post', '/api/studio/apps').send({ name })).body.data;

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  delete process.env.AUTH_SECRET;
  db = createTestDb();
  app = (await import('../../../server.js')).default;
});
beforeEach(() => resetDb(db));
afterAll(() => closeTestDb(db));

describe('studio apps routes', () => {
  it('lists, is no-store and carries the 1200 budget', async () => {
    const res = await request(app).get('/api/studio/apps');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [] });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['ratelimit-policy']).toMatch(/^1200;w=900/);
  });

  it('creates an app with the starter spec', async () => {
    const res = await req('post', '/api/studio/apps').send({ name: '  Crew Roster ' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: 'Crew Roster', slug: 'crew-roster', revision: 1, issues: [] });
    const list = await req('get', '/api/studio/apps');
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ ok: true, pageCount: 1, tableCount: 0 });
    expect(typeof list.body.data[0].description).toBe('string');
    expect(list.body.data[0].hasInstaller).toBe(false);
  });

  it('answers 400 for a bad body', async () => {
    for (const body of [{}, { name: 5 }, { name: 'x' }, { name: 'Local App Studio' }]) {
      const res = await req('post', '/api/studio/apps').send(body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_request');
    }
    const a = await make();
    for (const body of [{ baseRevision: 1 }, { spec: a.spec }, { spec: a.spec, baseRevision: '1' }, { spec: a.spec, baseRevision: 0 }, { spec: a.spec, baseRevision: 1.5 }]) {
      expect((await req('put', `/api/studio/apps/${a.id}`).send(body)).status).toBe(400);
    }
    expect((await req('post', '/api/studio/apps/import').send({})).status).toBe(400);
  });

  it('gets, and answers 404 for unknown or malformed ids', async () => {
    const a = await make();
    expect((await req('get', `/api/studio/apps/${a.id}`)).body.data.id).toBe(a.id);
    const missing = await req('get', `/api/studio/apps/${crypto.randomUUID()}`);
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('app_not_found');
    expect((await req('get', '/api/studio/apps/not-an-id')).status).toBe(404);
    expect((await req('delete', '/api/studio/apps/not-an-id')).status).toBe(404);
  });

  it('puts with a revision check', async () => {
    const a = await make();
    const spec = structuredClone(a.spec);
    spec.pages[0].title = 'Start';
    const ok = await req('put', `/api/studio/apps/${a.id}`).send({ spec, baseRevision: 1 });
    expect(ok.status).toBe(200);
    expect(ok.body.data.revision).toBe(2);
    const stale = await req('put', `/api/studio/apps/${a.id}`).send({ spec, baseRevision: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'revision_conflict', revision: 2 });
    const gone = await req('put', `/api/studio/apps/${crypto.randomUUID()}`).send({ spec: starterSpec('Free Name', 'free-name'), baseRevision: 1 });
    expect(gone.status).toBe(404);
    const bad = structuredClone(spec);
    bad.pages[0].layout.children[0].type = 'Nope';
    const invalid = await req('put', `/api/studio/apps/${a.id}`).send({ spec: bad, baseRevision: 2 });
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe('invalid_spec');
    expect(invalid.body.message).toBe(invalid.body.issues[0].message);
    expect(rowsOf(db, 'apps')[0].revision).toBe(2);
  });

  it('answers slug_taken when the new name collides', async () => {
    const a = await make('Crew Roster');
    const b = await make('Other Thing');
    const spec = structuredClone(b.spec);
    spec.app.slug = a.slug;
    const res = await req('put', `/api/studio/apps/${b.id}`).send({ spec, baseRevision: 1 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('slug_taken');
  });

  it('duplicates, imports and deletes', async () => {
    const a = await make();
    const dup = await req('post', `/api/studio/apps/${a.id}/duplicate`);
    expect(dup.status).toBe(201);
    expect(dup.body.data.name).toBe('Crew Roster Copy');
    expect((await req('post', `/api/studio/apps/${crypto.randomUUID()}/duplicate`)).status).toBe(404);
    const imp = await req('post', '/api/studio/apps/import').send({ spec: a.spec });
    expect(imp.status).toBe(201);
    expect(imp.body.data.slug).toBe('crew-roster-2');
    expect(imp.body.data.spec.app.slug).toBe('crew-roster-2');
    const badImport = await req('post', '/api/studio/apps/import').send({ spec: { specVersion: 1 } });
    expect(badImport.status).toBe(400);
    expect(badImport.body.code).toBe('invalid_spec');
    const del = await req('delete', `/api/studio/apps/${a.id}`);
    expect(del.body).toEqual({ data: { id: a.id } });
    expect((await req('delete', `/api/studio/apps/${a.id}`)).status).toBe(404);
  });

  it('deletes with ifRevision only while the revision still matches', async () => {
    const a = await make();
    const saved = await req('put', `/api/studio/apps/${a.id}`).send({ spec: a.spec, baseRevision: a.revision });
    expect(saved.status).toBe(200);
    const stale = await req('delete', `/api/studio/apps/${a.id}?ifRevision=${a.revision}`);
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'revision_conflict', revision: saved.body.data.revision });
    expect((await req('get', `/api/studio/apps/${a.id}`)).status).toBe(200);
    expect((await req('delete', `/api/studio/apps/${a.id}?ifRevision=abc`)).status).toBe(400);
    const ok = await req('delete', `/api/studio/apps/${a.id}?ifRevision=${saved.body.data.revision}`);
    expect(ok.body).toEqual({ data: { id: a.id } });
    expect((await req('delete', `/api/studio/apps/${a.id}?ifRevision=1`)).status).toBe(404);
  });

  it('refuses to delete an app while its build runs', async () => {
    const a = await make();
    const spy = vi.spyOn(getBuildService(), 'isBuilding').mockReturnValue(true);
    try {
      const res = await req('delete', `/api/studio/apps/${a.id}`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('build_running');
    } finally {
      spy.mockRestore();
    }
    expect((await req('get', `/api/studio/apps/${a.id}`)).status).toBe(200);
    expect((await req('delete', `/api/studio/apps/${a.id}`)).status).toBe(200);
  });

  it('gives a broken stored row spec null, issues and raw', async () => {
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO apps (id, name, slug, spec) VALUES (?, ?, ?, ?)').run(id, 'Broken App', 'broken-app', '{"specVersion":1}');
    const res = await req('get', `/api/studio/apps/${id}`);
    expect(res.body.data).toMatchObject({ spec: null, raw: { specVersion: 1 }, name: 'Broken App' });
    expect(res.body.data.issues.length).toBeGreaterThan(0);
    const dup = await req('post', `/api/studio/apps/${id}/duplicate`);
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('spec_invalid');
  });

  it('gives a 2.5 MB body the kit 413 and never writes a studio state key', async () => {
    const big = await req('post', '/api/studio/apps/import').send({ spec: { pad: 'x'.repeat(2.5 * 1024 * 1024) } });
    expect(big.status).toBe(413);
    expect(big.body.code).toBe('request_too_large');
    const state = await req('put', '/api/state/studio.anything').send({ value: 1 });
    expect(state.status).toBeGreaterThanOrEqual(400);
    await make();
    expect(rowsOf(db, 'app_state').filter((r) => r.key.startsWith('studio.'))).toHaveLength(0);
  });
});
