// POST /api/export with { tables: [one], format: 'csv' }: a streamed bare CSV behind the same guards as the ZIP.
import { EventEmitter } from 'node:events';
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
vi.mock('../modules/studio.data.js', (importOriginal) => import('./helpers/probeTable.js').then((m) => m.withProbeTable(importOriginal)));
import request from 'supertest';
import express from 'express';
import { closeTestDb, createTestDb, resetDb, seedDb } from './helpers/testDb.js';

vi.mock('../auditHook.js', async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, recordAudit: vi.fn(mod.recordAudit) };
});

vi.mock('../export/buildArchive.js', async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, exceedsRowCap: vi.fn(mod.exceedsRowCap) };
});

import * as archive from '../export/buildArchive.js';
import { recordAudit, setAuditSink } from '../auditHook.js';
import { registerExportRoutes } from '../exportRoutes.js';
import { readTablePages, EXPORT_PAGE_SIZE } from '../export/buildArchive.js';
import { DATA_TABLES } from '../dataTables.js';
import { toCsv } from '../export/csv.js';

let db;
beforeAll(() => {
  db = createTestDb();
});
beforeEach(() => {
  resetDb(db);
  recordAudit.mockClear();
  setAuditSink(null);
});
afterAll(() => closeTestDb(db));

const appWith = (opts, ip) => {
  const a = express();
  if (ip) {
    a.use((req, _res, next) => {
      Object.defineProperty(req, 'ip', { value: ip });
      next();
    });
  }
  registerExportRoutes(a, opts);
  return a;
};
const csvPost = (app, body) => request(app).post('/api/export').send(body);

describe('POST /api/export format csv', () => {
  it('streams a text/csv attachment named after the table, no-store, audited once', async () => {
    seedDb(db, { probe_items: [{ id: 'a', name: 'Plain', quantity: 5, unit_cost: 12.5 }] });
    const res = await csvPost(appWith(), { tables: ['probe_items'], format: 'csv' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="local-app-studio-probe_items-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.csv"$/,
    );
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-export-complete']).toBe('1');
    expect(res.headers['content-length']).toBeUndefined();
    const lines = res.text.split('\r\n');
    expect(lines[0]).toBe('id,name,category,quantity,unit_cost,status,notes,created_at');
    expect(lines[1]).toMatch(/^a,Plain,general,5,12\.5,active,,/);
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(recordAudit.mock.calls[0][0]).toMatchObject({ kind: 'export', feature: 'data_export', status: 'ok' });
    expect(recordAudit.mock.calls[0][0].meta).toMatchObject({ tables: 1, rows: 1 });
  });

  it('matches toCsv byte for byte, header included, for a table of rows', async () => {
    seedDb(db, { probe_items: [{ id: 'a', name: 'x,y', notes: 'line\nbreak "q"' }, { id: 'b', name: 'z' }] });
    const def = DATA_TABLES.find((d) => d.id === 'probe_items');
    const rows = db.prepare('SELECT * FROM probe_items ORDER BY id').all();
    const res = await csvPost(appWith(), { tables: ['probe_items'], format: 'csv' });
    expect(res.text).toBe(toCsv(def.columns, rows));
  });

  it.each(['=SUM(1)', '+1', '-x', '@x', '\tcmd', '  =1+1'])('guards a formula-like cell %j', async (name) => {
    seedDb(db, { probe_items: [{ id: 'a', name }] });
    const res = await csvPost(appWith(), { tables: ['probe_items'], format: 'csv' });
    expect(res.text.split('\r\n')[1]).toMatch(new RegExp(`^a,'${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},`));
  });

  it('keeps numbers in numeric columns unguarded', async () => {
    seedDb(db, { probe_items: [{ id: 'a', name: 'n', quantity: 7, unit_cost: 0.5 }] });
    const res = await csvPost(appWith(), { tables: ['probe_items'], format: 'csv' });
    expect(res.text.split('\r\n')[1]).toMatch(/^a,n,general,7,0\.5,/);
  });

  it('writes a header only file for an empty table', async () => {
    const res = await csvPost(appWith(), { tables: ['probe_items'], format: 'csv' });
    expect(res.status).toBe(200);
    expect(res.text).toBe('id,name,category,quantity,unit_cost,status,notes,created_at\r\n');
    expect(res.headers['x-export-complete']).toBe('1');
  });

  it('reads more than one page and returns every row once', async () => {
    const total = EXPORT_PAGE_SIZE + 5;
    seedDb(db, {
      probe_items: Array.from({ length: total }, (_, i) => ({ id: `r${String(i).padStart(5, '0')}`, name: `n${i}` })),
    });
    const res = await csvPost(appWith(), { tables: ['probe_items'], format: 'csv' });
    const lines = res.text.split('\r\n');
    expect(lines).toHaveLength(total + 2);
    expect(lines[1].startsWith('r00000,')).toBe(true);
    expect(lines[total].startsWith(`r${String(total - 1).padStart(5, '0')},`)).toBe(true);
    expect(lines[total + 1]).toBe('');
  });

  it('over the row cap: ends at the cap and says X-Export-Complete 0 up front, audited partial', async () => {
    seedDb(db, { probe_items: [{ id: 'a', name: '1' }, { id: 'b', name: '2' }, { id: 'c', name: '3' }] });
    const res = await csvPost(appWith({ buildOptions: { maxRowsPerTable: 2 } }), { tables: ['probe_items'], format: 'csv' });
    expect(res.status).toBe(200);
    expect(res.headers['x-export-complete']).toBe('0');
    expect(res.text.split('\r\n')).toHaveLength(4);
    expect(recordAudit.mock.calls[0][0]).toMatchObject({ status: 'error', meta: { rows: 2, partial: true } });
  });

  it('exactly at the cap is complete', async () => {
    seedDb(db, { probe_items: [{ id: 'a', name: '1' }, { id: 'b', name: '2' }] });
    const res = await csvPost(appWith({ buildOptions: { maxRowsPerTable: 2 } }), { tables: ['probe_items'], format: 'csv' });
    expect(res.headers['x-export-complete']).toBe('1');
  });

  it('answers a plain 500 when the deadline is gone before the first row', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    seedDb(db, { probe_items: [{ id: 'a', name: '1' }] });
    const res = await csvPost(appWith({ buildOptions: { deadlineMs: -1 } }), { tables: ['probe_items'], format: 'csv' });
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ code: 'server_error' });
    expect(res.headers['content-type']).not.toMatch(/csv/);
    expect(recordAudit.mock.calls[0][0]).toMatchObject({ status: 'error' });
  });
});

