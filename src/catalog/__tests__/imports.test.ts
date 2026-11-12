// The catalog has two kinds of file (docs/CATALOG.md, ADR-006). Pure files (definitions, schemas, checks) are imported by
// the Studio server under plain Node and may import zod; UI files (components, context, ActionHost, components.ts) end up
// in the runtime chunk, which must carry no zod, so they reach a zod-importing file only through `import type`.
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

// Every source file of the catalog (not the tests) as text, keyed "catalog/parts/Grid.tsx". The part files live in the runtime
// package (packages/runtime/src/catalog/parts), the core files in src/catalog; both key as "catalog/...".
const PKG_SRC = '../../../packages/runtime/src/';
const RAW = import.meta.glob(['../*.{ts,tsx}', '../../../packages/runtime/src/catalog/parts/*.{ts,tsx}'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const keyOf = (globKey: string): string => (globKey.startsWith(PKG_SRC) ? globKey.slice(PKG_SRC.length) : globKey.replace('../', 'catalog/'));
/** "catalog/parts/Grid.tsx" to its repo path "packages/runtime/src/catalog/parts/Grid.tsx" (relative specifiers resolve from there). */
const REPO_PATH = new Map<string, string>(Object.keys(RAW).map((k) => [keyOf(k), k.startsWith(PKG_SRC) ? `packages/runtime/src/${k.slice(PKG_SRC.length)}` : `src/catalog/${k.slice(3)}`]));
const TEXTS = new Map<string, string>(Object.entries(RAW).map(([key, text]) => [keyOf(key), text]));
const DOC = import.meta.glob('../../../docs/CATALOG.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const files = [...TEXTS.keys()];
const rel = (f: string): string => f;
const source = (f: string): string => TEXTS.get(f) ?? '';
const PKG_NAME = '@local-app-studio/runtime/';
/** A specifier of the app's own code: relative, or through the runtime package name. */
const isLocal = (spec: string): boolean => spec.startsWith('.') || spec.startsWith(PKG_NAME);

interface Import {
  line: string;
  isType: boolean;
  from: string;
}
function importsOf(text: string): Import[] {
  const out: Import[] = [];
  for (const m of text.matchAll(/^(import\s+(type\s+)?[^;]*?from\s+'([^']+)';)/gm)) out.push({ line: m[1], isType: m[2] !== undefined, from: m[3] });
  return out;
}

/** "catalog/parts/Grid.tsx" + "../enums.ts" = "catalog/enums.ts" (a specifier through the package name is already "<folder>/<file>"). */
function resolve(from: string, spec: string): string {
  if (spec.startsWith(PKG_NAME)) return spec.slice(PKG_NAME.length);
  const parts = (REPO_PATH.get(from) ?? from).split('/').slice(0, -1);
  for (const step of spec.split('/')) {
    if (step === '..') parts.pop();
    else if (step !== '.') parts.push(step);
  }
  return parts.join('/').replace(/^(packages\/runtime\/)?src\//, '');
}
const isPure = (f: string): boolean => {
  const r = f;
  return /\.def\.ts$/.test(r) || ['catalog/enums.ts', 'catalog/ids.ts', 'catalog/actions.ts', 'catalog/bindings.ts', 'catalog/definitions.ts', 'catalog/validateLayout.ts', 'catalog/types.ts', 'catalog/parts/sizingClasses.ts', 'catalog/parts/menuClasses.ts', 'catalog/parts/menuSearch.ts'].includes(r);
};

// Files that bring zod in: a value import of zod, the schema, or another such file.
const zodFiles = new Set<string>(['spec/schema.ts', 'catalog/registry.tsx']);
for (const f of files) {
  if (importsOf(source(f)).some((i) => !i.isType && i.from === 'zod')) zodFiles.add(rel(f));
}
for (let changed = true; changed; ) {
  changed = false;
  for (const f of files) {
    if (zodFiles.has(rel(f))) continue;
    if (importsOf(source(f)).some((i) => !i.isType && isLocal(i.from) && zodFiles.has(resolve(f, i.from)))) {
      zodFiles.add(rel(f));
      changed = true;
    }
  }
}

describe('zod stays out of the runtime chunk', () => {
  const ui = files.filter((f) => !isPure(f) && f !== 'catalog/registry.tsx');

  it('finds the UI and the pure files', () => {
    expect(ui.length).toBeGreaterThan(25);
    expect(files.filter(isPure).length).toBeGreaterThan(25);
    expect(zodFiles.has('catalog/definitions.ts')).toBe(true);
    expect(zodFiles.has('catalog/validateLayout.ts')).toBe(true);
  });

  it.each(ui.map((f) => [f, f]))('%s imports no zod, and zod-importing files only as types', (_name, f) => {
    for (const imp of importsOf(source(f))) {
      expect(imp.from, imp.line).not.toBe('zod');
      if (!isLocal(imp.from)) continue;
      const target = resolve(f, imp.from);
      if (zodFiles.has(target)) expect(imp.isType, imp.line).toBe(true);
    }
  });

  it('components.ts reaches no zod file at all, even as a type, except the shared prop types', () => {
    const values = importsOf(source('catalog/components.ts')).filter((i) => !i.isType);
    for (const imp of values) expect(zodFiles.has(resolve('catalog/components.ts', imp.from)), imp.line).toBe(false);
  });
});

describe('pure files follow the ADR-006 syntax rules', () => {
  const pure = files.filter(isPure);

  it.each(pure.map((f) => [f, f]))('%s: relative .ts imports, import type, zod as a namespace, no JSX, no "@/"', (_name, f) => {
    const text = source(f);
    expect(f.endsWith('.ts')).toBe(true);
    for (const imp of importsOf(text)) {
      expect(imp.from, imp.line).not.toMatch(/^@\//);
      expect(imp.from, imp.line).not.toMatch(/react|lucide/);
      if (imp.from.startsWith('.')) expect(imp.from, imp.line).toMatch(/\.ts$/);
      if (imp.from === 'zod' && !imp.isType) expect(imp.line).toMatch(/^import \* as z from 'zod';$/);
    }
    expect(text).not.toMatch(/\benum\s+\w+\s*\{|\bnamespace\s+\w+|constructor\s*\(\s*(public|private|readonly)/);
  });
});

describe('copy rules', () => {
  it('no em dash or en dash in a catalog file or in docs/CATALOG.md', () => {
    for (const f of files) expect(source(f), f).not.toMatch(/[\u2013\u2014]/);
    const docs = Object.values(DOC);
    expect(docs).toHaveLength(1);
    expect(docs[0]).not.toMatch(/[\u2013\u2014]/);
  });

  it('no part takes className, style or an on* prop from the model', () => {
    for (const f of files.filter((x) => x.endsWith('.def.ts'))) {
      const text = source(f);
      expect(text, rel(f)).not.toMatch(/\b(className|style|dangerouslySetInnerHTML)\s*:/);
      expect(text, rel(f)).not.toMatch(/\bon[A-Z]\w*\s*:/);
    }
  });
});
