// The browser side of the generic data API (docs: phase 2 contract, section 6). One CatalogDataSource over
// {apiBase}/data/..., plus the two calls the data browser and the App data settings section make. Envelopes:
// success `{ data }`, failure `{ error: sentence, code, action, requestId, message, field? }` (`message` is the
// deprecated alias of `error`; a body of the older shape `{ error: code, message }` is still read). A failure rejects
// with an Error that carries `code`, `action`, `requestId` and, for a bad field, `field`. Its message is the sentence
// followed by the next action.
import { ERROR_TEXT, joinSentence } from '@/catalog/errorText.ts';

const REVOKE_DELAY_MS = 30_000;
const SNAKE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$|^[a-z]+$/;

const str = (value) => (typeof value === 'string' && value !== '' ? value : undefined);

function failure(sentence, code, field, action, requestId) {
  // With no sentence the generic one brings its own next step; one next step is shown, never two.
  const next = sentence ? action : action || ERROR_TEXT.genericAction;
  const error = new Error(joinSentence(sentence || ERROR_TEXT.genericSentence, next));
  error.code = code;
  if (field) error.field = field;
  if (next) error.action = next;
  if (requestId) error.requestId = requestId;
  return error;
}

function networkFailure() {
  return failure(ERROR_TEXT.networkSentence, 'network_unreachable', undefined, ERROR_TEXT.networkAction);
}

/** The pieces of a failure body, new envelope or old: code, sentence, action, request id, field. */
function readEnvelope(body, response) {
  const code = str(body?.code) ?? str(body?.error) ?? 'server_error';
  const oldShape = str(body?.code) === undefined;
  const errorText = str(body?.error);
  const sentence = oldShape
    ? (str(body?.message) ?? (errorText && !SNAKE.test(errorText) ? errorText : undefined))
    : (errorText ?? str(body?.message));
  const requestId = str(body?.requestId) ?? str(response?.headers?.get?.('X-Request-Id'));
  return { code, sentence, action: str(body?.action), requestId, field: str(body?.field) };
}

async function request(url, init) {
  let response;
  try {
    response = await fetch(url, { credentials: 'same-origin', ...init });
  } catch (cause) {
    if (cause?.name === 'AbortError') throw cause;
    throw networkFailure();
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const e = readEnvelope(body, response);
    throw failure(e.sentence, e.code, e.field, e.action, e.requestId);
  }
  if (!body || typeof body !== 'object' || !('data' in body)) throw failure(undefined, 'server_error');
  return body;
}

async function send(url, init) {
  return (await request(url, init)).data;
}

/** A create or update: the row, with the rules that ran as a non-enumerable `applied` (so the row stays what it was). */
async function sendRow(url, init) {
  const body = await request(url, init);
  if (Array.isArray(body.applied) && body.data && typeof body.data === 'object') {
    Object.defineProperty(body.data, 'applied', { value: body.applied, enumerable: false });
  }
  return body.data;
}

const jsonInit = (method, payload) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

/**
 * Query string of a list or stats request.
 * @param {import('@/catalog/context').DataQuery & Partial<import('@/catalog/context').GroupQuery>} q
 * @returns {string} `''` or `?a=b&...`
 */
