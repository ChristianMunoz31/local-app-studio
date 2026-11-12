// The generic data API of a built app (runtime mode, unbundled, spec from APP_SPEC_PATH): CRUD, validation, the table
// allowlist (kit tables are unreachable), list queries, 409 for restricted references, and the envelopes.
// The spec is the Crew Roster fixture with a required lead and three extra crew fields (a temp copy; the fixture is read only).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const spec = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'packages', 'runtime', 'src', 'spec', 'fixtures', 'crew-roster.json'), 'utf8'));
  const crews = spec.tables.find((t) => t.id === 'crews');
  for (const f of crews.fields) if (f.id === 'lead_id') f.required = true;
  crews.fields.push(
    { id: 'budget', label: 'Budget', type: 'real' },
    { id: 'started', label: 'Started', type: 'date' },
    { id: 'active', label: 'Active', type: 'boolean' },
    { id: 'notes', label: 'Notes', type: 'longtext' },
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'las-spec-'));
  const file = path.join(dir, 'app-spec.json');
  fs.writeFileSync(file, JSON.stringify(spec));
  process.env.APP_MODE = 'runtime';
  process.env.APP_SPEC_PATH = file;
  process.env.__TEST_SPEC_DIR = dir;
});

import fs from 'node:fs';
import request from 'supertest';
import { closeTestDb, createTestDb, resetDb } from '../helpers/testDb.js';

vi.mock('../../../loadEnv.js', () => ({}));

const forced = vi.hoisted(() => ({ code: null }));
vi.mock('../../db/index.js', async (importOriginal) => {
  const real = await importOriginal();
  const { DbError } = await import('../../db/errors.js');
  return {
    ...real,
    select: (...args) => {
      if (forced.code) throw new DbError(forced.code, 'forced');
      return real.select(...args);
    },
  };
});

let app;
let db;
const savedPw = { APP_PASSWORD: process.env.APP_PASSWORD, AUTH_SECRET: process.env.AUTH_SECRET };

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
beforeEach(() => resetDb(db));

const post = (table, body) => request(app).post(`/api/data/${table}`).send(body);
const makePerson = async (name = 'Ana') => (await post('people', { name })).body.data;
const makeCrew = async (extra = {}) => {
  const lead = extra.lead_id ?? (await makePerson()).id;
  return (await post('crews', { name: 'Alpha', lead_id: lead, ...extra })).body.data;
};

describe('GET /api/data', () => {
  it('lists the app, the data file and every spec table with its row count', async () => {
    await makePerson();
    const res = await request(app).get('/api/data');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data.app).toEqual({ name: 'Crew Roster', version: '1.0.0' });
    expect(res.body.data.dbFile).toMatch(/app\.db$/);
    expect(res.body.data.tables).toEqual([
      { id: 'people', label: 'People', rowCount: 1 },
      { id: 'crews', label: 'Crews', rowCount: 0 },
    ]);
  });
});

describe('the table allowlist', () => {
  it.each(['items', 'app_state', 'app_secrets', 'audit_log', 'assistant_messages', 'assistant_conversations', 'app_schema_version', '__proto__', 'constructor', 'toString', 'nope'])(
    '%s is not a table of the app',
    async (table) => {
      for (const res of [
        await request(app).get(`/api/data/${table}`),
        await request(app).get(`/api/data/${table}/stats`),
        await request(app).get(`/api/data/${table}/abc`),
        await post(table, { name: 'x' }),
        await request(app).patch(`/api/data/${table}/abc`).send({ name: 'x' }),
        await request(app).delete(`/api/data/${table}/abc`),
      ]) {
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('unknown_table');
      }
    },
  );
});

describe('create', () => {
  it('returns 201 with the decoded row, ids and timestamps filled and SQL defaults applied', async () => {
    const lead = await makePerson();
    const res = await post('crews', { name: 'Alpha', lead_id: lead.id, active: 'true', budget: '12.5', started: '2025-03-01' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: 'Alpha', size: 1, status: 'active', lead_id: lead.id, active: true, budget: 12.5, started: '2025-03-01' });
    expect(res.body.data.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.data.created_at).toBe(res.body.data.updated_at);
  });

  it.each([
    [{ lead_id: 'x' }, 'name', 'Name is required.'],
    [{ name: '   ', lead_id: 'x' }, 'name', 'Name is required.'],
    [{ name: 'A' }, 'lead_id', 'Lead is required.'],
    [{ name: 'A', lead_id: 'x', size: 1.5 }, 'size', 'Size must be a whole number.'],
    [{ name: 'A', lead_id: 'x', status: 'gone' }, 'status', 'Status must be one of: active, paused.'],
    [{ name: 'A', lead_id: 'x', started: '2025-02-30' }, 'started', 'Started must be a date like 2025-01-31.'],
    [{ name: 'A', lead_id: 'x', active: 'yes' }, 'active', 'Active must be true or false.'],
    [{ name: 'A'.repeat(501), lead_id: 'x' }, 'name', 'Name must be 500 characters or fewer.'],
    [{ name: 'A', lead_id: 'x', bogus: 1 }, 'bogus', 'This table has no such field.'],
    [{ name: 'A', lead_id: 'x', id: 'mine' }, 'id', 'That value is set automatically.'],
    [{ name: 'A', lead_id: 'x', created_at: '2020-01-01T00:00:00.000Z' }, 'created_at', 'That value is set automatically.'],
  ])('refuses %j with invalid_record on %s', async (body, field, message) => {
    const res = await post('crews', body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'invalid_record', message, field });
  });

  it('refuses a reference to a record that does not exist and never echoes the value', async () => {
    const res = await post('crews', { name: 'A', lead_id: 'no-such-person' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'invalid_record', message: 'There is no People record with that id.', field: 'lead_id' });
    expect(JSON.stringify(res.body)).not.toContain('no-such-person');
  });

  it('refuses a body that is not an object', async () => {
    const res = await request(app).post('/api/data/people').send([1]);
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('body');
  });
});

