// POST /api/data/:table/import (phase 28, section 4): dry run by default, the same batches in a real run, mapping and size
// refusals, links by id or title, numbers, rules when ticked, and the budget.
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

const spy = vi.hoisted(() => ({ calls: [] }));
vi.mock('../../db/index.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    select: (table, opts) => {
      spy.calls.push({ table, columns: opts?.columns, limit: opts?.limit, where: opts?.where ? Object.keys(opts.where) : [] });
      return real.select(table, opts);
    },
  };
});

import fs from 'node:fs';
import request from 'supertest';
import { count, insert, select } from '../../db/index.js';
import { moduleOwnBody } from '../../modules/index.js';
import { localDate } from '@local-app-studio/runtime/spec/rules.ts';
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
  delete process.env.APP_PREVIEW_CHILD;
  for (const [k, v] of Object.entries(savedPw)) if (v !== undefined) process.env[k] = v;
});
beforeEach(() => {
  resetDb(db);
  spy.calls.length = 0;
});

// Each request comes from its own address, so the 30 per 15 minutes budget of one client never decides another test.
let n = 0;
const ip = () => `10.7.${Math.floor(n / 250)}.${(n += 1) % 250}`;
const run = (body, table = 'invoices', from = ip()) => request(app).post(`/api/data/${table}/import`).set('X-Forwarded-For', from).send(body);
const rows = (...lines) => ['Status,Paid,Due,Total', ...lines].join('\n');
const invoices = () => select('invoices', { orderBy: [{ column: 'rowid' }], db });
const numbers = () => invoices().map((r) => r.number);
const client = async (name) => (await request(app).post('/api/data/clients').send({ name })).body.data;

describe('dry run', () => {
  it('is the default, writes nothing and describes the file', async () => {
    const res = await run({ csv: ['Number,Status,Paid,Due,Notes', 'x,Sent,yes,2026-12-01,a', 'x,Draft,no,31/01/2026,b'].join('\r\n') });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const d = res.body.data;
    expect(d).toMatchObject({ dryRun: true, delimiter: ',', rows: 2, valid: 1, invalid: 1, complete: true, stoppedAt: null });
    expect(d.mapping).toEqual({ Number: null, Status: 'status', Paid: 'paid', Due: 'due', Notes: null });
    expect(d.errors).toEqual([{ row: 3, field: 'due', message: 'Row 3: Due must be a date like 2025-01-31.' }]);
    expect(d.lines).toEqual(['1 row can be added. 1 row will be left out.', 'Left out: Number, Notes.']);
    expect(d.fields.find((f) => f.id === 'number')).toMatchObject({ numbered: true, required: true });
    expect(count('invoices', { db })).toBe(0);
    expect(select('app_state', { db })).toEqual([]);
  });

  it('says that no column matches a field instead of "0 rows can be added" (phase 28 L5)', async () => {
    const res = await run({ csv: 'Colour,Size\nred,big\nblue,small' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ dryRun: true, valid: 0 });
    expect(res.body.data.lines).toEqual(['No column matches a field of this table.', 'Left out: Colour, Size.']);
    expect(count('invoices', { db })).toBe(0);
  });

  it('gives the counts the real run then gives, on the same file', async () => {
    const csv = rows('Sent,yes,2026-12-01,10', 'Draft,no,not a date,1', 'Paid,no,2026-11-01,3', 'Lost,no,,', 'Draft,yes,,5');
    const dry = (await run({ csv, dryRun: true })).body.data;
    const real = (await run({ csv, dryRun: false })).body.data;
    expect(real).toMatchObject({ dryRun: false, rows: dry.rows, added: dry.valid, skipped: dry.invalid, complete: true });
    expect(real.errors).toEqual(dry.errors);
    expect(real.lines).toEqual([`Added ${dry.valid} rows.`]);
    expect(dry.errors.map((e) => e.row)).toEqual([3, 5]);
  });
});