describe('POST /api/export format csv: cut off after the headers', () => {
  afterEach(() => vi.useRealTimers());

  it('rows added during the stream past the cap: the response is destroyed and audited partial, never ok', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    seedDb(db, { probe_items: [{ id: 'a', name: '1' }, { id: 'b', name: '2' }] });
    const actual = await vi.importActual('../export/buildArchive.js');
    // The up-front count says the table fits (2 of 2); a row arrives right after it.
    archive.exceedsRowCap.mockImplementationOnce((d, def, max) => {
      const fits = actual.exceedsRowCap(d, def, max);
      seedDb(db, { probe_items: [{ id: 'c', name: '3' }] });
      return fits;
    });
    await expect(csvPost(appWith({ buildOptions: { maxRowsPerTable: 2 } }), { tables: ['probe_items'], format: 'csv' })).rejects.toBeTruthy();
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(recordAudit.mock.calls[0][0]).toMatchObject({ status: 'error', meta: { rows: 2, partial: true } });
  });

  it('a client that stops reading cannot hold the stream past the export deadline: destroyed, audited partial', async () => {
    seedDb(db, { probe_items: [{ id: 'a', name: '1' }] });
    let handler;
    registerExportRoutes({ post: (_route, ...handlers) => (handler = handlers.at(-1)) }, { buildOptions: { deadlineMs: 5000 } });
    let reached;
    const written = new Promise((resolve) => {
      reached = resolve;
    });
    const res = Object.assign(new EventEmitter(), {
      writableEnded: false,
      set: vi.fn(),
      // Never drains: the buffer stays full.
      write: vi.fn(() => {
        reached();
        return false;
      }),
      end: vi.fn(),
      destroy: vi.fn(),
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const done = handler({ body: { tables: ['probe_items'], format: 'csv' } }, res);
    await written;
    expect(res.destroy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5001);
    await done;
    expect(res.destroy).toHaveBeenCalledTimes(1);
    expect(res.end).not.toHaveBeenCalled();
    expect(recordAudit.mock.calls.at(-1)[0]).toMatchObject({ status: 'error', meta: { partial: true } });
    expect(res.listenerCount('drain')).toBe(0);
  });
});

describe('readTablePages outcome', () => {
  const def = () => DATA_TABLES.find((d) => d.id === 'probe_items');

  it('reports ok and not truncated when the table ends', async () => {
    seedDb(db, { probe_items: [{ id: 'a', name: '1' }] });
    const outcome = {};
    const pages = [];
    for await (const p of readTablePages(db, def(), { deadline: Date.now() + 60_000, maxRows: 10, signal: new AbortController().signal }, outcome)) pages.push(p);
    expect(pages).toHaveLength(1);
    expect(outcome).toEqual({ status: 'ok', truncated: false });
  });

  it('reports a cut off (and keeps the first page) when the signal fires between pages', async () => {
    seedDb(db, {
      probe_items: Array.from({ length: EXPORT_PAGE_SIZE + 1 }, (_, i) => ({ id: `r${String(i).padStart(5, '0')}`, name: 'n' })),
    });
    const abort = new AbortController();
    const outcome = {};
    let pages = 0;
    for await (const p of readTablePages(db, def(), { deadline: Date.now() + 60_000, maxRows: 5000, signal: abort.signal }, outcome)) {
      pages += 1;
      expect(p).toHaveLength(EXPORT_PAGE_SIZE);
      abort.abort();
    }
    expect(pages).toBe(1);
    expect(outcome).toEqual({ status: 'skipped_deadline', truncated: true });
  });
});

describe('POST /api/export format csv: access and validation', () => {
  it('fails closed with the same 403 as the ZIP for a non-loopback client without sign-in', async () => {
    const a = appWith({ authEnabled: false }, '203.0.113.7');
    const csv = await csvPost(a, { tables: ['probe_items'], format: 'csv' });
    const zip = await csvPost(a, { tables: ['probe_items'] });
    expect(csv.status).toBe(403);
    expect(csv.status).toBe(zip.status);
    expect(csv.body).toMatchObject({ error: 'Export requires sign-in to be enabled.', code: 'auth_required' });
    expect(csv.body.error).toBe(zip.body.error);
    expect(csv.body.code).toBe(zip.body.code);
  });

  it('allows a non-loopback client when sign-in is on', async () => {
    const res = await csvPost(appWith({ authEnabled: true }, '203.0.113.7'), { tables: ['probe_items'], format: 'csv' });
    expect(res.status).toBe(200);
  });

  it.each([
    ['app_secrets', { tables: ['app_secrets'], format: 'csv' }],
    ['audit_log', { tables: ['audit_log'], format: 'csv' }],
    ['unknown id', { tables: ['nope'], format: 'csv' }],
    ['two tables', { tables: ['probe_items', 'assistant_conversations'], format: 'csv' }],
    ['no tables', { format: 'csv' }],
    ['empty list', { tables: [], format: 'csv' }],
    ['wrong format json', { tables: ['probe_items'], format: 'json' }],
    ['wrong format ZIP', { tables: ['probe_items'], format: 'zip' }],
    ['non-string format', { tables: ['probe_items'], format: 1 }],
    ['unknown format without tables', { format: 'xlsx' }],
  ])('400s invalid_request for %s', async (_n, body) => {
    const res = await csvPost(appWith(), body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'Invalid request body', code: 'invalid_request' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('leaves the ZIP path unchanged when format is absent', async () => {
    seedDb(db, { probe_items: [{ id: 'a', name: '1' }] });
    const res = await csvPost(appWith(), { tables: ['probe_items'] });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/zip/);
    expect(res.headers['content-disposition']).toMatch(/-probe_items\.zip"$/);
    expect(res.headers['x-export-complete']).toBe('1');
  });
});
