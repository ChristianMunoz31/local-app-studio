// Pure export-archive core: reads the exportable tables through a DatabaseSync handle and builds the
// ZIP (per-table JSON + CSV, manifest). No express, audit or
// getDb: POST /api/export (server/exportRoutes.js) and the backup worker thread
// (server/backup/worker/backupWorker.js) both import it. Tables come ONLY from the
// allowlist (DATA_TABLES) minus EXPORT_DENY; app_state rows are scrubbed by server/redact.js.
// No env values or credentials are ever written.
import { createRequire } from 'node:module';
import { zipSync, strToU8 } from 'fflate';
import { op, select } from '../db/query.js';
import { BUNDLED_APP_VERSION } from '../runtime.js';
import { DATA_TABLES } from '../dataTables.js';
import { WAITING_KEY_PREFIX } from '../waitingKey.js';
import { HIDDEN_APP_STATE_KEYS, redactAppStateRow } from '../redact.js';
import { toCsv } from './csv.js';

const yieldToLoop = () => new Promise((resolve) => setImmediate(resolve));

let cachedVersion;
/** Reads the app version lazily so a missing package.json can never break module load. */
function getAppVersion() {
  if (cachedVersion !== undefined) return cachedVersion;
  try {
    cachedVersion = BUNDLED_APP_VERSION ?? String(createRequire(import.meta.url)('../../package.json').version);
  } catch {
    cachedVersion = 'unknown';
  }
  return cachedVersion;
}

export const EXPORT_PAGE_SIZE = 1000;
export const EXPORT_MAX_ROWS_PER_TABLE = 50_000;
export const EXPORT_MAX_ZIP_BYTES = 48 * 1024 * 1024;
export const EXPORT_MAX_RAW_BYTES = 48 * 1024 * 1024;
// Upper bound on one build, not a platform limit.
export const EXPORT_DEADLINE_MS = 120_000;
export const EXPORT_CONCURRENCY = 4;
export const EXPORT_MAX_TABLES_PER_REQUEST = 20;
// Defense in depth on top of the DATA_TABLES allowlist: never exportable, whatever a def says.
export const EXPORT_DENY = new Set(['app_secrets', 'audit_log']);
// app_state rows never exported: the license activation holds the buyer's email and is useless on another computer.
export const EXPORT_SKIP_APP_STATE_KEYS = HIDDEN_APP_STATE_KEYS;

const EXCLUDED = ['app_secrets', 'audit_log', 'device-only settings stored in this browser'];
const REDACTION_NOTE =
  'Only app_state settings are scrubbed (sensitive keys and token-like values become [redacted]). ' +
  'Saved API keys (app_secrets) are never included. Assistant chat content is exported as-is.';

const MARKDOWN_RENDERERS = Object.freeze({});

class ExportTooLargeError extends Error {
  constructor() {
    super('export_too_large');
    this.code = 'export_too_large';
  }
}

const cutOff = (rows) => ({ rows, status: 'skipped_deadline', truncated: true });

/**
 * Reads one table in keyset pages on its single text-like primary key (plain binary order).
 * Stops only on an empty page, the row cap, or the deadline. Every page is charged to the
 * shared raw-bytes budget; going over it throws ExportTooLargeError, the only throw.
 * @returns {Promise<{ rows: object[], status: string, truncated: boolean, code?: string }>}
 */
async function collectTable(db, def, { deadline, maxRows, signal, budget }) {
  const columns = def.columns.map((c) => c.name);
  const rows = [];
  let lastPk;
  let ended = false;
  while (rows.length < maxRows) {
    if (deadline - Date.now() <= 0 || signal.aborted) return cutOff(rows);
    const size = Math.min(EXPORT_PAGE_SIZE, maxRows - rows.length);
    let chunk;
    try {
      const where = lastPk === undefined ? undefined : { [def.primaryKey]: op.gt(lastPk) };
      chunk = select(def.id, { columns, where, orderBy: [{ column: def.primaryKey, dir: 'asc' }], limit: size, db });
    } catch (e) {
      return { rows: [], status: 'error', truncated: false, code: e?.code };
    }
    if (chunk.length === 0) {
      ended = true;
      break;
    }
    rows.push(...chunk);
    budget.used += JSON.stringify(chunk).length;
    if (budget.used > budget.max) throw new ExportTooLargeError();
    lastPk = chunk[chunk.length - 1][def.primaryKey];
    // Let close/abort events fire between pages.
    await yieldToLoop();
  }
  // Cap reached without seeing an empty page: more rows may exist.
  return { rows, status: 'ok', truncated: !ended && rows.length >= maxRows };
}

