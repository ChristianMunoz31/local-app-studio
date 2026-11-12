import {
  ASSISTANT_CONTEXT_MAX_CHARS,
  ASSISTANT_MAX_MESSAGES,
  ASSISTANT_MAX_MESSAGE_CHARS,
  ASSISTANT_MAX_TOTAL_MESSAGE_CHARS,
  ASSISTANT_PAGE_LABELS,
  isAssistantPage,
} from './pages.js';

/** @typedef {'user'|'assistant'} AssistantRole */
/** @typedef {{ role: AssistantRole, content: string }} WireMessage */
/** @typedef {{ page: string, context: string, messages: WireMessage[] }} AdviceRequest */
/** @typedef {{ content: string, model: string, provider: string }} AdviceResult */
/** @typedef {{ data: AdviceResult }} AdviceSuccess */
/** @typedef {{ error: string, code: string, retryAfterMs?: number }} AdviceFailure */

const REDACTED = '[redacted]';
// Same token patterns as the client-side redactor (src/utils/assistantRedact.js).
const SECRET_TOKEN_RE =
  /\b(?:sk-|sk_(?:live|test)_|gsk_|gh[pousr]_|github_pat_|xox[abpr]-|ya29\.|ABSK|bedrock-api-key-)[A-Za-z0-9_\-.]{16,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+)?|Bearer\s+\S+|[A-Za-z0-9_-]{40,}/g;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B-\u001F\u007F]/g;
const FORMAT_CHARS_RE = /\p{Cf}/gu;

/**
 * Defense in depth: NFKC-normalize, strip format and control chars (except \n and \t),
 * then replace secret tokens.
 * @param {unknown} s
 * @returns {string}
 */
export function sanitizeAdviceText(s) {
  if (typeof s !== 'string') return '';
  return s
    .normalize('NFKC')
    .replace(FORMAT_CHARS_RE, '')
    .replace(CONTROL_CHARS_RE, '')
    .replace(SECRET_TOKEN_RE, REDACTED);
}

