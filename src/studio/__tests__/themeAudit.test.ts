// Studio chrome uses theme tokens only (docs/THEMES.md, docs/DESIGN.md). A fixed color in a Studio screen would look wrong in
// one of the two kit themes, so this audit reads every Studio source file outside __tests__, strips the comments, and fails on a
// hex or rgb( color inside a string literal, on a class that is not a token color, and on text-white that is not on the brand
// fill. It is the Studio twin of src/catalog/__tests__/themeAudit.test.ts.
import { describe, expect, it } from 'vitest';
import { listSources, readSource } from '../../catalog/__tests__/helpers/readSource.js';

/** Every .ts, .tsx and .jsx file under src/studio, outside __tests__ folders and type declaration files. A name with no dot is a folder. */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of listSources(dir)) {
    if (/\.(ts|tsx|jsx)$/.test(name)) {
      if (!name.endsWith('.d.ts')) out.push(`${dir}/${name}`);
    } else if (!name.includes('.') && name !== '__tests__') out.push(...listFiles(`${dir}/${name}`));
  }
  return out.sort();
}

/** Source with `//` and block comments removed. Quoted strings are kept whole, so a URL in a string survives. */
function stripComments(source: string): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i]!;
    const next = source[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += next ?? '';
        i += 1;
      } else if (c === quote) quote = null;
      else if (c === '\n' && quote !== '`') quote = null; // a stray apostrophe in JSX text must not swallow the file
      continue;
    }
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      out += '\n';
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, '');
      i = stop - 1;
    } else {
      if (c === '"' || c === "'" || c === '`') quote = c;
      out += c;
    }
  }
  return out;
}

/** Every quoted string in the source (single, double or template), without `${...}` holes. Strings inside a hole count too. */
function literals(source: string, alreadyStripped = false): string[] {
  const out: string[] = [];
  const text = alreadyStripped ? source : stripComments(source);
  for (const m of text.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
    const body = m[2]!;
    out.push(body.replace(/\$\{[^}]*\}/g, ' '));
    for (const hole of body.matchAll(/\$\{([^}]*)\}/g)) out.push(...literals(hole[1]!, true));
  }
  return out;
}

/** The utility part of a class token: variants (`hover:`, `focus-visible:`) and an alpha suffix (`/40`) removed. */
function utility(token: string): string {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < token.length; i += 1) {
    const c = token[i];
    if (c === '[' || c === '(') depth += 1;
    else if (c === ']' || c === ')') depth -= 1;
    else if (c === ':' && depth === 0) start = i + 1;
  }
  return token.slice(start).replace(/^[!-]/, '').replace(/\/(\d+|\[[^\]]*\])$/, '');
}

const COLOR_PREFIX = /^(text|bg|border|ring|outline|fill|stroke|from|to|via|divide|placeholder|decoration|accent|caret|shadow)-(.+)$/;
const FIXED_PALETTE =
  /^(?:(?:red|blue|gray|green|yellow|orange|pink|purple|cyan|teal|zinc|neutral|stone|emerald|indigo|violet|rose|sky|lime|amber|fuchsia)(?:-|$)|slate-\d)/;
const BRAND_FILL = 'bg-slate-brand';

/** Fixed colors that are allowed, each with the reason. Keyed by "file::token"; a file of "*" means any file. */
const ALLOWLIST: Readonly<Record<string, string>> = {};

interface Finding {
  file: string;
  kind: 'fixed_color' | 'non_token_class' | 'white_text_off_brand';
  detail: string;
}

/** Findings in one source text. `file` is only used for the allowlist key and the report. */
function auditSource(file: string, source: string): Finding[] {
  const findings: Finding[] = [];
  const add = (kind: Finding['kind'], detail: string): void => {
    if (!(`${file}::${detail}` in ALLOWLIST) && !(`*::${detail}` in ALLOWLIST)) findings.push({ file, kind, detail });
  };
  for (const text of literals(source)) {
    for (const hex of text.matchAll(/(?<![\w&])#[0-9a-fA-F]{3,8}\b/g)) add('fixed_color', hex[0]);
    for (const fn of text.matchAll(/\b(rgba?|hsla?|oklch|hwb)\((?!var\()/g)) add('fixed_color', `${fn[1]}(`);
    const onBrand = text.split(/\s+/).some((t) => utility(t) === BRAND_FILL);
    for (const token of text.split(/\s+/).filter(Boolean)) {
      const color = COLOR_PREFIX.exec(utility(token));
      if (!color) continue;
      const rest = color[2]!;
      if (rest === 'white' && color[1] === 'text') {
        if (!onBrand) add('white_text_off_brand', utility(token));
      } else if (rest === 'white' || rest === 'black' || FIXED_PALETTE.test(rest)) add('non_token_class', utility(token));
    }
  }
  return findings;
}

const FILES = listFiles('src/studio');

describe('Studio uses theme tokens only', () => {
  it('audits the Studio source files', () => {
    expect(FILES.length).toBeGreaterThan(100);
    expect(FILES.some((f) => f.includes('/__tests__/'))).toBe(false);
    for (const file of ['src/studio/components/ui.ts', 'src/studio/pages/DataTab.tsx', 'src/studio/design/DesignSession.tsx']) {
      expect(FILES, file).toContain(file);
    }
  });

  for (const file of FILES) {
    it(`${file}: no fixed colors, token classes only`, () => {
      expect(auditSource(file, readSource(file))).toEqual([]);
    });
  }

  it('every allowlist entry is still used', () => {
    const all = FILES.flatMap((f) => literals(readSource(f))).join(' ');
    for (const key of Object.keys(ALLOWLIST)) {
      const [file, token] = key.split('::') as [string, string];
      const text = file === '*' ? all : literals(readSource(file)).join(' ');
      expect(text, key).toContain(token);
    }
  });

  it('flags a fixed color, a non-token class and white text off the brand fill (the audit can fail)', () => {
    const kinds = (src: string): string[] => auditSource('x.tsx', src).map((f) => f.kind);
    expect(kinds("const a = 'bg-[#fff]';")).toEqual(['fixed_color']);
    expect(kinds("const a = 'border-[rgb(0,0,0)]';")).toEqual(['fixed_color']);
    expect(kinds("const a = 'bg-red-red/10 hover:text-gray-500 border-black';")).toEqual(['non_token_class', 'non_token_class', 'non_token_class']);
    expect(kinds("const a = 'bg-slate-500';")).toEqual(['non_token_class']);
    expect(kinds("const a = 'text-white p-2';")).toEqual(['white_text_off_brand']);
    expect(kinds("const a = 'bg-slate-brand text-white';")).toEqual([]);
    expect(kinds("const a = 'peer-checked:bg-slate-brand peer-checked:text-white';")).toEqual([]);
    expect(kinds("const a = 'bg-accent-red/10 text-slate-slate100 bg-slate-brandLight border-accent-red/40';")).toEqual([]);
  });

  it('ignores comments and keeps a URL inside a string', () => {
    expect(auditSource('x.tsx', "// text-white #fff rgb(0,0,0)\n/* bg-red-red */\nconst a = 'bg-slate-slate800';")).toEqual([]);
    expect(literals("const u = 'https://example.test/a'; // 'text-white'")).toEqual(['https://example.test/a']);
  });
});
