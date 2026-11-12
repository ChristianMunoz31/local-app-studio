// Phase 11 B5: Studio data limits (A5.1 to A5.8) through the real routes in studio mode. Each case either works inside
// the documented limit or is refused with a plain message that names the limit. Heavy inputs are built in memory and
// the store functions fill the tables, so the file runs in seconds. The 10000 row case (A5.3) is in
// runtime/dataRoutesHostile.test.js because it needs the built-app data routes.
import { DatabaseSync } from 'node:sqlite';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIMITS } from '@local-app-studio/runtime/spec/schema.ts';
import { FEATURE_LIMITS, SEED_FEATURES } from '../../../src/catalog/features/index.ts';
import { planMigration } from '../../spec/plan.js';
import { createApp } from '../../studio/apps.js';
import { createFeature } from '../../studio/features/store.js';
import { MAX_APPS, SPEC_SHAPE, starterSpec } from '../../studio/specCheck.js';
import { closeTestDb, createTestDb, resetDb } from '../helpers/testDb.js';

vi.mock('../../../loadEnv.js', () => ({}));

let app;
let db;
let n = 0;
const ip = () => `10.8.${Math.floor(n / 250)}.${(n += 1) % 250}`;
const req = (method, url) => request(app)[method](url).set('X-Forwarded-For', ip());

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  delete process.env.AUTH_SECRET;
  db = createTestDb();
  app = (await import('../../../server.js')).default;
});
beforeEach(() => resetDb(db));
afterAll(() => closeTestDb(db));

const make = async (name = 'Crew Roster') => (await req('post', '/api/studio/apps').send({ name })).body.data;
const put = (record, spec) => req('put', `/api/studio/apps/${record.id}`).send({ spec, baseRevision: record.revision });
const IMPORT_LIMIT_BYTES = 16 * 1024 * 1024;
const base = () => starterSpec('Crew Roster', 'crew-roster');

const tableOf = (i, fields) => ({
  id: `t${i}`,
  label: `Table ${i}`,
  titleField: 'f0',
  fields: Array.from({ length: fields }, (_, j) => ({ id: `f${j}`, label: `Field ${j}`, type: 'text' })),
});
const withTables = (tables, fields) => ({ ...base(), tables: Array.from({ length: tables }, (_, i) => tableOf(i, fields)) });
const textLayer = (id, chars) => ({ id, type: 'Text', props: {}, children: 'x'.repeat(chars) });
const withPage = (children) => {
  const spec = base();
  spec.pages[0].layout = { id: 'root_home', type: 'Page', props: {}, children };
  return spec;
};
const messageOf = (res) => res.body.message ?? '';

describe('A5.1: tables and fields', () => {
  it('40 tables of 60 fields is refused with 400 invalid_spec naming 30 tables', async () => {
    const a = await make();
    const res = await put(a, withTables(40, 60));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_spec');
    expect(messageOf(res)).toContain(String(LIMITS.tables));
    expect(messageOf(res)).not.toMatch(/zod|stack/i);
    const after = (await req('get', `/api/studio/apps/${a.id}`)).body.data;
    expect(after.revision).toBe(a.revision);
    expect(after.spec.tables).toEqual([]);
  });

  it('30 tables of 60 fields is accepted, is far below the size limit and creates every table', async () => {
    const a = await make();
    const spec = withTables(LIMITS.tables, LIMITS.fieldsPerTable);
    const res = await put(a, spec);
    expect(res.status).toBe(200);
    const size = JSON.stringify(res.body.data.spec).length;
    expect(size).toBeLessThan(LIMITS.specChars / 2);
    const plan = planMigration(null, res.body.data.spec);
    expect(plan.ok).toBe(true);
    const mem = new DatabaseSync(':memory:');
    mem.exec(plan.file.sql);
    const tables = mem.prepare("SELECT count(*) AS c FROM sqlite_master WHERE type = 'table' AND name LIKE 't%'").get();
    expect(tables.c).toBe(LIMITS.tables);
    const cols = mem.prepare('SELECT count(*) AS c FROM pragma_table_info(?)').get('t0');
    expect(cols.c).toBe(LIMITS.fieldsPerTable + 3);
    mem.close();
  });

  it('61 fields in one table is refused naming 60', async () => {
    const a = await make();
    const res = await put(a, withTables(1, LIMITS.fieldsPerTable + 1));
    expect(res.status).toBe(400);
    expect(messageOf(res)).toContain(String(LIMITS.fieldsPerTable));
  });
});