const DASH = '[\u2012-\u2015\u2E3A\u2E3B\uFE31\uFE32\uFE58]';
const HAS_DASH_RE = new RegExp(DASH);
// Fenced and inline code spans are captured, so split() keeps them at odd indexes.
const CODE_SPAN_RE = /(```[\s\S]*?```|`[^`\n]*`)/;
const TABLE_PLACEHOLDER_RE = new RegExp(String.raw`(\|[ \t]*)${DASH}+(?=[ \t]*\|)`, 'g');
// EN or figure dash between a digit and a digit or $ is a range.
const RANGE_RE = new RegExp(`(\\d)[ \\t]*[${String.fromCharCode(0x2012, 0x2013)}][ \\t]*(?=[$\\d])`, 'g');
const ISO_DATE_END_RE = /^\d{4}-\d{2}-\d{2}$/;
const LINE_START_FIRST_RE = new RegExp(String.raw`(^|\n)([ \t]*)(?:${DASH}[ \t]*)+`, 'g');
const LINE_START_MID_RE = new RegExp(String.raw`(\n)([ \t]*)(?:${DASH}[ \t]*)+`, 'g');
// The lookbehind stops matches from starting inside a run of spaces (no quadratic scan).
const PROSE_RE = new RegExp(
  String.raw`(?<![ \t]),?[ \t]*${DASH}(?:[ \t]*${DASH})*[ \t]*(?:,[ \t]*)?`,
  'g',
);

function stripDashesInPart(part, atLineStart) {
  return part
    .replace(TABLE_PLACEHOLDER_RE, '$1n/a')
    .replace(RANGE_RE, (_m, digit, offset, whole) =>
      ISO_DATE_END_RE.test(whole.slice(Math.max(0, offset - 9), offset + 1))
        ? `${digit} to `
        : `${digit}-`,
    )
    .replace(atLineStart ? LINE_START_FIRST_RE : LINE_START_MID_RE, '$1$2')
    .replace(PROSE_RE, ', ');
}

/**
 * Remove em/en-style dashes from model output (U+2012 to U+2015 and a few lookalikes).
 * Code spans are left alone. EN/figure-dash digit ranges (digits joined by an en dash, like 3 to 5 or $50 to $75) become a
 * hyphen ("to" after an ISO date), a lone "| - |" table cell becomes "n/a", a dash leading a
 * line is dropped (never leaving "- ", which markdown would render as a bullet), and any
 * other dash becomes ", ". Mirrored client-side in src/utils/assistantDashes.js.
 * @param {unknown} text
 * @returns {string}
 */
export function stripDashes(text) {
  if (typeof text !== 'string') return '';
  if (!HAS_DASH_RE.test(text)) return text;
  return text
    .split(CODE_SPAN_RE)
    .map((part, i) => (i % 2 === 1 ? part : stripDashesInPart(part, i === 0)))
    .join('');
}

/** Clip to `max` UTF-16 units without leaving a lone high surrogate at the cut. */
function clipText(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

const fail = (status, code, error) => ({ ok: false, status, code, error });

/** Every `code` validateAdviceRequest can return; each has a row in src/errors/copy.core.js. */
export const ADVICE_ERROR_CODES = Object.freeze([
  'invalid_request',
  'unknown_page',
  'invalid_context',
  'context_too_large',
  'invalid_messages',
  'too_many_messages',
  'message_too_long',
  'payload_too_large',
]);

/**
 * Validate and normalize a POST /api/assistant/advice body.
 * @param {unknown} body
 * @returns {{ ok: true, value: { page: string, pageLabel: string, context: string, messages: WireMessage[] } }
 *         | { ok: false, status: 400|413, code: string, error: string }}
 */
export function validateAdviceRequest(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return fail(400, 'invalid_request', 'Invalid request body');
  }
  const { page, context: rawContext, messages: rawMessages } = body;

  if (!isAssistantPage(page)) return fail(400, 'unknown_page', 'Unknown page');

  const context = rawContext === undefined || rawContext === null ? '' : rawContext;
  if (typeof context !== 'string') return fail(400, 'invalid_context', 'context must be a string');
  if (context.length > ASSISTANT_CONTEXT_MAX_CHARS) {
    return fail(413, 'context_too_large', 'Page context too large');
  }

  const list = rawMessages === undefined || rawMessages === null ? [] : rawMessages;
  if (!Array.isArray(list)) return fail(400, 'invalid_messages', 'messages must be an array');
  if (list.length > ASSISTANT_MAX_MESSAGES) return fail(413, 'too_many_messages', 'Too many messages');

  let total = 0;
  /** @type {WireMessage[]} */
  const messages = [];
  for (const m of list) {
    if (m === null || typeof m !== 'object' || Array.isArray(m)) {
      return fail(400, 'invalid_messages', 'Invalid message');
    }
    if (m.role !== 'user' && m.role !== 'assistant') {
      return fail(400, 'invalid_messages', 'Invalid message role');
    }
    if (typeof m.content !== 'string') {
      return fail(400, 'invalid_messages', 'Message content must be a non-empty string');
    }
    if (m.content.length > ASSISTANT_MAX_MESSAGE_CHARS) {
      return fail(413, 'message_too_long', 'Message too long');
    }
    // Sanitize first: the non-empty check and the caps must hold on what the model sees.
    const content = clipText(sanitizeAdviceText(m.content), ASSISTANT_MAX_MESSAGE_CHARS);
    if (content.trim() === '') {
      return fail(400, 'invalid_messages', 'Message content must be a non-empty string');
    }
    total += content.length;
    if (total > ASSISTANT_MAX_TOTAL_MESSAGE_CHARS) {
      return fail(413, 'payload_too_large', 'Messages too large');
    }
    messages.push({ role: m.role, content });
  }

  for (let i = 1; i < messages.length; i += 1) {
    if (messages[i].role === messages[i - 1].role) {
      return fail(400, 'invalid_messages', 'Messages must alternate between user and assistant');
    }
  }
  if (messages.length > 0 && messages[messages.length - 1].role !== 'user') {
    return fail(400, 'invalid_messages', 'The last message must be from the user');
  }

  return {
    ok: true,
    value: {
      page,
      pageLabel: ASSISTANT_PAGE_LABELS[page],
      context: clipText(sanitizeAdviceText(context), ASSISTANT_CONTEXT_MAX_CHARS),
      messages,
    },
  };
}
