// Export with records and the way back in (phase 28, D1 re-import half): the kit export of an app with numbered records,
// the design added as app.json, then the same ZIP restored into an empty database through POST /api/import.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Set before any import (a module reads the app mode and spec when it loads), so it must run synchronously: no dynamic import here.
vi.hoisted(() => {
  const fs = process.getBuiltinModule('node:fs');
  const os = process.getBuiltinModule('node:os');
  const path = process.getBuiltinModule('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'las-p28-'));
  const file = path.join(dir, 'app-spec.json');
  const spec = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'server', '__tests__', 'helpers', 'automationSpec.json'), 'utf8'));
  fs.writeFileSync(file, JSON.stringify(spec));
  process.env.APP_MODE = 'runtime';
  process.env.APP_SPEC_PATH = file;
  process.env.__TEST_SPEC_DIR = dir;
});

import fs from 'node:fs';
import request from 'supertest';
import { strFromU8, unzipSync } from 'fflate';
import { select } from '../../db/index.js';
import { parseExportZip } from '../../import/importExport.js';
import { withDesignEntry } from '../../studio/apps.js';
import { getAppSpec } from '../../spec/source.js';
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
beforeEach(() => resetDb(db));

const binary = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
const rows = () => select('invoices', { orderBy: [{ column: 'rowid' }], db });

describe('export with records, then import', () => {
  it('brings back the same ids, rows and numbers, and the next record is numbered above the highest', async () => {
    const client = (await request(app).post('/api/data/clients').send({ name: 'Acme' })).body.data;
    for (const total of [10, 20, 30]) await request(app).post('/api/data/invoices').send({ client_id: client.id, total, status: 'Sent' });
    const before = rows();
    expect(before.map((r) => r.number)).toEqual(['INV-1001', 'INV-1002', 'INV-1003']);

    const exported = await request(app).post('/api/export').send({ tables: ['clients', 'invoices'] }).buffer(true).parse(binary);
    expect(exported.status).toBe(200);
    const zip = withDesignEntry(new Uint8Array(exported.body), getAppSpec());
    const names = Object.keys(unzipSync(zip)).sort();
    expect(names).toEqual(['app.json', 'csv/clients.csv', 'csv/invoices.csv', 'json/clients.json', 'json/invoices.json', 'manifest.json']);
    expect(JSON.parse(strFromU8(unzipSync(zip)['app.json']))).toEqual(getAppSpec());
    expect(parseExportZip(zip).tables.get('invoices')).toHaveLength(3);

    resetDb(db);
    expect(rows()).toEqual([]);
    const imported = await request(app).post('/api/import').set('Content-Type', 'application/zip').send(Buffer.from(zip));
    expect(imported.status).toBe(200);
    const byNumber = (list) => list.map((r) => [r.id, r.number, r.total]).sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    expect(byNumber(rows())).toEqual(byNumber(before));

    const next = await request(app).post('/api/data/invoices').send({});
    expect(next.body.data.number).toBe('INV-1004');
  });
});
