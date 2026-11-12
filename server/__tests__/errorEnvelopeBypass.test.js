// ci:always-run
// No route may build its own error body: every non-2xx JSON answer and every SSE `error` event goes through
// server/errors.js. This scanner fails on the patterns that bypass it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ERRORS_FILE = path.join(ROOT, 'server', 'errors.js');

/** Removes // and block comments, leaving strings, template literals and regex-looking text alone. Line count is kept. */
function stripComments(src) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += n ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';
        i += 1;
      }
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

const STATUS_JSON_RE = /\.status\(\s*((?:[^()]|\([^()]*\))*)\)\s*(?:\.\s*(?:set|type|header)\((?:[^()]|\([^()]*\))*\)\s*)*\.\s*json\s*\(/gs;
const SIMPLE_RES = [
  { name: 'res.json with an error body', re: /\bres\.json\(\s*\{\s*error\s*:/g },
  { name: 'sendStatus 4xx or 5xx', re: /\bsendStatus\(\s*[45]\d\d/g },
  { name: 'SSE error event built by hand', re: /\bsse\.send\(\s*'error'\s*,(?!\s*sseError\()/g },
  { name: 'SSE error event built by hand', re: /sendEvent\(\s*\{\s*type:\s*'error'/g },
];

/** Index of the brace that closes the one opened at `open`. */
function matchBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return text.length - 1;
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/**
 * @param {string} src file text
 * @returns {Array<{ line: number, kind: string, text: string }>}
 */
function findBypasses(src) {
  const text = stripComments(src);
  const hits = [];
  for (const m of text.matchAll(STATUS_JSON_RE)) {
    const arg = m[1].trim();
    const numeric = /^\d{3}$/.test(arg) ? Number(arg) : null;
    if (numeric !== null && numeric >= 200 && numeric <= 299) continue;
    hits.push({ line: lineOf(text, m.index), kind: 'res.status(...).json', text: m[0].replace(/\s+/g, ' ').slice(0, 80) });
  }
  for (const { name, re } of SIMPLE_RES) {
    for (const m of text.matchAll(re)) hits.push({ line: lineOf(text, m.index), kind: name, text: m[0].replace(/\s+/g, ' ').slice(0, 80) });
  }
  for (const m of text.matchAll(/\brateLimit\(\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    const block = text.slice(open, matchBrace(text, open) + 1);
    // The options passed to limiterHandler( are its own business: only a limiter-level `message:` is a bypass.
    const hasMessage = /(^|[\s,{])message\s*:/.test(block.replace(/limiterHandler\([^\n]*/g, ''));
    const handler = /\bhandler\s*:\s*([^\n]*)/.exec(block);
    const badHandler = handler !== null && !handler[1].trimStart().startsWith('limiterHandler(');
    if (hasMessage || badHandler) hits.push({ line: lineOf(text, m.index), kind: 'rateLimit with its own body', text: 'rateLimit({ ... })' });
  }
  return hits;
}

function sourceFiles() {
  const out = [path.join(ROOT, 'server.js')];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.js')) out.push(full);
    }
  };
  walk(path.join(ROOT, 'server'));
  walk(path.join(ROOT, 'packages', 'runtime', 'server'));
  // The pro half follows the same rules (docs/ARCHITECTURE.md, 'The pro seam'); a checkout without pro/ has nothing to walk.
  for (const dir of ['server', 'src', 'scripts']) walk(path.join(ROOT, 'pro', dir));
  return out.filter((f) => f !== ERRORS_FILE);
}

describe('error envelope bypass scan', () => {
  it('finds no route that builds its own error body', () => {
    const offenders = [];
    for (const file of sourceFiles()) {
      for (const h of findBypasses(fs.readFileSync(file, 'utf8'))) {
        offenders.push(`${path.relative(ROOT, file).replaceAll('\\', '/')}:${h.line} ${h.kind}: ${h.text}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('proves the scanner works: one fixture line per pattern is found, success bodies and comments are not', () => {
    const fixture = [
      "res.status(500).json({ error: 'x' });",
      "res.json({ error: 'x' });",
      'res.sendStatus(503);',
      "rateLimit({ max: 1, message: { error: 'x' } });",
      "sse.send('error', { code: 'x' });",
      "sendEvent({ type: 'error', code: 'x' });",
      "res.status(201).json({ data: 1 });",
      "// res.status(500).json({ error: 'in a comment' });",
      "/* res.sendStatus(500) */",
      "rateLimit({ max: 1, handler: limiterHandler({}) });",
      "sse.send('error', sseError('x'));",
    ].join('\n');
    const hits = findBypasses(fixture);
    const lines = hits.map((h) => h.line).sort((a, b) => a - b);
    expect(lines).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
