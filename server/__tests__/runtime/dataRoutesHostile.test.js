// Phase 11 B2 and B5 (data side): hostile table names, fields, paging, filters and bodies on every generic data route.
// Contract: a 4xx with a plain message, no stack or SQL text, never a 500, never a row from another table.
// The setup copies dataRoutes.test.js (Crew Roster spec: `people` and `crews`, a reference between them).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const spec = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'packages', 'runtime', 'src', 'spec', 'fixtures', 'crew-roster.json'), 'utf8'));
  const crews = spec.tables.find((t) => t.id === 'crews');
  crews.fields.push({ id: 'budget', label: 'Budget', type: 'real' }, { id: 'started', label: 'Started', type: 'date' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'las-hostile-'));
  const file = path.join(dir, 'app-spec.json');
  fs.writeFileSync(file, JSON.stringify(spec));
  process.env.APP_MODE = 'runtime';
  process.env.APP_SPEC_PATH = file;
  process.env.__TEST_SPEC_DIR = dir;
});

import fs from 'node:fs';
import request from 'supertest';
import { insertMany, withTransaction } from '../../db/index.js';
import { closeTestDb, createTestDb, resetDb } from '../helpers/testDb.js';

vi.mock('../../../loadEnv.js', () => ({}));

let app;
let db;
const savedPw = { APP_PASSWORD: process.env.APP_PASSWORD, AUTH_SECRET: process.env.AUTH_SECRET };
const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  delete process.env.AUTH_SECRET;
  db = createTestDb();
  app = (await import('../../../server.js')).default;
});
afterAll(() => {
  closeTestDb(db);
  fs.rmSync(process.env.__TEST_SPEC_DIR, { recursive: true, force: true });
  delete process.env.APP_MODE;
  delete process.env.APP_SPEC_PATH;
  delete process.env.__TEST_SPEC_DIR;
  for (const [k, v] of Object.entries(savedPw)) if (v !== undefined) process.env[k] = v;
});
beforeEach(() => {
  resetDb(db);
  spy.mockClear();
});