describe('a real run', () => {
  it('numbers rows in order, a skipped row consumes no number, one column scan', async () => {
    const csv = rows('Sent,no,2026-12-01,1', 'Draft,no,bad,2', 'Paid,no,,3', 'Draft,no,,4');
    const res = await run({ csv, dryRun: false });
    expect(res.body.data).toMatchObject({ added: 3, skipped: 1 });
    expect(numbers()).toEqual(['INV-1001', 'INV-1002', 'INV-1003']);
    expect(spy.calls.filter((c) => c.table === 'invoices' && c.columns?.length === 1 && c.columns[0] === 'number')).toHaveLength(1);
    expect((await request(app).post('/api/data/invoices').send({})).body.data.number).toBe('INV-1004');
  });

  it('300 rows with 2 bad give 298 added and two row lines', async () => {
    const lines = Array.from({ length: 300 }, (_, i) => `Draft,no,${i === 56 || i === 199 ? '31/01/2026' : '2026-12-01'},${i}`);
    const res = await run({ csv: rows(...lines), dryRun: false });
    expect(res.body.data).toMatchObject({ rows: 300, added: 298, skipped: 2 });
    expect(res.body.data.errors.map((e) => e.message)).toEqual(['Row 58: Due must be a date like 2025-01-31.', 'Row 201: Due must be a date like 2025-01-31.']);
    expect(count('invoices', { db })).toBe(298);
  });

  it('reads a semicolon file with a comma decimal, quoted cells and an unguarded formula quote', async () => {
    const csv = ['Status;Paid;Due;Total;Note', 'Sent;yes;2026-12-01;12,5;"a;b"', 'Draft;0;;3;\'=SUM(A1)'].join('\n');
    const res = await run({ csv, dryRun: false });
    expect(res.body.data).toMatchObject({ added: 2, skipped: 0 });
    const [a, b] = invoices();
    expect(a).toMatchObject({ total: 12.5, paid: true, note: 'a;b' });
    expect(b).toMatchObject({ paid: false, note: '=SUM(A1)' });
  });

  it('keeps rules off unless ticked and runs them when ticked', async () => {
    const csv = rows('Sent,yes,,1');
    await run({ csv, dryRun: false });
    expect(invoices()[0].paid_on).toBeNull();
    const res = await run({ csv, dryRun: false, applyAutomations: true });
    expect(res.body.data.applied).toBe(1);
    expect(invoices()[1].paid_on).toBe(localDate(new Date()));
  });

  it('startAt resumes from a spreadsheet row', async () => {
    const csv = rows('Draft,no,,1', 'Draft,no,,2', 'Draft,no,,3');
    const res = await run({ csv, dryRun: false, startAt: 4 });
    expect(res.body.data).toMatchObject({ rows: 1, added: 1 });
    expect(invoices().map((r) => r.total)).toEqual([3]);
  });
});

describe('start row', () => {
  const csv = rows('Draft,no,,1', 'Draft,no,,2', 'Draft,no,,3');
  it.each([1, 1.5, 0, -2, 'x', '2', 9])('refuses %s', async (startAt) => {
    const res = await run({ csv, startAt });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_request');
    expect(res.body.error).toBe('Start row must be a whole number from 2 to 5.');
  });
  it('one past the last data row imports nothing', async () => {
    const res = await run({ csv, startAt: 5, dryRun: false });
    expect(res.body.data).toMatchObject({ rows: 0, added: 0, complete: true });
    expect(count('invoices', { db })).toBe(0);
  });
});

describe('mapping', () => {
  const csv = 'A,B,C\n1,2,3';
  it.each([
    ['a header that is not in the file', { Nope: 'status' }, 'Nope'],
    ['a field the table lacks', { A: 'nope' }, 'nope'],
    ['the numbered field', { A: 'number' }, 'number'],
    ['one field twice', { A: 'status', B: 'status' }, 'status'],
    ['no column', { A: null }, 'mapping'],
    ['a list', [], 'mapping'],
  ])('refuses %s', async (_name, mapping, field) => {
    const res = await run({ csv, mapping });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('import_mapping_invalid');
    expect(res.body.field).toBe(field);
  });
  it('uses a given mapping', async () => {
    const res = await run({ csv: 'A,B\nSent,4', mapping: { A: 'status', B: 'total' }, dryRun: false });
    expect(res.body.data.added).toBe(1);
    expect(invoices()[0]).toMatchObject({ status: 'Sent', total: 4 });
  });
  it('a real run with nothing mapped is refused, a dry run only reports', async () => {
    expect((await run({ csv, dryRun: false })).body.code).toBe('import_mapping_invalid');
    const dry = (await run({ csv })).body.data;
    expect(dry).toMatchObject({ valid: 0, invalid: 0 });
    expect(dry.lines[1]).toBe('Left out: A, B, C.');
  });
});

describe('files that cannot be read', () => {
  it.each([
    ['', 'Line 1: the file has no rows.'],
    ['a,,c\n1,2,3', 'Line 1: the first row must name every column.'],
    ['a,b,a\n1,2,3', 'Line 1: two columns have the same name.'],
    ['a,b\n1,2\n3,"oops\n4,5', 'Line 3: a quote is opened and never closed.'],
  ])('answers import_csv_invalid for %j', async (csv, message) => {
    const res = await run({ csv });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('import_csv_invalid');
    expect(res.body.error).toBe(message);
  });
  it('answers invalid_request when csv is missing or not text, and 404 for an unknown table', async () => {
    for (const body of [{}, { csv: 5 }, { csv: null }]) expect((await run(body)).body.code).toBe('invalid_request');
    const res = await run({ csv: 'a\n1' }, 'nope');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('unknown_table');
  });
  it('refuses a cell over 20000 characters as a row error', async () => {
    const res = await run({ csv: `Note\n${'x'.repeat(20001)}\nok` });
    expect(res.body.data).toMatchObject({ valid: 1, invalid: 1 });
    expect(res.body.data.errors[0].message).toBe('Row 2: Note is longer than 20000 characters.');
  });
});

