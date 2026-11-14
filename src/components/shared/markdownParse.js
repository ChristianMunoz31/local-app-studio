// A small, safe markdown parser for the Assistant. Pure: text in, token tree out, no DOM and no React.
//
// Safety rules (tests: __tests__/markdownParse.test.js and Markdown.test.jsx):
//   - Raw HTML is never parsed. "<" is plain text, so tags show as text.
//   - Images are never fetched: an image token carries only its alt text and a validated href.
//   - A link target must be http, https or mailto (see safeHref). Anything else becomes plain text.
//   - Every text value is a plain string; the renderer hands it to React as a text child.
//
// Bounded work: block parsing is line based and recursion is capped (MAX_BLOCK_DEPTH); inline parsing
// is one pass with a step budget, no regex with nested quantifiers runs on user text, and destination,
// autolink and nesting sizes are capped.
//
// Syntax: paragraphs, soft and hard line breaks, **bold**, *italic*, ~~strikethrough~~, `code`, fenced
// code (backticks or tildes), ATX and setext headings, rules, block quotes, bullet and numbered lists
// (nested, with task items), GFM tables (with alignment), [text](url "title"), <url> and bare
// http(s):// and www. autolinks, backslash escapes and the common entities.
//
// Not supported: raw HTML, indented code blocks, reference links, footnotes, bare email autolinks,
// single-tilde strikethrough, math.

const MAX_BLOCK_DEPTH = 10;
const MAX_INLINE_DEPTH = 24;
const MAX_URL = 2048;
const MAX_TITLE = 1024;
const MAX_PAREN_DEPTH = 32;

// ---------------------------------------------------------------------------------------------
// URLs

// Control, whitespace and invisible characters that browsers drop inside a scheme.
// eslint-disable-next-line no-control-regex
const URL_STRIP = /[\u0000-\u0020\u007f-\u00a0\u00ad\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2064\u3000\ufeff]/g;

/**
 * Returns the cleaned href when it is an http, https or mailto URL, else null. The scheme check runs on
 * the same string that is returned, so what is checked is what is rendered.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function safeHref(raw) {
  if (typeof raw !== 'string' || raw.length > 4 * MAX_URL) return null;
  const s = raw.replace(URL_STRIP, '');
  if (/^https?:\/\/[^/?#\\]/i.test(s)) return s;
  if (/^mailto:./i.test(s)) return s;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Entities and escapes

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  copy: '\u00a9',
  reg: '\u00ae',
  hellip: '\u2026',
};

const ESCAPABLE = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';

function fromCodePoint(cp) {
  if (!Number.isInteger(cp) || cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '\ufffd';
  return String.fromCodePoint(cp);
}

/** Entity at the start of `s` (which begins with "&"), as { text, len }, or null. */
function entityAt(s, i) {
  const m = /^&(?:#([0-9]{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/.exec(s.slice(i, i + 40));
  if (!m) return null;
  if (m[1] !== undefined) return { text: fromCodePoint(Number(m[1])), len: m[0].length };
  if (m[2] !== undefined) return { text: fromCodePoint(parseInt(m[2], 16)), len: m[0].length };
  const named = Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, m[3]) ? NAMED_ENTITIES[m[3]] : null;
  return named === null ? null : { text: named, len: m[0].length };
}

