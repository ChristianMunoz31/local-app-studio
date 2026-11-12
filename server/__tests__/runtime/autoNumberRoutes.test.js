// Auto numbers through the data routes and the Assistant (phase 28, section 2): the runtime numbers a record, a client value is
// refused, a counter only goes up, and the state route cannot touch it.
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
import { insert, select } from '../../db/index.js';
import { closeTestDb, createTestDb, resetDb } from '../helpers/testDb.js';

vi.mock('../../../loadEnv.js', () => ({}));

let app;
let db;
let tools;
const savedPw = { APP_PASSWORD: process.env.APP_PASSWORD, AUTH_SECRET: process.env.AUTH_SECRET };

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  delete process.env.AUTH_SECRET;
  db = createTestDb();
  app = (await import('../../../server.js')).default;
  tools = await import('@local-app-studio/runtime/server/assistantTools.js');
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

const post = (body = {}) => request(app).post('/api/data/invoices').send(body);
const numbers = () => select('invoices', { columns: ['number'], orderBy: [{ column: 'rowid' }], db }).map((r) => r.number);
const counter = () => select('app_state', { where: { key: 'autonumber.invoices.number' }, db })[0]?.value;

describe('numbering on a new record', () => {
  it('assigns INV-1001 then INV-1002 and a required numbered field passes', async () => {
    const a = await post({ status: 'Draft' });
    const b = await post({});
    expect(a.status).toBe(201);
    expect(a.body.data.number).toBe('INV-1001');
    expect(b.body.data.number).toBe('INV-1002');
    expect(counter()).toEqual({ last: 1002 });
  });

  it('refuses a client value with the field named, and writes nothing', async () => {
    const res = await post({ number: 'INV-9' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_record');
    expect(res.body.field).toBe('number');
    expect(res.body.error).toBe('Number is numbered automatically.');
    expect(numbers()).toEqual([]);
    expect(counter()).toBeUndefined();
  });

  it('treats null and an empty string as no value', async () => {
    expect((await post({ number: null })).body.data.number).toBe('INV-1001');
    expect((await post({ number: '' })).body.data.number).toBe('INV-1002');
  });

  it('a refused record consumes no number', async () => {
    expect((await post({ client_id: 'nope' })).status).toBe(400);
    expect((await post({})).body.data.number).toBe('INV-1001');
  });

  it('starts above the highest stored number when the field was numbered after rows existed', async () => {
    insert('invoices', { number: 'INV-5000' }, { db });
    insert('invoices', { number: 'old style' }, { db });
    const res = await post({});
    expect(res.body.data.number).toBe('INV-5001');
  });

  it('stays above the highest stored number when the state is lower', async () => {
    insert('invoices', { number: 'INV-1200' }, { db });
    insert('app_state', { key: 'autonumber.invoices.number', value: { last: 1100 } }, { db });
    expect((await post({})).body.data.number).toBe('INV-1201');
  });

  it('treats a state that is not a safe integer as missing', async () => {
    insert('app_state', { key: 'autonumber.invoices.number', value: { last: 1e300 } }, { db });
    expect((await post({})).body.data.number).toBe('INV-1001');
  });

  it('never reuses a number after a delete', async () => {
    const a = await post({});
    const b = await post({});
    expect((await request(app).delete(`/api/data/invoices/${b.body.data.id}`)).status).toBe(200);
    expect((await request(app).delete(`/api/data/invoices/${a.body.data.id}`)).status).toBe(200);
    expect((await post({})).body.data.number).toBe('INV-1003');
  });
});

describe('numbering on a change', () => {
  it('accepts an equal value, refuses a different one', async () => {
    const made = (await post({})).body.data;
    const same = await request(app).patch(`/api/data/invoices/${made.id}`).send({ number: made.number, status: 'Sent' });
    expect(same.status).toBe(200);
    expect(same.body.data.number).toBe('INV-1001');
    expect(same.body.data.status).toBe('Sent');
    const other = await request(app).patch(`/api/data/invoices/${made.id}`).send({ number: 'INV-77' });
    expect(other.status).toBe(400);
    expect(other.body.field).toBe('number');
    expect(other.body.error).toBe('Number is numbered automatically and cannot be changed.');
    const cleared = await request(app).patch(`/api/data/invoices/${made.id}`).send({ number: null });
    expect(cleared.status).toBe(400);
    expect(numbers()).toEqual(['INV-1001']);
  });
});

describe('the counter is not request input', () => {
  it('PUT /api/state/autonumber.* is refused', async () => {
    await post({});
    const res = await request(app).put('/api/state/autonumber.invoices.number').send({ value: { last: 1 } });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.code).toBe('protected_key');
    const upper = await request(app).put('/api/state/AutoNumber.invoices.number').send({ value: { last: 1 } });
    expect(upper.body.code).toBe('protected_key');
    expect(counter()).toEqual({ last: 1001 });
  });
});

describe('the Assistant', () => {
  it('stores the assigned number when the model sends one, and describe_data marks the field', async () => {
    const out = await tools.runRuntimeTool('save_record__invoices', { values: { number: 'INV-42', status: 'Sent' } });
    expect(out.created).toBe(true);
    expect(out.saved.number).toBe('INV-1001');
    const info = tools.describeData();
    const fields = info.tables.find((t) => t.id === 'invoices').fields;
    expect(fields.find((f) => f.id === 'number').numbered).toBe(true);
    expect(fields.filter((f) => f.numbered)).toHaveLength(1);
    expect(info.tables.find((t) => t.id === 'clients').fields.some((f) => 'numbered' in f)).toBe(false);
  });

  it('refuses a change to the number on an update and drops an equal one', async () => {
    const made = (await tools.runRuntimeTool('save_record__invoices', { values: { status: 'Draft' } })).saved;
    const same = await tools.runRuntimeTool('save_record__invoices', { id: made.id, values: { number: made.number, status: 'Sent' } });
    expect(same.saved.status).toBe('Sent');
    const other = await tools.runRuntimeTool('save_record__invoices', { id: made.id, values: { number: 'INV-1' } });
    expect(other.error).toBe('Number is numbered automatically and cannot be changed.');
  });
});
