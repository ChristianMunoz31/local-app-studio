// ci:always-run (reads docs/DESIGN.md as text, so `vitest related` cannot see the dependency)
// docs/DESIGN.md "Error codes" has exactly one table row per entry of ERROR_CODES (DESIGN-phase15 section 12, WP-H).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../../src/errors/errorCopy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DESIGN = fs.readFileSync(path.join(ROOT, 'docs', 'DESIGN.md'), 'utf8').replace(/\r\n/g, '\n');

/** The text of the "## Error codes" section, up to the next level-2 heading. */
function errorCodesSection() {
  const start = DESIGN.indexOf('\n## Error codes\n');
  expect(start, 'docs/DESIGN.md has an "## Error codes" section').toBeGreaterThanOrEqual(0);
  const rest = DESIGN.slice(start + 1);
  const next = rest.indexOf('\n## ', 1);
  return next === -1 ? rest : rest.slice(0, next);
}

/** The code in backticks in the first column of every table row of the section. */
function tableCodes() {
  const codes = [];
  for (const line of errorCodesSection().split('\n')) {
    const m = /^\|\s*`([a-z][a-z0-9_]*)`\s*\|/.exec(line);
    if (m) codes.push(m[1]);
  }
  return codes;
}

describe('docs/DESIGN.md Error codes table', () => {
  const codes = tableCodes();

  it('has a row for every code in ERROR_CODES', () => {
    const have = new Set(codes);
    expect(ERROR_CODES.filter((c) => !have.has(c))).toEqual([]);
  });

  it('has no row for a code that does not exist', () => {
    const known = new Set(ERROR_CODES);
    expect(codes.filter((c) => !known.has(c))).toEqual([]);
  });

  it('has exactly one row per code', () => {
    const seen = new Set();
    const dupes = codes.filter((c) => (seen.has(c) ? true : (seen.add(c), false)));
    expect(dupes).toEqual([]);
    expect(codes.length).toBe(ERROR_CODES.length);
  });
});
