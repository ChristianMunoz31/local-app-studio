// The allowlisted proxy from Studio's /api/preview/* to the preview child on loopback. Headers to the child are built
// from scratch (only the child's cookie, never the browser's); the child's cookies and policy headers never come back.
import http from 'node:http';
import { sendError } from '../../errors.js';

// Only the data API: it is all that the runtime UI SpecApp renders inside Studio calls (createHttpDataSource). The kit
// export endpoint is used only by the data browser, which a built app mounts and Studio does not.
export const PREVIEW_PATH_PREFIXES = Object.freeze(['/data']);
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const BAD_PATH = /\.\.|\\|%2e|%2f|%5c/i;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const IDLE_MS = 30000;
const PASS_HEADERS = ['content-type', 'content-disposition', 'content-length'];

const send = (res, status, code, message) => sendError(res, code, { status, ...(message ? { message } : {}) });

/**
 * @param {{ getTarget: () => ({ port: number, cookie: string } | null), request?: typeof http.request, timeoutMs?: number,
 *   maxResponseBytes?: number, idleMs?: number, isStarting?: () => boolean }} opts
 * @returns {import('express').RequestHandler}
 */
export function createPreviewProxy({ getTarget, request = http.request, timeoutMs = 30000, maxResponseBytes = MAX_RESPONSE_BYTES, idleMs = IDLE_MS, isStarting = () => false }) {
  return (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!METHODS.has(req.method)) return send(res, 405, 'method_not_allowed', 'That request is not supported here.');
    const suffix = req.url;
    const pathPart = suffix.split('?')[0];
    if (BAD_PATH.test(pathPart)) return send(res, 400, 'invalid_request', 'The request address is not valid.');
    if (!PREVIEW_PATH_PREFIXES.some((p) => pathPart === p || pathPart.startsWith(`${p}/`))) return send(res, 404, 'not_found');
    const target = getTarget();
    if (!target) {
      return send(res, 409, 'preview_not_running', isStarting() ? 'The preview is starting. Try again in a moment.' : 'Start the preview first.');
    }
    const declared = Number(req.headers['content-length']) > 0 || req.headers['transfer-encoding'] !== undefined;
    let payload = null;
    if (declared) {
      if (!req.is('application/json') || req.body === undefined) return send(res, 415, 'unsupported_media_type', 'The preview accepts JSON only.');
      payload = Buffer.from(JSON.stringify(req.body));
    }
    const headers = { host: `127.0.0.1:${target.port}`, cookie: `app_desktop=${target.cookie}` };
    // The preview child logs this request under the same id as the Studio server.
    const requestId = res.getHeader('X-Request-Id');
    if (typeof requestId === 'string') headers['x-request-id'] = requestId;
    if (typeof req.headers.accept === 'string') headers.accept = req.headers.accept;
    if (payload) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(payload.length);
    }
    let answered = false;
    const upstream = request({ host: '127.0.0.1', port: target.port, method: req.method, path: `/api${suffix}`, headers }, (up) => {
      answered = true;
      clearTimeout(timer);
      if (Number(up.headers['content-length']) > maxResponseBytes) {
        // Nothing is sent yet, so a clean error beats a truncated body.
        up.destroy();
        upstream.destroy();
        return send(res, 502, 'preview_failed', 'The preview sent back too much data.');
      }
      // Status and headers are applied with the first accepted chunk, so an over-cap body can still become a clean 502.
      let begun = false;
      let capped = false;
      let received = 0;
      const begin = () => {
        if (begun) return;
        begun = true;
        res.status(up.statusCode ?? 502);
        for (const name of PASS_HEADERS) if (up.headers[name] !== undefined) res.set(name, up.headers[name]);
      };
      up.on('data', (chunk) => {
        if (capped) return;
        received += chunk.length;
        if (received > maxResponseBytes) {
          capped = true;
          up.destroy();
          if (res.headersSent) res.destroy();
          else send(res, 502, 'preview_failed', 'The preview sent back too much data.');
          return;
        }
        begin();
        if (!res.write(chunk)) {
          up.pause();
          res.once('drain', () => up.resume());
        }
      });
      up.on('end', () => {
        if (capped) return;
        begin();
        res.end();
      });
      up.setTimeout(idleMs, () => {
        up.destroy();
        res.destroy();
      });
      up.on('error', () => res.destroy());
      return undefined;
    });
    const timer = setTimeout(() => {
      if (answered) return;
      answered = true;
      upstream.destroy();
      send(res, 504, 'preview_timeout', 'The preview took too long to answer.');
    }, timeoutMs);
    upstream.on('error', () => {
      clearTimeout(timer);
      if (res.headersSent || answered) return res.destroy();
      answered = true;
      return send(res, 502, 'preview_unavailable', 'The preview is not answering. Restart it.');
    });
    res.on('close', () => {
      clearTimeout(timer);
      if (!res.writableFinished) upstream.destroy();
    });
    if (payload) upstream.write(payload);
    return upstream.end();
  };
}
