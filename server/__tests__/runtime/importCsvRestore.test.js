// A real backup restore that begins while a CSV import runs (phase 28, M2): the import stops before its next batch, so the
// restore's drain wait ends, and the restored database holds exactly the backup's rows. The lock-only test of
// importCsvBatches.test.js keeps covering the stop on its own; this one runs the backup service end to end.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Set before any import (a module reads the app mode and spec when it loads), so it must run synchronously: no dynamic import here.
vi.hoisted(() => {
  const fs = process.getBuiltinModule('node:fs');
  const os = process.getBuiltinModule('node:os');
  const path = process.getBuiltinModule('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'las-p28r-'));
  const file = path.join(dir, 'app-spec.json');
  const spec = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'server', '__tests__', 'helpers', 'automationSpec.json'), 'utf8'));
  fs.writeFileSync(file, JSON.stringify(spec));
  process.env.APP_MODE = 'runtime';
  process.env.APP_SPEC_PATH = file;
  process.env.__TEST_SPEC_DIR = dir;
});

const hooks = vi.hoisted(() => ({ onYield: null }));
vi.mock('../../db/index.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    yieldToLoop: async () => {
      const once = hooks.onYield;
      hooks.onYield = null;
      once?.();
      return real.yieldToLoop();
    },
  };
});

import fs from 'node:fs';
import request from 'supertest';
import { createBackup } from '../../backup/service.js';
import { currentOp, inFlightCount, isGateClosed } from '../../backup/lock.js';
import { restoreBackup } from '../../backup/restore.js';
import { getDb, select } from '../../db/index.js';
import { cleanupBackupEnv, day, resetBackupEnv, runBackupsOnMainThread } from '../helpers/backupEnv.js';

vi.mock('../../../loadEnv.js', () => ({}));

runBackupsOnMainThread();

let app;
const savedPw = { APP_PASSWORD: process.env.APP_PASSWORD, AUTH_SECRET: process.env.AUTH_SECRET };

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  delete process.env.AUTH_SECRET;
  app = (await import('../../../server.js')).default;
});
afterAll(() => {
  cleanupBackupEnv();
  fs.rmSync(process.env.__TEST_SPEC_DIR, { recursive: true, force: true });
  delete process.env.APP_MODE;
  delete process.env.APP_SPEC_PATH;
  delete process.env.__TEST_SPEC_DIR;
  for (const [k, v] of Object.entries(savedPw)) if (v !== undefined) process.env[k] = v;
});
beforeEach(() => {
  resetBackupEnv();
  hooks.onYield = null;
});

const file1500 = () => `Status\n${'Draft\n'.repeat(1500)}`;
const invoiceRows = () => select('invoices', { orderBy: [{ column: 'rowid' }] }).map((r) => ({ id: r.id, status: r.status, number: r.number ?? null }));

describe('a restore that begins during a CSV import', () => {
  it('stops the import before its next batch, lets the restore drain, and leaves exactly the backup rows', async () => {
    for (const status of ['Sent', 'Paid']) {
      expect((await request(app).post('/api/data/invoices').set('X-Forwarded-For', '10.9.0.2').send({ status })).status).toBe(201);
    }
    const backup = (await createBackup({ kind: 'manual', now: day(1) })).meta;
    const backupRows = invoiceRows();
    expect(backupRows.map((r) => r.status)).toEqual(['Sent', 'Paid']);

    let restoring = null;
    const seen = { op: null, inFlight: null };
    hooks.onYield = () => {
      // The import's own request is counted until it answers; the restore starts now and has to wait for it (waitForDrain).
      seen.inFlight = inFlightCount();
      restoring = restoreBackup({ id: backup.id, now: day(2) });
      seen.op = currentOp();
    };
    const res = await request(app).post('/api/data/invoices/import').set('X-Forwarded-For', '10.9.0.1').send({ csv: file1500(), dryRun: false });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ added: 500, complete: false, stoppedAt: 502 });
    expect(seen).toEqual({ op: 'restore', inFlight: 1 });
    expect(restoring).not.toBeNull();

    // The restore could only close the gate and swap the file once the import's request had finished.
    const result = await restoring;
    expect(result).toMatchObject({ restoredFrom: backup.id });
    expect(inFlightCount()).toBe(0);
    expect(isGateClosed()).toBe(false);
    expect(currentOp()).toBeNull();
    expect(getDb().prepare('PRAGMA integrity_check').all().map((r) => r.integrity_check)).toEqual(['ok']);
    expect(invoiceRows()).toEqual(backupRows);
  });
});
