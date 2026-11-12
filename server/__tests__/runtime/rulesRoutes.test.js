// Rules on a status change through the data routes and the Assistant (phase 28, section 3): the person's own value wins,
// a rule's result is checked like the person's, `applied` shows only when something applied.
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
import { count } from '../../db/index.js';
import { localDate } from '@local-app-studio/runtime/spec/rules.ts';
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
const patch = (id, body) => request(app).patch(`/api/data/invoices/${id}`).send(body);
const today = () => localDate(new Date());

describe('applied', () => {
  it('is absent when no rule fired and present, with words, when one did', async () => {
    const plain = await post({ due: '2026-12-01' });
    expect(plain.status).toBe(201);
    expect(Object.hasOwn(plain.body, 'applied')).toBe(false);
    const day = today();
    const paid = await post({ paid: true });
    expect(paid.body.data.paid_on).toBe(day);
    expect(paid.body.applied).toEqual([{ field: 'paid_on', label: 'Paid on', to: 'today', words: 'Paid on was set to today.' }]);
  });

  it('a typed Paid on wins on a new record and nothing is reported', async () => {
    const res = await post({ paid: true, paid_on: '2026-01-02' });
    expect(res.body.data.paid_on).toBe('2026-01-02');
    expect(Object.hasOwn(res.body, 'applied')).toBe(false);
  });
});

describe('a whole row form save (H1)', () => {
  it('ticking Paid with the unchanged empty Paid on and Due sets Paid on', async () => {
    const made = (await post({ paid: false, due: '2026-12-01' })).body.data;
    const res = await patch(made.id, { paid: true, paid_on: null, due: '2026-12-01', status: 'Draft', total: null });
    expect(res.status).toBe(200);
    expect(res.body.data.paid_on).toBe(today());
    expect(res.body.applied[0].words).toBe('Paid on was set to today.');
  });

  it('unticking Paid with the unchanged stored date clears it', async () => {
    const made = (await post({ paid: true })).body.data;
    expect(made.paid_on).toBe(today());
    const res = await patch(made.id, { paid: false, paid_on: made.paid_on });
    expect(res.body.data.paid_on).toBeNull();
    expect(res.body.applied[0].words).toBe('Paid on was cleared.');
  });

  it('resending Paid unchanged fires nothing', async () => {
    const made = (await post({ paid: true, paid_on: '2026-01-02' })).body.data;
    const res = await patch(made.id, { paid: true, paid_on: '2026-01-02', note: 'x' });
    expect(res.body.data.paid_on).toBe('2026-01-02');
    expect(Object.hasOwn(res.body, 'applied')).toBe(false);
  });

  it('a new Paid on typed while ticking keeps the typed date', async () => {
    const made = (await post({ paid: false })).body.data;
    const res = await patch(made.id, { paid: true, paid_on: '2026-02-03' });
    expect(res.body.data.paid_on).toBe('2026-02-03');
    expect(Object.hasOwn(res.body, 'applied')).toBe(false);
  });
});

describe('a rule result is checked like the person value', () => {
  it('a copy that does not fit refuses the whole save and writes nothing', async () => {
    const res = await post({ status: 'Paid', note: 'x'.repeat(600) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_record');
    expect(res.body.field).toBe('short');
    expect(count('invoices', { db })).toBe(0);
  });

  it('a copy of a link passes the reference check and shows its words', async () => {
    const client = (await request(app).post('/api/data/clients').send({ name: 'Acme' })).body.data;
    const res = await post({ status: 'Sent', client_id: client.id });
    expect(res.status).toBe(201);
    expect(res.body.data.second_client).toBe(client.id);
    expect(res.body.applied).toEqual([{ field: 'second_client', label: 'Second client', to: 'field', words: 'Second client was copied from Client.' }]);
  });
});

describe('the Assistant', () => {
  it('a save after approval carries applied', async () => {
    const out = await tools.runRuntimeTool('save_record__invoices', { values: { paid: true } });
    expect(out.created).toBe(true);
    expect(out.saved.paid_on).toBe(today());
    expect(out.applied).toEqual([{ field: 'paid_on', label: 'Paid on', to: 'today', words: 'Paid on was set to today.' }]);
    const plain = await tools.runRuntimeTool('save_record__invoices', { values: { due: '2026-12-01' } });
    expect(Object.hasOwn(plain, 'applied')).toBe(false);
  });

  it('the parked preview does not show rule effects', async () => {
    const pre = await tools.precheckRuntimeWrite('save_record__invoices', { values: { paid: true } });
    expect(pre.ok).toBe(true);
    expect(pre.args.display.map((d) => d.label)).toEqual(['Paid']);
  });
});
