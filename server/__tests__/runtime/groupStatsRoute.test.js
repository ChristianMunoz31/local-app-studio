// GET /api/data/:table/stats with groupBy: allowlisted group-by over the compiled spec's fields, 12 groups plus Other,
// the latest 12 buckets for dates, and the injection set. Without groupBy the response is the one it always was.
// The spec is the Crew Roster fixture plus a real, a date, a yes/no and a text field (a temp copy).
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
import { MAX_CHART_GROUPS } from '../../../src/catalog/enums.ts';
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

describe('the constants', () => {
  it('keeps the server group limit equal to the catalog chart limit', () => {
    expect(MAX_GROUPS).toBe(MAX_CHART_GROUPS);
    expect(MAX_GROUPS).toBe(12);
  });
});

describe('stats without groupBy', () => {
  it('is the response it always was, and ignores the group parameters', async () => {
    await seedCrews(CREWS);
    const expected = {
      data: {
        table: 'crews',
        count: 3,
        fields: {
          size: { count: 3, sum: 12, avg: 4, min: 2, max: 6 },
          budget: { count: 2, sum: 15.5, avg: 7.75, min: 5.5, max: 10 },
        },
      },
    };
    // Number fields of the table that were not given still count their column default (size 1, budget 0).
    const res = await stats({});
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual(['count', 'fields', 'table']);
    expect(res.body.data.groups).toBeUndefined();
    expect(res.body.data.count).toBe(expected.data.count);
    expect(res.body.data.fields.size).toEqual(expected.data.fields.size);
    expect(await stats({ measure: 'max', bucket: 'year' }).then((r) => r.body)).toEqual(res.body);
  });
});

