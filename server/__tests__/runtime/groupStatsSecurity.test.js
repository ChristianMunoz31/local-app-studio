// Group-by security cross-check: the cases groupStatsRoute.test.js does not pin (bracket array param, limit injection,
// SQL characters in search, tables outside the compiled spec). Same spec setup as that file (a temp copy of Crew Roster).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const spec = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'packages', 'runtime', 'src', 'spec', 'fixtures', 'crew-roster.json'), 'utf8'));
  const crews = spec.tables.find((t) => t.id === 'crews');
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
import { MAX_GROUPS } from '@local-app-studio/runtime/server/stats.js';

vi.mock('../../../loadEnv.js', () => ({}));

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
const stats = (query) => request(app).get('/api/data/crews/stats').query(query);
let lead;
async function seedCrews(rows) {
  lead = (await post('people', { name: 'Ana' })).body.data;
  for (const row of rows) {
    const res = await post('crews', { lead_id: lead.id, ...row });
    expect(res.status).toBe(201);
  }
}
const CREWS = [
  { name: 'A', status: 'active', size: 4, budget: 10, active: true, started: '2026-01-05' },
  { name: 'B', status: 'active', size: 6, active: true, started: '2026-01-20' },
  { name: 'C', status: 'paused', size: 2, budget: 5.5, active: false, started: '2026-03-01' },
];


const bad = (res, field) => {
  expect(res.status).toBe(400);
  expect(res.body.code).toBe('invalid_query');
  if (field) expect(res.body.field).toBe(field);
};

describe('group-by array and repeated params', () => {
  it.each(['groupBy[]=status', 'groupBy[0]=status', 'groupBy[]=status&groupBy[]=name', 'groupBy=status&groupBy[]=name'])('%s answers 400', async (q) => {
    await seedCrews(CREWS);
    bad(await request(app).get(`/api/data/crews/stats?${q}`));
  });

  it('refuses array forms of the other group params', async () => {
    await seedCrews(CREWS);
    for (const q of ['groupBy=status&measure[]=sum', 'groupBy=started&bucket[]=month', 'groupBy=status&measure=sum&field[]=size']) {
      bad(await request(app).get(`/api/data/crews/stats?${q}`));
    }
  });
});

describe('limit and sort injection on a grouped stats call', () => {
  const LIMITS = ['1; DROP TABLE crews', '-1', '0', '1 OR 1=1', '99999', 'NaN', "5' --", '1e10', '5)UNION SELECT 1', 'limit[]=3', '1,2'];

  it.each(LIMITS)('limit=%s never reaches SQL: 200 or 400 with the data intact', async (limit) => {
    await seedCrews(CREWS);
    const res = await stats({ groupBy: 'status', limit, offset: '1; DROP TABLE crews', sort: 'name;drop' });
    expect([200, 400]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.data.count).toBe(3);
      expect(res.body.data.groups.length).toBeLessThanOrEqual(MAX_GROUPS);
      expect(res.body.data.groups.map((g) => g.count)).toEqual([2, 1]);
    } else {
      expect(res.body.code).toBe('invalid_query');
    }
    expect((await stats({ groupBy: 'status' })).body.data.count).toBe(3);
  });

  it('cannot widen the group count past the cap with a huge limit', async () => {
    await seedCrews(Array.from({ length: 20 }, (_, i) => ({ name: `n${i}`, status: i % 2 ? 'active' : 'paused', size: i })));
    const res = await stats({ groupBy: 'size', limit: '1000' });
    if (res.status === 200) expect(res.body.data.groups.length).toBeLessThanOrEqual(MAX_GROUPS);
  });
});

describe('search with SQL characters on a grouped stats call', () => {
  const TERMS = ["'; DROP TABLE crews; --", '" OR 1=1 --', '%', '_', '\\', "a' OR 'a'='a", ')', 'x'.repeat(20)];

  it.each(TERMS)('search=%j is data, not SQL', async (search) => {
    await seedCrews(CREWS);
    const res = await stats({ groupBy: 'status', search });
    expect([200, 400]).toContain(res.status);
    if (res.status === 200) {
      // None of the crews contains these characters, so nothing matches; a wildcard must not match everything.
      expect(res.body.data.count).toBe(0);
      expect(res.body.data.groups).toEqual([]);
    }
    expect((await stats({ groupBy: 'status' })).body.data.count).toBe(3);
  });

  it('treats % and _ as literal characters', async () => {
    await seedCrews([{ name: '100% crew', status: 'active', size: 1 }, { name: 'plain', status: 'paused', size: 2 }, { name: 'a_b', status: 'paused', size: 3 }]);
    expect((await stats({ groupBy: 'status', search: '%' })).body.data.count).toBe(1);
    expect((await stats({ groupBy: 'status', search: '_' })).body.data.count).toBe(1);
  });

  it('refuses a search that is not text, and a searchFields list with a non-text or unknown field', async () => {
    await seedCrews(CREWS);
    bad(await request(app).get('/api/data/crews/stats?groupBy=status&search[a]=b'), 'search');
    bad(await stats({ groupBy: 'status', search: 'x', searchFields: 'size' }), 'searchFields');
    bad(await stats({ groupBy: 'status', search: 'x', searchFields: 'name;drop' }), 'searchFields');
  });
});

describe('tables outside the compiled spec', () => {
  it.each(['nope', 'sqlite_master', 'app_state', '__proto__', 'crews;drop', 'studio_features'])('stats for %s answers 404 and never runs', async (table) => {
    const res = await request(app).get(`/api/data/${encodeURIComponent(table)}/stats`).query({ groupBy: 'status' });
    expect(res.status).toBe(404);
    expect(res.body.data).toBeUndefined();
  });

  it('groupBy naming a column of another table is refused on both tables', async () => {
    await seedCrews(CREWS);
    bad(await stats({ groupBy: 'nickname' }), 'groupBy');
    const people = await request(app).get('/api/data/people/stats').query({ groupBy: 'status' });
    bad(people, 'groupBy');
  });

  it('measure=sum on a text or select field is refused, on a number field is allowed', async () => {
    await seedCrews(CREWS);
    bad(await stats({ groupBy: 'status', measure: 'sum', field: 'name' }), 'field');
    bad(await stats({ groupBy: 'status', measure: 'sum', field: 'status' }), 'field');
    expect((await stats({ groupBy: 'status', measure: 'sum', field: 'size' })).status).toBe(200);
  });

  it('bucket on a select or text field is refused', async () => {
    await seedCrews(CREWS);
    bad(await stats({ groupBy: 'status', bucket: 'day' }));
    bad(await stats({ groupBy: 'name', bucket: 'month' }));
  });
});
