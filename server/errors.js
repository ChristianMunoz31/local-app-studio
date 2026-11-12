// The one error envelope (DESIGN phase 15, section 1). Every non-2xx JSON body and every SSE `error` payload
// the server sends is built here: { error: <sentence>, code, action, requestId, message, details?, ...extras }.
// The words live in src/errors/ (copy.core.js here, copy.studio.js through registerErrorCopy). Nothing in this file
// imports a feature module: errors are recognized by name, so a built app's sidecar does not pull Studio code in.
import { CORE_ERROR_COPY } from '../src/errors/copy.core.js';
import { currentRequestId, isDebug, logger, newRequestId, ownFrame, REQUEST_ID_HEADER } from './log.js';
import { redactDetails } from './redact.js';

export const SERVER_ERROR_CODE = 'server_error';

/** @type {Map<string, import('../src/errors/copy.core.js').ErrorCopyRow>} */
const rows = new Map(Object.entries(CORE_ERROR_COPY));

const RESERVED_KEYS = new Set(['error', 'code', 'action', 'requestId', 'message', 'details']);
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Adds rows for active modules (the Studio module calls it at import). Throws on a code that already has a different row.
 * @param {Record<string, import('../src/errors/copy.core.js').ErrorCopyRow>} extra
 */
export function registerErrorCopy(extra) {
  for (const [code, row] of Object.entries(extra)) {
    const have = rows.get(code);
    if (have === row) continue;
    if (have) throw new Error(`Duplicate error code: ${code}`);
    rows.set(code, row);
  }
}

/** @param {unknown} code @returns {boolean} true when `code` has a row */
export function isErrorCode(code) {
  return typeof code === 'string' && rows.has(code);
}

/** @param {string} code @returns {import('../src/errors/copy.core.js').ErrorCopyRow} the row for `code`, or server_error's */
export function errorRow(code) {
  return rows.get(code) ?? /** @type {import('../src/errors/copy.core.js').ErrorCopyRow} */ (rows.get(SERVER_ERROR_CODE));
}

const nonEmpty = (v) => (typeof v === 'string' && v.trim() !== '' ? v : undefined);

/** An error a route or library can throw; the final handler and sendErrorFrom send it as an envelope. */
export class AppError extends Error {
  /**
   * @param {string} code
   * @param {{ status?: number, message?: string, action?: string, details?: object, extra?: object, cause?: unknown }} [opts]
   */
  constructor(code, opts = {}) {
    super(nonEmpty(opts.message) ?? errorRow(code).sentence ?? errorRow(SERVER_ERROR_CODE).sentence);
    this.name = 'AppError';
    this.code = code;
    if (opts.status !== undefined) this.status = opts.status;
    if (opts.action !== undefined) this.action = opts.action;
    if (opts.details !== undefined) this.details = opts.details;
    this.extra = opts.extra ?? {};
    if (opts.cause !== undefined) this.cause = opts.cause;
  }
}

/**
 * Builds an envelope. Never throws. An unknown code logs warn `errors.unknown_code` and becomes server_error.
 * @param {string} code
 * @param {{ message?: string, action?: string, requestId?: string, details?: object, extra?: object }} [opts]
 * @returns {Record<string, unknown>}
 */
export function errorBody(code, opts = {}) {
  let useCode = code;
  if (!isErrorCode(useCode)) {
    logger.warn('errors.unknown_code', { code: typeof code === 'string' ? code.slice(0, 60) : typeof code });
    useCode = SERVER_ERROR_CODE;
  }
  const row = errorRow(useCode);
  const error = nonEmpty(opts.message) ?? row.sentence ?? errorRow(SERVER_ERROR_CODE).sentence;
  const body = {
    error,
    code: useCode,
    action: nonEmpty(opts.action) ?? row.action,
    requestId: (typeof opts.requestId === 'string' && ID_RE.test(opts.requestId) ? opts.requestId : null) ?? currentRequestId() ?? newRequestId(),
    message: error,
  };
  if (opts.details) body.details = redactDetails(opts.details);
  if (opts.extra && typeof opts.extra === 'object') {
    for (const [k, v] of Object.entries(opts.extra)) if (!RESERVED_KEYS.has(k)) body[k] = v;
  }
  return body;
}

/**
 * Sends the envelope. Status is opts.status or the row default. Sets `Cache-Control: no-store` on /api paths,
 * `X-Request-Id` and `res.locals.errorCode` (read by the request log line). After headers were sent it logs and writes nothing.
 * @param {import('express').Response} res
 * @param {string} code
 * @param {{ status?: number, message?: string, action?: string, details?: object, extra?: object, headers?: Record<string, string> }} [opts]
 * @returns {import('express').Response}
 */
