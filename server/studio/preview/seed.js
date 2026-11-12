// Puts an example's sample records into a fresh Preview data folder through the child's own data routes (the same loopback
// calls and cookie the proxy uses), so the app's validation, defaults and reference checks apply and nothing in the
// runtime changes. A stamp file in the data folder says it was done; Reset and every fresh start remove the folder.
// Values are never logged, only codes.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { log } from '../../log.js';
import { readAutoNumber } from '@local-app-studio/runtime/spec/autoNumber.ts';
import { resolveRow, seedOrder } from '../../../src/studio/lib/sampleData.ts';

export const STAMP_FILE = 'studio-sample.json';
const MAX_BODY_BYTES = 1024 * 1024;

/** @param {string} dataDir */
export function hasStamp(dataDir) {
  return fs.existsSync(path.join(dataDir, STAMP_FILE));
}

/**
 * @param {string} dataDir
 * @param {{ created: number, skipped: number }} result
 */
export function writeStamp(dataDir, { created, skipped }) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, STAMP_FILE), JSON.stringify({ v: 1, at: new Date().toISOString(), created, skipped }));
}

/**
 * One loopback JSON call. Resolves { status, body } (body null when it is not JSON); rejects on a socket error or timeout.
 * @param {typeof http.request} request
 */
function call(request, { port, cookie, method, path: urlPath, payload, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const headers = { host: `127.0.0.1:${port}`, cookie: `app_desktop=${cookie}`, 'content-type': 'application/json' };
    const data = payload === undefined ? null : Buffer.from(JSON.stringify(payload));
    if (data) headers['content-length'] = String(data.length);
    let hard;
    const req = request({ host: '127.0.0.1', port, method, path: urlPath, headers }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY_BYTES) {
          clearTimeout(hard);
          req.destroy(new Error('too_large'));
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => {
        clearTimeout(hard);
        let body = null;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          // not JSON
        }
        resolve({ status: res.statusCode ?? 0, body });
      });
      res.on('error', reject);
    });
    // A hard limit for the whole call (the idle timeout alone never fires on a child that keeps trickling bytes).
    hard = setTimeout(() => req.destroy(new Error('timeout')), timeoutMs);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('close', () => clearTimeout(hard));
    req.on('error', (err) => {
      clearTimeout(hard);
      reject(err);
    });
    req.end(data ?? undefined);
  });
}

/**
 * Posts the sample rows of `sample` into the child on `port`: nothing when any table of the app already has rows, tables
 * in referenced-first order, rows in file order, each row resolved against the app's current spec. A row the app refuses
 * counts as skipped; a socket error, the total time limit or `shouldStop()` turning true stops the run. Never rejects.
 * @param {{ port: number, cookie: string, spec: object, sample: { tables: Record<string, object[]> }, today?: Date,
 *   request?: typeof http.request, timeoutMs?: number, totalMs?: number, shouldStop?: () => boolean }} opts
 * @returns {Promise<{ created: number, skipped: number, hadRows: boolean, aborted: boolean }>}
 */
export async function seedSample({ port, cookie, spec, sample, today = new Date(), request = http.request, timeoutMs = 5000, totalMs = 15000, shouldStop = () => false }) {
  const result = { created: 0, skipped: 0, hadRows: false, aborted: false };
  const started = Date.now();
  const send = (method, urlPath, payload) => {
    if (shouldStop()) return Promise.reject(new Error('superseded'));
    const left = totalMs - (Date.now() - started);
    if (left <= 0) return Promise.reject(new Error('total_time'));
    return call(request, { port, cookie, method, path: urlPath, payload, timeoutMs: Math.min(timeoutMs, left) });
  };
  try {
    const info = await send('GET', '/api/data');
    const listed = info.status === 200 ? info.body?.data?.tables : null;
    if (!Array.isArray(listed)) throw new Error('data_unreadable');
    const ids = new Set(spec.tables.map((t) => t.id));
    if (listed.some((t) => ids.has(t?.id) && Number(t.rowCount) > 0)) {
      result.hadRows = true;
      return result;
    }
    const byId = new Map(spec.tables.map((t) => [t.id, t]));
    const made = new Map();
    const idOf = (table, key) => made.get(`${table}:${key}`);
    for (const tableId of seedOrder(spec)) {
      const rows = sample.tables[tableId];
      const table = byId.get(tableId);
      if (!Array.isArray(rows) || !table) continue;
      // The app numbers its records itself and refuses a number in the body, so a numbered field is never sent.
      const numbered = readAutoNumber(table)?.field ?? null;
      for (const row of rows) {
        const body = resolveRow(table, row, today, idOf);
        if (numbered !== null) delete body[numbered];
        const answer = await send('POST', `/api/data/${encodeURIComponent(tableId)}`, body);
        const id = answer.body?.data?.id;
        if (answer.status === 201 && typeof id === 'string') {
          result.created += 1;
          if (typeof row._id === 'string') made.set(`${tableId}:${row._id}`, id);
        } else {
          result.skipped += 1;
        }
      }
    }
  } catch (err) {
    result.aborted = true;
    log('warn', 'studio.sample_seed_failed', { code: typeof err?.code === 'string' ? err.code : (err?.message ?? 'unknown').slice(0, 40) });
  }
  return result;
}
