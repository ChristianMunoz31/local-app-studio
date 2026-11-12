// The batches of the CSV import (phase 28, M2 and M3): a batch that fails leaves the batches before it and says where to go on,
// a failure before any batch answers the error envelope, and a restore that begins stops the import between batches.
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

const hooks = vi.hoisted(() => ({ calls: 0, throwAt: 0, error: null, onYield: null }));
vi.mock('../../db/index.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    yieldToLoop: async () => {
      hooks.onYield?.();
    },
  };
});
vi.mock('../../../packages/runtime/server/write.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    createRecord: (opts) => {
      hooks.calls += 1;
      if (hooks.calls === hooks.throwAt) throw hooks.error;
      return real.createRecord(opts);
    },
  };
});

import fs from 'node:fs';
import request from 'supertest';
import { tryAcquire } from '../../backup/lock.js';
import { DbError } from '../../db/errors.js';
import { count, select } from '../../db/index.js';
import { tail } from '../../log.js';
import { closeTestDb, createTestDb, resetDb } from '../helpers/testDb.js';

vi.mock('../../../loadEnv.js', () => ({}));

let app;
let db;
let n = 0;
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
beforeEach(() => {
  resetDb(db);
  hooks.calls = 0;
  hooks.throwAt = 0;
  hooks.error = null;
  hooks.onYield = null;
});

const ip = () => `10.6.${Math.floor(n / 250)}.${(n += 1) % 250}`;
const run = (body) => request(app).post('/api/data/invoices/import').set('X-Forwarded-For', ip()).send(body);
const file1500 = () => `Status\n${'Draft\n'.repeat(1500)}`;
const numbers = () => select('invoices', { columns: ['number'], orderBy: [{ column: 'rowid' }], db }).map((r) => r.number);

describe('a batch that fails', () => {
  it('leaves the batches before it, says where to go on, and a resume adds the rest with no gap', async () => {
    hooks.throwAt = 1001;
    hooks.error = new TypeError('boom');
    const res = await run({ csv: file1500(), dryRun: false });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ added: 1000, complete: false, stoppedAt: 1002 });
    expect(res.body.data.lines).toEqual(['Added 1000 rows.', 'Nothing from row 1002 on was added. Import again from row 1002.']);
    expect(count('invoices', { db })).toBe(1000);
    hooks.throwAt = 0;
    const resume = await run({ csv: file1500(), dryRun: false, startAt: 1002 });
    expect(resume.body.data).toMatchObject({ rows: 500, added: 500, complete: true, stoppedAt: null });
    const all = numbers();
    expect(all).toHaveLength(1500);
    expect(all[0]).toBe('INV-1001');
    expect(all[1499]).toBe('INV-2500');
    expect(new Set(all).size).toBe(1500);
  });

  it('a dry run stops the same way and writes nothing', async () => {
    hooks.throwAt = 1001;
    hooks.error = new TypeError('boom');
    const res = await run({ csv: file1500() });
    expect(res.body.data).toMatchObject({ dryRun: true, valid: 1000, complete: false, stoppedAt: 1002 });
    expect(count('invoices', { db })).toBe(0);
  });

  it('a failure before any batch committed is the error envelope', async () => {
    hooks.throwAt = 1;
    hooks.error = new DbError('db_unavailable', 'gone');
    const res = await run({ csv: file1500(), dryRun: false });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('db_unavailable');
    expect(count('invoices', { db })).toBe(0);
  });
});

describe('a batch that fails after a committed batch is logged (phase 28 M1)', () => {
  it('logs the code and the batch number, never the message or a cell', async () => {
    hooks.throwAt = 1001;
    hooks.error = new TypeError('boom-secret-message');
    const failed = () => tail({ minLevel: 'error' }).filter((r) => r.event === 'runtime.import_batch_failed');
    const before = failed().length;
    const csv = `Status${'\nDraft'.repeat(1499)}\nCell-secret-value\n`;
    const res = await run({ csv, dryRun: false });
    expect(res.body.data).toMatchObject({ added: 1000, complete: false, stoppedAt: 1002 });
    const rows = failed();
    expect(rows).toHaveLength(before + 1);
    expect(rows.at(-1)).toMatchObject({ level: 'error', code: 'TypeError', batch: 2, committed: 2 });
    const text = JSON.stringify(rows.at(-1));
    expect(text).not.toMatch(/boom-secret-message|Cell-secret-value|Draft/);
  });
});

describe('a restore that begins during an import', () => {
  it('stops before the next batch with complete false and the row to go on from', async () => {
    let release = null;
    hooks.onYield = () => {
      hooks.onYield = null;
      release = tryAcquire('restore');
    };
    try {
      const res = await run({ csv: file1500(), dryRun: false });
      expect(res.body.data).toMatchObject({ added: 500, complete: false, stoppedAt: 502 });
      expect(count('invoices', { db })).toBe(500);
    } finally {
      release?.();
    }
    const resume = await run({ csv: file1500(), dryRun: false, startAt: 502 });
    expect(resume.body.data).toMatchObject({ added: 1000, complete: true });
    expect(new Set(numbers()).size).toBe(1500);
  });
});