const LEAK = /SQLITE_[A-Z]|node:|\bat [\w.<>]+ \(|\.js:\d+|"stack"/;

/** The shared contract of a refusal: 4xx, JSON, plain words, nothing internal. */
function expectPlain(res, { status } = {}) {
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
  if (status) expect(res.status).toBe(status);
  expect(res.headers['content-type']).toMatch(/json/);
  expect(res.body).toBeTypeOf('object');
  expect(typeof res.body.code).toBe('string');
  expect(res.body).not.toHaveProperty('stack');
  expect(res.body).not.toHaveProperty('rows');
  expect(res.text).not.toMatch(LEAK);
  if (res.body.message !== undefined) {
    expect(typeof res.body.message).toBe('string');
    expect(res.body.message.length).toBeGreaterThan(3);
  }
}

const seedPeople = (n = 3) => insertMany('people', Array.from({ length: n }, (_, i) => ({ name: `P${i}` })));
const seedCrews = (leadId, n = 3) =>
  insertMany('crews', Array.from({ length: n }, (_, i) => ({ name: `C${i}`, lead_id: leadId, size: i + 1, status: i % 2 ? 'paused' : 'active' })));
const get = (url) => request(app).get(url);
const postJson = (url, text) => request(app).post(url).set('Content-Type', 'application/json').send(text);

describe('A2.1 and A2.2: hostile table names', () => {
  const names = [
    'sqlite_master', 'app_state', 'studio_apps', 'studio_features', '__proto__', 'constructor', 'hasOwnProperty', 'toString', 'valueOf', 'prototype',
    'crews";DROP TABLE crews;--', "crews' OR '1'='1", 'crews;', 'crews.', 'crews%00', 'créws', '漢字', '🙂', 'a'.repeat(300), 'CREWS', 'Crews', ' crews', 'crews ',
    'people,crews', 'main.crews', '*', '%2e%2e',
  ];

  it.each(names)('%j is 404 unknown_table on every route and leaves the data alone', async (name) => {
    const [p] = seedPeople(1);
    seedCrews(p.id, 2);
    const t = encodeURIComponent(name);
    for (const res of [
      await get(`/api/data/${t}`),
      await get(`/api/data/${t}/stats`),
      await get(`/api/data/${t}/stats?groupBy=status`),
      await get(`/api/data/${t}/abc`),
      await request(app).post(`/api/data/${t}`).send({ name: 'x' }),
      await request(app).patch(`/api/data/${t}/abc`).send({ name: 'x' }),
      await request(app).delete(`/api/data/${t}/abc`),
    ]) {
      expectPlain(res, { status: 404 });
      expect(res.body.code).toBe('unknown_table');
      expect(res.body.message).toBe('That table does not exist.');
    }
    expect((await get('/api/data/crews')).body.data.total).toBe(2);
    expect((await get('/api/data/people')).body.data.total).toBe(1);
  });

  it('raw (not encoded) hostile paths are refused cleanly', async () => {
    for (const url of ['/api/data/crews;DROP', '/api/data/%', '/api/data/%E0%A4%A', '/api/data/%zz/stats', '/api/data//crews', '/api/data/crews/']) {
      const res = await get(url);
      expect(res.status).toBeLessThan(500);
      expect(res.text).not.toMatch(LEAK);
    }
  });
});

describe('A2.3: sort', () => {
  it.each([
    'name";--:asc', '__proto__:asc', 'constructor', 'nofield', 'name:sideways', 'a,b,c,d', 'name:asc:extra', ':asc', ',', 'sqlite_master', 'name asc', 'name; DROP TABLE crews',
    'name,size,status,id', 'nickname', 'a'.repeat(300),
  ])('sort=%j is 400 invalid_query on sort', async (sort) => {
    const [p] = seedPeople(1);
    seedCrews(p.id, 1);
    const res = await get('/api/data/crews').query({ sort });
    expectPlain(res, { status: 400 });
    expect(res.body).toMatchObject({ code: 'invalid_query', field: 'sort' });
  });

  it('empty, repeated and bracketed sort are refused, a valid sort works', async () => {
    expectPlain(await get('/api/data/crews?sort='), { status: 400 });
    expectPlain(await get('/api/data/crews?sort=name&sort=size'), { status: 400 });
    expectPlain(await get('/api/data/crews?sort[a]=1'), { status: 400 });
    const [p] = seedPeople(1);
    seedCrews(p.id, 3);
    const ok = await get('/api/data/crews?sort=size:desc');
    expect(ok.body.data.rows.map((r) => r.size)).toEqual([3, 2, 1]);
  });
});

describe('A2.4: paging', () => {
  it.each(['0', '-1', '1e9', '1.5', '', ' 5', '5 ', '0x10', '201', '1000000000', '9999999999', '+5', '٣', 'NaN', 'Infinity', '5;DROP', '[]'])(
    'limit=%j is 400 on limit',
    async (v) => {
      const res = await get(`/api/data/crews?limit=${encodeURIComponent(v)}`);
      expectPlain(res, { status: 400 });
      expect(res.body).toMatchObject({ code: 'invalid_query', field: 'limit' });
    },
  );

  it.each(['-1', '100001', '1.5', '', '0x1', '1e3', '99999999999'])('offset=%j is 400 on offset', async (v) => {
    const res = await get(`/api/data/crews?offset=${encodeURIComponent(v)}`);
    expectPlain(res, { status: 400 });
    expect(res.body.field).toBe('offset');
  });

  it('repeated or bracketed limit and offset are 400', async () => {
    expectPlain(await get('/api/data/crews?limit=1&limit=2'), { status: 400 });
    expectPlain(await get('/api/data/crews?limit[]=1'), { status: 400 });
    expectPlain(await get('/api/data/crews?offset=1&offset=2'), { status: 400 });
  });

  it('the edges 1, 200 and offset 100000 are accepted', async () => {
    expect((await get('/api/data/crews?limit=1')).status).toBe(200);
    expect((await get('/api/data/crews?limit=200')).status).toBe(200);
    const far = await get('/api/data/crews?offset=100000');
    expect(far.status).toBe(200);
    expect(far.body.data.rows).toEqual([]);
  });
});

describe('A2.5: filter', () => {
  const filter = (v) => get('/api/data/crews').query({ filter: typeof v === 'string' ? v : JSON.stringify(v) });

  it('a SQL fragment as a value is a bound literal: 200 with no rows', async () => {
    const [p] = seedPeople(1);
    seedCrews(p.id, 3);
    for (const value of ["x' OR 1=1 --", '"; DROP TABLE crews;--', "'); DELETE FROM crews;--", '%', '_', '\\']) {
      const res = await filter([{ field: 'name', op: 'eq', value }]);
      expect(res.status).toBe(200);
      expect(res.body.data.rows).toEqual([]);
    }
    expect((await get('/api/data/crews')).body.data.total).toBe(3);
  });

  it.each([
    ['a field with SQL in its name', [{ field: 'name; DROP', op: 'eq', value: 'x' }]],
    ['__proto__ field', [{ field: '__proto__', op: 'eq', value: 'x' }]],
    ['constructor field', [{ field: 'constructor', op: 'eq', value: 'x' }]],
    ['sqlite_master field', [{ field: 'sqlite_master', op: 'eq', value: 'x' }]],
    ['an operator that is SQL', [{ field: 'name', op: 'eq OR 1=1', value: 'x' }]],
    ['like as an operator', [{ field: 'name', op: 'like', value: '%' }]],
    ['nine filters', Array.from({ length: 9 }, (_, i) => ({ field: 'name', op: 'eq', value: String(i) }))],
    ['a non-list object', '{"__proto__":{}}'],
    ['a plain object', { field: 'name', op: 'eq', value: 'x' }],
    ['numbers in a list', [1, 2]],
    ['null in a list', [null]],
    ['nested arrays', [[{ field: 'name', op: 'eq', value: 'x' }]]],
    ['in with 51 values', [{ field: 'name', op: 'in', value: Array.from({ length: 51 }, (_, i) => String(i)) }]],
    ['in without a list', [{ field: 'name', op: 'in', value: 'x' }]],
    ['gt on a select field', [{ field: 'status', op: 'gt', value: 'active' }]],
    ['a select value that is not an option', [{ field: 'status', op: 'eq', value: 'x" OR 1=1' }]],
    ['text for an integer', [{ field: 'size', op: 'eq', value: '1 OR 1=1' }]],
    ['an impossible date', [{ field: 'started', op: 'eq', value: '2025-02-30' }]],
    ['an object as a value', [{ field: 'name', op: 'eq', value: { $or: 1 } }]],
    ['a duplicate field and operator', [{ field: 'name', op: 'eq', value: 'a' }, { field: 'name', op: 'eq', value: 'b' }]],
    ['null with gt', [{ field: 'name', op: 'gt', value: null }]],
    ['invalid JSON', '{not json'],
    ['a JSON string', '"x"'],
    ['null', 'null'],
    ['empty text', ''],
  ])('%s is 400 on filter', async (_label, v) => {
    const res = await filter(v);
    expectPlain(res, { status: 400 });
    expect(res.body).toMatchObject({ code: 'invalid_query', field: 'filter' });
  });

  it('a long, repeated or bracketed filter is 400', async () => {
    // Node refuses a request line over 16 KB with a bare 431 before Express, so the 20000 character cap is checked
    // directly in params.test-style fashion below; here a 3000 character text must still be a plain 400 (the URL stays under that limit).
    expectPlain(await filter('['.repeat(3000)), { status: 400 });
    expectPlain(await get('/api/data/crews?filter=[]&filter=[]'), { status: 400 });
    expectPlain(await get('/api/data/crews?filter[a]=1'), { status: 400 });
  });

  it('a filter naming a field of another table is refused', async () => {
    const res = await get('/api/data/people').query({ filter: JSON.stringify([{ field: 'size', op: 'eq', value: 1 }]) });
    expectPlain(res, { status: 400 });
  });
});

describe('A2.5b: the 20000 character filter cap, at the parser', () => {
  it('20001 characters is refused with field filter and 20000 is parsed', async () => {
    const { parseDataQuery } = await import('@local-app-studio/runtime/server/params.js');
    const { getCompiledSpec, getAppSpec } = await import('../../spec/source.js');
    const compiled = getCompiledSpec();
    const spec = getAppSpec();
    const over = parseDataQuery(compiled, spec, 'crews', { filter: ' '.repeat(20001) + '[]' });
    expect(over).toMatchObject({ ok: false, field: 'filter' });
    const edge = parseDataQuery(compiled, spec, 'crews', { filter: '[]'.padStart(20000, ' ') });
    expect(edge.ok).toBe(true);
  });
});

describe('A2.6: search and searchFields', () => {
  it.each([
    [{ search: 'x'.repeat(201) }, 'search'],
    [{ search: 'x', searchFields: '__proto__' }, 'searchFields'],
    [{ search: 'x', searchFields: 'size' }, 'searchFields'],
    [{ search: 'x', searchFields: 'name,constructor' }, 'searchFields'],
    [{ search: 'x', searchFields: 'name;DROP' }, 'searchFields'],
    [{ search: 'x', searchFields: 'id' }, 'searchFields'],
    [{ search: 'x', searchFields: 'sqlite_master' }, 'searchFields'],
  ])('%j is 400 on %s', async (query, field) => {
    const res = await get('/api/data/crews').query(query);
    expectPlain(res, { status: 400 });
    expect(res.body.field).toBe(field);
  });

  it('a repeated or object search is 400; an SQL-looking or LIKE-looking term is just text', async () => {
    expectPlain(await get('/api/data/crews?search=a&search=b'), { status: 400 });
    expectPlain(await get('/api/data/crews?search[a]=b'), { status: 400 });
    const [p] = seedPeople(1);
    seedCrews(p.id, 2);
    for (const term of ["x' OR 1=1 --", '%', '_', '\\', '"']) {
      const res = await get('/api/data/crews').query({ search: term });
      expect(res.status).toBe(200);
      expect(res.body.data.rows).toEqual([]);
    }
  });
});

describe('A2.7: stats groupBy', () => {
  const stats = (q) => get('/api/data/crews/stats').query(q);
  it.each([
    [{ groupBy: 'sqlite_master' }, 'groupBy'],
    [{ groupBy: '__proto__' }, 'groupBy'],
    [{ groupBy: 'constructor' }, 'groupBy'],
    [{ groupBy: 'id' }, 'groupBy'],
    [{ groupBy: 'name' }, 'groupBy'],
    [{ groupBy: 'size' }, 'groupBy'],
    [{ groupBy: 'nofield' }, 'groupBy'],
    [{ groupBy: '' }, 'groupBy'],
    [{ groupBy: 'status";--' }, 'groupBy'],
    [{ groupBy: 'status', measure: 'sum', field: '__proto__' }, 'field'],
    [{ groupBy: 'status', measure: 'sum', field: 'name' }, 'field'],
    [{ groupBy: 'status', measure: 'avg' }, 'field'],
    [{ groupBy: 'status', measure: 'max' }, 'measure'],
    [{ groupBy: 'status', measure: 'sum; DROP', field: 'size' }, 'measure'],
    [{ groupBy: 'status', field: '__proto__' }, 'field'],
    [{ groupBy: 'status', bucket: 'year' }, 'bucket'],
    [{ groupBy: 'started', bucket: 'year' }, 'bucket'],
    [{ groupBy: 'started', bucket: 'day"' }, 'bucket'],
  ])('%j is 400 on %s', async (q, field) => {
    const res = await stats(q);
    expectPlain(res, { status: 400 });
    expect(res.body).toMatchObject({ code: 'invalid_query', field });
  });

  it('stats with a bad filter, or a field the table lacks, is 400 not 500', async () => {
    expectPlain(await stats({ filter: '[{"field":"x","op":"eq","value":1}]' }), { status: 400 });
    expectPlain(await get('/api/data/people/stats?groupBy=size'), { status: 400 });
  });
});

describe('A2.8: page and source', () => {
  it.each([
    ['page=__proto__&source=constructor'],
    ['page=home&source=__proto__'],
    ['page=__proto__&source=open_crews'],
    ['page=home'],
    ['source=open_crews'],
    ['page=home&source=nope'],
    ['page=nope&source=open_crews'],
    ['page[]=home&source=open_crews'],
    ['page=home&source[a]=1'],
    ['page=home&source=open_crews&source=open_crews'],
  ])('%s is 400', async (q) => {
    expectPlain(await get(`/api/data/crews?${q}`), { status: 400 });
  });

  it('a source of another table is refused, the right one works', async () => {
    expectPlain(await get('/api/data/people?page=home&source=open_crews'), { status: 400 });
    expect((await get('/api/data/crews?page=home&source=open_crews')).status).toBe(200);
  });
});

describe('A2.9: record bodies', () => {
  const crew = (body) => request(app).post('/api/data/crews').send(body);

  it('keys __proto__, constructor, id, created_at, a 300 char key and an unknown field are 400 invalid_record', async () => {
    const [p] = seedPeople(1);
    const head = `{"name":"A","lead_id":"${p.id}",`;
    for (const tail of [
      '"__proto__":{"polluted":true}}',
      '"constructor":{"prototype":{"polluted":true}}}',
      '"prototype":1}',
      '"id":"mine"}',
      '"created_at":"2020-01-01T00:00:00.000Z"}',
      '"updated_at":"2020-01-01T00:00:00.000Z"}',
      `"${'k'.repeat(300)}":1}`,
      '"name\\"; DROP":1}',
      '"sqlite_master":1}',
    ]) {
      const res = await postJson('/api/data/crews', head + tail);
      expectPlain(res, { status: 400 });
      expect(res.body.code).toBe('invalid_record');
    }
    // A huge unknown key is not sent back in the answer.
    const big = await postJson('/api/data/crews', `{"name":"A","lead_id":"${p.id}","${'k'.repeat(100000)}":1}`);
    expectPlain(big, { status: 400 });
    expect(big.body.field).toBe('body');
    expect(big.text.length).toBeLessThan(300);
    expect({}.polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
    expect((await get('/api/data/crews')).body.data.total).toBe(0);
    expect((await crew({ name: 'A', lead_id: p.id })).status).toBe(201);
  });

  it('PATCH with the same hostile keys is 400 and changes nothing', async () => {
    const [p] = seedPeople(1);
    const [c] = seedCrews(p.id, 1);
    for (const text of ['{"__proto__":{"x":1}}', '{"constructor":1}', '{"id":"other"}', '{"created_at":"2020-01-01T00:00:00.000Z"}', '{"nofield":1}']) {
      const res = await request(app).patch(`/api/data/crews/${c.id}`).set('Content-Type', 'application/json').send(text);
      expectPlain(res, { status: 400 });
      expect(res.body.code).toBe('invalid_record');
    }
    expect((await get(`/api/data/crews/${c.id}`)).body.data).toEqual(c);
  });

  it('a reference to a row of the wrong table or a missing row is 400 and never echoed', async () => {
    const [p] = seedPeople(1);
    const [c] = seedCrews(p.id, 1);
    const wrongTable = await crew({ name: 'A', lead_id: c.id });
    expectPlain(wrongTable, { status: 400 });
    expect(wrongTable.body).toMatchObject({ code: 'invalid_record', field: 'lead_id' });
    const res = await crew({ name: 'A', lead_id: "x'; DROP TABLE people;--" });
    expectPlain(res, { status: 400 });
    expect(res.text).not.toContain('DROP');
    expectPlain(await crew({ name: 'A', lead_id: 'x'.repeat(300) }), { status: 400 });
    expectPlain(await crew({ name: 'A', lead_id: { id: p.id } }), { status: 400 });
    expectPlain(await crew({ name: 'A', lead_id: [p.id] }), { status: 400 });
    expect((await get('/api/data/people')).body.data.total).toBe(1);
  });

  it('arrays, scalars and malformed JSON bodies are 400 with plain words', async () => {
    for (const text of ['[]', '[{"name":"A"}]', '"x"', '12', 'true', 'null', '{', '{"name":', '{name: 1}', "{'a':1}"]) {
      expectPlain(await postJson('/api/data/people', text), { status: 400 });
    }
    // The body parser answer carries plain words for the built-app client (server.js error handler).
    const malformed = await postJson('/api/data/people', '{');
    expect(malformed.body).toMatchObject({ code: 'invalid_body', message: 'That request could not be read. Check it and try again.' });
    const wrongType = await request(app).post('/api/data/people').set('Content-Type', 'text/plain').send('name=x');
    expect(wrongType.status).toBeLessThan(500);
    expect(wrongType.text).not.toMatch(LEAK);
  });

  it('hostile values in real fields are stored as text and never executed; bad typed values are 400', async () => {
    const [p] = seedPeople(1);
    const name = "x'); DROP TABLE crews;--";
    const res = await crew({ name, lead_id: p.id });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe(name);
    expect((await get('/api/data/crews')).body.data.total).toBe(1);
    expectPlain(await crew({ name: 'A', lead_id: p.id, size: '1; DROP TABLE crews' }), { status: 400 });
    expectPlain(await crew({ name: 'A', lead_id: p.id, status: "active' OR '1'='1" }), { status: 400 });
    expectPlain(await postJson('/api/data/crews', `{"name":"A","lead_id":"${p.id}","budget":1e999}`), { status: 400 });
    expectPlain(await crew({ name: 'A', lead_id: p.id, started: '2025-13-01' }), { status: 400 });
  });
});

describe('A2.10: record ids', () => {
  it.each(['x'.repeat(201), '../x', '%2e%2e', '%00', "x' OR '1'='1", '"', ';', '漢', '..%2f..%2fapp.db', '__proto__', 'constructor'])(
    'id %j is refused on GET, PATCH and DELETE',
    async (id) => {
      const [p] = seedPeople(1);
      seedCrews(p.id, 1);
      const e = encodeURIComponent(id);
      for (const res of [
        await get(`/api/data/crews/${e}`),
        await request(app).patch(`/api/data/crews/${e}`).send({ size: 2 }),
        await request(app).delete(`/api/data/crews/${e}`),
      ]) {
        expectPlain(res, { status: 404 });
        expect(res.body.code).toBe('not_found');
      }
      expect((await get('/api/data/crews')).body.data.total).toBe(1);
    },
  );

  it('a stray extra path segment never reaches a row', async () => {
    const [p] = seedPeople(1);
    const res = await get(`/api/data/people/${p.id}/extra`);
    expect(res.status).toBe(404);
    expect(res.text).not.toMatch(LEAK);
  });
});

describe('A2.11: kit tables are not reachable', () => {
  it.each(['app_state', 'studio_apps', 'app_secrets', 'audit_log', 'assistant_messages', 'app_schema_version'])('%s is 404 unknown_table', async (t) => {
    const res = await get(`/api/data/${t}`);
    expectPlain(res, { status: 404 });
    expect(res.body.code).toBe('unknown_table');
  });
});

describe('logging', () => {
  it('request text is never logged', async () => {
    await get('/api/data/crews?sort=x";DROP&limit=-1');
    await get('/api/data/crews?filter=%7B');
    expect(spy.mock.calls.flat().join(' ')).not.toMatch(/DROP/);
  });
});

describe('A5.3: 10000 rows through the data routes', () => {
  it('pages are capped at 200, offset paging reaches the end, stats and groups answer fast', async () => {
    const [p] = seedPeople(1);
    withTransaction(() => {
      insertMany(
        'crews',
        Array.from({ length: 10000 }, (_, i) => ({ name: `Crew ${String(i).padStart(5, '0')}`, lead_id: p.id, size: (i % 7) + 1, status: i % 2 ? 'paused' : 'active' })),
      );
    });
    const first = await get('/api/data/crews?limit=200&sort=name');
    expect(first.body.data).toMatchObject({ total: 10000, limit: 200, offset: 0 });
    expect(first.body.data.rows).toHaveLength(200);
    expectPlain(await get('/api/data/crews?limit=201'), { status: 400 });
    expect((await get('/api/data/crews')).body.data.rows).toHaveLength(50);
    const last = await get('/api/data/crews?limit=200&offset=9900&sort=name');
    expect(last.body.data.rows).toHaveLength(100);
    expect(last.body.data.rows.at(-1).name).toBe('Crew 09999');
    expect((await get('/api/data/crews?limit=200&offset=10000')).body.data.rows).toEqual([]);
    const t0 = Date.now();
    const stats = await get('/api/data/crews/stats');
    const groups = await get('/api/data/crews/stats?groupBy=status');
    const sum = await get('/api/data/crews/stats?groupBy=status&measure=sum&field=size');
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(stats.body.data.count).toBe(10000);
    expect(groups.body.data.groups.map((g) => g.count)).toEqual([5000, 5000]);
    expect(groups.body.data.other).toBeNull();
    expect(sum.body.data.groups).toHaveLength(2);
  });
});
