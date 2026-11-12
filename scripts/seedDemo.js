// Generic, fictional demo data: the two demo features (docs/FEATURES.md) as studio_features rows, so the
// Features page is populated in the sandbox, in screenshots and in tests. Deterministic (dates
// relative to `now`), no personal data.
//
// Every write timestamp (created_at, updated_at) is clamped to the seed clock (now), so the seed
// never writes the future.
//
// CLI: node scripts/seedDemo.js --data-dir <dir> [--app-dir <dir>] [--force] [--now <iso>]
// The data dir must be inside the OS temp dir (never the real data dir). When --app-dir is a
// different checkout, its modules are imported by a child process with a minimal env and a fake
// home under the data dir, never in this process.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SEED_FEATURES } from '../src/catalog/features/index.ts';
import { assertSafeDataDir, assertUnderTmp, buildChildEnv, samePath, sandboxHomeFor } from './lib/sandboxSafety.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HISTORY_DAYS = 60;

/**
 * Inserts the demo data set.
 * @param {{ insert: (table: string, row: object) => object, now?: Date }} deps
 *   `now` is injectable (tests); the default is the wall clock at the start of the run.
 * @returns {Promise<{ counts: Record<string, number> }>}
 */
export async function seedDemo({ insert, now = new Date() }) {
  const counts = {};
  const add = (table, row) => {
    counts[table] = (counts[table] ?? 0) + 1;
    return insert(table, row);
  };

  // Past activity: never later than now.
  const stamp = (offsetDays, hour = 12, minute = 0) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays, hour, minute, 0, 0);
    return (d.getTime() > now.getTime() ? now : d).toISOString();
  };

  // ---------------- features (studio_features) ----------------
  SEED_FEATURES.forEach((f, i) => {
    const at = stamp(-HISTORY_DAYS + i, 10);
    add('studio_features', {
      id: f.id,
      label: f.label,
      description: f.description,
      version: 1,
      body: { params: f.params, fragment: f.fragment, bindings: f.bindings },
      created_at: at,
      updated_at: at,
    });
  });

  // ---------------- profile (app_state) ----------------
  add('app_state', { key: 'profile', value: { displayName: 'Demo', onboardedAt: stamp(-HISTORY_DAYS) }, updated_at: stamp(0, 0) });

  return { counts };
}

// ---------------- CLI ----------------
// --now is a test seam (fixed clock for the demo data); the default is the real clock.
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?$/;

function parseNow(value) {
  const text = value ?? '';
  const d = new Date(text);
  if (!ISO_DATE_TIME.test(text) || Number.isNaN(d.getTime())) {
    throw new Error('--now needs an ISO 8601 date-time such as 2026-06-15T09:00:00Z.');
  }
  if (d.getTime() > Date.now()) throw new Error('--now must not be in the future.');
  return d;
}

function parseArgs(argv) {
  const out = { dataDir: '', appDir: '', force: false, child: false, now: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--data-dir') out.dataDir = argv[(i += 1)] ?? '';
    else if (argv[i] === '--app-dir') out.appDir = argv[(i += 1)] ?? '';
    else if (argv[i] === '--now') out.now = parseNow(argv[(i += 1)]);
    else if (argv[i] === '--force') out.force = true;
    else if (argv[i] === '--child') out.child = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dataDir) throw new Error('Usage: node scripts/seedDemo.js --data-dir <dir> [--app-dir <dir>] [--force] [--now <iso>]');
  // The child runs with a fake APPDATA, so the real-dir check is made once, by the parent.
  const dataDir = args.child ? path.resolve(assertUnderTmp(args.dataDir)) : assertSafeDataDir(args.dataDir);
  const appDir = path.resolve(args.appDir || REPO_ROOT);
  if (!args.child && !samePath(appDir, REPO_ROOT)) {
    const childArgs = [fileURLToPath(import.meta.url), '--data-dir', dataDir, '--app-dir', appDir, '--child'];
    if (args.force) childArgs.push('--force');
    if (args.now) childArgs.push('--now', args.now.toISOString());
    const env = buildChildEnv({
      homeDir: sandboxHomeFor(dataDir),
      extra: { APP_DATA_DIR: dataDir, APP_SCHEDULER: '0', APP_NO_DOTENV: '1' },
    });
    const res = spawnSync(process.execPath, childArgs, { cwd: REPO_ROOT, env, stdio: 'inherit', shell: false });
    if (res.status !== 0) throw new Error(`Seeding in the child process failed (exit ${res.status ?? 'signal'}).`);
    return;
  }
  process.env.APP_DATA_DIR = dataDir;
  process.env.APP_SCHEDULER = '0';
  process.env.APP_NO_DOTENV = '1';
  fs.mkdirSync(dataDir, { recursive: true });
  if (args.force) {
    for (const f of ['app.db', 'app.db-wal', 'app.db-shm']) fs.rmSync(path.join(dataDir, f), { force: true });
  }
  const db = await import(pathToFileURL(path.join(appDir, 'server', 'db', 'index.js')).href);
  try {
    const existing = db.IMPORT_ORDER.filter((t) => db.count(t) > 0);
    if (existing.length > 0) {
      throw new Error(`Refusing to seed a database that already has data (${existing.join(', ')}). Use --force.`);
    }
    const { counts } = await seedDemo({ insert: db.insert, now: args.now ?? new Date() });
    console.log(`Seeded demo data into ${path.join(dataDir, 'app.db')}`);
    console.log(JSON.stringify(counts));
  } finally {
    db.closeDb();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
