// Exit 4 belongs to the Studio preview child only, and never to the pre-migration backup step.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DbError, previewMigrationExitCode } from '../db/errors.js';
import { openDb } from '../db/index.js';
import { migrateApp } from '../db/migrate.js';

const CHILD = { APP_PREVIEW_CHILD: '1' };
const dirs = [];
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })));

describe('previewMigrationExitCode', () => {
  it('is 4 for a migration failure in the preview child', () => {
    expect(previewMigrationExitCode(new DbError('migration_failed', 'x'), CHILD)).toBe(4);
  });

  it('is null outside the preview child (the main server and built apps keep exit 1)', () => {
    expect(previewMigrationExitCode(new DbError('migration_failed', 'x'), {})).toBeNull();
    expect(previewMigrationExitCode(new DbError('migration_failed', 'x'), { APP_PREVIEW_CHILD: '0' })).toBeNull();
  });

  it('is null for other errors in the preview child', () => {
    expect(previewMigrationExitCode(new DbError('db_too_new', 'x'), CHILD)).toBeNull();
    expect(previewMigrationExitCode(new Error('x'), CHILD)).toBeNull();
  });

  it('is null when the pre-migration backup failed, using the real runner', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'las-exit-'));
    dirs.push(dir);
    const filename = path.join(dir, 'app.db');
    const db = openDb({ filename, migrate: false });
    const m1 = { version: 1, name: 'a', sql: 'CREATE TABLE t (id TEXT)', sha256: 'a'.repeat(64) };
    const m2 = { version: 2, name: 'b', sql: 'ALTER TABLE t ADD COLUMN n TEXT', sha256: 'b'.repeat(64) };
    migrateApp(db, { migrations: [m1], filename });
    // A folder where the backup file must go makes the backup step fail.
    fs.mkdirSync(`${filename}.pre-app-v2.bak`);
    fs.writeFileSync(path.join(`${filename}.pre-app-v2.bak`, 'keep'), 'x');
    let caught;
    try {
      migrateApp(db, { migrations: [m1, m2], filename });
    } catch (err) {
      caught = err;
    }
    db.close();
    expect(caught).toMatchObject({ code: 'migration_failed', step: 'backup' });
    expect(previewMigrationExitCode(caught, CHILD)).toBeNull();
  });

  it('is 4 when the migration SQL itself fails, using the real runner', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'las-exit-'));
    dirs.push(dir);
    const filename = path.join(dir, 'app.db');
    const db = openDb({ filename, migrate: false });
    let caught;
    try {
      migrateApp(db, { migrations: [{ version: 1, name: 'a', sql: 'NOT SQL', sha256: 'a'.repeat(64) }], filename });
    } catch (err) {
      caught = err;
    }
    db.close();
    expect(previewMigrationExitCode(caught, CHILD)).toBe(4);
  });
});
