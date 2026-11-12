// A numbered field's counter across a backup restore and the ZIP importer (phase 28, section 2): a restore swaps the whole
// database file, so counter and rows always match; the ZIP import never lowers a counter (L4); a table id with digits is read (ENTRY_RE).
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Set before any import (a module reads the app mode and spec when it loads), so it must run synchronously: no dynamic import here.
vi.hoisted(() => {
  const fs = process.getBuiltinModule('node:fs');
  const os = process.getBuiltinModule('node:os');
  const path = process.getBuiltinModule('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'las-p28-'));
  const file = path.join(dir, 'app-spec.json');
  const spec = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'server', '__tests__', 'helpers', 'automationSpec.json'), 'utf8'));
  spec.tables.push({ id: 'q2_sales', label: 'Q2 sales', fields: [{ id: 'name', label: 'Name', type: 'text' }] });
  fs.writeFileSync(file, JSON.stringify(spec));
  process.env.APP_MODE = 'runtime';
  process.env.APP_SPEC_PATH = file;
  process.env.__TEST_SPEC_DIR = dir;
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { createRecord } from '@local-app-studio/runtime/server/write.js';
import { buildExportZip } from '../../export/buildArchive.js';
import { createBackup } from '../../backup/service.js';
import { restoreBackup } from '../../backup/restore.js';
import { count, getDb, insert, openDb, select } from '../../db/index.js';
import { importParsed, importZipBuffer, parseExportZip } from '../../import/importExport.js';
import { getAppSpec, getCompiledSpec } from '../../spec/source.js';
import { cleanupBackupEnv, day, resetBackupEnv, runBackupsOnMainThread } from '../helpers/backupEnv.js';

vi.mock('../../../loadEnv.js', () => ({}));

runBackupsOnMainThread();
beforeEach(() => {
  resetBackupEnv();
});
afterAll(() => {
  cleanupBackupEnv();
  fs.rmSync(process.env.__TEST_SPEC_DIR, { recursive: true, force: true });
  delete process.env.APP_MODE;
  delete process.env.APP_SPEC_PATH;
  delete process.env.__TEST_SPEC_DIR;
});

const add = (db) => {
  const w = createRecord({ compiled: getCompiledSpec(), spec: getAppSpec(), table: 'invoices', body: {}, ...(db ? { db } : {}) });
  return w.row.number;
};
const counterOf = (db) => select('app_state', { where: { key: 'autonumber.invoices.number' }, db })[0]?.value?.last;

describe('backup restore', () => {
  it('the next number is above the restored rows, because the counter is in the same file', async () => {
    add();
    add();
    const backup = (await createBackup({ kind: 'manual', now: day(1) })).meta;
    add();
    add();
    expect(count('invoices')).toBe(4);
    await restoreBackup({ id: backup.id, now: day(2) });
    expect(count('invoices')).toBe(2);
    expect(counterOf()).toBe(1002);
    expect(add()).toBe('INV-1003');
  });
});

describe('ZIP import', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'las-p28-zip-'));

  it('into a fresh database sets the counter from the imported rows', async () => {
    add();
    add();
    add();
    const { zip } = await buildExportZip({ db: getDb(), now: new Date(), tables: ['clients', 'invoices'] });
    const dir = tmp();
    const fresh = openDb({ filename: path.join(dir, 'fresh.db') });
    try {
      importZipBuffer(zip, { db: fresh });
      expect(count('invoices', { db: fresh })).toBe(3);
      expect(counterOf(fresh)).toBe(1003);
      expect(add(fresh)).toBe('INV-1004');
    } finally {
      fresh.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const parsedWith = (last) => ({
    format: 'local-app-studio-export',
    formatVersion: 1,
    manifest: {},
    ignored: [],
    tables: new Map([['app_state', [{ key: 'autonumber.invoices.number', value: { last }, updated_at: new Date().toISOString() }]]]),
  });

  it('L4: a counter lower than the database is kept, a higher one raises it', () => {
    add();
    add();
    importParsed(parsedWith(1), {});
    expect(counterOf()).toBe(1002);
    importParsed(parsedWith(9000), {});
    expect(counterOf()).toBe(9000);
    expect(add()).toBe('INV-9001');
  });

  it('a dry run changes no counter', () => {
    add();
    importParsed(parsedWith(9000), { dryRun: true });
    expect(counterOf()).toBe(1001);
  });

  it('reads the file of a table id with digits', () => {
    insert('q2_sales', { name: 'a' });
    const zip = zipSync({
      'manifest.json': strToU8(JSON.stringify({ format: 'local-app-studio-export', formatVersion: 1, tables: [{ id: 'q2_sales' }] })),
      'json/q2_sales.json': strToU8(JSON.stringify([{ id: 'one', name: 'a' }])),
    });
    const parsed = parseExportZip(zip);
    expect(parsed.ignored).toEqual([]);
    expect(parsed.tables.get('q2_sales')).toHaveLength(1);
  });
});
