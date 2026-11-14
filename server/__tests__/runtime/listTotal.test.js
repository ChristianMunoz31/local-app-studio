// GET /api/data/:table with total=0 skips the row count: the body has no total key. No flag, or total=1, is unchanged.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const spec = fs.readFileSync(path.join(process.cwd(), 'packages', 'runtime', 'src', 'spec', 'fixtures', 'crew-roster.json'), 'utf8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'las-spec-'));
  const file = path.join(dir, 'app-spec.json');
  fs.writeFileSync(file, spec);
  process.env.APP_MODE = 'runtime';
  process.env.APP_SPEC_PATH = file;
  process.env.__TEST_SPEC_DIR = dir;
});

import fs from 'node:fs';
import request from 'supertest';
import { closeTestDb, createTestDb, resetDb } from '../helpers/testDb.js';

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
beforeEach(async () => {
  resetDb(db);
  for (const name of ['Ana', 'Ben', 'Cy']) await request(app).post('/api/data/people').send({ name });
});

describe('list total flag', () => {
  it('keeps the total when the flag is absent', async () => {
    const res = await request(app).get('/api/data/people?limit=2');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ total: 3, limit: 2, offset: 0 });
    expect(res.body.data.rows).toHaveLength(2);
  });

  it('keeps the total with total=1', async () => {
    const res = await request(app).get('/api/data/people?total=1');
    expect(res.body.data.total).toBe(3);
  });

  it('skips the count with total=0: rows, limit and offset stay, no total key', async () => {
    const res = await request(app).get('/api/data/people?total=0&limit=2&offset=1');
    expect(res.status).toBe(200);
    expect(res.body.data.rows).toHaveLength(2);
    expect(res.body.data).toMatchObject({ limit: 2, offset: 1 });
    expect(Object.hasOwn(res.body.data, 'total')).toBe(false);
  });

  it.each(['2', 'yes', '', '-1', '00'])('answers 400 invalid_query for total=%s', async (value) => {
    const res = await request(app).get(`/api/data/people?total=${value}`);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'invalid_query', field: 'total' });
    expect(typeof res.body.error).toBe('string');
    expect(res.body.requestId).toBeTruthy();
  });

  it('rejects a repeated flag', async () => {
    const res = await request(app).get('/api/data/people?total=0&total=1');
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('total');
  });
});