describe('stats with groupBy', () => {
  it('counts each select value, biggest first', async () => {
    await seedCrews(CREWS);
    const res = await stats({ groupBy: 'status' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: {
        table: 'crews',
        count: 3,
        groups: [
          { key: 'active', count: 2, value: 2 },
          { key: 'paused', count: 1, value: 1 },
        ],
        other: null,
      },
    });
  });

  it('sums and averages a number field', async () => {
    await seedCrews(CREWS);
    const sum = await stats({ groupBy: 'status', measure: 'sum', field: 'size' });
    expect(sum.body.data.groups).toEqual([
      { key: 'active', count: 2, value: 10 },
      { key: 'paused', count: 1, value: 2 },
    ]);
    const avg = await stats({ groupBy: 'status', measure: 'avg', field: 'size' });
    expect(avg.body.data.groups.map((g) => g.value)).toEqual([5, 2]);
  });

  it('decodes yes/no keys to true and false', async () => {
    await seedCrews(CREWS);
    const res = await stats({ groupBy: 'active' });
    expect(res.body.data.groups).toEqual([
      { key: true, count: 2, value: 2 },
      { key: false, count: 1, value: 1 },
    ]);
  });

  it('buckets dates by month (default) or day, oldest first', async () => {
    await seedCrews(CREWS);
    const month = await stats({ groupBy: 'started' });
    expect(month.body.data.groups.map((g) => [g.key, g.count])).toEqual([['2026-01', 2], ['2026-03', 1]]);
    const day = await stats({ groupBy: 'started', bucket: 'day' });
    expect(day.body.data.groups.map((g) => g.key)).toEqual(['2026-01-05', '2026-01-20', '2026-03-01']);
  });

  it('buckets a runtime datetime column and groups a reference by its id', async () => {
    await seedCrews(CREWS);
    const created = await stats({ groupBy: 'created_at' });
    expect(created.body.data.groups).toHaveLength(1);
    expect(created.body.data.groups[0].key).toMatch(/^\d{4}-\d{2}$/);
    const lead = await stats({ groupBy: 'lead_id' });
    expect(lead.body.data.groups[0].count).toBe(3);
  });

  it('gives a null average for a group with no numbers, and none for a null key', async () => {
    await seedCrews([{ name: 'A', status: 'active' }, { name: 'B', status: 'paused', size: 3 }]);
    await post('crews', { name: 'C', lead_id: lead.id, notes: 'x' });
    const res = await stats({ groupBy: 'started', measure: 'avg', field: 'budget' });
    expect(res.body.data.groups).toEqual([{ key: null, count: 3, value: null }]);
    const none = await stats({ groupBy: 'status', measure: 'avg', field: 'budget' });
    expect(none.body.data.groups.every((g) => g.value === null)).toBe(true);
    const sum = await stats({ groupBy: 'status', measure: 'sum', field: 'budget' });
    expect(sum.body.data.groups.every((g) => g.value === 0)).toBe(true);
  });

  it('shows the 12 biggest groups and folds the rest into other', async () => {
    const people = [];
    for (let i = 0; i < 14; i += 1) people.push((await post('people', { name: `P${i}` })).body.data.id);
    for (let i = 0; i < 14; i += 1) {
      for (let k = 0; k <= (i === 13 ? 2 : i === 12 ? 1 : 0); k += 1) {
        expect((await post('crews', { name: `C${i}-${k}`, lead_id: people[i], size: 2 })).status).toBe(201);
      }
    }
    const res = await stats({ groupBy: 'lead_id', measure: 'sum', field: 'size' });
    expect(res.body.data.count).toBe(17);
    expect(res.body.data.groups).toHaveLength(12);
    expect(res.body.data.groups[0]).toEqual({ key: people[13], count: 3, value: 6 });
    expect(res.body.data.groups[1]).toEqual({ key: people[12], count: 2, value: 4 });
    expect(res.body.data.other).toEqual({ groups: 2, count: 2, value: 4 });
  });

  it('takes the latest 12 date buckets in ascending order', async () => {
    const rows = Array.from({ length: 14 }, (_, i) => ({ name: `D${i}`, started: `2025-${String((i % 12) + 1).padStart(2, '0')}-10`.replace(/^2025/, i < 12 ? '2025' : '2026') }));
    await seedCrews(rows);
    const res = await stats({ groupBy: 'started', bucket: 'month' });
    const keys = res.body.data.groups.map((g) => g.key);
    expect(keys).toHaveLength(12);
    expect(keys).toEqual([...keys].sort());
    expect(keys.at(-1)).toBe('2026-02');
    expect(keys[0]).toBe('2025-03');
    expect(res.body.data.other).toEqual({ groups: 2, count: 2, value: 2 });
  });

  it('keeps undated records as their own last bucket when there are more than 12 months', async () => {
    const dated = Array.from({ length: 13 }, (_, i) => ({ name: `M${i}`, started: new Date(Date.UTC(2025, i, 10)).toISOString().slice(0, 10) }));
    await seedCrews([...dated, { name: 'U1' }, { name: 'U2' }]);
    const res = await stats({ groupBy: 'started', bucket: 'month' });
    const { groups, other, count } = res.body.data;
    expect(count).toBe(15);
    expect(groups).toHaveLength(13);
    expect(groups.at(-1)).toEqual({ key: null, count: 2, value: 2 });
    expect(groups[0].key).toBe('2025-02');
    expect(other).toEqual({ groups: 1, count: 1, value: 1 });
  });

  it('applies the page source and run-time filters first', async () => {
    await seedCrews(CREWS);
    const res = await stats({ page: 'home', source: 'open_crews', groupBy: 'status' });
    expect(res.body.data).toMatchObject({ count: 2, groups: [{ key: 'active', count: 2 }], other: null });
    const filter = JSON.stringify([{ field: 'size', op: 'gte', value: 5 }]);
    const filtered = await stats({ groupBy: 'status', filter });
    expect(filtered.body.data).toMatchObject({ count: 1, groups: [{ key: 'active', count: 1 }] });
    const searched = await stats({ groupBy: 'status', search: 'C' });
    expect(searched.body.data.count).toBe(1);
  });

  it('gives an empty table no groups and no other', async () => {
    const res = await stats({ groupBy: 'status' });
    expect(res.body).toEqual({ data: { table: 'crews', count: 0, groups: [], other: null } });
  });
});

