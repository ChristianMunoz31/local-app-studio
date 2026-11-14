// POST /api/export: one ZIP with per-table JSON + CSV, Markdown for item notes,
// and a manifest. Registered behind the auth gate in server.js. The archive itself is built by
// server/export/buildArchive.js (shared with the backup worker); this file is the route, limiter and audit.
import express from 'express';
import rateLimit from 'express-rate-limit';
import { getDb } from './db/index.js';
import { limiterHandler, sendError } from './errors.js';
import { DATA_TABLES } from './dataTables.js';
import { makeRequireSignIn } from './export/access.js';
import { recordAudit } from './auditHook.js';
import { csvHeader, csvRows } from './export/csv.js';
import {
  buildExportZip,
  exceedsRowCap,
  exportableRows,
  readTablePages,
  EXPORT_DENY,
  EXPORT_MAX_ROWS_PER_TABLE,
  EXPORT_MAX_ZIP_BYTES,
  EXPORT_MAX_RAW_BYTES,
  EXPORT_PAGE_SIZE,
  EXPORT_DEADLINE_MS,
  EXPORT_CONCURRENCY,
  EXPORT_MAX_TABLES_PER_REQUEST,
} from './export/buildArchive.js';

export {
  buildExportZip,
  EXPORT_DENY,
  EXPORT_MAX_ROWS_PER_TABLE,
  EXPORT_MAX_ZIP_BYTES,
  EXPORT_MAX_RAW_BYTES,
  EXPORT_PAGE_SIZE,
  EXPORT_DEADLINE_MS,
  EXPORT_CONCURRENCY,
  EXPORT_MAX_TABLES_PER_REQUEST,
};

const EXPORT_MAX_INPUT_TABLES = 64;

const send = (res, status, code, error, extra = {}) => sendError(res, code, { status, message: error, extra });
const auditFailure = (meta = { tables: 0, rows: 0, bytes: 0 }) =>
  recordAudit({ kind: 'export', feature: 'data_export', status: 'error', meta });

/**
 * Validates the optional { tables: [ids], format?: 'csv' } body. No format means the ZIP; 'csv' needs exactly one table.
 * @returns {{ ok: true, tables: string[] | null, format: 'zip' | 'csv' } | { ok: false }}
 */
function parseTables(body, allowed) {
  if (body === undefined || body === null) return { ok: true, tables: null, format: 'zip' };
  if (typeof body !== 'object' || Array.isArray(body)) return { ok: false };
  if (body.format !== undefined && body.format !== 'csv') return { ok: false };
  const format = body.format === 'csv' ? 'csv' : 'zip';
  if (body.tables === undefined) return format === 'csv' ? { ok: false } : { ok: true, tables: null, format };
  if (!Array.isArray(body.tables)) return { ok: false };
  if (body.tables.length > EXPORT_MAX_INPUT_TABLES) return { ok: false };
  const tables = [...new Set(body.tables)];
  if (tables.length === 0 || tables.length > EXPORT_MAX_TABLES_PER_REQUEST) return { ok: false };
  if (!tables.every((id) => typeof id === 'string' && allowed.has(id))) return { ok: false };
  if (format === 'csv' && tables.length !== 1) return { ok: false };
  return { ok: true, tables, format };
}

/**
 * Streams one table as a bare CSV with res.write, page by page (never the whole table in memory).
 * How a cut off file is signalled: headers go out before the first row, so X-Export-Complete is only what is known then.
 * The row cap is known up front (one COUNT), so a table over the cap sends X-Export-Complete: 0 and ends cleanly at the
 * cap; otherwise 1. A deadline, abort or read error after the headers is not knowable in advance, so the response is
 * destroyed instead of ended: the browser sees a failed download, never a silently short file. A failure before the
 * first row is a normal 500.
 */
