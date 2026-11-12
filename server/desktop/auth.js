// Desktop sidecar auth. The shell and this process share a per-launch 32-byte secret (stdin handshake).
// The shell opens GET /desktop/bootstrap?token=<hex> once; that sets an HttpOnly session cookie, and
// every other request must carry it. Both values are HMACs of the secret, so the secret itself
// never travels over HTTP.
import crypto from 'node:crypto';
import { sendError } from '../errors.js';
import { isSameOrigin, resolveHostPolicy } from '../hostGuard.js';

export const BOOTSTRAP_PATH = '/desktop/bootstrap';
export const DESKTOP_COOKIE = 'app_desktop';
export const UNAUTHORIZED_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Local App Studio</title></head>' +
  '<body><p>Open Local App Studio from its app icon.</p></body></html>';

// Shown for a reused or wrong bootstrap token (for example a webview that lost its cookie).
export const LOST_SESSION_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Local App Studio</title></head>' +
  '<body><p>This Local App Studio window lost its session. Close Local App Studio and open it again.</p></body></html>';

const BOOTSTRAP_LABEL = 'desktop-bootstrap-v1';
const COOKIE_LABEL = 'desktop-cookie-v1';
const SECRET_BYTES = 32;
const TOKEN_HEX_RE = /^[0-9a-f]{64}$/;
const API_PREFIX_RE = /^\/api(\/|$)/i;

/** @type {{ bootstrap: Buffer, cookieText: string } | null} */
let state = null;
let bootstrapUsed = false;

const hmac = (secret, label) => crypto.createHmac('sha256', secret).update(label).digest();

/**
 * Install the launch secret (call once, before listening). Resets the single-use bootstrap flag.
 * @param {Buffer} secret 32 bytes
 */
export function initDesktopAuth(secret) {
  if (!Buffer.isBuffer(secret) || secret.length !== SECRET_BYTES) {
    throw new TypeError('Desktop secret must be a 32-byte Buffer');
  }
  state = { bootstrap: hmac(secret, BOOTSTRAP_LABEL), cookieText: hmac(secret, COOKIE_LABEL).toString('base64url') };
  bootstrapUsed = false;
}

/** Test seam: forget the secret so the gate fails closed. */
export function resetDesktopAuth() {
  state = null;
  bootstrapUsed = false;
}

const requireState = () => {
  if (!state) throw new Error('Desktop auth is not initialised');
  return state;
};

/** @returns {string} hex(HMAC-SHA256(secret, 'desktop-bootstrap-v1')) */
export const bootstrapToken = () => requireState().bootstrap.toString('hex');

/** @returns {string} base64url(HMAC-SHA256(secret, 'desktop-cookie-v1')) */
export const cookieValue = () => requireState().cookieText;

const safeEqual = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);

const readCookie = (req, name) => {
  const header = req.headers.cookie;
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
};

const hasValidCookie = (req) => {
  if (!state) return false;
  const presented = readCookie(req, DESKTOP_COOKIE);
  if (!presented) return false;
  return safeEqual(Buffer.from(presented), Buffer.from(state.cookieText));
};

const denyJson = (res, code) => {
  res.set('Cache-Control', 'no-store');
  return sendError(res, code);
};

/**
 * Middleware enforcing the desktop gate. Mount right after the host guard.
 * @param {{ env?: Record<string, string | undefined> }} [opts]
 * @returns {import('express').RequestHandler}
 */
export function createDesktopGate({ env = process.env } = {}) {
  const policy = resolveHostPolicy(env);
  return (req, res, next) => {
    if (req.method === 'GET' && req.path === BOOTSTRAP_PATH) {
      const token = req.query.token;
      const valid =
        !bootstrapUsed &&
        state !== null &&
        typeof token === 'string' &&
        TOKEN_HEX_RE.test(token) &&
        safeEqual(Buffer.from(token, 'hex'), Buffer.from(state.bootstrap));
      if (!valid) {
        res.set('Cache-Control', 'no-store');
        return res.status(403).type('text/html').send(LOST_SESSION_HTML);
      }
      bootstrapUsed = true;
      res.set('Cache-Control', 'no-store');
      res.append('Set-Cookie', `${DESKTOP_COOKIE}=${state.cookieText}; HttpOnly; SameSite=Strict; Path=/`);
      return res.redirect(302, '/');
    }

    if (String(req.get('sec-fetch-site') || '').toLowerCase() === 'cross-site') {
      return denyJson(res, 'cross_site_blocked');
    }
    const origin = req.get('origin');
    if (origin && req.method !== 'GET' && req.method !== 'HEAD' && !isSameOrigin(origin, req.get('host'), policy)) {
      return denyJson(res, 'origin_not_allowed');
    }

    if (hasValidCookie(req)) return next();
    if (API_PREFIX_RE.test(req.path)) return denyJson(res, 'desktop_auth_required');
    res.set('Cache-Control', 'no-store');
    return res.status(401).type('text/html').send(UNAUTHORIZED_HTML);
  };
}
