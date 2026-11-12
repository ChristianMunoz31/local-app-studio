// Plain text (UTF-8). Runs inside the parser child only. One unpaginated "page" with page: null.
import { LIMITS } from './limits.js';
import { cleanText, cutAt } from './clean.js';

/**
 * @param {Uint8Array} bytes
 * @returns {import('./result.js').ParseOutcome}
 */
export function parseText(bytes) {
  let decoded;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return { ok: false, code: 'unsupported' };
  }
  const text = cleanText(decoded.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'));
  if (text.trim() === '') return { ok: false, code: 'empty' };
  const truncated = text.length > LIMITS.maxChars;
  return {
    ok: true,
    kind: 'text',
    pages: [{ page: null, text: cutAt(text, LIMITS.maxChars) }],
    meta: { pageCount: null, paginated: false, truncated },
  };
}
