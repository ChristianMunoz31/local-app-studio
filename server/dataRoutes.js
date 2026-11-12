// SQLite-backed data routes (server/db): generic app state only.
// Registered in server.js; every route 503s when the local database cannot be opened.
//
// Error contract (the pattern to copy for your own modules): every error goes through server/errors.js sendError and is
// { error: <sentence>, code, action, requestId, message }:
//   400 invalid_request       malformed request
//   404 not_found             unknown id
//   503 db_unavailable        the local database cannot be opened
//   500 server_error          anything else; only the error code is logged
import { httpErrorFor, nowIso, pingDb, select, toDbError, upsert } from './db/index.js';
import { sendError } from './errors.js';
import { HIDDEN_APP_STATE_KEYS } from './redact.js';
import { isStateRouteDeniedKey } from './import/importExport.js';

const UNAVAILABLE_MESSAGE = 'Local database is unavailable.';
const sendUnavailable = (res) => sendError(res, 'db_unavailable', { message: UNAVAILABLE_MESSAGE });

// Maps a failure to a fixed, leak-free response. Only the error code is logged.
const fail = (res, e) => {
  if (e?.code === 'not_found' && e?.status === 404) {
    return sendError(res, 'not_found', { message: 'That record no longer exists.' });
  }
  const d = toDbError(e);
  const { status } = httpErrorFor(d);
  if (status >= 500) console.error('Data route error:', d.code);
  if (status === 503) return sendUnavailable(res);
  if (status === 400) return sendError(res, 'invalid_request', { message: 'That request could not be understood.' });
  return sendError(res, 'server_error', { message: 'Something went wrong. Try again.' });
};

// Wraps an async handler so any throw becomes a fail() response. Express 5 leaves req.body undefined
// when no parser ran (no body or no JSON content type); handlers read it as an object, so default it.
const route = (handler) => async (req, res) => {
  try {
    req.body ??= {};
    await handler(req, res);
  } catch (e) {
    fail(res, e);
  }
};

// List GETs would otherwise stream an entire table. Apply a high safety ceiling plus opt-in
// ?limit/?offset pagination, layered AFTER the query's own ordering so ranges stay stable.
const LIST_CEILING = 5000;
export function parseRange(req) {
  const rawLimit = Number(req.query?.limit);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), LIST_CEILING) : LIST_CEILING;
  const rawOffset = Number(req.query?.offset);
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;
  return { limit, offset };
}

export function registerDataRoutes(app) {
  // When the database cannot be opened (unwritable data dir, corrupt file, file newer
  // than this app), short-circuit this module's routes with the documented 503.
  app.use(['/api/state'], (req, res, next) => {
    // pingDb never throws: false covers both a failed open and a closed handle.
    if (!pingDb()) return sendUnavailable(res);
    next();
  });

  // ===== App state (generic key/value settings) =====
  app.get(
    '/api/state',
    route(async (req, res) => {
      const map = {};
      for (const row of select('app_state', { columns: ['key', 'value'] })) {
        if (!HIDDEN_APP_STATE_KEYS.has(row.key)) map[row.key] = row.value;
      }
      res.json(map);
    }),
  );

  app.put(
    '/api/state/:key',
    route(async (req, res) => {
      if (isStateRouteDeniedKey(req.params.key)) {
        return sendError(res, 'protected_key');
      }
      if (!('value' in (req.body || {}))) {
        return sendError(res, 'invalid_body', { message: 'value is required' });
      }
      const row = upsert(
        'app_state',
        { key: req.params.key, value: req.body.value, updated_at: nowIso() },
        { conflict: ['key'] },
      );
      res.json({ key: row.key, value: row.value });
    }),
  );
}
