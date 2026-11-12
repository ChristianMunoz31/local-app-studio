// POST /api/ingest/parse: a document (PDF, DOCX or UTF-8 text) in as base64 JSON, page text out. Registered behind
// the auth gate in server.js. Parsing runs in a child process (server/ingest/, docs/INGEST.md); this file is the
// route, the body limit and the HTTP status mapping.
//
// Body:    { "data": "<base64 document bytes>", "kind": "pdf" | "docx" | "text" }   (kind optional, sniffed otherwise)
// 200:     { ok: true, kind, pages: [...], meta: {...} }
// Errors:  { ok: false, error: <code>, code: <code>, message }
//   400 invalid_request   body is not { data: base64, kind? }
//   413 too_large         document over the input cap (also the JSON body limit)
//   422 unsupported | encrypted | empty | parse_failed   the document itself cannot be read
//   429 doc_busy          parse queue full, try again
//   500 doc_crashed       the parser process died or answered nonsense
//   503 doc_unavailable   the parser process could not be started
//   504 doc_timeout       the parse hit its time limit
// A client that disconnects aborts the parse (the child is killed) and gets no response.
// Every answer, including the body parser's own 400 and 413, is Cache-Control: no-store.
import express from 'express';
import rateLimit from 'express-rate-limit';
import { limiterHandler, sendError } from './errors.js';
import { makeRequireSignIn } from './export/access.js';
import { KINDS, LIMITS, failure, isParserBusy, parseDocument } from './ingest/index.js';

export const INGEST_BODY_PATH = '/api/ingest/parse';

// base64 is 4 chars per 3 bytes; a little room for the JSON wrapper.
const BASE64_MAX_CHARS = Math.ceil(LIMITS.maxInputBytes / 3) * 4 + 4;
const BODY_LIMIT = `${Math.ceil((BASE64_MAX_CHARS + 1024) / (1024 * 1024))}mb`;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

const STATUS = Object.freeze({
  unsupported: 422,
  encrypted: 422,
  empty: 422,
  parse_failed: 422,
  too_large: 413,
  doc_busy: 429,
  doc_crashed: 500,
  doc_unavailable: 503,
  doc_timeout: 504,
});

const sendFailure = (res, status, code, message) => sendError(res, code, { status, message, extra: { ok: false } });
const INVALID_MESSAGE = 'Send { data: <base64 document>, kind?: "pdf" | "docx" | "text" }.';
const invalid = (res) => sendFailure(res, 400, 'invalid_request', INVALID_MESSAGE);

/**
 * Validates a parsed body and decodes it. A separate function so the base64 string (about 1.33x the document) is
 * not referenced by the request handler while a job waits in the queue: only the decoded bytes stay alive.
 * @param {unknown} body
 * @returns {{ bytes: Buffer, kind: string | undefined } | { status: number, code: string, message: string }}
 */
function decodeBody(body) {
  const bad = { status: 400, code: 'invalid_request', message: INVALID_MESSAGE };
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return bad;
  const { data, kind } = body;
  if (typeof data !== 'string' || data.length === 0 || !BASE64_RE.test(data) || data.length % 4 === 1) return bad;
  if (data.length > BASE64_MAX_CHARS) return { status: 413, code: 'too_large', message: failure('too_large').message };
  if (kind !== undefined && !KINDS.includes(kind)) return bad;
  return { bytes: Buffer.from(data, 'base64'), kind };
}

/**
 * @param {import('express').Express} app
 * @param {{ authEnabled?: boolean, parse?: typeof parseDocument, isBusy?: () => boolean }} [opts] without auth, only
 *   loopback clients may parse (fail closed otherwise); `parse` and `isBusy` (is the parse queue full?) replace the
 *   real parser in tests
 */
export function registerIngestRoutes(app, { authEnabled = false, parse = parseDocument, isBusy = isParserBusy } = {}) {
  // Parsing is CPU and memory heavy: 60 requests per 15 minutes, on top of the global /api limit.
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    handler: limiterHandler({ message: 'Too many requests, please try again later.' }),
  });
  const requireSignIn = makeRequireSignIn({ authEnabled, action: 'Parsing' });
  const noStore = (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  };
  // A full queue answers before the (up to 34 MB) body is read and decoded: no memory is spent on a request that
  // cannot be queued. The check is repeated by the host when the job is queued.
  const rejectWhenBusy = (_req, res, next) => (isBusy() ? sendFailure(res, 429, 'doc_busy', failure('doc_busy').message) : next());
  const jsonParser = express.json({ limit: BODY_LIMIT });
  const parseBody = (req, res, next) =>
    jsonParser(req, res, (err) => {
      if (!err) return next();
      // body-parser errors can carry the raw body: answer with a fixed message, never the error.
      if ((err.status ?? err.statusCode) === 413) return sendFailure(res, 413, 'too_large', 'This document is too large to read.');
      return invalid(res);
    });

  // A Pro gate would go here (requirePro('<id>') from server/pro.js, mounted first); free in the spike.
  app.post(INGEST_BODY_PATH, noStore, requireSignIn, limiter, rejectWhenBusy, parseBody, async (req, res) => {
    const decoded = decodeBody(req.body);
    req.body = undefined; // the parsed body (and its base64 string) can be collected while the job waits
    if (!('bytes' in decoded)) return sendFailure(res, decoded.status, decoded.code, decoded.message);
    const { bytes, kind } = decoded;
    const abort = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) abort.abort();
    };
    res.once('close', onClose);
    try {
      const result = await parse(bytes, { kind, signal: abort.signal });
      if (abort.signal.aborted) return undefined;
      if (result.ok) return res.json(result);
      // An unknown code (a stub, a future parser) is never echoed: it becomes doc_crashed.
      const code = result.code in STATUS ? result.code : 'doc_crashed';
      return sendFailure(res, STATUS[code], code, failure(code).message);
    } catch {
      // parseDocument never rejects; this is a bug guard that must not leak error text.
      return sendFailure(res, 500, 'doc_crashed', failure('doc_crashed').message);
    } finally {
      res.off('close', onClose);
    }
  });
}
