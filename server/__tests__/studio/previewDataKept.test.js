// The real preview child: rows written through the proxy survive Stop then Start, an additive table change and its
// migration, and the status says so. One test, one real server process; the scratch folder is removed after.
import fs from 'node:fs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../../loadEnv.js', () => ({}));

import { importApp, saveSpec } from '../../studio/apps.js';
import { getPreviewManager } from '../../studio/preview/manager.js';
import { previewRoot } from '../../studio/preview/paths.js';
import { starterSpec } from '../../studio/specCheck.js';
import { closeTestDb, createTestDb } from '../helpers/testDb.js';

const IP = '192.0.2.11';
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
  fs.rmSync(previewRoot(), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  closeTestDb(db);
});

const start = (appId) => request(app).post('/api/studio/preview/start').set('X-Forwarded-For', IP).send({ appId });
const stop = () => request(app).post('/api/studio/preview/stop').set('X-Forwarded-For', IP);
const list = async () => (await request(app).get('/api/preview/data/crews').set('X-Forwarded-For', IP)).body;
const add = (name) => request(app).post('/api/preview/data/crews').set('X-Forwarded-For', IP).send({ name });

describe('preview data in a real child', () => {
  it('keeps two rows across Stop and Start and across an added field, and reports why', async () => {
    const spec = starterSpec('Crew Keep', 'crew-keep');
    spec.tables = [{ id: 'crews', label: 'Crews', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] }];
    const record = importApp(spec);

    const first = await start(record.id);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.data.data).toEqual({ kept: false, reason: 'first_start' });
    expect((await add('North')).status).toBe(201);
    expect((await add('South')).status).toBe(201);
    expect(JSON.stringify(await list())).toContain('South');

    await stop();
    const again = await start(record.id);
    expect(again.body.data.data).toEqual({ kept: true, reason: 'unchanged' });
    expect(JSON.stringify(await list())).toContain('North');

    const next = structuredClone(spec);
    next.tables[0].fields.push({ id: 'size', label: 'Size', type: 'integer', required: false });
    const saved = saveSpec(record.id, next, record.revision);
    await stop();
    const updated = await start(record.id);
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(updated.body.data).toMatchObject({ state: 'running', revision: saved.revision, data: { kept: true, reason: 'tables_updated' } });
    const body = JSON.stringify(await list());
    expect(body).toContain('North');
    expect(body).toContain('South');
    expect((await request(app).get('/api/studio/preview/status').set('X-Forwarded-For', IP)).body.data.data.reason).toBe('tables_updated');

    // A refused change (a field removed) clears the rows and says why.
    const removed = structuredClone(next);
    removed.tables[0].fields = removed.tables[0].fields.filter((f) => f.id !== 'size');
    saveSpec(record.id, removed, saved.revision);
    await stop();
    const cleared = await start(record.id);
    expect(cleared.body.data.data).toEqual({ kept: false, reason: 'tables_replaced' });
    expect(JSON.stringify(await list())).not.toContain('North');
    await stop();
  }, 90000);
});
