// The Preview seeder and a numbered field (phase 28): the app numbers its own records and refuses a number in the body, so
// seedSample never sends the numbered field and the example's records get numbers from the app.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Set before any import (a module reads the app mode and spec when it loads), so it must run synchronously.
vi.hoisted(() => {
  const fs = process.getBuiltinModule('node:fs');
  const os = process.getBuiltinModule('node:os');
  const path = process.getBuiltinModule('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'las-p28-'));
  const file = path.join(dir, 'app-spec.json');
  fs.copyFileSync(path.join(process.cwd(), 'server', '__tests__', 'helpers', 'automationSpec.json'), file);
  process.env.APP_MODE = 'runtime';
  process.env.APP_SPEC_PATH = file;
  process.env.__TEST_SPEC_DIR = dir;
});

import fs from 'node:fs';
import http from 'node:http';
import { closeTestDb, createTestDb, resetDb, rowsOf } from '../helpers/testDb.js';
import { seedSample } from '../../studio/preview/seed.js';

vi.mock('../../../loadEnv.js', () => ({}));

let db;
let server;
let port;
let spec;
const savedPw = { APP_PASSWORD: process.env.APP_PASSWORD, AUTH_SECRET: process.env.AUTH_SECRET };

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  delete process.env.AUTH_SECRET;
  db = createTestDb();
  spec = JSON.parse(fs.readFileSync(process.env.APP_SPEC_PATH, 'utf8'));
  const app = (await import('../../../server.js')).default;
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  closeTestDb(db);
  fs.rmSync(process.env.__TEST_SPEC_DIR, { recursive: true, force: true });
  delete process.env.APP_MODE;
  delete process.env.APP_SPEC_PATH;
  delete process.env.__TEST_SPEC_DIR;
  for (const [k, v] of Object.entries(savedPw)) if (v !== undefined) process.env[k] = v;
});
beforeEach(() => resetDb(db));

describe('seedSample with a numbered field', () => {
  it('drops a number in the sample row and lets the app number the records', async () => {
    const sample = {
      v: 1,
      tables: {
        clients: [{ _id: 'k1', name: 'Acme' }],
        invoices: [
          { client_id: 'k1', number: 'INV-OLD-1', total: 5 },
          { client_id: 'k1', total: 6 },
        ],
      },
    };
    const result = await seedSample({ port, cookie: 'unused', spec, sample, today: new Date(2026, 5, 15, 12) });
    expect(result).toMatchObject({ created: 3, skipped: 0, aborted: false });
    expect(rowsOf(db, 'invoices').map((r) => r.number)).toEqual(['INV-1001', 'INV-1002']);
  });
});