/** Backslash escapes and entities of a link destination or title. */
function unescapeText(s) {
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length && ESCAPABLE.includes(s[i + 1])) {
      out += s[i + 1];
      i += 1;
    } else if (c === '&') {
      const e = entityAt(s, i);
      if (e) {
        out += e.text;
        i += e.len - 1;
      } else {
        out += c;
      }
    } else {
      out += c;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Inline

const WS_TEST = /\s/;
const PUNCT_TEST = /[\p{P}\p{S}]/u;
const ALNUM_TEST = /[\p{L}\p{N}]/u;

const isWsChar = (ch) => ch === '' || WS_TEST.test(ch);
const isPunctChar = (ch) => ch !== '' && PUNCT_TEST.test(ch);

// Characters that end a plain-text run in the inline scanner.
const SPECIAL = new Set([92, 10, 96, 38, 60, 33, 91, 93, 42, 95, 126, 104, 72, 119, 87]);

function pushNode(list, node) {
  const last = list[list.length - 1];
  if (node.t === 'text' && last && last.t === 'text') {
    last.v += node.v;
    return;
  }
  list.push(node.t === 'text' ? { t: 'text', v: node.v } : node);
}

/** Plain text of inline nodes (the alt text of an image). */
function textOf(nodes) {
  let out = '';
  for (const node of nodes) {
    if (node.t === 'text' || node.t === 'code') out += node.v;
    else if (node.t === 'br') out += ' ';
    else if (node.t === 'img') out += node.alt;
    else if (node.c) out += textOf(node.c);
  }
  return out;
}

/** Matches emphasis delimiters (CommonMark delimiter algorithm) by recording opens and closes on them. */
function matchEmphasis(ds, budget) {
  for (let k = 0; k < ds.length; k += 1) {
    ds[k].prev = k > 0 ? ds[k - 1] : null;
    ds[k].next = k < ds.length - 1 ? ds[k + 1] : null;
  }
  let head = ds.length ? ds[0] : null;
  const unlink = (d) => {
    if (d.prev) d.prev.next = d.next;
    else head = d.next;
    if (d.next) d.next.prev = d.prev;
  };
  const bottoms = new Map();
  let cur = head;
  while (cur) {
    if (!cur.canClose || cur.n === 0) {
      cur = cur.next;
      continue;
    }
    const key = `${cur.ch}${cur.canOpen ? 1 : 0}${cur.orig % 3}`;
    const bottom = bottoms.has(key) ? bottoms.get(key) : null;
    let op = cur.prev;
    let found = null;
    while (op && op !== bottom) {
      budget.left -= 1;
      if (budget.left <= 0) return;
      if (op.ch === cur.ch && op.canOpen && op.n > 0) {
        const oddMatch =
          cur.ch !== '~' && (op.canClose || cur.canOpen) && (op.orig + cur.orig) % 3 === 0 && !(op.orig % 3 === 0 && cur.orig % 3 === 0);
        if (!oddMatch) {
          found = op;
          break;
        }
      }
      op = op.prev;
    }
    if (!found) {
      bottoms.set(key, cur.prev);
      const next = cur.next;
      if (!cur.canOpen) unlink(cur);
      cur = next;
      continue;
    }
    const use = cur.ch === '~' ? 2 : found.n >= 2 && cur.n >= 2 ? 2 : 1;
    found.n -= use;
    cur.n -= use;
    found.opens.push({ use, ch: cur.ch });
    cur.closes.push({ use, ch: cur.ch });
    found.next = cur;
    cur.prev = found;
    if (found.n === 0) unlink(found);
    if (cur.n === 0) {
      const next = cur.next;
      unlink(cur);
      cur = next;
    }
  }
}

/** Builds the nested node list from flat items whose delimiters carry their matches. */
function buildTree(items) {
  const root = { c: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  for (const item of items) {
    if (item.t !== 'delim') {
      pushNode(top().c, item);
      continue;
    }
    for (let k = 0; k < item.closes.length; k += 1) {
      if (stack.length <= 1) break;
      const node = stack.pop();
      if (node.t === 'frag') node.c.forEach((child) => pushNode(top().c, child));
      else pushNode(top().c, node);
    }
    if (item.n > 0) pushNode(top().c, { t: 'text', v: item.ch.repeat(item.n) });
    for (let k = item.opens.length - 1; k >= 0; k -= 1) {
      const { use, ch } = item.opens[k];
      const t = stack.length > MAX_INLINE_DEPTH ? 'frag' : ch === '~' ? 'del' : use === 2 ? 'strong' : 'em';
      stack.push({ t, c: [] });
    }
  }
  while (stack.length > 1) {
    const node = stack.pop();
    if (node.t === 'frag') node.c.forEach((child) => pushNode(top().c, child));
    else pushNode(top().c, node);
  }
  return root.c;
}

/**
 * Parses inline markdown into nodes: { t: 'text', v }, { t: 'code', v }, { t: 'br' }, { t: 'img', alt, href } (href is null when the destination is not http, https or mailto, as for a link),
 * { t: 'a', href, c } (href is null when the destination is not http, https or mailto) and
 * { t: 'strong' | 'em' | 'del', c }.
 * @param {string} src
 * @returns {object[]}
 */
export function parseInline(src) {
  const n = src.length;
  const items = [];
  const delims = [];
  const brackets = [];
  const budget = { left: 40 * n + 4000 };
  let buf = '';
  let i = 0;
  let watermark = 0;
  let gtAt = -1; // index of the nearest ">" after the last "<" scanned (Infinity when none)
  let runs = null;
  const runPtr = new Map();

  const flush = () => {
    if (buf) {
      items.push({ t: 'text', v: buf });
      buf = '';
    }
  };

  const findCloser = (k, from) => {
    if (!runs) {
      runs = new Map();
      let p = 0;
      while (p < n) {
        if (src.charCodeAt(p) === 96) {
          let q = p;
          while (q < n && src.charCodeAt(q) === 96) q += 1;
          const arr = runs.get(q - p) ?? [];
          arr.push(p);
          runs.set(q - p, arr);
          p = q;
        } else {
          p += 1;
        }
      }
    }
    const arr = runs.get(k);
    if (!arr) return -1;
    let idx = runPtr.get(k) ?? 0;
    while (idx < arr.length && arr[idx] < from) idx += 1;
    runPtr.set(k, idx);
    return idx < arr.length ? arr[idx] : -1;
  };

  const skipSpace = (p) => {
    let q = p;
    while (q < n && (src[q] === ' ' || src[q] === '\t' || src[q] === '\n')) q += 1;
    return q;
  };

  // Parses `(destination "title")` after the "(" at p-1. Returns { href, end } (end is the ")" index) or null.
  const parseDestination = (p) => {
    let q = skipSpace(p);
    let raw;
    if (src[q] === '<') {
      let r = q + 1;
      while (r < n && r - q <= MAX_URL && src[r] !== '>' && src[r] !== '<' && src[r] !== '\n') r += 1;
      if (src[r] !== '>') return null;
      raw = src.slice(q + 1, r);
      budget.left -= r - q;
      q = r + 1;
    } else {
      let r = q;
      let depth = 0;
      while (r < n && r - q < MAX_URL) {
        const code = src.charCodeAt(r);
        if (code <= 32 || code === 127) break;
        if (src[r] === '\\' && r + 1 < n && ESCAPABLE.includes(src[r + 1])) {
          r += 2;
          continue;
        }
        if (src[r] === '(') {
          depth += 1;
          if (depth > MAX_PAREN_DEPTH) return null;
        } else if (src[r] === ')') {
          if (depth === 0) break;
          depth -= 1;
        }
        r += 1;
      }
      if (r - q >= MAX_URL || depth !== 0) return null;
      raw = src.slice(q, r);
      budget.left -= r - q;
      q = r;
    }
    q = skipSpace(q);
    const open = src[q];
    if (open === '"' || open === "'" || open === '(') {
      const close = open === '(' ? ')' : open;
      let r = q + 1;
      while (r < n && r - q <= MAX_TITLE && src[r] !== close) {
        if (src[r] === '\\') r += 1;
        r += 1;
      }
      if (src[r] !== close) return null;
      budget.left -= r - q;
      q = skipSpace(r + 1);
    }
    if (src[q] !== ')') return null;
    return { href: unescapeText(raw), end: q };
  };

  const tryAutolink = (p) => {
    const head = src.slice(p, p + 8).toLowerCase();
    let skip;
    if (head.startsWith('https://')) skip = 8;
    else if (head.startsWith('http://')) skip = 7;
    else if (head.startsWith('www.')) skip = 4;
    else return null;
    if (p > 0 && /[\p{L}\p{N}/@.]/u.test(src[p - 1])) return null;
    if (!ALNUM_TEST.test(src[p + skip] ?? '')) return null;
    const max = Math.min(n, p + MAX_URL);
    let end = p + skip;
    let opens = 0;
    let closes = 0;
    while (end < max) {
      const code = src.charCodeAt(end);
      if (code <= 32 || code === 34 || code === 60 || code === 127) break;
      if (code === 40) opens += 1;
      else if (code === 41) closes += 1;
      end += 1;
    }
    while (end > p + skip) {
      const c = src[end - 1];
      if ('?!.,:*_~\'";'.includes(c)) {
        end -= 1;
      } else if (c === ')' && closes > opens) {
        closes -= 1;
        end -= 1;
      } else {
        break;
      }
    }
    if (end <= p + skip) return null;
    const text = src.slice(p, end);
    const href = safeHref(skip === 4 ? `http://${text}` : text);
    return href === null ? null : { text, href, end };
  };

  const closeBracket = () => {
    const opener = brackets.pop();
    if (!opener) {
      buf += ']';
      i += 1;
      return;
    }
    const active = opener.image || brackets.length >= watermark;
    if (watermark > brackets.length) watermark = brackets.length;
    const dest = active && src[i + 1] === '(' && budget.left > 0 ? parseDestination(i + 2) : null;
    if (!dest) {
      buf += ']';
      i += 1;
      return;
    }
    flush();
    const inner = items.splice(opener.idx + 1);
    items.pop();
    const innerDelims = delims.splice(opener.delimStart);
    matchEmphasis(innerDelims, budget);
    const children = buildTree(inner);
    if (opener.image) {
      items.push({ t: 'img', alt: textOf(children), href: safeHref(dest.href) });
    } else {
      const href = safeHref(dest.href);
      // An unsafe destination keeps the link node with href null: the renderer shows the label as plain
      // text, or hands it to a component override with no href (the Assistant's SafeLink does that).
      items.push({ t: 'a', href, c: children });
      watermark = brackets.length;
    }
    i = dest.end + 1;
  };

  while (i < n) {
    const code = src.charCodeAt(i);
    if (!SPECIAL.has(code)) {
      let j = i + 1;
      while (j < n && !SPECIAL.has(src.charCodeAt(j))) j += 1;
      buf += src.slice(i, j);
      i = j;
      continue;
    }
    const c = src[i];
    if (c === '\\') {
      const next = src[i + 1];
      if (next === '\n') {
        flush();
        items.push({ t: 'br' });
        i += 2;
      } else if (next !== undefined && ESCAPABLE.includes(next)) {
        buf += next;
        i += 2;
      } else {
        buf += c;
        i += 1;
      }
    } else if (c === '\n') {
      let e = buf.length;
      while (e > 0 && buf.charCodeAt(e - 1) === 32) e -= 1;
      const hard = buf.length - e >= 2;
      buf = buf.slice(0, e);
      if (hard) {
        flush();
        items.push({ t: 'br' });
      } else {
        buf += '\n';
      }
      i += 1;
    } else if (c === '`') {
      let k = 1;
      while (src.charCodeAt(i + k) === 96) k += 1;
      const close = findCloser(k, i + k);
      if (close < 0) {
        buf += '`'.repeat(k);
        i += k;
      } else {
        flush();
        let raw = src.slice(i + k, close).replace(/\n/g, ' ');
        if (raw.length > 2 && raw[0] === ' ' && raw[raw.length - 1] === ' ' && raw.trim().length > 0) raw = raw.slice(1, -1);
        items.push({ t: 'code', v: raw });
        i = close + k;
      }
    } else if (c === '&') {
      const e = entityAt(src, i);
      if (e) {
        buf += e.text;
        i += e.len;
      } else {
        buf += c;
        i += 1;
      }
    } else if (c === '<') {
      // The nearest ">" is cached so a run of "<" with no ">" costs one scan, not one per "<".
      if (gtAt < i + 1) {
        const found = src.indexOf('>', i + 1);
        gtAt = found < 0 ? Infinity : found;
      }
      const end = gtAt;
      const candidate = end - i <= MAX_URL ? src.slice(i + 1, end) : '';
      const href = candidate && /^[^\s<>]+$/.test(candidate) ? safeHref(candidate) : null;
      if (href === null) {
        buf += c;
        i += 1;
      } else {
        flush();
        items.push({ t: 'a', href, c: [{ t: 'text', v: candidate }] });
        i = end + 1;
      }
    } else if (c === '!' && src[i + 1] === '[') {
      flush();
      items.push({ t: 'text', v: '![' });
      brackets.push({ idx: items.length - 1, image: true, delimStart: delims.length });
      i += 2;
    } else if (c === '[') {
      flush();
      items.push({ t: 'text', v: '[' });
      brackets.push({ idx: items.length - 1, image: false, delimStart: delims.length });
      i += 1;
    } else if (c === ']') {
      closeBracket();
    } else if (c === '*' || c === '_' || c === '~') {
      let k = 1;
      while (src[i + k] === c) k += 1;
      const prev = i > 0 ? src[i - 1] : '';
      const next = i + k < n ? src[i + k] : '';
      const prevWs = isWsChar(prev);
      const nextWs = isWsChar(next);
      const prevP = isPunctChar(prev);
      const nextP = isPunctChar(next);
      const left = !nextWs && (!nextP || prevWs || prevP);
      const right = !prevWs && (!prevP || nextWs || nextP);
      let canOpen = left;
      let canClose = right;
      if (c === '_') {
        canOpen = left && (!right || prevP);
        canClose = right && (!left || nextP);
      }
      if ((c === '~' && k !== 2) || (!canOpen && !canClose)) {
        buf += c.repeat(k);
      } else {
        flush();
        const d = { t: 'delim', ch: c, n: k, orig: k, canOpen, canClose, opens: [], closes: [], prev: null, next: null };
        items.push(d);
        delims.push(d);
      }
      i += k;
    } else {
      // h, H, w, W: a bare link, only outside brackets so a link never nests in a link.
      const auto = brackets.length === 0 ? tryAutolink(i) : null;
      if (auto) {
        flush();
        items.push({ t: 'a', href: auto.href, c: [{ t: 'text', v: auto.text }] });
        i = auto.end;
      } else {
        buf += c;
        i += 1;
      }
    }
  }
  flush();
  matchEmphasis(delims, budget);
  return buildTree(items);
}

// ---------------------------------------------------------------------------------------------
// Blocks

function indentOf(line) {
  let col = 0;
  for (let i = 0; i < line.length; i += 1) {
    const c = line.charCodeAt(i);
    if (c === 32) col += 1;
    else if (c === 9) col += 4 - (col % 4);
    else break;
  }
  return col;
}

function isBlank(line) {
  for (let i = 0; i < line.length; i += 1) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** Removes up to `n` columns of leading whitespace. */
function stripIndent(line, n) {
  let col = 0;
  let i = 0;
  while (i < line.length && col < n) {
    if (line[i] === ' ') {
      col += 1;
      i += 1;
    } else if (line[i] === '\t') {
      const w = 4 - (col % 4);
      if (col + w > n) return ' '.repeat(col + w - n) + line.slice(i + 1);
      col += w;
      i += 1;
    } else {
      break;
    }
  }
  return line.slice(i);
}

function firstNonWs(line) {
  let p = 0;
  while (line[p] === ' ' || line[p] === '\t') p += 1;
  return p;
}

function fenceOpen(line) {
  const ind = indentOf(line);
  if (ind > 3) return null;
  const p = firstNonWs(line);
  const ch = line[p];
  if (ch !== '`' && ch !== '~') return null;
  let q = p;
  while (line[q] === ch) q += 1;
  if (q - p < 3) return null;
  const info = line.slice(q).trim();
  if (ch === '`' && info.includes('`')) return null;
  return { ch, len: q - p, indent: ind, info };
}

function fenceCloses(line, f) {
  if (indentOf(line) > 3) return false;
  const t = line.trim();
  if (t.length < f.len) return false;
  for (let k = 0; k < t.length; k += 1) if (t[k] !== f.ch) return false;
  return true;
}

function atx(line) {
  if (indentOf(line) > 3) return null;
  const p = firstNonWs(line);
  let q = p;
  while (line[q] === '#') q += 1;
  const level = q - p;
  if (level < 1 || level > 6) return null;
  if (q < line.length && line[q] !== ' ' && line[q] !== '\t') return null;
  let text = line.slice(q).trim();
  let e = text.length;
  while (e > 0 && text[e - 1] === '#') e -= 1;
  if (e < text.length && (e === 0 || text[e - 1] === ' ' || text[e - 1] === '\t')) text = text.slice(0, e).trim();
  return { level, text };
}

function isHr(line) {
  if (indentOf(line) > 3) return false;
  const t = line.trim();
  const ch = t[0];
  if (ch !== '-' && ch !== '*' && ch !== '_') return false;
  let count = 0;
  for (let k = 0; k < t.length; k += 1) {
    if (t[k] === ch) count += 1;
    else if (t[k] !== ' ' && t[k] !== '\t') return false;
  }
  return count >= 3;
}

function isQuote(line) {
  return indentOf(line) <= 3 && line[firstNonWs(line)] === '>';
}

function stripQuote(line) {
  const rest = line.slice(firstNonWs(line) + 1);
  return rest[0] === ' ' ? rest.slice(1) : rest;
}

/** 1 for a line of "=", 2 for a line of "-" (a setext underline), else 0. */
function setextLevel(line) {
  if (indentOf(line) > 3) return 0;
  const t = line.trim();
  if (!t) return 0;
  const ch = t[0];
  if (ch !== '=' && ch !== '-') return 0;
  for (let k = 1; k < t.length; k += 1) if (t[k] !== ch) return 0;
  return ch === '=' ? 1 : 2;
}

function listMarker(line) {
  const ind = indentOf(line);
  if (ind > 3) return null;
  const p = firstNonWs(line);
  const c = line[p];
  let q = p;
  let bullet = false;
  let ch;
  let num = 0;
  if (c === '-' || c === '*' || c === '+') {
    bullet = true;
    ch = c;
    q = p + 1;
  } else if (c >= '0' && c <= '9') {
    while (q < line.length && q - p < 9 && line[q] >= '0' && line[q] <= '9') q += 1;
    const d = line[q];
    if (d !== '.' && d !== ')') return null;
    num = Number(line.slice(p, q));
    ch = d;
    q += 1;
  } else {
    return null;
  }
  if (q < line.length && line[q] !== ' ' && line[q] !== '\t') return null;
  const markerEnd = ind + (q - p);
  let col = markerEnd;
  let r = q;
  while (r < line.length && (line[r] === ' ' || line[r] === '\t')) {
    col += line[r] === '\t' ? 4 - (col % 4) : 1;
    r += 1;
  }
  const empty = r >= line.length;
  const spaces = col - markerEnd;
  const contentIndent = empty || spaces > 4 ? markerEnd + 1 : col;
  return { bullet, ch, num, contentIndent, text: empty ? '' : line.slice(r), empty };
}

/** Does this line start a block that may interrupt a paragraph? */
function startsBlock(line) {
  if (indentOf(line) > 3) return false;
  if (fenceOpen(line) || atx(line) || isHr(line) || isQuote(line)) return true;
  const m = listMarker(line);
  return Boolean(m && !m.empty && (m.bullet || m.num === 1));
}

function splitRow(line) {
  let s = line.trim();
  if (s[0] === '|') s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '|') {
      cur += '|';
      i += 1;
    } else if (c === '|') {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  cells.push(cur.trim());
  return cells;
}

/** Alignments of a table delimiter row ('left' | 'right' | 'center' | null per column), or null when it is not one. */
function delimiterRow(line) {
  if (line === undefined || indentOf(line) > 3 || !line.includes('|') || !line.includes('-')) return null;
  const aligns = [];
  for (const cell of splitRow(line)) {
    if (!/^:?-+:?$/.test(cell)) return null;
    const l = cell[0] === ':';
    const r = cell[cell.length - 1] === ':';
    aligns.push(l && r ? 'center' : r ? 'right' : l ? 'left' : null);
  }
  return aligns;
}

function tableAt(lines, i) {
  const header = lines[i];
  if (indentOf(header) > 3 || !header.includes('|')) return null;
  const aligns = delimiterRow(lines[i + 1]);
  if (!aligns) return null;
  const head = splitRow(header);
  if (head.length !== aligns.length) return null;
  const rows = [];
  let j = i + 2;
  while (j < lines.length && !isBlank(lines[j]) && !startsBlock(lines[j])) {
    const cells = splitRow(lines[j]);
    while (cells.length < aligns.length) cells.push('');
    rows.push(cells.slice(0, aligns.length).map(parseInline));
    j += 1;
  }
  return { node: { t: 'table', aligns, head: head.map(parseInline), rows }, next: j };
}

function sameListKind(a, b) {
  return a.bullet === b.bullet && (a.bullet || a.ch === b.ch);
}

function buildItem(itemLines, depth) {
  let task = null;
  const m = /^\[([ xX])\](?:[ \t]|$)/.exec(itemLines[0]);
  if (m) {
    task = m[1] !== ' ';
    itemLines[0] = itemLines[0].slice(m[0].length);
  }
  return { blocks: parseBlocks(itemLines, depth + 1), task };
}

function parseList(lines, start, depth) {
  const n = lines.length;
  const first = listMarker(lines[start]);
  const items = [];
  let loose = false;
  let cur = first;
  let i = start;
  for (;;) {
    const itemLines = [cur.text];
    let j = i + 1;
    while (j < n) {
      const l = lines[j];
      if (isBlank(l)) {
        let k = j + 1;
        while (k < n && isBlank(lines[k])) k += 1;
        if (k < n && indentOf(lines[k]) >= cur.contentIndent) {
          for (let b = j; b < k; b += 1) itemLines.push('');
          j = k;
          continue;
        }
        break;
      }
      const ind = indentOf(l);
      if (ind >= cur.contentIndent) {
        itemLines.push(stripIndent(l, cur.contentIndent));
        j += 1;
        continue;
      }
      // A less indented line continues the paragraph above it (lazy continuation) unless it starts a block.
      if (!isBlank(itemLines[itemLines.length - 1]) && !listMarker(l) && !startsBlock(l)) {
        itemLines.push(stripIndent(l, ind));
        j += 1;
        continue;
      }
      break;
    }
    items.push(buildItem(itemLines, depth));
    let k = j;
    while (k < n && isBlank(lines[k])) k += 1;
    const next = k < n ? listMarker(lines[k]) : null;
    if (next && sameListKind(first, next)) {
      if (k > j) loose = true;
      cur = next;
      i = k;
      continue;
    }
    if (items.some((it) => it.blocks.filter((b) => b.t === 'p').length > 1)) loose = true;
    return [{ t: 'list', ordered: !first.bullet, start: first.num, tight: !loose, items }, j];
  }
}

function parseBlocks(lines, depth) {
  if (depth > MAX_BLOCK_DEPTH) {
    const text = lines.map((l) => l.trim()).join('\n').trim();
    return text ? [{ t: 'p', c: parseInline(text) }] : [];
  }
  const out = [];
  const n = lines.length;
  let i = 0;
  while (i < n) {
    const line = lines[i];
    if (isBlank(line)) {
      i += 1;
      continue;
    }
    if (indentOf(line) < 4) {
      const f = fenceOpen(line);
      if (f) {
        const body = [];
        i += 1;
        while (i < n && !fenceCloses(lines[i], f)) {
          body.push(stripIndent(lines[i], f.indent));
          i += 1;
        }
        i += 1;
        const lang = f.info.split(/\s/, 1)[0];
        out.push({ t: 'code', lang: /^[A-Za-z0-9_+#.-]{1,32}$/.test(lang) ? lang : '', text: body.join('\n') });
        continue;
      }
      const h = atx(line);
      if (h) {
        out.push({ t: 'h', level: h.level, c: parseInline(h.text) });
        i += 1;
        continue;
      }
      if (isHr(line)) {
        out.push({ t: 'hr' });
        i += 1;
        continue;
      }
      if (isQuote(line)) {
        const inner = [];
        while (i < n) {
          const l = lines[i];
          if (isQuote(l)) {
            inner.push(stripQuote(l));
          } else if (!isBlank(l) && inner.length && !isBlank(inner[inner.length - 1]) && !startsBlock(l)) {
            inner.push(l);
          } else {
            break;
          }
          i += 1;
        }
        out.push({ t: 'quote', c: parseBlocks(inner, depth + 1) });
        continue;
      }
      if (listMarker(line)) {
        const [node, next] = parseList(lines, i, depth);
        out.push(node);
        i = next;
        continue;
      }
      const table = tableAt(lines, i);
      if (table) {
        out.push(table.node);
        i = table.next;
        continue;
      }
    }
    const para = [line.trimStart()];
    let setext = 0;
    let j = i + 1;
    while (j < n) {
      const l = lines[j];
      if (isBlank(l)) break;
      if (indentOf(l) < 4) {
        setext = setextLevel(l);
        if (setext) {
          j += 1;
          break;
        }
        if (startsBlock(l)) break;
        if (l.includes('|') && tableAt(lines, j)) break;
      }
      para.push(l.trimStart());
      j += 1;
    }
    const text = para.join('\n').trimEnd();
    out.push(setext ? { t: 'h', level: setext, c: parseInline(text) } : { t: 'p', c: parseInline(text) });
    i = j;
  }
  return out;
}

/**
 * Parses markdown text into a block tree. Block nodes: p, h (level), hr, code (lang, text), quote (c),
 * list (ordered, start, tight, items of { blocks, task }) and table (aligns, head, rows); inline children
 * come from parseInline.
 * @param {unknown} source
 * @returns {object[]}
 */
export function parseMarkdown(source) {
  const text = String(source ?? '').replace(/\0/g, '\ufffd');
  return parseBlocks(text.split(/\r\n|\r|\n/), 0);
}
