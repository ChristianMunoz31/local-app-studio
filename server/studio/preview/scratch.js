// The preview child's folder: spec file, data folder and a chain of app-track migrations. Rows survive a restart and every
// table change a built app could take (the same planMigration path); a change it refuses clears the data and says why.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { takeSnapshot } from '../../backup/snapshot.js';
import { openDb } from '../../db/index.js';
import { compileSpec, planMigration } from '../../spec/compile.js';
import { previewRoot, scratchDirFor } from './paths.js';
import { STAMP_FILE } from './seed.js';

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const MAX_VERSION = 999;

/** The only entries Reset preview data removes, inside a scratch folder. */
export const RESETTABLE = Object.freeze(['data', 'app-migrations', 'preview-state.json', 'applied-spec.json', 'pending-spec.json']);

/** @typedef {{ kept: boolean, reason: 'first_start' | 'unchanged' | 'tables_updated' | 'tables_replaced' | 'repaired' | 'reset', seeded?: number }} PreviewData */
// `seeded` is added by the manager (not here) when an example's sample records were put in: how many (preview/seed.js).

/** JSON with sorted keys and undefined dropped (same output as the client's stableJson). */
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((v) => stableJson(v === undefined ? null : v)).join(',')}]`;
  if (value && typeof value === 'object') {
    const parts = Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`);
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const MAX_PENDING_BYTES = 2 * 1024 * 1024;

