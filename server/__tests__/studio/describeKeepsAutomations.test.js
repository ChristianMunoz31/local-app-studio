// The helper route and automations (phase 28, section 1.6): the model is given the design without numbering or rules, and the
// proposal keeps them again (a rule the edit broke is dropped), so the prompt and schema bytes do not move.
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../loadEnv.js', () => ({}));
vi.mock('node-fetch', () => ({ default: vi.fn() }));
vi.mock('../../studio/describe/pipeline.js', async (importOriginal) => ({ ...(await importOriginal()), runDescribe: vi.fn() }));

import fetch from 'node-fetch';
import { __resetAiForTests } from '../../ai/index.js';
import { runDescribe } from '../../studio/describe/pipeline.js';
import { importApp } from '../../studio/apps.js';
import { installFakeOllama } from '../helpers/fakeOllama.js';
import { closeTestDb, createTestDb, resetDb } from '../helpers/testDb.js';
import { PUBLIC_BUILD } from '../helpers/proBuild.js';

const FIXTURE = path.join(process.cwd(), 'packages', 'runtime', 'src', 'spec', '__tests__', 'fixtures', 'automations', 'rules-paid.json');
let app;
let db;
let n = 0;
const saved = Object.fromEntries(['APP_PASSWORD', 'AUTH_SECRET', 'APP_AI'].map((k) => [k, process.env[k]]));

const sseParse = (res, cb) => {
  let text = '';
  res.setEncoding('utf8');
  res.on('data', (d) => {
    text += d;
  });
  res.on('end', () => cb(null, text));
};
const events = (text) =>
  text
    .split('\n\n')
    .filter((b) => b.startsWith('event:'))
    .map((b) => {
      const [e, d] = b.split('\n');
      return [e.slice(7), JSON.parse(d.slice(6))];
    });
const post = (id) =>
  request(app)
    .post(`/api/studio/apps/${id}/describe`)
    .set('X-Forwarded-For', `203.0.113.${(n += 1) % 250}`)
    .buffer(true)
    .parse(sseParse)
    .send({ mode: 'edit', instruction: 'Rename a field', baseRevision: 1 });

beforeAll(async () => {
  for (const k of Object.keys(saved)) delete process.env[k];
  db = createTestDb();
  app = (await import('../../../server.js')).default;
});
afterAll(() => {
  closeTestDb(db);
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
beforeEach(() => {
  resetDb(db);
  __resetAiForTests();
  fetch.mockReset();
  runDescribe.mockReset();
  installFakeOllama(fetch);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const savedApp = () => importApp(JSON.parse(fs.readFileSync(FIXTURE, 'utf8')));
const proposalEvent = (res) => events(res.body).find(([e]) => e === 'proposal')?.[1];

describe.skipIf(PUBLIC_BUILD)('describe keeps automations (needs the helper route, which is not in a public build)', () => {
  it('gives the model a design with no numbering or rules, and keeps both in the proposal', async () => {
    const record = savedApp();
    expect(JSON.stringify(record.spec)).toMatch(/autoNumber/);
    runDescribe.mockImplementation(async ({ baseSpec }) => {
      const proposal = structuredClone(baseSpec);
      proposal.tables[1].fields.find((f) => f.id === 'total').label = 'Amount';
      return { proposal, fallbacks: [], steps: [] };
    });
    const res = await post(record.id);
    const sent = runDescribe.mock.calls[0][0].baseSpec;
    expect(JSON.stringify(sent)).not.toMatch(/autoNumber|"rules"/);
    const { proposal } = proposalEvent(res);
    const invoices = proposal.tables.find((t) => t.id === 'invoices');
    expect(invoices.fields.find((f) => f.id === 'number').autoNumber).toEqual({ prefix: 'INV-', start: 1001, width: 4 });
    expect(invoices.fields.find((f) => f.id === 'total').label).toBe('Amount');
    expect(invoices.rules).toEqual(record.spec.tables[1].rules);
  });

  it('drops a rule whose field the edit removed, and keeps the others', async () => {
    const record = savedApp();
    runDescribe.mockImplementation(async ({ baseSpec }) => {
      const proposal = structuredClone(baseSpec);
      proposal.tables[1].fields = proposal.tables[1].fields.filter((f) => f.id !== 'paid_on');
      return { proposal, fallbacks: [], steps: [] };
    });
    const res = await post(record.id);
    const invoices = proposalEvent(res).proposal.tables.find((t) => t.id === 'invoices');
    expect(invoices.rules ?? []).toEqual([]);
    expect(invoices.fields.some((f) => f.id === 'paid_on')).toBe(false);
    expect(invoices.fields.find((f) => f.id === 'number').autoNumber).toBeDefined();
  });

  it('drops the numbering when the edit changes the field to a type that cannot hold it', async () => {
    const record = savedApp();
    runDescribe.mockImplementation(async ({ baseSpec }) => {
      const proposal = structuredClone(baseSpec);
      const invoices = proposal.tables.find((t) => t.id === 'invoices');
      invoices.fields[0] = { id: 'number', label: 'Number', type: 'date', required: false };
      delete invoices.titleField;
      return { proposal, fallbacks: [], steps: [] };
    });
    const res = await post(record.id);
    const invoices = proposalEvent(res).proposal.tables.find((t) => t.id === 'invoices');
    expect(invoices.fields[0].autoNumber).toBeUndefined();
  });
});
