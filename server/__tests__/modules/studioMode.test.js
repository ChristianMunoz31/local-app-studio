// The real app in studio mode: the Studio apps routes are no-store with their own budget; /api/data has no own budget.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeTestDb, createTestDb } from '../helpers/testDb.js';

vi.mock('../../../loadEnv.js', () => ({}));

let app;
let db;

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  delete process.env.AUTH_SECRET;
  db = createTestDb();
  app = (await import('../../../server.js')).default;
});
afterAll(() => closeTestDb(db));

describe('server.js in studio mode', () => {
  it('mounts the Studio module and keeps its paths no-store', async () => {
    const res = await request(app).get('/api/studio/apps');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [] });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['ratelimit-policy']).toMatch(/^1200;w=900/);
  });

  it('keeps /api/data under the global budget (no runtime module, no own limiter)', async () => {
    const res = await request(app).get('/api/data/crews');
    expect(res.status).toBe(404);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['ratelimit-policy']).toMatch(/^300;w=900/);
  });

  it('keeps unmatched /api/preview answering JSON 404, no-store', async () => {
    const res = await request(app).get('/api/preview/anything');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'not_found' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('answers the preview proxy 409 preview_not_running when no preview is running', async () => {
    const res = await request(app).get('/api/preview/data/crews');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('preview_not_running');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['ratelimit-policy']).toMatch(/^3000;w=900/);
  });
});