export function sendError(res, code, opts = {}) {
  if (res.headersSent) {
    logger.warn('errors.after_headers', { code: typeof code === 'string' ? code.slice(0, 60) : typeof code });
    return res;
  }
  const useCode = isErrorCode(code) ? code : SERVER_ERROR_CODE;
  const fromHeader = typeof res.getHeader === 'function' ? res.getHeader(REQUEST_ID_HEADER) : undefined;
  const body = errorBody(code, { ...opts, requestId: typeof fromHeader === 'string' ? fromHeader : undefined });
  const rowStatus = errorRow(useCode).status;
  const status = Number.isInteger(opts.status) ? opts.status : rowStatus >= 400 ? rowStatus : 500;
  const url = res.req?.originalUrl ?? res.req?.url ?? '';
  if (typeof url === 'string' && url.startsWith('/api')) res.set('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(opts.headers ?? {})) res.set(k, v);
  res.set(REQUEST_ID_HEADER, String(body.requestId));
  if (res.locals && typeof res.locals === 'object') res.locals.errorCode = body.code;
  return res.status(status).json(body);
}

// The first own stack frame as `server/x.js:12:3` (repo relative, see ownFrame in log.js).
const firstOwnFrame = (err) => ownFrame(err) ?? undefined;

const isHttpStatus = (n, min, max) => Number.isInteger(n) && n >= min && n < max;

// Maps a thrown error to { code, opts }, or null when it is not one of the known kinds.
function mapKnown(err) {
  if (!err || typeof err !== 'object') return null;
  const name = err.name;
  const code = err.code;
  if (err instanceof AppError) {
    return { code, opts: { status: err.status, message: err.message, action: err.action, details: err.details, extra: err.extra } };
  }
  if (name === 'StudioError' && isErrorCode(code)) {
    return { code, opts: { status: err.status, message: err.message, extra: err.extra } };
  }
  if (name === 'BackupError' && isErrorCode(code)) {
    return {
      code,
      opts: { status: err.status, message: err.message, ...(code === 'db_restoring' ? { headers: { 'Retry-After': '5' } } : {}) },
    };
  }
  if (name === 'ImportError' && isErrorCode(code)) {
    return { code, opts: { status: err.status, message: err.message } };
  }
  if (name === 'LicenseError' && isErrorCode(code)) {
    return { code, opts: { status: err.httpStatus, message: err.publicMessage } };
  }
  if ((name === 'AiUnavailableError' || name === 'AiBusyError' || name === 'ProRequiredError') && isErrorCode(code)) {
    const extra = {};
    if (err.reason !== undefined) extra.reason = err.reason;
    if (err.hint !== undefined) extra.hint = err.hint;
    if (err.feature !== undefined) extra.feature = err.feature;
    return { code, opts: { status: err.httpStatus, message: err.publicMessage, extra } };
  }
  if (name === 'DbError' && err.status === 503) {
    return { code: code === 'db_restoring' ? 'db_restoring' : 'db_unavailable', opts: {} };
  }
  if (isHttpStatus(err.status, 400, 500) && isErrorCode(code) && name !== 'DbError') {
    return { code, opts: { status: err.status } };
  }
  return null;
}

/**
 * Maps a thrown error to an envelope and sends it. Known kinds keep their code, status and sentence; anything else is
 * `server_error` 500, logged with the error name and code only (never the message or a stack in the body).
 * In debug mode the body gains redacted `details { errorName, errorCode, at }`.
 * @param {import('express').Response} res
 * @param {unknown} err
 * @param {string} [fallbackCode]
 * @returns {import('express').Response}
 */
export function sendErrorFrom(res, err, fallbackCode = SERVER_ERROR_CODE) {
  const known = mapKnown(err);
  const e = /** @type {{ name?: unknown, code?: unknown } | null} */ (err && typeof err === 'object' ? err : null);
  const code = known?.code ?? (isErrorCode(fallbackCode) ? fallbackCode : SERVER_ERROR_CODE);
  const opts = { ...(known?.opts ?? {}) };
  if (opts.status === undefined) delete opts.status;
  if (!known || errorRow(code).status >= 500 || (opts.status ?? 0) >= 500) {
    logger.error('errors.unhandled', {
      name: typeof e?.name === 'string' ? e.name.slice(0, 60) : typeof err,
      errorCode: typeof e?.code === 'string' || typeof e?.code === 'number' ? String(e.code).slice(0, 60) : undefined,
      at: firstOwnFrame(err),
    });
  }
  if (isDebug() && !opts.details) {
    opts.details = {
      errorName: typeof e?.name === 'string' ? e.name : typeof err,
      errorCode: typeof e?.code === 'string' || typeof e?.code === 'number' ? String(e.code) : null,
      at: firstOwnFrame(err) ?? null,
    };
  }
  return sendError(res, code, opts);
}

/**
 * express-rate-limit v8 `handler` option. Status comes from the limiter's options (429).
 * @param {{ message?: string }} [opts]
 * @returns {(req: import('express').Request, res: import('express').Response, next: unknown, options?: { statusCode?: number }) => unknown}
 */
export function limiterHandler(opts = {}) {
  return (_req, res, _next, options) =>
    sendError(res, 'rate_limited', {
      status: Number.isInteger(options?.statusCode) ? options.statusCode : 429,
      ...(nonEmpty(opts.message) ? { message: opts.message } : {}),
    });
}

/**
 * The payload of an SSE `error` event: the same fields as the envelope, with no HTTP status.
 * @param {string} code
 * @param {{ message?: string, action?: string, details?: object, extra?: object }} [opts]
 * @returns {Record<string, unknown>}
 */
export function sseError(code, opts = {}) {
  return errorBody(code, opts);
}
