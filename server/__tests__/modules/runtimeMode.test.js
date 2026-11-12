// The real app in runtime mode (unbundled, APP_MODE=runtime): the Studio module is not registered, /api/data is no-store and
// has its own rate budget, and the kit still works.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeTestDb, createTestDb } from '../helpers/testDb.js';

vi.mock('../../../loadEnv.js', () => ({}));

let app;
let db;
const saved = process.env.APP_MODE;

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  delete process.env.AUTH_SECRET;
  process.env.APP_MODE = 'runtime';
  vi.resetModules();
  db = createTestDb();
  app = (await import('../../../server.js')).default;
});
afterAll(() => {
  closeTestDb(db);
  if (saved === undefined) delete process.env.APP_MODE;
  else process.env.APP_MODE = saved;
  vi.resetModules();
});

describe('server.js with APP_MODE=runtime', () => {
  it('has no Studio routes: the Studio apps and preview routes answer the unmatched-API 404', async () => {
    const get = await request(app).get('/api/studio/apps');
    expect(get.status).toBe(404);
    expect(get.body).toMatchObject({ code: 'not_found' });
    const preview = await request(app).get('/api/preview/data/x');
    expect(preview.status).toBe(404);
    expect(preview.body).toMatchObject({ code: 'not_found' });
  });

  it('answers /api/data with no-store and its own 3000 per 15 minutes budget, not the global 300', async () => {
    const res = await request(app).get('/api/data/crews');
    expect(res.status).toBe(404);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['ratelimit-policy']).toMatch(/^3000;w=900/);
    const other = await request(app).get('/api/nothing-here');
    expect(other.headers['ratelimit-policy']).toMatch(/^300;w=900/);
  });

  it('keeps the kit working', async () => {
    expect((await request(app).get('/api/state')).status).toBe(200);
  });
});
