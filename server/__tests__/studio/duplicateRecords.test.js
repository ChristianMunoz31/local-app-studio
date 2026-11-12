// Duplicate with records (phase 28, section 5.2): copyPreviewData copies the Preview data folder of one app to another, and the
// duplicate route does it when asked. The copy's first start sees the same tables hash and keeps the data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../loadEnv.js', () => ({}));

import { importApp } from '../../studio/apps.js';
import { previewRoot, scratchDirFor } from '../../studio/preview/paths.js';
import { copyPreviewData, prepareScratch } from '../../studio/preview/scratch.js';
import { STAMP_FILE } from '../../studio/preview/seed.js';
import { compileSpec } from '../../spec/compile.js';
import { closeTestDb, createTestDb, resetDb } from '../helpers/testDb.js';

const FIXTURE = path.join(process.cwd(), 'packages', 'runtime', 'src', 'spec', '__tests__', 'fixtures', 'automations', 'rules-paid.json');
const spec = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
let app;
let db;
let root;
let n = 0;

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  delete process.env.AUTH_SECRET;
  db = createTestDb();
  app = (await import('../../../server.js')).default;
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'las-p28-dup-'));
});
afterAll(() => {
  closeTestDb(db);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(previewRoot(), { recursive: true, force: true });
});
beforeEach(() => resetDb(db));
afterEach(() => vi.restoreAllMocks());

const uuid = () => crypto.randomUUID();

/** A scratch folder with a Preview database holding two invoices and a counter row, as a stopped Preview leaves it. */
function withPreviewData(appSpec, id, base = root) {
  const dir = scratchDirFor(base, id);
  const prepared = prepareScratch(dir, appSpec, base);
  const file = path.join(prepared.dataDir, 'app.db');
  const data = new DatabaseSync(file);
  data.exec(compileSpec(appSpec).createSql);
  data.exec('CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)');
  data.exec(`INSERT INTO invoices (id, number, created_at, updated_at) VALUES ('i1', 'INV-1001', 'x', 'x'), ('i2', 'INV-1002', 'x', 'x')`);
  data.exec(`INSERT INTO app_state VALUES ('autonumber.invoices.number', '{"last":1002}', 'x')`);
  data.close();
  fs.writeFileSync(path.join(prepared.dataDir, STAMP_FILE), '{"v":1}');
  return { dir, file, prepared };
}

describe('copyPreviewData', () => {
  it('returns false when the source has no Preview data', () => {
    expect(copyPreviewData(uuid(), uuid(), root)).toBe(false);
  });

  it('copies the database with its counters, the migration chain, the state files and the sample stamp', () => {
    const source = uuid();
    const copy = uuid();
    withPreviewData(spec(), source);
    expect(copyPreviewData(source, copy, root)).toBe(true);
    const to = scratchDirFor(root, copy);
    const data = new DatabaseSync(path.join(to, 'data', 'app.db'), { readOnly: true });
    try {
      expect(data.prepare('SELECT number FROM invoices ORDER BY number').all().map((r) => r.number)).toEqual(['INV-1001', 'INV-1002']);
      expect(data.prepare("SELECT value FROM app_state WHERE key = 'autonumber.invoices.number'").get().value).toBe('{"last":1002}');
    } finally {
      data.close();
    }
    expect(fs.existsSync(path.join(to, 'data', 'app.db.partial'))).toBe(false);
    for (const name of ['preview-state.json', 'applied-spec.json', path.join('app-migrations', 'migrations.lock.json'), path.join('app-migrations', '001_app.sql'), path.join('data', STAMP_FILE)]) {
      expect(fs.existsSync(path.join(to, name)), name).toBe(true);
    }
  });

  it('leaves the source untouched and the copy starts with the data kept', () => {
    const source = uuid();
    const copy = uuid();
    const { file } = withPreviewData(spec(), source);
    copyPreviewData(source, copy, root);
    const original = new DatabaseSync(file, { readOnly: true });
    try {
      expect(original.prepare('SELECT COUNT(*) AS n FROM invoices').get().n).toBe(2);
    } finally {
      original.close();
    }
    expect(fs.existsSync(path.join(scratchDirFor(root, source), 'data', 'app.db.partial'))).toBe(false);
    const renamed = spec();
    renamed.app.name = 'Invoice Desk Copy';
    renamed.app.slug = 'invoice-desk-copy';
    const prepared = prepareScratch(scratchDirFor(root, copy), renamed, root);
    expect(prepared.data).toEqual({ kept: true, reason: 'unchanged' });
    expect(prepared.migrated).toBe(false);
  });

  it('refuses a folder outside the root and an id that is not a UUID', () => {
    expect(() => copyPreviewData('../x', uuid(), root)).toThrow(TypeError);
    expect(() => copyPreviewData(uuid(), 'nope', root)).toThrow(TypeError);
  });
});

describe('POST /api/studio/apps/:id/duplicate with records', () => {
  const dup = (id, body) =>
    request(app)
      .post(`/api/studio/apps/${id}/duplicate`)
      .set('X-Forwarded-For', `192.0.2.${(n += 1) % 250}`)
      .send(body);

  it('copies the Preview records when asked and says so', async () => {
    const record = importApp(spec());
    withPreviewData(record.spec, record.id, previewRoot());
    const res = await dup(record.id, { withRecords: true });
    expect(res.status).toBe(201);
    expect(res.body.data.recordsCopied).toBe(true);
    const copyDb = new DatabaseSync(path.join(scratchDirFor(previewRoot(), res.body.data.id), 'data', 'app.db'), { readOnly: true });
    try {
      expect(copyDb.prepare('SELECT COUNT(*) AS n FROM invoices').get().n).toBe(2);
    } finally {
      copyDb.close();
    }
  });

  it('copies nothing by default or when the app has no Preview data', async () => {
    const record = importApp(spec());
    withPreviewData(record.spec, record.id, previewRoot());
    const plain = await dup(record.id, {});
    expect(plain.body.data.recordsCopied).toBe(false);
    expect(fs.existsSync(path.join(scratchDirFor(previewRoot(), plain.body.data.id), 'data', 'app.db'))).toBe(false);
    const empty = importApp(spec());
    fs.rmSync(scratchDirFor(previewRoot(), empty.id), { recursive: true, force: true });
    const none = await dup(empty.id, { withRecords: true });
    expect(none.status).toBe(201);
    expect(none.body.data.recordsCopied).toBe(false);
  });

  it('answers 400 when withRecords is not true or false, and 404 for an unknown app', async () => {
    const record = importApp(spec());
    expect((await dup(record.id, { withRecords: 'yes' })).status).toBe(400);
    expect((await dup(uuid(), { withRecords: true })).status).toBe(404);
  });
});
