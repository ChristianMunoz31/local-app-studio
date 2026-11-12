// Parts use theme variables only (docs/THEMES.md, docs/DESIGN.md). A part that hard-codes a color or a corner would ignore the
// theme, so this audit reads every part file and the kit style files they import, maps the classes to the CSS variables they
// read, and fails on a variable outside the theme contract or on a fixed color that is not on the allowlist below.
import { describe, expect, it } from 'vitest';
import { THEME_VARIABLES } from '@local-app-studio/runtime/theme/variables.ts';
import { listSources, readSource } from './helpers/readSource.js';

const KIT_FILES = [
  'src/components/shared/formStyles.js',
  'src/components/settings/pillStyles.js',
  'src/components/shared/Skeleton.jsx',
  'src/components/shared/SectionCard.jsx',
];
const FILES = [
  ...listSources('packages/runtime/src/catalog/parts')
    .filter((f) => /\.(tsx|ts)$/.test(f) && !f.endsWith('.def.ts'))
    .map((f) => `packages/runtime/src/catalog/parts/${f}`),
  ...KIT_FILES,
];

/** Fixed colors that are allowed, each with the reason. Keyed by "file::token"; a file of "*" means any file. */
const KIT_DANGER = 'The kit btnDanger class is for Studio chrome only; the Button part has its own danger class on theme variables.';
const ALLOWLIST: Readonly<Record<string, string>> = {
  '*::text-white': 'Text on the brand fill: the contract solves --brand and --brand-dark for at least 4.5:1 against white (themes.test.ts).',
  'src/components/shared/formStyles.js::border-red-red': KIT_DANGER,
  'src/components/shared/formStyles.js::bg-red-red': KIT_DANGER,
  'src/components/shared/formStyles.js::ring-red-red': KIT_DANGER,
};

const css = readSource('src/index.css');
const CONTRACT: ReadonlySet<string> = new Set(THEME_VARIABLES);

/** Every quoted string in the source (single, double or template), without `${...}` holes. */
function literals(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) out.push(m[2]!.replace(/\$\{[^}]*\}/g, ' '));
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

/** The variables the rule of a kit class such as `.glass-subtle` reads, from src/index.css. */
function cssVarsOfClass(name: string): string[] {
  const rules = [...css.matchAll(new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`, 'g'))];
  return rules.flatMap((r) => [...r[1]!.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]!));
}

const COLOR_PREFIX = /^(text|bg|border|ring|outline|fill|stroke|from|to|via|divide|placeholder|decoration|accent|caret|shadow)-(.+)$/;
const FIXED_PALETTE = /^(red|blue|gray|green|yellow|orange|pink|purple|cyan|teal|zinc|neutral|stone|emerald|indigo|violet|rose|sky|lime|amber|fuchsia)-/;

interface Finding {
  file: string;
  kind: 'unknown_variable' | 'fixed_color';
  detail: string;
}

function auditFile(file: string): { vars: Set<string>; findings: Finding[] } {
  const vars = new Set<string>();
  const findings: Finding[] = [];
  const fixed = (detail: string): void => {
    if (!(`${file}::${detail}` in ALLOWLIST) && !(`*::${detail}` in ALLOWLIST)) findings.push({ file, kind: 'fixed_color', detail });
  };
  for (const text of literals(readSource(file))) {
    for (const hex of text.matchAll(/(?<![\w&])#[0-9a-fA-F]{3,8}\b/g)) fixed(hex[0]);
    for (const fn of text.matchAll(/\b(rgba?|hsla?|oklch|hwb)\((?!var\()/g)) fixed(`${fn[1]}(`);
    for (const v of text.matchAll(/var\((--[a-z0-9-]+)/g)) vars.add(v[1]!);
    for (const token of text.split(/\s+/).filter(Boolean)) {
      const u = utility(token);
      const color = COLOR_PREFIX.exec(u);
      if (color) {
        const rest = color[2]!;
        const slate = /^slate-slate(50|100|200|300|400|500|600|700|800|900|950)$/.exec(rest);
        const brand = /^slate-brand(Light|Dark|Accent)?$/.exec(rest);
        const accent = /^accent-([a-z]+)$/.exec(rest);
        if (slate) vars.add(`--slate-${slate[1]}`);
        else if (brand) vars.add(`--brand${brand[1] ? `-${brand[1].toLowerCase()}` : ''}`);
        else if (accent) vars.add(`--acc-${accent[1]}`);
        else if (rest === 'white' || rest === 'black') fixed(u);
        else if (FIXED_PALETTE.test(rest)) fixed(u);
      }
      const rounded = /^rounded(?:-[a-z]{1,2})?-(sm|md|lg|xl|2xl)$/.exec(u);
      if (rounded) vars.add(`--radius-${rounded[1]}`);
      const font = /^font-(display|sans)$/.exec(u);
      if (font) vars.add(`--font-${font[1]}`);
      const glass = /^(glass(?:-[a-z]+)*)$/.exec(u);
      if (glass) for (const v of cssVarsOfClass(glass[1]!)) vars.add(v);
    }
  }
  for (const name of vars) if (!CONTRACT.has(name)) findings.push({ file, kind: 'unknown_variable', detail: name });
  return { vars, findings };
}

describe('catalog parts use theme variables only', () => {
  it('audits the part files and the kit style files they import', () => {
    expect(FILES.length).toBeGreaterThan(30);
    for (const kit of KIT_FILES) expect(FILES).toContain(kit);
  });

  for (const file of FILES) {
    it(`${file}: only variables of the theme contract, no fixed colors`, () => {
      expect(auditFile(file).findings).toEqual([]);
    });
  }

  it('maps the classes it knows about (the audit sees real variables)', () => {
    expect(auditFile('packages/runtime/src/catalog/parts/styles.ts').vars.has('--slate-100')).toBe(true);
    const { vars } = auditFile('packages/runtime/src/catalog/parts/Card.tsx');
    expect(vars.has('--radius-xl')).toBe(true);
    expect(vars.has('--glass-border')).toBe(true);
    expect(vars.has('--glass-bg-subtle')).toBe(true);
  });

  it('every allowlist entry is still used', () => {
    const all = FILES.flatMap((f) => literals(readSource(f))).join(' ');
    for (const key of Object.keys(ALLOWLIST)) {
      const [file, token] = key.split('::') as [string, string];
      expect(file === '*' ? all : literals(readSource(file)).join(' '), key).toContain(token);
    }
  });

  it('flags a fixed color and an unknown variable (the audit can fail)', () => {
    const bad = literals("const a = 'bg-red-red/10 text-white [color:var(--assistant-bg)] bg-[#fff]';").join(' ');
    const tokens = bad.split(/\s+/);
    expect(tokens.map(utility)).toContain('bg-red-red');
    expect(/(?<![\w&])#[0-9a-fA-F]{3,8}\b/.test(bad)).toBe(true);
    expect(CONTRACT.has('--assistant-bg')).toBe(false);
  });
});
