// Every production caller of validateAppSpec that validates a whole spec spreads CATALOG_CHECKS (src/catalog/validateLayout.ts),
// so none enforces the page checks without the menu checks. A source scan: a new caller cannot enforce half the catalog.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PUBLIC_BUILD } from '../helpers/proBuild.js';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const SKIP = new Set(['node_modules', 'dist', 'vendor', '__tests__', '.git']);
const LAYOUT_ONLY = /validateAppSpec\([^)\r\n]*\bcheckLayout\b/;
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;

function sources(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(full));
    else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** The text with comment lines removed, so a doc comment that names the call is not a call. */
const codeOf = (text) =>
  text
    .split(/\r?\n/)
    .filter((line) => !COMMENT_LINE.test(line))
    .join(' ');

// The pipeline lives under pro/ in a pro build (docs/ARCHITECTURE.md, 'The pro seam'); a public run has only its stub.
const PRO_FILES = !PUBLIC_BUILD && fs.existsSync(path.join(ROOT, 'pro')) ? sources(path.join(ROOT, 'pro')) : [];
const FILES = [...sources(path.join(ROOT, 'server')), ...sources(path.join(ROOT, 'src')), ...PRO_FILES].map((file) => ({
  name: path.relative(ROOT, file).split(path.sep).join('/'),
  text: fs.readFileSync(file, 'utf8'),
}));

describe('validateAppSpec callers', () => {
  it('no production caller passes checkLayout on its own', () => {
    expect(FILES.filter(({ text }) => LAYOUT_ONLY.test(codeOf(text))).map(({ name }) => name)).toEqual([]);
  });

  it('the callers that validate a whole spec spread CATALOG_CHECKS', () => {
    const using = FILES.filter(({ text }) => text.includes('...CATALOG_CHECKS')).map(({ name }) => name);
    expect(using).toEqual(
      expect.arrayContaining([
        ...(PRO_FILES.length > 0 ? ['pro/server/studio/describe/pipeline.js'] : []),
        'server/studio/specCheck.js',
        'src/catalog/features/sample.ts',
        'src/studio/lib/validate.ts',
        'src/studio/showcase/samples.ts',
      ]),
    );
  });
});