describe('A5.2: the design size', () => {
  /** A valid spec whose JSON is exactly `chars` long (Text layers of at most layerTextChars, spread over the home page). */
  function specOfSize(chars) {
    const spec = withPage([]);
    const kids = [];
    for (let i = 0; i < 270; i += 1) kids.push(textLayer(`text_${i}`, LIMITS.layerTextChars));
    spec.pages[0].layout.children = kids;
    // Fewer layers than the page limit, so shrink the last text until the size is exact.
    let len = JSON.stringify(spec).length;
    let k = kids.length - 1;
    while (len > chars) {
      const cut = Math.min(len - chars, kids[k].children.length - 1);
      kids[k].children = kids[k].children.slice(0, kids[k].children.length - cut);
      len = JSON.stringify(spec).length;
      k -= 1;
      if (k < 0) k = kids.length - 1;
    }
    return { spec, len };
  }

  it('a design of exactly specChars characters is accepted and one character more is refused', async () => {
    const a = await make();
    const fit = specOfSize(LIMITS.specChars);
    expect(fit.len).toBe(LIMITS.specChars);
    const ok = await put(a, fit.spec);
    expect(ok.status).toBe(200);
    const over = structuredClone(fit.spec);
    over.pages[0].layout.children[0].children += 'x';
    expect(JSON.stringify(over).length).toBe(LIMITS.specChars + 1);
    const res = await put({ ...a, revision: ok.body.data.revision }, over);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_spec');
    expect(messageOf(res)).toContain('An app design may be at most 512 KB.');
  });

  it('a 1 MB design is refused by PUT and by import with 400 invalid_spec and a plain message, and nothing is stored', async () => {
    const a = await make();
    const big = { ...base(), pad: 'x'.repeat(1024 * 1024) };
    const res = await put(a, big);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_spec');
    expect(messageOf(res)).toContain('An app design may be at most 512 KB.');
    const imp = await req('post', '/api/studio/apps/import').send({ spec: big });
    expect(imp.status).toBe(400);
    expect(imp.body.code).toBe('invalid_spec');
    expect((await req('get', '/api/studio/apps')).body.data).toHaveLength(1);
  });

  it('a body over 2 MB is a plain 413 JSON answer that names the limit and never writes', async () => {
    const a = await make();
    const res = await req('put', `/api/studio/apps/${a.id}`).send({ spec: { pad: 'x'.repeat(2.1 * 1024 * 1024) }, baseRevision: 1 });
    expect(res.status).toBe(413);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.code).toBe('request_too_large');
    expect(res.body.message).toMatch(/2 MB/);
    expect(res.text).not.toMatch(/stack|PayloadTooLarge/);
    const imp = await req('post', '/api/studio/apps/import').send({ spec: { pad: 'x'.repeat(2.1 * 1024 * 1024) } });
    expect(imp.status).toBe(413);
    expect(imp.body.message).toMatch(/2 MB/);
  });

  it('a body that is not JSON gets a plain 400 with a message', async () => {
    const a = await make();
    const res = await req('put', `/api/studio/apps/${a.id}`).set('Content-Type', 'application/json').send('{"spec":');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_body');
    expect(typeof res.body.message).toBe('string');
    expect(res.body.message.length).toBeGreaterThan(5);
  });

  it('a design nested past the shape limit is refused with a plain message', async () => {
    const a = await make();
    let deep = 1;
    for (let i = 0; i < SPEC_SHAPE.maxDepth + 5; i += 1) deep = { a: deep };
    const res = await put(a, { ...base(), deep });
    expect(res.status).toBe(400);
    expect(messageOf(res)).toContain(String(SPEC_SHAPE.maxDepth));
  });
});

describe('A5.4: an import file of 50 MB', () => {
  // express.raw (IMPORT_MAX_BODY, 16 MB) refuses on the declared length before reading. A client that keeps sending
  // 50 MB can see the connection reset after the answer (the browser checks the size first, importService.js), so the
  // answer is checked at the first byte over the limit, which the client reads in full.
  it('a body of 16 MB plus one byte gets a plain 413 import_too_large and stores nothing', async () => {
    const res = await request(app).post('/api/import').set('Content-Type', 'application/zip').send(Buffer.alloc(IMPORT_LIMIT_BYTES + 1, 1));
    expect(res.status).toBe(413);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body).toMatchObject({ code: 'import_too_large', error: 'This file is too large to restore here. The limit is 16 MB.' });
    expect(res.text).not.toMatch(/stack|PayloadTooLarge/);
  });

  it('a 50 MB upload never gets a 5xx: it is a 413 or a reset connection', async () => {
    const outcome = await request(app)
      .post('/api/import')
      .set('Content-Type', 'application/zip')
      .send(Buffer.alloc(50 * 1024 * 1024, 1))
      .then((r) => r.status, (e) => e.code);
    expect([413, 'ECONNRESET', 'EPIPE']).toContain(outcome);
  });
});

