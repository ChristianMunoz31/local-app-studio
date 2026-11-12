// Shared HTTP helpers for the Studio routes.
import { STUDIO_ERROR_COPY } from '../../src/errors/copy.studio.js';
import { DbError, pingDb } from '../db/index.js';
import { registerErrorCopy, sendError, sendErrorFrom } from '../errors.js';
import { StudioError } from './apps.js';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Every Studio route file imports this module, so the Studio error rows exist wherever a Studio route runs.
registerErrorCopy(STUDIO_ERROR_COPY);

const UNAVAILABLE_MESSAGE = 'Local database is unavailable.';
const SERVER_ERROR_MESSAGE = 'Something went wrong. Try again.';

/** @param {import('express').Response} res @param {string} message */
export const badRequest = (res, message) => sendError(res, 'invalid_request', { message });

/** @param {import('express').Response} res */
export const appNotFound = (res) =>
  sendError(res, 'app_not_found', { message: 'That app does not exist. It may have been deleted.' });

/**
 * Maps a thrown error to its fixed body. Logs the code only, never a message or a request body.
 * @param {import('express').Response} res
 * @param {unknown} err
 */
export function sendStudioError(res, err) {
  if (res.headersSent) return undefined;
  if (err instanceof StudioError) return sendErrorFrom(res, err);
  if (err instanceof DbError && err.status === 503) return sendError(res, 'db_unavailable', { message: UNAVAILABLE_MESSAGE });
  console.error('Studio error:', err instanceof DbError ? err.code : (err?.name ?? 'unknown'));
  return sendError(res, 'server_error', { message: SERVER_ERROR_MESSAGE });
}

/** No-store, then a database check (503 JSON when it is unavailable). */
export function studioGuard(req, res, next) {
  res.set('Cache-Control', 'no-store');
  if (!pingDb()) return sendError(res, 'db_unavailable', { message: UNAVAILABLE_MESSAGE });
  return next();
}