describe('size caps', () => {
  it('answers 413 request_too_large with the 16 MB sentence for a body over 16 MB', async () => {
    const big = JSON.stringify({ csv: `Note\n${'x'.repeat(17 * 1024 * 1024)}` });
    const res = await request(app).post('/api/data/invoices/import').set('Content-Type', 'application/json').send(big);
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('request_too_large');
    expect(res.body.error).toBe('This file is too large to import here. The limit is 16 MB.');
  });

  it('answers 413 import_too_large for 200001 rows, before any write', async () => {
    const csv = `Note\n${'x\n'.repeat(200001)}`;
    const res = await run({ csv, dryRun: false });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('import_too_large');
    expect(res.body.error).toBe('This file has more than 200000 rows. Split it, then import each part.');
    // A CSV is not restored from a backup: the route words its own next step (phase 28 L3).
    expect(res.body.action).toBe('Split the file into smaller files, then import each one.');
    expect(res.body.action).not.toMatch(/backup/i);
    expect(count('invoices', { db })).toBe(0);
  });

  it('caps a Preview import at 5000 rows', async () => {
    process.env.APP_PREVIEW_CHILD = '1';
    try {
      const over = await run({ csv: `Note\n${'x\n'.repeat(5001)}`, dryRun: false });
      expect(over.status).toBe(413);
      expect(over.body.code).toBe('import_too_large');
      expect(over.body.error).toBe('In Preview a file can have up to 5000 rows. Split it, or import it in the built app.');
      expect(over.body.action).toBe('Split the file into smaller files, then import each one.');
      expect(count('invoices', { db })).toBe(0);
      const ok = await run({ csv: `Note\n${'x\n'.repeat(5000)}` });
      expect(ok.body.data.valid).toBe(5000);
    } finally {
      delete process.env.APP_PREVIEW_CHILD;
    }
  });
});

describe('links', () => {
  it('keeps an id, matches a title trimmed and in any case, and names missing and ambiguous ones with the row', async () => {
    const acme = await client('Acme Ltd');
    await client('Twin');
    await client('Twin');
    const csv = ['Status,Client', `Draft,${acme.id}`, 'Draft,  acme LTD ', 'Draft,Nobody Inc', 'Draft,twin', 'Draft,'].join('\n');
    const res = await run({ csv, dryRun: false });
    expect(res.body.data).toMatchObject({ added: 3, skipped: 2 });
    expect(res.body.data.errors.map((e) => e.message)).toEqual([
      'Row 4: there is no Clients record named "Nobody Inc".',
      'Row 5: 2 Clients records are named "twin". Give one of them another name, then import again.',
    ]);
    expect(invoices().map((r) => r.client_id)).toEqual([acme.id, acme.id, null]);
  });

  it('reads the ids once and the titles in one paged read per linked table', async () => {
    await client('Acme');
    spy.calls.length = 0;
    await run({ csv: ['Status,Client', 'Draft,Acme', 'Draft,Acme', 'Draft,Other'].join('\n'), dryRun: false });
    const reads = spy.calls.filter((c) => c.table === 'clients');
    expect(reads.filter((c) => c.where.includes('id'))).toHaveLength(1);
    expect(reads.filter((c) => c.limit === 5000)).toHaveLength(1);
  });
});

describe('the budget', () => {
  it('answers 429 rate_limited after 30 imports in a window', async () => {
    let limited = null;
    for (let i = 0; i < 40 && limited === null; i += 1) {
      const res = await run({ csv: 'Note\nx' }, 'invoices', '10.8.0.1');
      if (res.status === 429) limited = res;
    }
    expect(limited).not.toBeNull();
    expect(limited.body.code).toBe('rate_limited');
  });

  it('refuses a limited caller before it reads the body (phase 28 L1)', async () => {
    for (let i = 0; i < 31; i += 1) await run({ csv: 'Note\nx' }, 'invoices', '10.8.0.2');
    // A body the JSON parser would refuse with 400 is never read once the budget is spent.
    const res = await request(app)
      .post('/api/data/invoices/import')
      .set('X-Forwarded-For', '10.8.0.2')
      .set('Content-Type', 'application/json')
      .send('{not json');
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('rate_limited');
  });
});

describe('the import body parser is for POST only (phase 28 L2)', () => {
  it('names the entry for POST and not for another method of the same path', () => {
    const path = '/api/data/invoices/import';
    expect(moduleOwnBody({ path, method: 'POST' }, 'runtime')).not.toBeNull();
    for (const method of ['PATCH', 'PUT', 'GET', 'DELETE']) expect(moduleOwnBody({ path, method }, 'runtime'), method).toBeNull();
  });

  it('a PATCH to a record whose id is "import" still has its body parsed', async () => {
    insert('clients', { id: 'import', name: 'Before' }, { db });
    const res = await request(app).patch('/api/data/clients/import').send({ name: 'After' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: 'import', name: 'After' });
  });
});
