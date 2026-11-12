// Structured logs, request ids and stage timings (DESIGN phase 15, section 5).
// One JSON line per record. Every record is redacted on the way in, so the ring, the file, the API and the report
// are all safe to share. `log()` never throws. Request and response bodies, query strings, headers, prompts and
// record values are never logged: callers pass short scalar fields only.
import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { chmodBestEffort } from './paths.js';
import { REDACTED, SENSITIVE_KEY_RE, redactText, setRedactDataDir } from './redact.js';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'];
export const RING_SIZE = 500;
export const LOG_FILE_MAX_BYTES = 2 * 1024 * 1024;
export const LOG_FILE_KEEP = 3;
export const SLOW_QUERY_MS = 100;
export const REQUEST_ID_HEADER = 'X-Request-Id';

const FILE_NAME = 'server.jsonl';
const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_.]{0,40}$/;
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const MAX_FIELDS = 20;
const MAX_STRING = 300;
// Fields that come first, in this order, after level, time, requestId and event.
const LEAD_FIELDS = ['route', 'status', 'code', 'durationMs'];
const RESERVED = new Set(['level', 'time', 'requestId', 'event', 'role']);
const rank = (level) => LOG_LEVELS.indexOf(level);

const als = new AsyncLocalStorage();

const state = {
  /** @type {object[]} */ ring: [],
  /** @type {string[]} */ pending: [],
  dir: null,
  file: null,
  role: null,
  desktop: false,
  env: process.env,
  sessionDebug: false,
  size: 0,
  writing: Promise.resolve(),
  scheduled: false,
  /** @type {Set<import('node:http').ServerResponse>} */ open: new Set(),
};

const underTest = () => Boolean(process.env.VITEST) && process.env.APP_LOG_TEST !== '1';

/**
 * Sets the role, the data folder and the output mode. Call once, after the data folder is known. Records logged before
 * this call are kept in the ring and written to the file once it opens.
 * @param {{ dataDir?: string, role?: string, desktop?: boolean, env?: Record<string, string | undefined> }} opts
 */
export function configureLog({ dataDir, role, desktop = false, env = process.env } = {}) {
  try {
    state.role = role ?? null;
    state.desktop = Boolean(desktop);
    state.env = env;
    if (typeof dataDir === 'string' && dataDir !== '') setRedactDataDir(dataDir);
    if (typeof dataDir === 'string' && dataDir !== '' && !underTest()) {
      const dir = path.join(dataDir, 'logs');
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      state.dir = dir;
      state.file = path.join(dir, FILE_NAME);
      try {
        state.size = fs.statSync(state.file).size;
      } catch {
        state.size = 0;
      }
      chmodBestEffort(state.file, 0o600);
      for (const rec of state.ring) state.pending.push(JSON.stringify(rec));
      schedule();
    }
  } catch {
    state.dir = null;
    state.file = null;
  }
}

/** True when `APP_DEBUG=1` or the Diagnostics toggle is on. */
export function isDebug() {
  return state.env.APP_DEBUG === '1' || state.sessionDebug;
}

/** @param {boolean} on The Diagnostics toggle: memory only, it cannot turn off an env-set debug mode. */
export function setSessionDebug(on) {
  state.sessionDebug = on === true;
}

export function debugState() {
  const env = state.env.APP_DEBUG === '1';
  return { env, session: state.sessionDebug, on: env || state.sessionDebug };
}

// Every string goes through redactText (secret spans, e-mail addresses, the data and home folders, other absolute paths).
function cleanString(value) {
  return redactText(String(value), { max: MAX_STRING });
}

/**
 * The first stack frame outside node internals and node_modules as `server/x.js:12:3` (repo relative; a frame outside the
 * repo keeps only its file name). Never a full path, so a user name in a path cannot reach a log or a response.
 * @param {unknown} err
 * @returns {string | null}
 */
export function ownFrame(err) {
  const stack = typeof err?.stack === 'string' ? err.stack.split('\n') : [];
  for (const line of stack) {
    if (!/^\s+at\s/.test(line)) continue;
    const m = /\(?((?:file:\/\/)?[^()\s]+):(\d+):(\d+)\)?\s*$/.exec(line);
    if (!m || m[1].startsWith('node:') || m[1].includes('node_modules')) continue;
    const file = m[1].replace(/^file:\/\/\/?/, '').replaceAll('\\', '/');
    const cut = Math.max(file.lastIndexOf('/server/'), file.lastIndexOf('/src/'));
    const short = cut >= 0 ? file.slice(cut + 1) : file.slice(file.lastIndexOf('/') + 1);
    return `${short}:${m[2]}:${m[3]}`;
  }
  return null;
}

