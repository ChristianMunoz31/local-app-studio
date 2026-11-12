// Heuristic redaction for app_state rows shown in exports and the audit log. Defense in
// depth, not a guarantee: real secrets no longer live in app_state.

import os from 'node:os';

export const REDACTED = '[redacted]';

// app_state rows no API ever returns (state, export): the license activation holds the buyer's
// email and is useless on another computer.
export const HIDDEN_APP_STATE_KEYS = new Set(['license.activation']);

// Substring match on a key normalized as: camelCase -> snake (insert '_' at lower->Upper),
// lowercase. Deliberately broad (fail closed): `author`/`authorName` are spared by the
// `auth(?!or)` lookahead, while `authorization` is re-added explicitly.
export const SENSITIVE_KEY_RE =
  /pass|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|accesskeyid|(^|_)pw($|_)|passcode|credential|private[_-]?key|session|cookie|bearer|signature|dsn|webhook|jwt|auth(?!or)|authoriz/;

// Applied to string values regardless of key. Prefix-style tokens must start the string
// or follow a non-alphanumeric character (so "task-1" does not match "sk-").
export const SENSITIVE_VALUE_RE = new RegExp(
  [
    '(?:^|[^A-Za-z0-9])(?:sk-|sk_(?:live|test)_|gsk_|gh[pousr]_|github_pat_|xox[abpr]-|ya29\\.|ABSK|bedrock-api-key-)',
    '(?:^|[^A-Za-z0-9])AKIA[0-9A-Z]{16}',
    '(?:^|[^A-Za-z0-9])AIza[0-9A-Za-z_-]{20,}',
    '(?:^|[^A-Za-z0-9])eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}',
    '\\bBearer\\s+\\S+',
    '://[^/\\s:]+:[^@\\s]+@',
  ].join('|'),
  'i',
);

// `{ name|key: 'OPENAI_API_KEY', value: ... }` pair objects: the value is sensitive
// because of its sibling label, whatever its own shape.
const LABEL_PROPS = ['name', 'key'];

const MAX_DEPTH = 20;

// Value regexes only scan the head of a string (bounds regex cost on huge values). A longer
// string that looks like a URL with userinfo may hide credentials past the head, so it is
// redacted conservatively.
const VALUE_SCAN_LIMIT = 4096;
// Strings that look like serialized JSON are parsed (up to this size) and redacted structurally.
const JSON_PARSE_LIMIT = 64 * 1024;

const isSensitiveString = (s) => {
  if (SENSITIVE_VALUE_RE.test(s.slice(0, VALUE_SCAN_LIMIT))) return true;
  return s.length > VALUE_SCAN_LIMIT && s.includes('://') && s.includes('@');
};

const normalizeKey = (key) =>
  String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();

const isSensitiveKey = (key) => SENSITIVE_KEY_RE.test(normalizeKey(key));

/**
 * Returns a redacted copy of `value`; never mutates the input. Fails closed past depth 20.
 * @param {unknown} value
 * @param {number} depth
 * @returns {unknown}
 */
