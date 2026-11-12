// Maps a data-layer failure to the HTTP response used across the data routes.
import { httpErrorFor, toDbError } from './db/index.js';
import { sendError } from './errors.js';

/**
 * Send the mapped storage failure (503 / 400 / 404) or a generic 500.
 * @param {import('express').Response} res
 * @param {unknown} error
 * @returns {import('express').Response}
 */
export function sendStorageError(res, error) {
  // A data-layer error carrying status 503 (unavailable database) keeps that status.
  if (error?.status === 503) return sendError(res, 'db_unavailable');
  const d = toDbError(error);
  const { status } = httpErrorFor(d);
  if (status >= 500) console.error('Storage error:', d.code);
  if (status === 503) return sendError(res, 'db_unavailable');
  if (status === 400) return sendError(res, 'invalid_request');
  if (status === 404) return sendError(res, 'not_found');
  return sendError(res, 'server_error');
}
