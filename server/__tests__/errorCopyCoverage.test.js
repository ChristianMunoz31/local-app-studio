// ci:always-run
// Every error code the server can send has a row with words and a next step.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CORE_ERROR_COPY } from '../../src/errors/copy.core.js';
import { STUDIO_ERROR_COPY } from '../../src/errors/copy.studio.js';
import { ERROR_CODES, ERROR_COPY } from '../../src/errors/errorCopy.js';
import { AI_ERROR_SCOPES } from '../ai/llmErrors.js';
import { ADVICE_ERROR_CODES } from '../assistant/validateAdvice.js';
import { BACKUP_MESSAGES } from '../backup/errors.js';
import { MESSAGES as INGEST_MESSAGES } from '../ingest/limits.js';
import { STORE_ERROR_STATUS } from '../license/messages.js';
import { FIXED_MESSAGE } from '../studio/build/service.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CODE_RE = /^[a-z][a-z0-9_]*$/;
const ERRORS_FILE = path.join(ROOT, 'server', 'errors.js');

function sourceFiles() {
  const out = [path.join(ROOT, 'server.js')];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.js')) out.push(full);
    }
  };
  walk(path.join(ROOT, 'server'));
  walk(path.join(ROOT, 'packages', 'runtime', 'server'));
  // The pro modules (docs/ARCHITECTURE.md, 'The pro seam') send the same codes; a run without pro/ has only the stubs.
  if (fs.existsSync(path.join(ROOT, 'pro', 'server'))) walk(path.join(ROOT, 'pro', 'server'));
  return out;
}

const PATTERNS = [
  /\bsendError\(\s*\w+\s*,\s*'([a-z][a-z0-9_]*)'/g,
  /\bsseError\(\s*'([a-z][a-z0-9_]*)'/g,
  /\bnew (?:AppError|StudioError|BackupError|ImportError|DescribeError|CloudScopeError|AiUnavailableError)\(\s*'([a-z][a-z0-9_]*)'/g,
  /\b(?:fail|send|err|sendFailure)\(\s*\w+\s*,\s*\d+\s*,\s*'([a-z][a-z0-9_]*)'/g,
];

function scanServerCodes() {
  const found = new Map();
  for (const file of sourceFiles()) {
    if (file === ERRORS_FILE) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const re of PATTERNS) {
      for (const m of text.matchAll(re)) found.set(m[1], path.relative(ROOT, file));
    }
  }
  return found;
}

describe('error copy table', () => {
  it('has 186 codes, none in both files, all snake_case', () => {
    expect(ERROR_CODES).toHaveLength(Object.keys(CORE_ERROR_COPY).length + Object.keys(STUDIO_ERROR_COPY).length);
    expect(ERROR_CODES).toHaveLength(186);
    for (const code of Object.keys(CORE_ERROR_COPY)) expect(Object.hasOwn(STUDIO_ERROR_COPY, code)).toBe(false);
    for (const code of ERROR_CODES) expect(code).toMatch(CODE_RE);
  });

  it('gives every row an action and a sentence or an owner, and owners name real files', () => {
    for (const [code, row] of Object.entries(ERROR_COPY)) {
      expect(row.action?.trim(), code).toBeTruthy();
      expect(Boolean(row.sentence?.trim()) || Boolean(row.owner), code).toBe(true);
      expect(Number.isInteger(row.status), code).toBe(true);
      if (row.owner) expect(fs.existsSync(path.join(ROOT, row.owner)), `${code} owner ${row.owner}`).toBe(true);
    }
  });

  it('has no en or em dash in any word', () => {
    for (const [code, row] of Object.entries(ERROR_COPY)) {
      expect(`${row.sentence ?? ''}${row.action}`, code).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it('has a row for every code the server code names, and none of them is client only', () => {
    const found = scanServerCodes();
    const missing = [...found].filter(([code]) => !Object.hasOwn(ERROR_COPY, code)).map(([c, f]) => `${c} (${f})`);
    expect(missing).toEqual([]);
    for (const code of found.keys()) expect(ERROR_COPY[code]?.clientOnly, code).toBeUndefined();
  });

  it('has a row for every code in the registries', () => {
    const registries = [...Object.keys(BACKUP_MESSAGES), ...Object.keys(STORE_ERROR_STATUS), ...AI_ERROR_SCOPES, ...ADVICE_ERROR_CODES, ...Object.keys(FIXED_MESSAGE), ...Object.keys(INGEST_MESSAGES).filter((c) => c !== 'aborted')];
    const missing = registries.filter((c) => !Object.hasOwn(ERROR_COPY, c));
    expect(missing).toEqual([]);
  });

  it('fails a code that has no row (the scanner sees an unknown code)', () => {
    const fixture = "sendError(res, 'definitely_not_a_code');";
    const hits = [...fixture.matchAll(PATTERNS[0])].map((m) => m[1]);
    expect(hits).toEqual(['definitely_not_a_code']);
    expect(Object.hasOwn(ERROR_COPY, hits[0])).toBe(false);
  });
});
