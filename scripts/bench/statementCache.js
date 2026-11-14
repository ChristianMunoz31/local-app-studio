// Times typical query.js calls (insert, get by id, list with a filter) with the prepared statement cache on and off.
// Usage: node scripts/bench/statementCache.js [--n N]   (default 5000 rounds, each round runs the three calls)
// Safety: the database is a fresh fs.mkdtemp folder inside os.tmpdir() (checked with scripts/lib/sandboxSafety.js) and
// is removed at the end; the real data folder is never opened.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertSafeDataDir, assertUnderTmp } from '../lib/sandboxSafety.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const nIdx = argv.indexOf('--n');
const ROUNDS = nIdx === -1 ? 5_000 : Number(argv[nIdx + 1]);
if (!Number.isInteger(ROUNDS) || ROUNDS < 1) throw new Error('--n needs a positive integer');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-app-studio-bench-'));
assertSafeDataDir(dataDir);
assertUnderTmp(dataDir);
process.env.APP_DATA_DIR = dataDir;
process.env.APP_NO_DOTENV = '1';
delete process.env.VITEST;

const srv = (rel) => import(pathToFileURL(path.join(ROOT, 'server', rel)).href);

try {
  const { openDb, insert, selectOne, select } = await srv('db/index.js');
  const { setStatementCacheEnabled } = await srv('db/statementCache.js');
  const db = openDb({ filename: path.join(dataDir, 'bench.db') });
  // Messages of one conversation: the list filter uses the (conversation_id, created_at) index, so the timing is not
  // dominated by a table scan that grows with every insert.
  const table = 'assistant_messages';
  const conv = insert('assistant_conversations', { title: 'bench' }, { db }).id;

  const ids = [];
  const round = (i) => {
    const row = insert(table, { conversation_id: conv, role: 'user', content: `row ${i}` }, { db });
    if (ids.length < 200) ids.push(row.id);
    selectOne(table, { where: { id: row.id }, db });
    select(table, { where: { conversation_id: conv }, orderBy: [{ column: 'created_at', dir: 'desc' }], limit: 20, db });
  };

  // Reads only: get by id and a filtered list on the rows written above. Each insert above is its own WAL commit,
  // whose cost hides the prepare cost; the read pass shows what the cache changes on the hot read path.
  const readRound = (i) => {
    selectOne(table, { where: { id: ids[i % ids.length] }, db });
    select(table, { where: { conversation_id: conv }, orderBy: [{ column: 'created_at', dir: 'desc' }], limit: 20, db });
  };

  const time = (cacheOn, fn, calls) => {
    setStatementCacheEnabled(cacheOn);
    for (let i = 0; i < 500; i += 1) fn(i); // warm up
    const t0 = performance.now();
    for (let i = 0; i < ROUNDS; i += 1) fn(i);
    const ms = performance.now() - t0;
    return { ms, opsPerSec: Math.round((ROUNDS * calls * 1000) / ms) };
  };

  // Alternate so table growth and drift hit both settings: off, on, off, on.
  const run = (fn, calls) => {
    const off = [time(false, fn, calls)];
    const on = [time(true, fn, calls)];
    off.push(time(false, fn, calls));
    on.push(time(true, fn, calls));
    return { off, on };
  };
  const mixed = run(round, 3);
  const reads = run(readRound, 2);
  setStatementCacheEnabled(true);
  db.close();

  const fmt = (label, r) => `${label.padEnd(10)} ${String(r.opsPerSec).padStart(8)} ops/s  (${r.ms.toFixed(0)} ms)`;
  const avg = (rs) => rs.reduce((n, r) => n + r.opsPerSec, 0) / rs.length;
  console.log(`${ROUNDS} rounds, ${os.cpus()[0]?.model ?? 'cpu'}, node ${process.version}`);
  for (const [name, r] of [
    ['mixed (insert, get by id, filtered list)', mixed],
    ['reads (get by id, filtered list)', reads],
  ]) {
    console.log(name);
    for (let i = 0; i < 2; i += 1) {
      console.log(fmt('cache off', r.off[i]));
      console.log(fmt('cache on', r.on[i]));
    }
    console.log(`mean ops/s: off ${Math.round(avg(r.off))}, on ${Math.round(avg(r.on))}, ratio x${(avg(r.on) / avg(r.off)).toFixed(2)}`);
  }
} finally {
  // Best effort: a handle left open by a failed run must not hide the real error.
  try {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  } catch (err) {
    console.error(`could not remove ${dataDir}: ${err.code ?? err.message}`);
  }
}