/**
 * Builds the export ZIP.
 * @param {{ db: import('node:sqlite').DatabaseSync, now?: Date, deadlineMs?: number, maxZipBytes?: number, maxRawBytes?: number,
 *   maxRowsPerTable?: number, tables?: string[] | null, defs?: ReadonlyArray<object>,
 *   signal?: AbortSignal }} opts signal aborts the build (client disconnect)
 * @returns {Promise<{ zip: Uint8Array, manifest: object }>} rejects with code 'export_too_large' over a size
 *   cap and 'export_aborted' when the signal fires
 */
export async function buildExportZip({
  db,
  now = new Date(),
  deadlineMs = EXPORT_DEADLINE_MS,
  maxZipBytes = EXPORT_MAX_ZIP_BYTES,
  maxRawBytes = EXPORT_MAX_RAW_BYTES,
  maxRowsPerTable = EXPORT_MAX_ROWS_PER_TABLE,
  tables: subset = null,
  defs = DATA_TABLES,
  signal: externalSignal,
}) {
  const wanted = subset ? new Set(subset) : null;
  const selected = defs.filter((d) => !EXPORT_DENY.has(d.id) && (!wanted || wanted.has(d.id)));
  const deadline = Date.now() + deadlineMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(deadlineMs, 0));
  timer.unref?.();

  const results = new Array(selected.length);
  const budget = { used: 0, max: maxRawBytes };
  let halted = false;
  let externallyAborted = false;
  const onExternalAbort = () => {
    externallyAborted = true;
    halted = true;
    controller.abort();
  };
  if (externalSignal?.aborted) onExternalAbort();
  else externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

  const processTable = async (def) => {
    const collected = await collectTable(db, def, {
      deadline,
      maxRows: maxRowsPerTable,
      signal: controller.signal,
      budget,
    });
    // Another lane failed or the caller left: do not serialize partial rows.
    if (halted) return null;
    if (collected.status === 'error') console.error('Export table error:', def.id, collected.code ?? 'unknown');
    // `studio.waiting.*` rows are not exported either (an unsaved design belongs to no app after an import; see the import).
    const rows =
      def.redact === 'app_state'
        ? collected.rows.filter((r) => !EXPORT_SKIP_APP_STATE_KEYS.has(r?.key) && !(typeof r?.key === 'string' && r.key.startsWith(WAITING_KEY_PREFIX))).map(redactAppStateRow)
        : collected.rows;
    const json = strToU8(JSON.stringify(rows));
    const csv = strToU8(toCsv(def.columns, rows));
    // JSON size was charged per page; add the CSV copy.
    budget.used += csv.length;
    if (budget.used > budget.max) throw new ExportTooLargeError();
    const render = Object.hasOwn(MARKDOWN_RENDERERS, def.id) ? MARKDOWN_RENDERERS[def.id] : null;
    const markdown = render
      ? rows.map((r) => {
          const m = render(r);
          const data = strToU8(m.content);
          budget.used += data.length;
          return { path: m.path, data };
        })
      : [];
    if (budget.used > budget.max) throw new ExportTooLargeError();
    return { def, rows: rows.length, status: collected.status, truncated: collected.truncated, json, csv, markdown };
  };

  let next = 0;
  const lane = async () => {
    while (!halted) {
      const i = next;
      next += 1;
      if (i >= selected.length) return;
      try {
        results[i] = await processTable(selected[i]);
      } catch (e) {
        halted = true;
        controller.abort();
        throw e;
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(EXPORT_CONCURRENCY, selected.length) }, lane));
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
  if (externallyAborted) throw Object.assign(new Error('export_aborted'), { code: 'export_aborted' });

  const files = {};
  const tableEntries = [];
  const markdownCounts = {};
  let totalRows = 0;
  for (const r of results) {
    for (const m of r.markdown) files[m.path] = m.data;
    if (Object.hasOwn(markdownCounts, r.def.id)) markdownCounts[r.def.id] = r.markdown.length;
    const jsonPath = `json/${r.def.id}.json`;
    const csvPath = `csv/${r.def.id}.csv`;
    files[jsonPath] = r.json;
    files[csvPath] = r.csv;
    totalRows += r.rows;
    tableEntries.push({
      id: r.def.id,
      label: r.def.label,
      rows: r.rows,
      status: r.status,
      truncated: r.truncated,
      files: [jsonPath, csvPath],
    });
  }

  const complete = tableEntries.every((t) => t.status === 'ok' && !t.truncated);
  const manifest = {
    format: 'local-app-studio-export',
    formatVersion: 1,
    exportedAt: now.toISOString(),
    appVersion: getAppVersion(),
    complete,
    tables: tableEntries,
    totals: { tables: tableEntries.length, rows: totalRows },
    markdown: { dir: 'markdown/', ...markdownCounts },
    excluded: EXCLUDED,
    redaction: REDACTION_NOTE,
  };
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));

  const zip = zipSync(files, { level: 6 });
  if (zip.length > maxZipBytes) throw new ExportTooLargeError();
  return { zip, manifest };
}
