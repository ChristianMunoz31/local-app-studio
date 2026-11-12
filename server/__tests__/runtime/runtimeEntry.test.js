// A runtime-mode server loads the Crew Roster fixture (read only) through the unbundled test seam (APP_MODE and
// APP_SPEC_PATH), builds its schema from the in-memory 001 migration and serves its tables through the generic data API.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.APP_MODE = 'runtime';
  process.env.APP_SPEC_PATH = `${process.cwd()}/packages/runtime/src/spec/fixtures/crew-roster.json`;
});

import request from 'supertest';

vi.mock('../../../loadEnv.js', () => ({}));

import { closeTestDb, createTestDb } from '../helpers/testDb.js';
import { getAppSpec, getCompiledSpec } from '../../spec/source.js';
import { TABLES } from '../../db/index.js';

let app;
let db;

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  delete process.env.AUTH_SECRET;
  db = createTestDb();
  app = (await import('../../../server.js')).default;
});
afterAll(() => {
  closeTestDb(db);
  delete process.env.APP_MODE;
  delete process.env.APP_SPEC_PATH;
});

describe('runtime entry with the Crew Roster fixture', () => {
  it('loads the fixture as the app spec and compiles it', () => {
    expect(getAppSpec().app.name).toBe('Crew Roster');
    expect(Object.keys(getCompiledSpec().tables)).toEqual(['people', 'crews']);
    expect(Object.keys(TABLES)).toEqual(expect.arrayContaining(['app_state', 'people', 'crews']));
  });

  it('records the app schema at version 1', () => {
    expect(db.prepare('SELECT version, name FROM app_schema_version ORDER BY version').all().map((r) => ({ ...r }))).toEqual([{ version: 1, name: 'app' }]);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('people', 'crews')").all().map((r) => r.name).sort();
    expect(tables).toEqual(['crews', 'people']);
  });

  it('GET /api/data lists the spec tables in import order', async () => {
    const res = await request(app).get('/api/data');
    expect(res.status).toBe(200);
    expect(res.body.data.app.name).toBe('Crew Roster');
    expect(res.body.data.tables.map((t) => t.id)).toEqual(['people', 'crews']);
  });

  it('creates and lists crews through the generic API', async () => {
    const created = await request(app).post('/api/data/crews').send({ name: 'Alpha', size: 4 });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ name: 'Alpha', size: 4, status: 'active', lead_id: null });
    const list = await request(app).get('/api/data/crews');
    expect(list.body.data.rows.map((r) => r.name)).toEqual(['Alpha']);
    expect(list.body.data.total).toBe(1);
    const viaSource = await request(app).get('/api/data/crews').query({ page: 'home', source: 'open_crews' });
    expect(viaSource.body.data.total).toBe(1);
  });

  it('keeps kit tables out of the data API, the Studio routes out of the server, and the kit working', async () => {
    expect((await request(app).get('/api/data/items')).body.code).toBe('unknown_table');
    expect((await request(app).get('/api/data/app_state')).status).toBe(404);
    expect((await request(app).get('/api/studio/spike-layout')).body).toMatchObject({ code: 'not_found' });
    expect((await request(app).get('/api/state')).status).toBe(200);
  });
});