describe('A5.5: saved features', () => {
  const feature = (i) => {
    const copy = structuredClone(SEED_FEATURES[0]);
    delete copy.version;
    delete copy.updatedAt;
    return { ...copy, id: `lim_feature_${i}`, label: `Limit feature ${i}` };
  };

  it('keeps FEATURE_LIMITS.library features and refuses the next with a message naming the limit', async () => {
    for (let i = 0; i < FEATURE_LIMITS.library; i += 1) createFeature(feature(i));
    const list = await req('get', '/api/studio/features');
    expect(list.body.data).toHaveLength(FEATURE_LIMITS.library);
    const res = await req('post', '/api/studio/features').send({ feature: feature(FEATURE_LIMITS.library) });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('too_many_features');
    expect(res.body.message).toContain(String(FEATURE_LIMITS.library));
    const file = await req('post', '/api/studio/features/import').send({ file: { kind: 'feature', feature: feature(FEATURE_LIMITS.library + 1) } });
    expect(file.status).toBeLessThan(500);
    expect((await req('get', '/api/studio/features')).body.data).toHaveLength(FEATURE_LIMITS.library);
  });
});

describe('A5.6: apps', () => {
  it('keeps MAX_APPS apps and refuses the next on create, import and duplicate, naming the limit', async () => {
    for (let i = 0; i < MAX_APPS; i += 1) createApp({ name: `App ${i}` });
    const list = await req('get', '/api/studio/apps');
    expect(list.body.data).toHaveLength(MAX_APPS);
    const created = await req('post', '/api/studio/apps').send({ name: 'One Too Many' });
    expect(created.status).toBe(409);
    expect(created.body.code).toBe('too_many_apps');
    expect(created.body.message).toContain(String(MAX_APPS));
    const imported = await req('post', '/api/studio/apps/import').send({ spec: starterSpec('Imported One', 'imported-one') });
    expect(imported.status).toBe(409);
    expect(imported.body.code).toBe('too_many_apps');
    const first = list.body.data[0];
    const dup = await req('post', `/api/studio/apps/${first.id}/duplicate`);
    expect(dup.status).toBe(409);
    expect(dup.body.message).toContain(String(MAX_APPS));
    expect((await req('get', '/api/studio/apps')).body.data).toHaveLength(MAX_APPS);
  });
});

describe('A5.7: layers and depth of a page', () => {
  it('a page of LIMITS.layersPerPage parts is accepted and one more is refused naming the limit', async () => {
    const a = await make();
    // The root counts as one part.
    const fit = withPage(Array.from({ length: LIMITS.layersPerPage - 1 }, (_, i) => textLayer(`t_${i}`, 3)));
    const ok = await put(a, fit);
    expect(ok.status).toBe(200);
    const over = withPage(Array.from({ length: LIMITS.layersPerPage }, (_, i) => textLayer(`t_${i}`, 3)));
    const res = await put({ ...a, revision: ok.body.data.revision }, over);
    expect(res.status).toBe(400);
    expect(messageOf(res)).toContain(String(LIMITS.layersPerPage));
    const huge = await put({ ...a, revision: ok.body.data.revision }, withPage(Array.from({ length: 301 }, (_, i) => textLayer(`h_${i}`, 3))));
    expect(huge.status).toBe(400);
  });

  it('nesting of LIMITS.layerDepth levels is accepted and one more is refused naming the limit', async () => {
    const a = await make();
    const chain = (levels) => {
      let node = textLayer('leaf', 3);
      for (let i = 0; i < levels; i += 1) node = { id: `card_${i}`, type: 'Card', props: {}, children: [node] };
      return node;
    };
    // Page (1) + cards + leaf: find the deepest chain accepted, it must be exactly layerDepth levels in total.
    let deepest = 0;
    let revision = a.revision;
    for (let levels = 1; levels <= LIMITS.layerDepth + 2; levels += 1) {
      const res = await put({ ...a, revision }, withPage([chain(levels)]));
      if (res.status === 200) {
        deepest = levels;
        revision = res.body.data.revision;
      } else {
        expect(res.status).toBe(400);
        expect(messageOf(res)).toContain(String(LIMITS.layerDepth));
        break;
      }
    }
    expect(deepest + 2).toBe(LIMITS.layerDepth);
  });
});