async function streamCsv(res, { db, def, now, buildOptions, signal }) {
  const aborted = () => signal.aborted;
  const maxRows = buildOptions.maxRowsPerTable ?? EXPORT_MAX_ROWS_PER_TABLE;
  const deadline = Date.now() + (buildOptions.deadlineMs ?? EXPORT_DEADLINE_MS);
  const outcome = {};
  const pages = readTablePages(db, def, { deadline, maxRows, signal }, outcome);
  let rows = 0;
  let bytes = 0;
  let started = false;
  const audit = (status, partial) =>
    recordAudit({
      kind: 'export',
      feature: 'data_export',
      status,
      meta: partial ? { tables: 1, rows, bytes, partial: true } : { tables: 1, rows, bytes },
    });
  const write = async (text) => {
    bytes += Buffer.byteLength(text);
    if (res.write(text)) return;
    // A client that stops reading must not hold the stream past the export deadline.
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        res.off('drain', done);
        res.off('close', done);
      };
      const done = () => {
        cleanup();
        resolve();
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(Object.assign(new Error('export_deadline'), { code: 'export_deadline' }));
      }, Math.max(deadline - Date.now(), 0));
      res.once('drain', done);
      res.once('close', done);
    });
  };
  try {
    const capped = exceedsRowCap(db, def, maxRows);
    const first = await pages.next();
    if (aborted()) {
      await audit('error');
      return;
    }
    if (first.done && outcome.status !== 'ok') {
      console.error('Export table error:', def.id, outcome.code ?? 'unknown');
      await audit('error');
      send(res, 500, 'server_error', 'Export failed');
      return;
    }
    const timestamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="local-app-studio-${def.id}-${timestamp}.csv"`);
    res.set('X-Export-Complete', capped ? '0' : '1');
    res.set('Access-Control-Expose-Headers', 'X-Export-Complete, Content-Disposition, X-Request-Id');
    started = true;
    await write(csvHeader(def.columns));
    let page = first;
    while (!page.done) {
      const visible = exportableRows(def, page.value);
      rows += visible.length;
      await write(csvRows(def.columns, visible));
      if (aborted()) break;
      page = await pages.next();
    }
    if (aborted()) {
      await audit('error', true);
      return;
    }
    if (outcome.status !== 'ok') {
      await audit('error', true);
      res.destroy();
      return;
    }
    // Rows added while streaming can push the table past the cap after the up-front count said it fit: the
    // header already said complete, so end the response as a failed download instead.
    if (outcome.truncated && !capped && exceedsRowCap(db, def, maxRows)) {
      await audit('error', true);
      res.destroy();
      return;
    }
    await audit(capped ? 'error' : 'ok', capped);
    res.end();
  } catch (e) {
    console.error('Export error:', e?.code ?? 'unknown');
    await audit('error', started);
    if (started) res.destroy();
    else send(res, 500, 'server_error', 'Export failed');
  }
}

/**
 * @param {import('express').Express} app
 * @param {{ authEnabled?: boolean, buildOptions?: object }} [opts] without auth, only loopback clients may
 *   export (fail closed otherwise); buildOptions override buildExportZip limits
 */
export function registerExportRoutes(app, { authEnabled = false, buildOptions = {} } = {}) {
  const allowedIds = new Set(DATA_TABLES.filter((d) => !EXPORT_DENY.has(d.id)).map((d) => d.id));

  // Dedicated limit: 30 per 15 min. A full export that is too large falls back to one
  // request per table (about 16), so the budget has to cover one whole fallback run.
  // Only cheap rejections (400/403/503, and a client that left) are refunded. 413 and 5xx
  // did real work, so they count. express-rate-limit only consults requestWasSuccessful
  // when skipFailedRequests is on.
  const exportLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    skipFailedRequests: true,
    requestWasSuccessful: (_req, res) => res.statusCode < 400 || res.statusCode === 413 || (res.statusCode >= 500 && res.statusCode !== 503),
    handler: limiterHandler({ message: 'Too many exports, please try again later.' }),
  });

  const requireSignIn = makeRequireSignIn({ authEnabled, action: 'Export' });

  app.post('/api/export', requireSignIn, exportLimiter, express.json({ limit: '10kb' }), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const parsed = parseTables(req.body, allowedIds);
    if (!parsed.ok) return send(res, 400, 'invalid_request', 'Invalid request body');
    let db;
    try {
      db = getDb();
    } catch {
      await auditFailure();
      return send(res, 503, 'not_configured', 'Local database is unavailable.');
    }
    const abort = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) abort.abort();
    };
    res.once('close', onClose);
    if (parsed.format === 'csv') {
      try {
        const def = DATA_TABLES.find((d) => d.id === parsed.tables[0]);
        await streamCsv(res, { db, def, now: new Date(), buildOptions, signal: abort.signal });
      } finally {
        res.off('close', onClose);
      }
      return undefined;
    }
    try {
      const now = new Date();
      const { zip, manifest } = await buildExportZip({
        ...buildOptions,
        db,
        now,
        tables: parsed.tables,
        signal: abort.signal,
      });
      const body = Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength);
      const complete = manifest.complete;
      const meta = { tables: manifest.totals.tables, rows: manifest.totals.rows, bytes: body.length };
      await recordAudit({
        kind: 'export',
        feature: 'data_export',
        status: complete ? 'ok' : 'error',
        meta: complete ? meta : { ...meta, partial: true },
      });
      const timestamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const suffix = !parsed.tables ? '' : parsed.tables.length === 1 ? `-${parsed.tables[0]}` : '-partial';
      res.set('Content-Type', 'application/zip');
      res.set(
        'Content-Disposition',
        `attachment; filename="local-app-studio-export-${timestamp}${suffix}.zip"`,
      );
      res.set('X-Export-Complete', complete ? '1' : '0');
      res.set('Access-Control-Expose-Headers', 'X-Export-Complete, Content-Disposition, X-Request-Id');
      res.set('Content-Length', String(body.length));
      return res.send(body);
    } catch (e) {
      if (e?.code === 'export_aborted') {
        await auditFailure();
        return undefined;
      }
      const tooLarge = e?.code === 'export_too_large';
      if (!tooLarge) console.error('Export error:', e?.code ?? 'unknown');
      await auditFailure();
      return tooLarge
        ? send(res, 413, 'export_too_large', 'Export is too large to download in one file.', {
            tables: [...allowedIds],
          })
        : send(res, 500, 'server_error', 'Export failed');
    } finally {
      res.off('close', onClose);
    }
  });
}
