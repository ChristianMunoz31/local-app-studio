// Export with records (phase 28, section 5.1): POST /api/studio/apps/:id/export { records: true } asks the running Preview child
// for the kit export ZIP over loopback and adds the saved design as app.json. The child here is a small loopback server.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import request from 'supertest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../loadEnv.js', () => ({}));

const preview = vi.hoisted(() => ({ status: { state: 'stopped', appId: null }, target: null }));
vi.mock('../../studio/preview/manager.js', async (importOriginal) => {
  const original = await importOriginal();
  const real = original.getPreviewManager();
  const fake = Object.assign(Object.create(real), { status: () => preview.status, target: () => preview.target });
  return { ...original, getPreviewManager: () => fake };
});

import { importApp } from '../../studio/apps.js';
import { parseExportZip } from '../../import/importExport.js';
import { closeTestDb, createTestDb, resetDb } from '../helpers/testDb.js';

const FIXTURE = path.join(process.cwd(), 'packages', 'runtime', 'src', 'spec', '__tests__', 'fixtures', 'automations', 'rules-paid.json');
const COOKIE = 'child-cookie';
let app;
let db;
let child;
let childPort;
let childSeen;
let childAnswer;
let n = 0;

const kitZip = () =>
  zipSync({
    'manifest.json': strToU8(JSON.stringify({ format: 'local-app-studio-export', formatVersion: 1, tables: [{ id: 'clients' }, { id: 'invoices' }] })),
    'json/clients.json': strToU8('[]'),
    'json/invoices.json': strToU8(JSON.stringify([{ id: 'i1', number: 'INV-1001' }])),
    'csv/clients.csv': strToU8('id\r\n'),
    'csv/invoices.csv': strToU8('id,number\r\ni1,INV-1001\r\n'),
  });

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  delete process.env.AUTH_SECRET;
  db = createTestDb();
  app = (await import('../../../server.js')).default;
  child = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      childSeen = { method: req.method, url: req.url, cookie: req.headers.cookie, body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') };
      const answer = childAnswer();
      res.writeHead(answer.status, answer.headers ?? {});
      res.end(answer.body);
    });
  });
  await new Promise((resolve) => child.listen(0, '127.0.0.1', resolve));
  childPort = child.address().port;
});
afterAll(async () => {
  await new Promise((resolve) => child.close(resolve));
  closeTestDb(db);
});
beforeEach(() => {
  resetDb(db);
  childSeen = null;
  childAnswer = () => ({ status: 200, headers: { 'content-type': 'application/zip' }, body: Buffer.from(kitZip()) });
  preview.status = { state: 'stopped', appId: null };
  preview.target = null;
});
afterEach(() => vi.restoreAllMocks());

const record = () => importApp(JSON.parse(fs.readFileSync(FIXTURE, 'utf8')));
const exportOf = (id, body = { records: true }) =>
  request(app)
    .post(`/api/studio/apps/${id}/export`)
    .set('X-Forwarded-For', `198.51.100.${(n += 1) % 250}`)
    .buffer(true)
    .parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    })
    .send(body);
const running = (r) => {
  preview.status = { state: 'running', appId: r.id };
  preview.target = { port: childPort, cookie: COOKIE };
};

describe('export with records', () => {
  it('answers 409 preview_not_running when the Preview is stopped or runs another app', async () => {
    const r = record();
    const stopped = await exportOf(r.id);
    expect(stopped.status).toBe(409);
    expect(JSON.parse(stopped.body.toString()).code).toBe('preview_not_running');
    expect(JSON.parse(stopped.body.toString()).error).toBe('Start the preview of this app first. Its records live there.');
    preview.status = { state: 'running', appId: crypto.randomUUID() };
    preview.target = { port: childPort, cookie: COOKIE };
    expect((await exportOf(r.id)).status).toBe(409);
    expect(childSeen).toBeNull();
  });

  it('adds app.json to the kit ZIP and names the file after the app', async () => {
    const r = record();
    running(r);
    const res = await exportOf(r.id);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/zip/);
    expect(res.headers['content-disposition']).toBe('attachment; filename="Invoice Desk app.zip"');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(childSeen).toMatchObject({ method: 'POST', url: '/api/export', cookie: `app_desktop=${COOKIE}`, body: { tables: ['clients', 'invoices'] } });
    const files = unzipSync(new Uint8Array(res.body));
    expect(Object.keys(files).sort()).toEqual(['app.json', 'csv/clients.csv', 'csv/invoices.csv', 'json/clients.json', 'json/invoices.json', 'manifest.json']);
    const text = strFromU8(files['app.json']);
    expect(text).toContain('\n  "specVersion": 1');
    expect(JSON.parse(text)).toEqual(r.spec);
    // The kit importer reads manifest.json and json/<table>.json and skips csv/ and app.json without a complaint. (This server runs
    // in studio mode, which has no invoices table, so the table itself is listed as ignored; a built app reads it, see exportRoundTrip.)
    const parsed = parseExportZip(new Uint8Array(res.body));
    expect(parsed.manifest.tables.map((t) => t.id)).toEqual(['clients', 'invoices']);
    expect(parsed.ignored.map((i) => i.reason)).toEqual(['unknown_table', 'unknown_table']);
  });

  it('answers 400 unless records is true', async () => {
    const r = record();
    running(r);
    for (const body of [{}, { records: false }, { records: 'yes' }]) expect((await exportOf(r.id, body)).status).toBe(400);
    expect((await exportOf(crypto.randomUUID())).status).toBe(404);
    expect((await exportOf('nope')).status).toBe(404);
  });

  it('answers 502 when the Preview cannot be read and 413 when the export is incomplete', async () => {
    const r = record();
    running(r);
    childAnswer = () => ({ status: 500, body: 'no' });
    const failed = await exportOf(r.id);
    expect(failed.status).toBe(502);
    expect(JSON.parse(failed.body.toString()).code).toBe('preview_failed');
    childAnswer = () => ({ status: 200, headers: { 'content-type': 'application/zip', 'x-export-complete': '0' }, body: Buffer.from(kitZip()) });
    const partial = await exportOf(r.id);
    expect(partial.status).toBe(413);
    expect(JSON.parse(partial.body.toString()).code).toBe('export_too_large');
  });
});
