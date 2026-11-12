// DOCX text: a zip whose needed entries are inflated with hard size caps, then scanned for <w:t> text by a tiny
// tokenizer (no XML parser, so no entity expansion, DTD or external reference is ever processed). Runs inside
// the parser child only. DOCX has no pages: one unpaginated "page" with page: null and a paragraph index.
// Adapted from Burrow's docParsers.js (same limits and zip-bomb rules).
import { Unzip, UnzipInflate } from 'fflate';
import { LIMITS } from './limits.js';
import { cleanText, cutAt } from './clean.js';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Only the five predefined entities and numeric references; anything else stays as it is. */
function decodeEntities(s) {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);/g, (m, body) => {
    if (body[0] !== '#') return ENTITIES[body];
    const cp = body[1] === 'x' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
    if (!Number.isInteger(cp) || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) || cp === 0) return '';
    return String.fromCodePoint(cp);
  });
}

const nameEnd = (tag) => {
  for (let i = 0; i < tag.length; i += 1) {
    const c = tag.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10 || c === 13 || c === 47) return i;
  }
  return tag.length;
};

/**
 * The paragraphs of a WordprocessingML part: `<w:t>` runs, tabs and breaks, one string per `<w:p>`.
 * Stops once about `maxChars` characters were collected.
 * @param {string} xml
 * @param {number} maxChars
 * @returns {string[]}
 */
export function wordXmlToParagraphs(xml, maxChars) {
  const paragraphs = [];
  let current = [];
  let length = 0;
  let i = 0;
  const push = (s) => {
    current.push(s);
    length += s.length;
  };
  while (i < xml.length && length <= maxChars) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) break;
    const gt = xml.indexOf('>', lt + 1);
    if (gt === -1) break;
    const tag = xml.slice(lt + 1, gt);
    i = gt + 1;
    const first = tag.charCodeAt(0);
    if (first === 33 || first === 63) continue; // <! (comment, CDATA marker, DOCTYPE) and <? (declaration): ignored
    const closing = first === 47;
    const name = closing ? tag.slice(1, nameEnd(tag.slice(1)) + 1) : tag.slice(0, nameEnd(tag));
    const selfClosing = tag.charCodeAt(tag.length - 1) === 47;
    if (closing) {
      if (name === 'w:p') {
        paragraphs.push(current.join(''));
        current = [];
        length += 1;
      }
    } else if (name === 'w:t') {
      if (selfClosing) continue;
      const end = xml.indexOf('</w:t>', i);
      if (end === -1) break;
      push(decodeEntities(xml.slice(i, end)));
      i = end + 6;
    } else if (name === 'w:tab') push('\t');
    else if (name === 'w:br' || name === 'w:cr') push('\n');
  }
  if (current.length > 0) paragraphs.push(current.join(''));
  return paragraphs;
}

const WANTED_PART = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;
const SLICE = 16 * 1024;

/** document.xml first (so a text cap keeps the body), then the other parts by name. */
const partOrder = (a, b) => (a === 'word/document.xml' ? -1 : b === 'word/document.xml' ? 1 : a < b ? -1 : a > b ? 1 : 0);

/**
 * Inflates the wanted parts. Zip-bomb guards: at most `docxMaxEntries` entries, a declared size over the cap is
 * refused before inflating, and the bytes actually inflated are counted per entry and in total (the declared size
 * is never trusted). Unneeded entries (images, fonts, embedded files) are never inflated. The input is fed in
 * slices so one inflate burst is limited (a slice of deflate data can still expand to a few MB before the counters
 * see it, so an entry may overshoot its cap by that much before it is refused).
 * @param {Uint8Array} bytes
 * @returns {{ ok: true, parts: Map<string, Uint8Array> } | { ok: false, code: 'parse_failed' }}
 */
function readParts(bytes) {
  const parts = new Map();
  let entries = 0;
  let total = 0;
  let violation = false;
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (file) => {
    entries += 1;
    if (entries > LIMITS.docxMaxEntries) violation = true;
    if (violation || !WANTED_PART.test(file.name)) return;
    if (typeof file.originalSize === 'number' && file.originalSize > LIMITS.docxMaxEntryBytes) {
      violation = true;
      return;
    }
    const chunks = [];
    let size = 0;
    file.ondata = (err, chunk, final) => {
      if (violation) return;
      if (err) {
        violation = true;
        return;
      }
      size += chunk.length;
      total += chunk.length;
      if (size > LIMITS.docxMaxEntryBytes || total > LIMITS.docxMaxTotalBytes) {
        violation = true;
        file.terminate();
        return;
      }
      chunks.push(chunk);
      if (final) parts.set(file.name, Buffer.concat(chunks));
    };
    file.start();
  };
  try {
    for (let at = 0; at < bytes.length && !violation; at += SLICE) {
      unzip.push(bytes.subarray(at, Math.min(bytes.length, at + SLICE)), at + SLICE >= bytes.length);
    }
  } catch {
    return { ok: false, code: 'parse_failed' };
  }
  if (violation) return { ok: false, code: 'parse_failed' };
  return { ok: true, parts };
}

/**
 * @param {Uint8Array} bytes
 * @returns {import('./result.js').ParseOutcome}
 */
export function parseDocx(bytes) {
  const read = readParts(bytes);
  if (!read.ok) return read;
  if (!read.parts.has('word/document.xml')) return { ok: false, code: 'parse_failed' };
  const decoder = new TextDecoder('utf-8');
  const all = [];
  let length = 0;
  for (const name of [...read.parts.keys()].sort(partOrder)) {
    for (const raw of wordXmlToParagraphs(decoder.decode(read.parts.get(name)), LIMITS.maxChars - length + 1)) {
      const p = cleanText(raw);
      all.push(p);
      length += p.length + 1;
    }
    if (length > LIMITS.maxChars) break;
  }
  // Keep whole paragraphs up to the character cap, then record each one's offsets in the joined text.
  const kept = [];
  let used = 0;
  let truncated = false;
  for (const p of all) {
    if (used + p.length > LIMITS.maxChars) {
      // The boundary paragraph keeps its prefix (never half of a surrogate pair), so one huge paragraph is not "empty".
      const prefix = cutAt(p, Math.max(0, LIMITS.maxChars - used));
      if (prefix.length > 0) kept.push(prefix);
      truncated = true;
      break;
    }
    kept.push(p);
    used += p.length + 1;
  }
  const text = kept.join('\n');
  if (text.trim() === '') return { ok: false, code: 'empty' };
  let start = 0;
  const paragraphs = kept.map((p, index) => {
    const entry = { index, start, end: start + p.length };
    start += p.length + 1;
    return entry;
  });
  return {
    ok: true,
    kind: 'docx',
    pages: [{ page: null, text, paragraphs }],
    meta: { pageCount: null, paginated: false, truncated },
  };
}