function cleanFields(fields) {
  const out = {};
  if (!fields || typeof fields !== 'object') return out;
  let count = 0;
  for (const [key, value] of Object.entries(fields)) {
    if (count >= MAX_FIELDS) break;
    if (RESERVED.has(key) || !KEY_RE.test(key)) continue;
    if (value === null || typeof value === 'boolean') {
      out[key] = value;
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) continue;
      out[key] = value;
    } else if (typeof value === 'string') {
      const normalized = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
      out[key] = SENSITIVE_KEY_RE.test(normalized) ? REDACTED : cleanString(value);
    } else {
      continue;
    }
    count += 1;
  }
  return out;
}

function buildRecord(level, event, fields) {
  const clean = cleanFields(fields);
  const ctx = als.getStore();
  const given = typeof fields?.requestId === 'string' && ID_RE.test(fields.requestId) ? fields.requestId : null;
  const record = { level, time: new Date().toISOString(), requestId: given ?? ctx?.id ?? null, event: cleanString(event) };
  for (const key of LEAD_FIELDS) {
    if (Object.hasOwn(clean, key)) {
      record[key] = clean[key];
      delete clean[key];
    }
  }
  Object.assign(record, clean);
  if (state.role) record.role = state.role;
  return record;
}

function humanLine(rec) {
  const parts = [`[${rec.level}]`, rec.event];
  if (rec.route) parts.push(rec.route);
  if (rec.status !== undefined) parts.push(String(rec.status));
  if (rec.code) parts.push(rec.code);
  if (typeof rec.durationMs === 'number') parts.push(`${Math.round(rec.durationMs)}ms`);
  for (const [k, v] of Object.entries(rec)) {
    if (['level', 'time', 'requestId', 'event', 'route', 'status', 'code', 'durationMs', 'role'].includes(k)) continue;
    parts.push(`${k}=${v}`);
  }
  return parts.join(' ');
}

/**
 * Logs one record. Kept when its level is info or above, or debug or above in debug mode. Never throws.
 * @param {'debug' | 'info' | 'warn' | 'error' | 'fatal'} level
 * @param {string} event
 * @param {Record<string, unknown>} [fields] short scalar fields only
 */
export function log(level, event, fields = {}) {
  try {
    const min = isDebug() ? 0 : 1;
    const r = rank(level);
    if (r < min) return;
    const record = buildRecord(level, event, fields);
    state.ring.push(record);
    if (state.ring.length > RING_SIZE) state.ring.splice(0, state.ring.length - RING_SIZE);
    if (state.file) {
      state.pending.push(JSON.stringify(record));
      schedule();
    }
    if (underTest()) return;
    // Desktop runs print only error and fatal (Tauri keeps the last 40 stderr lines); others print warn and above.
    if (r >= (state.desktop ? 3 : 2)) process.stderr.write(`${humanLine(record)}\n`);
  } catch {
    // logging must never break the caller
  }
}

export const logger = Object.freeze({
  debug: (event, fields) => log('debug', event, fields),
  info: (event, fields) => log('info', event, fields),
  warn: (event, fields) => log('warn', event, fields),
  error: (event, fields) => log('error', event, fields),
  fatal: (event, fields) => log('fatal', event, fields),
});

function schedule() {
  if (state.scheduled) return;
  state.scheduled = true;
  setImmediate(() => {
    state.scheduled = false;
    state.writing = state.writing.then(writeBatch, writeBatch);
  });
}

function rotate() {
  const base = state.dir;
  const name = (n) => path.join(base, `server.${n}.jsonl`);
  fs.rmSync(name(LOG_FILE_KEEP), { force: true });
  for (let n = LOG_FILE_KEEP - 1; n >= 1; n -= 1) {
    if (fs.existsSync(name(n))) fs.renameSync(name(n), name(n + 1));
  }
  if (fs.existsSync(state.file)) fs.renameSync(state.file, name(1));
  state.size = 0;
}

function takeBatch() {
  if (state.pending.length === 0 || !state.file) return null;
  const text = `${state.pending.join('\n')}\n`;
  state.pending = [];
  const bytes = Buffer.byteLength(text);
  if (state.size > 0 && state.size + bytes > LOG_FILE_MAX_BYTES) rotate();
  state.size += bytes;
  return text;
}

async function writeBatch() {
  try {
    const text = takeBatch();
    if (text === null) return;
    await fs.promises.appendFile(state.file, text, { mode: 0o600 });
  } catch {
    // a full disk or a locked file must not crash the server
  }
}

/** Resolves when everything logged so far is on disk. */
export function flushLog() {
  schedule();
  return new Promise((resolve) => {
    setImmediate(() => state.writing.then(() => (state.pending.length ? writeBatch() : undefined)).then(resolve, resolve));
  });
}

