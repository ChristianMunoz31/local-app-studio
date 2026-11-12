// The real preview child (server.js in runtime mode) started through the Studio routes, reached through the proxy.
// One test: it spawns a real server process. The scratch folder sits beside the test data folder and is removed after.
import fs from 'node:fs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../../loadEnv.js', () => ({}));

import { importApp } from '../../studio/apps.js';
import { getPreviewManager } from '../../studio/preview/manager.js';
import { previewRoot } from '../../studio/preview/paths.js';
import { starterSpec } from '../../studio/specCheck.js';
import { closeTestDb, createTestDb } from '../helpers/testDb.js';

let app;
let db;
beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  delete process.env.AUTH_SECRET;
  db = createTestDb();
  app = (await import('../../../server.js')).default;
});
afterAll(async () => {
  await getPreviewManager().stop();
  fs.rmSync(previewRoot(), { recursive: true, force: true });
  closeTestDb(db);
});

describe('real preview child', () => {
  it('starts, answers through the proxy with its own gate satisfied, and stops', async () => {
    const spec = starterSpec('Crew Roster', 'crew-roster');
    spec.tables = [{ id: 'crews', label: 'Crews', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] }];
    const record = importApp(spec);
    const started = await request(app).post('/api/studio/preview/start').set('X-Forwarded-For', '192.0.2.10').send({ appId: record.id });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    expect(started.body.data).toMatchObject({ state: 'running', appId: record.id });

    // Unknown table: the child's real data API answers, so its own gate was satisfied.
    const res = await request(app).get('/api/preview/data/anything').set('X-Forwarded-For', '192.0.2.10');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('unknown_table');
    expect(res.body.error).not.toBe('desktop_auth_required');
    // A table of the spec (its app-track migration ran in the child) answers 200 through the proxy.
    const rows = await request(app).get('/api/preview/data/crews').set('X-Forwarded-For', '192.0.2.10');
    expect(rows.status, JSON.stringify(rows.body)).toBe(200);

    const stopped = await request(app).post('/api/studio/preview/stop').set('X-Forwarded-For', '192.0.2.10');
    expect(stopped.body.data.state).toBe('stopped');
    const after = await request(app).get('/api/preview/data/anything').set('X-Forwarded-For', '192.0.2.10');
    expect(after.status).toBe(409);
    expect(after.body.code).toBe('preview_not_running');
  }, 60000);
});