const readJson = (file, maxBytes = Number.POSITIVE_INFINITY) => {
  try {
    if (fs.statSync(file).size > maxBytes) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

const readSql = (file) => fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');

/** The folder's absolute path after checking it sits inside the root. */
function checkedBase(dir, rootDir) {
  const root = path.resolve(rootDir);
  const base = path.resolve(dir);
  if (!base.startsWith(root + path.sep)) throw new TypeError('Scratch folder is outside the preview root');
  return base;
}

const migrationName = (version) => `${String(version).padStart(3, '0')}_app.sql`;

/**
 * `files` must be a contiguous 001.. list, all on disk, and the lock must hold exactly those files with matching hashes.
 * One extra lock entry (the next file, matching its hash on disk) is a pending migration: written for a start that has not
 * become ready yet (state is only saved after ready), so the child may or may not have applied it.
 * @returns {{ pending: string | null, pendingHash: string | null } | null} null when the chain is not intact
 */
function chainStatus(migrationsDir, files) {
  if (!Array.isArray(files) || files.length === 0 || files.length >= MAX_VERSION) return null;
  const lock = readJson(path.join(migrationsDir, 'migrations.lock.json'));
  if (!lock || typeof lock !== 'object') return null;
  const sizes = Object.keys(lock).length;
  if (sizes !== files.length && sizes !== files.length + 1) return null;
  const matches = (name) => {
    try {
      return lock[name] === sha256(readSql(path.join(migrationsDir, name)));
    } catch {
      return false;
    }
  };
  if (!files.every((name, i) => name === migrationName(i + 1) && matches(name))) return null;
  if (sizes === files.length) return { pending: null, pendingHash: null };
  const next = migrationName(files.length + 1);
  return matches(next) ? { pending: next, pendingHash: lock[next] } : null;
}

/**
 * The highest app migration version recorded in the preview database (0 when there is no database or no record). Opened read
 * only. A database another process holds (busy or locked) throws before prepare writes or deletes anything, so the start fails
 * and can be retried; any other unreadable database counts as everything applied: the pending migration is then kept, and the
 * runner skips what is recorded.
 */
function appliedVersion(dataDir) {
  const file = path.join(dataDir, 'app.db');
  if (!fs.existsSync(file)) return 0;
  let db = null;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const row = db.prepare('SELECT MAX(version) AS v FROM app_schema_version').get();
    return typeof row?.v === 'number' ? row.v : 0;
  } catch (err) {
    if (/no such table/i.test(String(err?.message))) return 0;
    if (err?.errcode === 5 || err?.errcode === 6 || /database (table )?is (locked|busy)/i.test(String(err?.message))) {
      throw Object.assign(new Error('The preview database is in use by another process. Try starting the preview again.', { cause: err }), {
        previewUserMessage: true,
      });
    }
    return Number.POSITIVE_INFINITY;
  } finally {
    try {
      db?.close();
    } catch {
      // already closed
    }
  }
}

function writeChain(migrationsDir, entries) {
  fs.mkdirSync(migrationsDir, { recursive: true });
  const keep = new Set(entries.map(([name]) => name));
  for (const name of fs.readdirSync(migrationsDir)) if (name.endsWith('_app.sql') && !keep.has(name)) fs.rmSync(path.join(migrationsDir, name), { force: true });
  const lock = {};
  for (const [name, sql] of entries) {
    fs.writeFileSync(path.join(migrationsDir, name), sql);
    lock[name] = sha256(sql);
  }
  fs.writeFileSync(path.join(migrationsDir, 'migrations.lock.json'), JSON.stringify(lock));
}

/**
 * Writes the spec file and brings the data folder and the app-track migration chain in line with the spec's tables.
 * Call only while no child uses the folder.
 * @param {string} dir the app's scratch folder
 * @param {object} spec a checked spec
 * @param {string} [rootDir] the preview root the folder must sit in
 * @param {{ fresh?: boolean, reason?: 'reset' | 'repaired', deferCommit?: boolean }} [opts] `fresh` clears the data and
 *   starts the chain over; `deferCommit` holds back the state and applied-spec files of an appended migration until
 *   `commit()` (the caller commits once the child is ready, so a start that never got ready is planned again)
 * @returns {{ specPath: string, dataDir: string, appMigrationsDir: string, data: PreviewData, migrated: boolean, commit: () => void }}
 */
export function prepareScratch(dir, spec, rootDir = previewRoot(), opts = {}) {
  const base = checkedBase(dir, rootDir);
  const specPath = path.join(base, 'app-spec.json');
  const dataDir = path.join(base, 'data');
  const migrationsDir = path.join(base, 'app-migrations');
  const statePath = path.join(base, 'preview-state.json');
  const appliedPath = path.join(base, 'applied-spec.json');
  fs.mkdirSync(base, { recursive: true });

  const tablesHash = sha256(stableJson(spec.tables));
  const createSql = () => compileSpec(spec).createSql.replaceAll('\r\n', '\n');
  const pendingSpecPath = path.join(base, 'pending-spec.json');
  const stateExisted = fs.existsSync(statePath);
  let state = readJson(statePath);
  const status = state && state.v === 2 ? chainStatus(migrationsDir, state.files) : null;
  let v2 = status !== null;
  /** @type {'tables_replaced' | null} a pending migration the child applied but whose spec is lost: nothing to plan from */
  let lostPending = null;
  if (v2 && status.pending !== null && appliedVersion(dataDir) >= state.files.length + 1) {
    // The child applied the pending migration but never reported ready (timeout, cancel, kill). The database now holds it, so
    // it becomes part of the committed chain and every later plan starts from the spec it was written for.
    // Root cause of T21: any plain spec file used to pass here. The envelope ties the spec to the exact pending SQL (name and
    // hash), so a leftover, an interrupted write or a hand-edited file cannot advance the state to tables the database lacks.
    const p = readJson(pendingSpecPath, MAX_PENDING_BYTES);
    if (p?.v === 1 && p.file === status.pending && p.sha256 === status.pendingHash && Array.isArray(p.spec?.tables)) {
      fs.writeFileSync(appliedPath, JSON.stringify(p.spec));
      state = { v: 2, tablesHash: sha256(stableJson(p.spec.tables)), files: [...state.files, status.pending] };
      fs.writeFileSync(statePath, JSON.stringify(state));
    } else {
      v2 = false;
      lostPending = 'tables_replaced';
    }
  }

  /** @type {string[]} */
  let files = [];
  /** @type {Array<[string, string]> | null} */
  let entries = null;
  /** @type {PreviewData} */
  let data = { kept: false, reason: 'first_start' };
  let migrated = false;
  /** @type {string | null} the pending migration's envelope, written before the chain */
  let pendingJson = null;

  const startFresh = (reason) => {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    fs.rmSync(migrationsDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    entries = [['001_app.sql', createSql()]];
    files = ['001_app.sql'];
    data = { kept: false, reason };
  };

  if (opts.fresh) {
    startFresh(opts.reason ?? 'reset');
  } else if (v2 && state.tablesHash === tablesHash) {
    files = state.files;
    data = { kept: true, reason: 'unchanged' };
    // A leftover pending migration the child never applied no longer matches the tables: drop it from the chain.
    if (Object.keys(readJson(path.join(migrationsDir, 'migrations.lock.json')) ?? {}).length > files.length) {
      entries = files.map((name) => [name, readSql(path.join(migrationsDir, name))]);
    }
  } else if (v2) {
    const applied = readJson(appliedPath);
    const version = state.files.length + 1;
    const plan = applied && version <= MAX_VERSION ? planMigration(applied, spec, { version }) : null;
    if (plan && plan.ok) {
      files = [...state.files];
      if (plan.file) {
        entries = [...state.files.map((name) => [name, readSql(path.join(migrationsDir, name))]), [plan.file.name, plan.file.sql.replaceAll('\r\n', '\n')]];
        files.push(plan.file.name);
        migrated = true;
        pendingJson = JSON.stringify({ v: 1, file: plan.file.name, sha256: sha256(plan.file.sql.replaceAll('\r\n', '\n')), spec });
      }
      data = { kept: true, reason: 'tables_updated' };
    } else {
      startFresh('tables_replaced');
    }
  } else if (state && state.v === undefined && typeof state.tablesHash === 'string') {
    // Phase 9 state: the kept database was built from this create SQL when both hashes still match.
    const sql = createSql();
    if (state.tablesHash === tablesHash && state.createSqlHash === sha256(sql)) {
      entries = [['001_app.sql', sql]];
      files = ['001_app.sql'];
      data = { kept: true, reason: 'unchanged' };
    } else {
      startFresh('tables_replaced');
    }
  } else {
    startFresh(lostPending ?? (stateExisted ? 'tables_replaced' : 'first_start'));
  }

  // The pending file goes first: a crash between the two leaves an envelope that matches no lock entry, which is ignored.
  const deferred = opts.deferCommit === true && migrated;
  if (deferred && pendingJson) fs.writeFileSync(pendingSpecPath, pendingJson);
  else fs.rmSync(pendingSpecPath, { force: true });
  if (entries) writeChain(migrationsDir, entries);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(specPath, JSON.stringify(spec));
  const untouched = data.reason === 'unchanged' && v2 && fs.existsSync(appliedPath);
  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    if (!untouched) fs.writeFileSync(appliedPath, JSON.stringify(spec));
    if (!untouched || state.tablesHash !== tablesHash) fs.writeFileSync(statePath, JSON.stringify({ v: 2, tablesHash, files }));
    fs.rmSync(pendingSpecPath, { force: true });
  };
  if (!deferred) commit();
  return { specPath, dataDir, appMigrationsDir: migrationsDir, data, migrated, commit };
}

/**
 * Removes the RESETTABLE entries of one scratch folder. Call only while no child uses it.
 * @param {string} dir the app's scratch folder
 * @param {string} [rootDir] the preview root the folder must sit in
 */
export function resetScratch(dir, rootDir = previewRoot()) {
  const base = checkedBase(dir, rootDir);
  for (const name of RESETTABLE) fs.rmSync(path.join(base, name), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

/**
 * Copies one app's Preview records to another app's scratch folder (Duplicate with records): the source `data/app.db` through
 * VACUUM INTO into `app.db.partial` (the backup's own technique, safe while the source child runs), renamed into place, then
 * `app-migrations/`, `preview-state.json`, `applied-spec.json` and the sample stamp, so the copy's first start sees the same
 * tables hash and keeps the data. The counters of numbered fields ride inside the file. Call only for a copy that has never run.
 * @param {string} sourceAppId
 * @param {string} copyAppId
 * @param {string} [rootDir] the preview root both folders must sit in
 * @returns {boolean} false when the source has no Preview data
 */
export function copyPreviewData(sourceAppId, copyAppId, rootDir = previewRoot()) {
  const from = checkedBase(scratchDirFor(rootDir, sourceAppId), rootDir);
  const to = checkedBase(scratchDirFor(rootDir, copyAppId), rootDir);
  const sourceDb = path.join(from, 'data', 'app.db');
  if (!fs.existsSync(sourceDb)) return false;
  const dataDir = path.join(to, 'data');
  const partial = path.join(dataDir, 'app.db.partial');
  fs.mkdirSync(dataDir, { recursive: true });
  const db = openDb({ filename: sourceDb, migrate: false });
  try {
    takeSnapshot(db, partial);
  } finally {
    db.close();
  }
  for (const stale of ['app.db-wal', 'app.db-shm']) fs.rmSync(path.join(dataDir, stale), { force: true });
  fs.renameSync(partial, path.join(dataDir, 'app.db'));
  const migrations = path.join(from, 'app-migrations');
  if (fs.existsSync(migrations)) fs.cpSync(migrations, path.join(to, 'app-migrations'), { recursive: true });
  for (const name of ['preview-state.json', 'applied-spec.json']) {
    if (fs.existsSync(path.join(from, name))) fs.copyFileSync(path.join(from, name), path.join(to, name));
  }
  if (fs.existsSync(path.join(from, 'data', STAMP_FILE))) fs.copyFileSync(path.join(from, 'data', STAMP_FILE), path.join(dataDir, STAMP_FILE));
  return true;
}