describe('read, patch and delete one record', () => {
  it('GET :id returns the row and 404 not_found otherwise', async () => {
    const crew = await makeCrew();
    const ok = await request(app).get(`/api/data/crews/${crew.id}`);
    expect(ok.body).toEqual({ data: crew });
    const miss = await request(app).get('/api/data/crews/missing');
    expect(miss.status).toBe(404);
    expect(miss.body.code).toBe('not_found');
  });

  it('PATCH changes only the sent fields and sets updated_at', async () => {
    const crew = await makeCrew({ size: 4 });
    await new Promise((r) => setTimeout(r, 5));
    const res = await request(app).patch(`/api/data/crews/${crew.id}`).send({ status: 'paused' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: crew.id, name: 'Alpha', size: 4, status: 'paused', created_at: crew.created_at });
    expect(res.body.data.updated_at > crew.updated_at).toBe(true);
  });

  it('PATCH refuses a required field set to null, an unknown id and an invalid value', async () => {
    const crew = await makeCrew();
    const nulled = await request(app).patch(`/api/data/crews/${crew.id}`).send({ name: null });
    expect(nulled.status).toBe(400);
    expect(nulled.body).toMatchObject({ code: 'invalid_record', field: 'name', message: 'Name is required.' });
    expect((await request(app).patch('/api/data/crews/missing').send({ size: 2 })).status).toBe(404);
    expect((await request(app).patch(`/api/data/crews/${crew.id}`).send({ size: 'many' })).status).toBe(400);
    // An optional field can be cleared.
    const cleared = await request(app).patch(`/api/data/crews/${crew.id}`).send({ budget: null });
    expect(cleared.body.data.budget).toBeNull();
  });

  it('DELETE removes the row; a second delete is 404', async () => {
    const crew = await makeCrew();
    const res = await request(app).delete(`/api/data/crews/${crew.id}`);
    expect(res.body).toEqual({ data: { id: crew.id, deleted: true } });
    expect((await request(app).delete(`/api/data/crews/${crew.id}`)).status).toBe(404);
  });

  it('DELETE of a record that a required reference points at is 409 record_in_use until the child is gone', async () => {
    const lead = await makePerson();
    const crew = await makeCrew({ lead_id: lead.id });
    const blocked = await request(app).delete(`/api/data/people/${lead.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({ code: 'record_in_use', table: 'crews' });
    expect((await request(app).get(`/api/data/people/${lead.id}`)).status).toBe(200);
    await request(app).delete(`/api/data/crews/${crew.id}`);
    expect((await request(app).delete(`/api/data/people/${lead.id}`)).status).toBe(200);
  });
});

describe('list', () => {
  const seed = async () => {
    const lead = await makePerson('Lead');
    for (const [name, size, status] of [['Bravo', 2, 'active'], ['alpha', 5, 'paused'], ['Charlie', 3, 'active'], ['Delta', 9, 'active']]) {
      await makeCrew({ name, size, status, lead_id: lead.id });
    }
  };

  it('defaults to newest first with limit 50 and offset 0, and returns the total', async () => {
    await seed();
    const res = await request(app).get('/api/data/crews');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ total: 4, limit: 50, offset: 0 });
    expect(res.body.data.rows.map((r) => r.name)).toEqual(['Delta', 'Charlie', 'alpha', 'Bravo']);
  });

  it('sorts (case-insensitively for text), pages, and reports the total of all matches', async () => {
    await seed();
    const sorted = await request(app).get('/api/data/crews').query({ sort: 'name:asc', limit: '2', offset: '1' });
    expect(sorted.body.data.rows.map((r) => r.name)).toEqual(['Bravo', 'Charlie']);
    expect(sorted.body.data).toMatchObject({ total: 4, limit: 2, offset: 1 });
    const desc = await request(app).get('/api/data/crews').query({ sort: 'size:desc,name:asc' });
    expect(desc.body.data.rows.map((r) => r.size)).toEqual([9, 5, 3, 2]);
  });

  it('filters with the run-time filter parameter', async () => {
    await seed();
    const filter = JSON.stringify([{ field: 'status', op: 'eq', value: 'active' }, { field: 'size', op: 'gte', value: 3 }]);
    const res = await request(app).get('/api/data/crews').query({ filter, sort: 'size:asc' });
    expect(res.body.data.rows.map((r) => r.name)).toEqual(['Charlie', 'Delta']);
    expect(res.body.data.total).toBe(2);
  });

  it('searches text fields (case-insensitive) and honors searchFields', async () => {
    await seed();
    const all = await request(app).get('/api/data/crews').query({ search: 'ALPH' });
    expect(all.body.data.rows.map((r) => r.name)).toEqual(['alpha']);
    const none = await request(app).get('/api/data/crews').query({ search: 'alph', searchFields: 'notes' });
    expect(none.body.data.total).toBe(0);
  });

  it('applies a page source (where, orderBy, limit) and narrows it with run-time filters', async () => {
    await seed();
    const res = await request(app).get('/api/data/crews').query({ page: 'home', source: 'open_crews' });
    expect(res.body.data.rows.map((r) => r.name)).toEqual(['Bravo', 'Charlie', 'Delta']);
    const narrowed = await request(app)
      .get('/api/data/crews')
      .query({ page: 'home', source: 'open_crews', filter: JSON.stringify([{ field: 'size', op: 'gt', value: 2 }]) });
    expect(narrowed.body.data.rows.map((r) => r.name)).toEqual(['Charlie', 'Delta']);
    // A run-time condition can never widen the source: paused crews stay out.
    const widened = await request(app)
      .get('/api/data/crews')
      .query({ page: 'home', source: 'open_crews', filter: JSON.stringify([{ field: 'status', op: 'eq', value: 'paused' }]) });
    expect(widened.body.data.total).toBe(0);
  });

  it.each([
    [{ limit: '0' }, 'limit'],
    [{ limit: '201' }, 'limit'],
    [{ limit: 'ten' }, 'limit'],
    [{ offset: '-1' }, 'offset'],
    [{ offset: '100001' }, 'offset'],
    [{ sort: 'nope:asc' }, 'sort'],
    [{ sort: 'name:sideways' }, 'sort'],
    [{ sort: 'a:asc,b:asc,c:asc,d:asc' }, 'sort'],
    [{ search: 'x'.repeat(201) }, 'search'],
    [{ search: 'x', searchFields: 'size' }, 'searchFields'],
    [{ filter: 'not json' }, 'filter'],
    [{ page: 'home' }, 'source'],
    [{ source: 'open_crews' }, 'page'],
    [{ page: 'home', source: 'missing' }, 'source'],
    [{ page: 'nope', source: 'open_crews' }, 'page'],
    [{ 'filter[a]': 'b' }, 'filter'],
  ])('answers 400 invalid_query for %j', async (query, field) => {
    const res = await request(app).get('/api/data/crews').query(query);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'invalid_query', field });
  });

  it('refuses a page source of another table', async () => {
    const res = await request(app).get('/api/data/people').query({ page: 'home', source: 'open_crews' });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('source');
  });
});

describe('stats', () => {
  it('computes counts and totals in code for the numeric fields and honors filters', async () => {
    const lead = await makePerson();
    await makeCrew({ name: 'A', size: 2, budget: 10, lead_id: lead.id });
    await makeCrew({ name: 'B', size: 4, budget: 2.5, lead_id: lead.id, status: 'paused' });
    await makeCrew({ name: 'C', lead_id: lead.id });
    const res = await request(app).get('/api/data/crews/stats');
    expect(res.status).toBe(200);
    expect(res.body.data.table).toBe('crews');
    expect(res.body.data.count).toBe(3);
    expect(res.body.data.fields.size).toEqual({ count: 3, sum: 7, avg: 7 / 3, min: 1, max: 4 });
    expect(res.body.data.fields.budget).toEqual({ count: 2, sum: 12.5, avg: 6.25, min: 2.5, max: 10 });
    expect(res.body.data.fields.name).toBeUndefined();
    const filtered = await request(app)
      .get('/api/data/crews/stats')
      .query({ filter: JSON.stringify([{ field: 'status', op: 'eq', value: 'active' }]), limit: '1', sort: 'bogus' });
    expect(filtered.body.data.count).toBe(2);
    expect(filtered.body.data.fields.size.sum).toBe(3);
  });

  it('an empty table gives sum 0 and null average, minimum and maximum', async () => {
    const res = await request(app).get('/api/data/crews/stats');
    expect(res.body.data.count).toBe(0);
    expect(res.body.data.fields.size).toEqual({ count: 0, sum: 0, avg: null, min: null, max: null });
  });

  it('is not captured as a record id', async () => {
    expect((await request(app).get('/api/data/people/stats')).body.data.table).toBe('people');
  });
});

describe('database errors by method', () => {
  it('answers invalid_query on a GET list and invalid_record on a write', async () => {
    forced.code = 'invalid_query';
    try {
      const get = await request(app).get('/api/data/people');
      expect(get.status).toBe(400);
      expect(get.body.code).toBe('invalid_query');
      const lead = await makePerson();
      const patch = await request(app).patch(`/api/data/people/${lead.id}`).send({ name: 'Zed' });
      expect(patch.body.error).not.toBe('invalid_query');
    } finally {
      forced.code = null;
    }
  });
});