describe('A5.8: pages, sources, menu items', () => {
  const pageOf = (i, sources = []) => ({
    id: `p${i}`,
    title: `Page ${i}`,
    route: i === 0 ? '/' : `/p${i}`,
    sources,
    layout: { id: `root_p${i}`, type: 'Page', props: {}, children: [] },
  });

  it('31 pages are refused naming 30; 30 are accepted', async () => {
    const a = await make();
    const mk = (count) => ({ ...base(), pages: Array.from({ length: count }, (_, i) => pageOf(i)), nav: [{ pageId: 'p0', label: 'Home' }] });
    const ok = await put(a, mk(LIMITS.pages));
    expect(ok.status).toBe(200);
    const res = await put({ ...a, revision: ok.body.data.revision }, mk(LIMITS.pages + 1));
    expect(res.status).toBe(400);
    expect(messageOf(res)).toContain(String(LIMITS.pages));
  });

  it('9 sources on a page are refused naming 8; 8 are accepted', async () => {
    const a = await make();
    const mk = (count) => {
      const spec = withTables(1, 2);
      spec.pages[0].sources = Array.from({ length: count }, (_, i) => ({ id: `s${i}`, table: 't0', mode: 'list' }));
      return spec;
    };
    const ok = await put(a, mk(LIMITS.sourcesPerPage));
    expect(ok.status).toBe(200);
    const res = await put({ ...a, revision: ok.body.data.revision }, mk(LIMITS.sourcesPerPage + 1));
    expect(res.status).toBe(400);
    expect(messageOf(res)).toContain(String(LIMITS.sourcesPerPage));
  });

  it('21 menu items are refused naming 20; 20 are accepted', async () => {
    const a = await make();
    const mk = (count) => ({
      ...base(),
      pages: Array.from({ length: count }, (_, i) => pageOf(i)),
      nav: Array.from({ length: count }, (_, i) => ({ pageId: `p${i}`, label: `Page ${i}` })),
    });
    const ok = await put(a, mk(LIMITS.nav));
    expect(ok.status).toBe(200);
    const res = await put({ ...a, revision: ok.body.data.revision }, mk(LIMITS.nav + 1));
    expect(res.status).toBe(400);
    expect(messageOf(res)).toContain(String(LIMITS.nav));
  });
});

describe('A2.11 and A2.12 (studio mode): kit tables and hostile ids and revisions', () => {
  it.each(['app_state', 'studio_apps', 'apps', 'studio_features', 'sqlite_master', '__proto__'])('/api/data/%s is a plain 404 in Studio (the data routes are not mounted)', async (t) => {
    const res = await req('get', `/api/data/${t}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
    expect(res.body).not.toHaveProperty('rows');
  });

  it.each(['not-a-uuid', '../x', '%00', 'x'.repeat(300), '00000000-0000-0000-0000-00000000000g'])('app id %j is 404 app_not_found on every verb', async (id) => {
    const e = encodeURIComponent(id);
    for (const res of [
      await req('get', `/api/studio/apps/${e}`),
      await req('put', `/api/studio/apps/${e}`).send({ spec: base(), baseRevision: 1 }),
      await req('delete', `/api/studio/apps/${e}`),
      await req('post', `/api/studio/apps/${e}/duplicate`),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('app_not_found');
      expect(res.text).not.toMatch(/stack|SQLITE/);
    }
  });

  it('duplicating an unknown id is 404 and baseRevision -1, 1.5, "3", null, an array are 400 invalid_request', async () => {
    expect((await req('post', '/api/studio/apps/00000000-0000-4000-8000-000000000000/duplicate')).status).toBe(404);
    const a = await make();
    for (const baseRevision of [-1, 1.5, '3', null, [1], 1e300, Number.MAX_SAFE_INTEGER + 2]) {
      const res = await req('put', `/api/studio/apps/${a.id}`).set('Content-Type', 'application/json').send(JSON.stringify({ spec: base(), baseRevision }));
      expect(res.status, String(baseRevision)).toBe(400);
      expect(res.body.code).toBe('invalid_request');
    }
    const stale = await put({ ...a, revision: 99 }, base());
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('revision_conflict');
  });
});
