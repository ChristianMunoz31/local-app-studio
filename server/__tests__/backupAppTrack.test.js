// Backup inspection of a runtime database: the expected schema shape follows the app-track version the backup recorded
// (a backup taken before an app update is still a valid, restorable file), and the spec tables are counted.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { compileSpec } from '../spec/compile.js';

const specJson = fs.readFileSync(new URL('../../packages/runtime/src/spec/fixtures/crew-roster.json', import.meta.url), 'utf8');
const saved = { APP_MODE: process.env.APP_MODE, APP_SPEC_PATH: process.env.APP_SPEC_PATH, APP_SPEC_MIGRATIONS_DIR: process.env.APP_SPEC_MIGRATIONS_DIR };

let root;
let migrate;
let inspectDbFile;
let runBackupOp;
beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'las-backup-app-'));
  const migrations = path.join(root, 'migrations');
  fs.mkdirSync(migrations);
  const createSql = compileSpec(JSON.parse(specJson)).createSql;
  fs.writeFileSync(path.join(migrations, '001_app.sql'), createSql);
  fs.writeFileSync(path.join(migrations, '002_app.sql'), 'ALTER TABLE crews ADD COLUMN note TEXT;\n');
  fs.writeFileSync(path.join(root, 'app-spec.json'), specJson);
  process.env.APP_MODE = 'runtime';
  process.env.APP_SPEC_PATH = path.join(root, 'app-spec.json');
  process.env.APP_SPEC_MIGRATIONS_DIR = migrations;
  vi.resetModules();
  ({ migrate } = await import('../db/migrate.js'));
  ({ inspectDbFile } = await import('../backup/snapshot.js'));
  ({ runBackupOp } = await import('../backup/worker/client.js'));
});
afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  } catch {
    /* Windows EBUSY: leak tmp */
  }
});

function makeFile(name, appVersion) {
  const file = path.join(root, name);
  const db = new DatabaseSync(file);
  try {
    migrate(db, appVersion === undefined ? {} : { appVersion });
  } finally {
    db.close();
  }
  return file;
}

describe('inspectDbFile on a runtime database', () => {
  it('accepts a backup taken at an older app-track version', () => {
    const info = inspectDbFile(makeFile('v1.db', 1));
    expect(info).toMatchObject({ integrityOk: true, shapeOk: true });
    expect(info.rowCounts).toHaveProperty('crews', 0);
  });

  it('accepts a backup at the latest app-track version', () => {
    expect(inspectDbFile(makeFile('v2.db')).shapeOk).toBe(true);
  });

  it('reports shapeOk null (not false) for a backup whose app-track version is newer than this build', () => {
    const file = makeFile('newer.db');
    const db = new DatabaseSync(file);
    db.exec("INSERT INTO app_schema_version (version, name, sha256, applied_at) VALUES (3, 'future', 'x', '2099-01-01T00:00:00.000Z')");
    db.close();
    expect(inspectDbFile(file)).toMatchObject({ integrityOk: true, shapeOk: null });
  });

  it('still rejects a file whose objects do not match the version it records', () => {
    const file = makeFile('extra.db', 1);
    const db = new DatabaseSync(file);
    db.exec('ALTER TABLE crews ADD COLUMN note TEXT'); // the schema of version 2 under a version 1 record
    db.close();
    expect(inspectDbFile(file).shapeOk).toBe(false);
  });
});

describe('the backup worker thread', () => {
  it('sees the spec tables through the environment the client forwards (unbundled, as in the preview child)', async () => {
    const dbPath = makeFile('worker.db', 1);
    const out = await runBackupOp('snapshotInspect', { dbPath, partialPath: path.join(root, 'worker.partial'), latestVersion: 99 });
    expect(out).toMatchObject({ integrityOk: true, shapeOk: true });
    expect(out.rowCounts).toHaveProperty('crews', 0);
  });
});