/** Writes the pending buffer synchronously (fatal exits). */
export function flushLogSync() {
  try {
    const text = takeBatch();
    if (text !== null) fs.appendFileSync(state.file, text, { mode: 0o600 });
  } catch {
    // best effort
  }
}

/**
 * Newest last, from the ring.
 * @param {{ limit?: number, minLevel?: 'debug' | 'info' | 'warn' | 'error' | 'fatal' }} [opts]
 */
export function tail({ limit = 200, minLevel = 'debug' } = {}) {
  const min = Math.max(0, rank(minLevel));
  const rows = state.ring.filter((r) => rank(r.level) >= min);
  const n = Math.max(0, Math.min(RING_SIZE, Math.trunc(Number(limit)) || 0));
  return n === 0 ? [] : rows.slice(-n).map((r) => ({ ...r }));
}

/** @returns {Array<{ name: string, path: string, bytes: number }>} current file first, then the rotated ones */
export function logFiles() {
  if (!state.dir) return [];
  const names = [FILE_NAME, ...Array.from({ length: LOG_FILE_KEEP }, (_, i) => `server.${i + 1}.jsonl`)];
  const out = [];
  for (const name of names) {
    const full = path.join(state.dir, name);
    try {
      out.push({ name, path: full, bytes: fs.statSync(full).size });
    } catch {
      // not there
    }
  }
  return out;
}

/** An 8 byte random id as 16 hex characters. */
export function newRequestId() {
  return crypto.randomBytes(8).toString('hex');
}

/** @returns {string | null} the id of the request (or startup task) this code runs inside */
export function currentRequestId() {
  return als.getStore()?.id ?? null;
}

function routeOf(req) {
  const method = typeof req?.method === 'string' ? req.method : 'GET';
  const tpl = req?.route?.path;
  if (typeof tpl !== 'string') return `${method} (unmatched)`;
  return `${method} ${(req.baseUrl ?? '') + tpl}`;
}

/** @returns {{ id: string, res: import('node:http').ServerResponse | null, route: string | null } | null} */
export function currentRequest() {
  const ctx = als.getStore();
  if (!ctx) return null;
  return { id: ctx.id, res: ctx.res, route: ctx.req ? routeOf(ctx.req) : null };
}

/**
 * Runs `fn` inside a request-id context (startup tasks, background jobs).
 * @template T
 * @param {string} id
 * @param {() => T} fn
 * @returns {T}
 */
export function withRequestId(id, fn) {
  return als.run({ id, res: null, req: null, startedAt: performance.now() }, fn);
}

/** @returns {Set<import('node:http').ServerResponse>} responses still open (process guards finish them) */
export function openResponses() {
  return state.open;
}

/**
 * Express middleware: assigns the request id, sets the `X-Request-Id` header, and logs one `http.request` record when
 * the response finishes or closes. A GET below 400 is a debug record (D-10).
 */
export function requestContext() {
  return (req, res, next) => {
    const incoming = req.headers?.[REQUEST_ID_HEADER.toLowerCase()];
    const id = typeof incoming === 'string' && ID_RE.test(incoming) ? incoming : newRequestId();
    res.setHeader(REQUEST_ID_HEADER, id);
    const startedAt = performance.now();
    state.open.add(res);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      state.open.delete(res);
      const status = res.statusCode;
      const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : req.method === 'GET' ? 'debug' : 'info';
      const code = typeof res.locals?.errorCode === 'string' ? res.locals.errorCode : undefined;
      als.run({ id, res, req, startedAt }, () => {
        log(level, 'http.request', {
          route: routeOf(req),
          status,
          ...(code ? { code } : {}),
          durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
        });
      });
    };
    res.on('finish', finish);
    res.on('close', finish);
    als.run({ id, res, req, startedAt }, next);
  };
}

/**
 * Starts a stage timer. Call the returned function when the stage ends; it logs event `stage` at info.
 * @param {string} name for example `describe.tables`
 * @param {Record<string, unknown>} [fields]
 * @returns {(more?: Record<string, unknown>) => number} the duration in ms
 */
export function startStage(name, fields = {}) {
  const t0 = performance.now();
  return (more = {}) => {
    const durationMs = Math.round((performance.now() - t0) * 10) / 10;
    log('info', 'stage', { stage: name, durationMs, ...fields, ...more });
    return durationMs;
  };
}

/** Test seam: clears the ring, the buffers and the configuration. */
export function resetLogForTests() {
  state.ring = [];
  state.pending = [];
  state.dir = null;
  state.file = null;
  state.role = null;
  state.desktop = false;
  state.env = process.env;
  state.sessionDebug = false;
  state.size = 0;
  state.open.clear();
}
