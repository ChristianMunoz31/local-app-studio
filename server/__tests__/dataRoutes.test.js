// Data routes against a real (in-memory) SQLite database: the export route body limit and app state.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { PROTECTED_APP_STATE_KEYS } from '../import/importExport.js';
import { closeTestDb, createTestDb, resetDb, rowsOf } from './helpers/testDb.js';

vi.mock('../../loadEnv.js', () => ({}));

let app;
let db;
// The shell may export SECRETS_ENCRYPTION_KEY; keep these tests independent of it.
const savedEncKey = process.env.SECRETS_ENCRYPTION_KEY;

beforeAll(async () => {
  delete process.env.SECRETS_ENCRYPTION_KEY;
  delete process.env.APP_PASSWORD;
  delete process.env.AUTH_SECRET;
  db = createTestDb();
  app = (await import('../../server.js')).default;
});
afterAll(() => {
  closeTestDb(db);
  if (savedEncKey === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
  else process.env.SECRETS_ENCRYPTION_KEY = savedEncKey;
});
beforeEach(() => resetDb(db));

describe('path variants', () => {
  // The export route enforces its own 10kb JSON limit; the global 2mb parser must not pre-empt it.
  it.each(['/api/export', '/api/export/', '/API/export'])('applies the export route body limit for %s', async (path) => {
    const res = await request(app).post(path).send({ pad: 'x'.repeat(50 * 1024) });
    expect(res.status).toBe(413);
  });
});

describe('app state', () => {
  it('upserts and reads back JSON values of any type', async () => {
    const put = await request(app).put('/api/state/theme').send({ value: 'dark' });
    expect(put.body).toEqual({ key: 'theme', value: 'dark' });
    await request(app).put('/api/state/theme').send({ value: { mode: 'light', n: [1, 2] } });
    await request(app).put('/api/state/flag').send({ value: false });
    const all = await request(app).get('/api/state');
    expect(all.body).toEqual({ theme: { mode: 'light', n: [1, 2] }, flag: false });
    expect(rowsOf(db, 'app_state').filter((r) => r.key === 'theme')).toHaveLength(1);
  });

  it.each([...PROTECTED_APP_STATE_KEYS])('403s writes to the protected key %s', async (key) => {
    const res = await request(app).put(`/api/state/${key}`).send({ value: { example: true } });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'protected_key' });
    expect(rowsOf(db, 'app_state').filter((r) => r.key === key)).toHaveLength(0);
  });

  it('400s a missing or null value', async () => {
    expect((await request(app).put('/api/state/k').send({})).status).toBe(400);
    const nul = await request(app).put('/api/state/k').send({ value: null });
    expect(nul.status).toBe(400);
    expect(nul.body).toMatchObject({ code: 'invalid_request' });
  });
});