export function buildQuery(q = {}) {
  const params = new URLSearchParams();
  if (q.page && q.source) {
    params.set('page', q.page);
    params.set('source', q.source);
  }
  if (q.filter?.length) params.set('filter', JSON.stringify(q.filter));
  if (q.search?.term) {
    params.set('search', q.search.term);
    if (q.search.fields?.length) params.set('searchFields', q.search.fields.join(','));
  }
  if (q.sort?.length) params.set('sort', q.sort.map((s) => `${s.field}:${s.dir}`).join(','));
  if (q.limit !== undefined) params.set('limit', String(q.limit));
  if (q.offset !== undefined) params.set('offset', String(q.offset));
  if (q.groupBy) {
    params.set('groupBy', q.groupBy);
    if (q.measure) params.set('measure', q.measure);
    if (q.field) params.set('field', q.field);
    if (q.bucket) params.set('bucket', q.bucket);
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/**
 * A CatalogDataSource over the data API.
 * @param {string} [apiBase]
 * @returns {import('@/catalog/context').CatalogDataSource}
 */
export function createHttpDataSource(apiBase = '/api') {
  const base = `${apiBase}/data`;
  const tableUrl = (table) => `${base}/${encodeURIComponent(table)}`;
  const rowUrl = (table, id) => `${tableUrl(table)}/${encodeURIComponent(id)}`;
  return {
    list: (table, q) => send(`${tableUrl(table)}${buildQuery(q)}`),
    stats: (table, q) => send(`${tableUrl(table)}/stats${buildQuery(q)}`),
    groups: (table, q) => send(`${tableUrl(table)}/stats${buildQuery(q)}`),
    async get(table, id) {
      try {
        return await send(rowUrl(table, id));
      } catch (e) {
        if (e?.code === 'not_found') return null;
        throw e;
      }
    },
    create: (table, values) => sendRow(tableUrl(table), jsonInit('POST', values)),
    update: (table, id, values) => sendRow(rowUrl(table, id), jsonInit('PATCH', values)),
    async remove(table, id) {
      await send(rowUrl(table, id), { method: 'DELETE' });
    },
  };
}

/**
 * `GET {apiBase}/data`: the app name and version, the data folder, the database file and every table with its row count.
 * @param {string} [apiBase]
 * @returns {Promise<{ app: { name: string, version: string } | null, dataDir: string, dbFile: string, tables: Array<{ id: string, label: string, rowCount: number }> }>}
 */
export function fetchDataInfo(apiBase = '/api') {
  return send(`${apiBase}/data`);
}

/**
 * `POST {apiBase}/data/:table/import`: a dry run (the default on the server) or the real import.
 * @param {string} table
 * @param {object} body `{ csv, mapping?, dryRun?, applyAutomations?, startAt? }`
 * @param {string} [apiBase]
 */
export function importRows(table, body, apiBase = '/api') {
  return send(`${apiBase}/data/${encodeURIComponent(table)}/import`, jsonInit('POST', body));
}

/**
 * `POST {apiBase}/backups`: one backup now.
 * @param {string} [apiBase]
 * @returns {Promise<{ at: string }>}
 */
export async function backUpNow(apiBase = '/api') {
  const data = await send(`${apiBase}/backups`, jsonInit('POST', {}));
  return { at: data?.backup?.createdAt ?? '' };
}

const EXPORT_MESSAGES = {
  rate_limited: ERROR_TEXT.exportRateLimited,
  export_too_large: ERROR_TEXT.exportTooLarge,
};

function filenameFrom(disposition, ids) {
  const match = /filename="?([^";]+)"?/i.exec(disposition ?? '');
  return match ? match[1] : `export-${ids.join('-')}.zip`;
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
  }
}

/**
 * Downloads a ZIP of the given tables (`POST /api/export { tables }`, the kit endpoint).
 * @param {string[]} ids
 * @param {string} [apiBase]
 * @returns {Promise<{ filename: string, complete: boolean }>}
 */
export async function exportTables(ids, apiBase = '/api') {
  let response;
  try {
    response = await fetch(`${apiBase}/export`, { method: 'POST', ...jsonInit('POST', { tables: ids }) });
  } catch {
    throw networkFailure();
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const e = readEnvelope(body, response);
    const known = EXPORT_MESSAGES[e.code];
    throw failure(known ?? e.sentence ?? ERROR_TEXT.exportFailed, e.code, undefined, known ? undefined : e.action, e.requestId);
  }
  const filename = filenameFrom(response.headers.get('Content-Disposition'), ids);
  const complete = response.headers.get('X-Export-Complete') === '1';
  let blob;
  try {
    blob = await response.blob();
  } catch {
    // The connection dropped while the file was coming down.
    throw networkFailure();
  }
  saveBlob(blob, filename);
  return { filename, complete };
}