describe('group-by input is never SQL', () => {
  const BAD = [
    ['name;drop', { groupBy: 'name;drop' }],
    ['a quote', { groupBy: 'status"' }],
    ['__proto__', { groupBy: '__proto__' }],
    ['constructor', { groupBy: 'constructor' }],
    ['id', { groupBy: 'id' }],
    ['a field of another table', { groupBy: 'nickname' }],
    ['a text field', { groupBy: 'name' }],
    ['a number field', { groupBy: 'size' }],
    ['an empty name', { groupBy: '' }],
    ['an object groupBy', 'groupBy[a]=b'],
    ['a repeated groupBy', 'groupBy=status&groupBy=name'],
    ['bucket year', { groupBy: 'started', bucket: 'year' }],
    ['bucket on a select', { groupBy: 'status', bucket: 'month' }],
    ['bucket as an object', 'groupBy=started&bucket[a]=b'],
    ['measure max', { groupBy: 'status', measure: 'max' }],
    ['measure as an object', 'groupBy=status&measure[a]=b'],
    ['sum without a field', { groupBy: 'status', measure: 'sum' }],
    ['avg of a text field', { groupBy: 'status', measure: 'avg', field: 'name' }],
    ['sum of an unknown field', { groupBy: 'status', measure: 'sum', field: 'nope' }],
    ['sum of __proto__', { groupBy: 'status', measure: 'sum', field: '__proto__' }],
    ['sum of id', { groupBy: 'status', measure: 'sum', field: 'id' }],
    ['a count field that does not exist', { groupBy: 'status', field: 'nope' }],
  ];
  it.each(BAD)('%s answers 400 invalid_query', async (_name, query) => {
    await seedCrews(CREWS);
    const res = typeof query === 'string' ? await request(app).get(`/api/data/crews/stats?${query}`) : await stats(query);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_query');
    expect(typeof res.body.field).toBe('string');
  });

  it('answers 404 for an unknown table and keeps the data intact after the attacks', async () => {
    await seedCrews(CREWS);
    await stats({ groupBy: 'status;DROP TABLE crews' });
    expect((await request(app).get('/api/data/nope/stats?groupBy=status')).status).toBe(404);
    expect((await stats({ groupBy: 'status' })).body.data.count).toBe(3);
  });
});

describe('a yes or no left empty reads as No (phase 17, C-maker-1)', () => {
  const where = (op, value) => JSON.stringify([{ field: 'active', op, value }]);
  const names = async (op, value) => {
    const res = await request(app).get('/api/data/crews').query({ filter: where(op, value) });
    expect(res.status).toBe(200);
    return res.body.data.rows.map((r) => r.name).sort();
  };
  const SEED = [
    { name: 'Yes', status: 'active', size: 1, active: true },
    { name: 'No', status: 'active', size: 1, active: false },
    { name: 'Empty', status: 'active', size: 1 },
  ];

  it('lists a row with the yes or no missing under eq false and ne true, and leaves eq true alone', async () => {
    await seedCrews(SEED);
    expect(await names('eq', false)).toEqual(['Empty', 'No']);
    expect(await names('ne', true)).toEqual(['Empty', 'No']);
    expect(await names('eq', true)).toEqual(['Yes']);
    expect(await names('ne', false)).toEqual(['Yes']);
  });

  it('counts the row in the stats query under the same filter', async () => {
    await seedCrews(SEED);
    const res = await stats({ groupBy: 'status', filter: where('eq', false) });
    expect(res.status).toBe(200);
    expect(res.body.data.groups).toEqual([expect.objectContaining({ key: 'active', count: 2 })]);
    expect((await stats({ filter: where('eq', false) })).body.data.count).toBe(2);
  });
});