export function redactValue(value, depth = 0) {
  if (depth > MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) {
    // `['API_KEY', 'abc']` entries-style pair: the second element is sensitive via its label.
    if (value.length === 2 && typeof value[0] === 'string' && isSensitiveKey(value[0])) {
      return [value[0], REDACTED];
    }
    return value.map((v) => redactValue(v, depth + 1));
  }
  if (value !== null && typeof value === 'object') {
    const labelled = LABEL_PROPS.some(
      (p) => typeof value[p] === 'string' && isSensitiveKey(value[p]),
    );
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = isSensitiveKey(k) || (labelled && k === 'value') ? REDACTED : redactValue(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') {
    const head = value.trimStart()[0];
    if ((head === '{' || head === '[') && value.length <= JSON_PARSE_LIMIT) {
      let parsed;
      try {
        parsed = JSON.parse(value);
      } catch {
        parsed = undefined;
      }
      if (parsed !== undefined && parsed !== null && typeof parsed === 'object') {
        return JSON.stringify(redactValue(parsed, depth + 1));
      }
    }
    if (isSensitiveString(value)) return REDACTED;
  }
  return value;
}

/**
 * @param {{ key?: string, value?: unknown }} row
 * @returns {{ key?: string, value?: unknown }}
 */
export function redactAppStateRow(row) {
  if (!row || typeof row !== 'object') return row;
  if (isSensitiveKey(row.key ?? '')) return { ...row, value: REDACTED };
  return { ...row, value: redactValue(row.value, 0) };
}

// ---------------------------------------------------------------------------------------------
// Text and details redaction for log lines, error envelope details and report files (phase 15).
// ---------------------------------------------------------------------------------------------

const TEXT_MAX_DEFAULT = 500;
const DETAILS_MAX_DEPTH = 6;
const DETAILS_MAX_KEYS = 30;
const DETAILS_MAX_ITEMS = 20;

// The sensitive-value prefixes, widened to swallow the rest of the token.
const SENSITIVE_SPAN_RE = new RegExp(`(?:${SENSITIVE_VALUE_RE.source})\\S*`, 'gi');
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const WINDOWS_PATH_RE = /[A-Za-z]:[\\/][^\s"'<>|]+/g;
const POSIX_HOME_PATH_RE = /\/(?:Users|home)\/[^\s"']+/g;

let redactDataDir = '';

/**
 * Sets the data folder that redactText replaces with <data> (called once by configureLog).
 * @param {string | null | undefined} dir
 */
export function setRedactDataDir(dir) {
  redactDataDir = typeof dir === 'string' ? dir : '';
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A folder path matched on both slash styles; case-insensitive on Windows.
const folderReCache = new Map();
function folderRe(dir) {
  if (folderReCache.has(dir)) return folderReCache.get(dir);
  const re = buildFolderRe(dir);
  if (folderReCache.size >= 8) folderReCache.clear();
  folderReCache.set(dir, re);
  return re;
}

function buildFolderRe(dir) {
  const parts = dir.split(/[\\/]+/).filter((p) => p !== '');
  if (parts.length === 0) return null;
  const lead = /^[\\/]/.test(dir) ? '[\\\\/]' : '';
  return new RegExp(lead + parts.map(escapeRe).join('[\\\\/]+'), process.platform === 'win32' ? 'gi' : 'g');
}

const lastSegment = (p) => p.split(/[\\/]/).filter((s) => s !== '').pop() ?? '';

/**
 * Redacts one string. Never throws. Order: secret-looking spans, e-mail addresses, the data folder (<data>),
 * the home folder (<home>), any other absolute path (<path>/<last segment>); then caps at `max` characters.
 * @param {unknown} text
 * @param {{ dataDir?: string, home?: string, max?: number }} [opts]
 * @returns {string}
 */
export function redactText(text, opts = {}) {
  try {
    let out = typeof text === 'string' ? text : String(text);
    const max = Number.isInteger(opts.max) && opts.max > 0 ? opts.max : TEXT_MAX_DEFAULT;
    // Bound the work on huge inputs: nothing past a few times the cap survives anyway.
    if (out.length > max * 4) out = out.slice(0, max * 4);
    out = out.replace(SENSITIVE_SPAN_RE, REDACTED);
    out = out.replace(EMAIL_RE, REDACTED);
    const dataDir = opts.dataDir ?? redactDataDir;
    if (dataDir) {
      const re = folderRe(dataDir);
      if (re) out = out.replace(re, '<data>');
    }
    const home = opts.home ?? os.homedir();
    if (home) {
      const re = folderRe(home);
      if (re) out = out.replace(re, '<home>');
    }
    out = out.replace(WINDOWS_PATH_RE, (m) => `<path>/${lastSegment(m)}`);
    out = out.replace(POSIX_HOME_PATH_RE, (m) => `<path>/${lastSegment(m)}`);
    return out.length > max ? `${out.slice(0, max)}...` : out;
  } catch {
    return REDACTED;
  }
}

function detailsWalk(value, depth, opts) {
  if (depth > DETAILS_MAX_DEPTH) return REDACTED;
  if (typeof value === 'string') return redactText(value, opts);
  if (Array.isArray(value)) {
    return value
      .slice(0, DETAILS_MAX_ITEMS)
      .filter((v) => !isDroppedValue(v))
      .map((v) => detailsWalk(v, depth + 1, opts));
  }
  if (value !== null && typeof value === 'object') {
    const out = {};
    const entries = Object.entries(value).filter(([, v]) => !isDroppedValue(v));
    for (const [k, v] of entries.slice(0, DETAILS_MAX_KEYS)) out[k] = detailsWalk(v, depth + 1, opts);
    if (entries.length > DETAILS_MAX_KEYS) out._truncated = true;
    return out;
  }
  return value;
}

// Removes functions and binary values before the key-based pass, so a Buffer is never walked byte by byte.
function stripBinary(value, depth) {
  if (depth > DETAILS_MAX_DEPTH + 1) return value;
  if (Array.isArray(value)) return value.filter((v) => !isDroppedValue(v)).map((v) => stripBinary(v, depth + 1));
  if (value !== null && typeof value === 'object' && !isDroppedValue(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (!isDroppedValue(v)) out[k] = stripBinary(v, depth + 1);
    return out;
  }
  return value;
}

const isDroppedValue = (v) =>
  typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint' || ArrayBuffer.isView(v) || v instanceof ArrayBuffer;

/**
 * Key-based redaction (redactValue), then redactText on every string. Depth 6 (deeper becomes [redacted]), at most 30
 * keys per object (`_truncated: true` added when more) and 20 items per array, functions, Buffers and typed arrays
 * dropped. A non-object input comes back as `{ value }`. Never throws.
 * @param {unknown} value
 * @param {{ dataDir?: string, home?: string, max?: number }} [opts]
 * @returns {Record<string, unknown>}
 */
export function redactDetails(value, opts = {}) {
  try {
    const walked = detailsWalk(redactValue(stripBinary(value, 0)), 0, opts);
    return walked !== null && typeof walked === 'object' && !Array.isArray(walked) ? walked : { value: walked };
  } catch {
    return { value: REDACTED };
  }
}
