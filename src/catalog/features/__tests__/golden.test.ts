// Golden fixtures for the feature library (docs/FEATURES.md; DESIGN-phase6.md sections 4 and 14).
// Every file in ./fixtures/*.json is one case: a library, an input and the expected output or error codes.
// To add a case, add a file. There is deliberately no update mode: expected output is edited by hand and reviewed.
//
// Fixture shape:
//   description        what the case shows
//   mode               "expand" (input is a page layout run through expandLayout on the crew page)
//                      or "validate" (input is a feature record run through validateFeatureInput)
//   library            seed ids ("kpi_row") or feature bodies { id, params, fragment, bindings }
//   input              the layout or the feature record
//   expect             { ok: true, layout, used } | { ok: false, codes }
//   messageIncludes    optional text every error message set must contain
//   mustNotContain     optional strings that must not appear anywhere in the result
//   checkPrototype     optional: Object.prototype must be untouched afterwards
import { describe, expect, it } from 'vitest';
import { validateAppSpec } from '@local-app-studio/runtime/spec/schema.ts';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema.ts';
import { crewCtx, crewSpec } from '../../__tests__/fixtures.ts';
import { checkLayout } from '../../validateLayout.ts';
import { expandLayout } from '../expand.ts';
import { SEED_FEATURES } from '../seeds.ts';
import type { FeatureBody, FeatureDefinition, FeatureLibrary } from '../types.ts';
import { validateFeatureInput } from '../validate.ts';

interface Fixture {
  description: string;
  mode: 'expand' | 'validate';
  library: Array<string | (FeatureBody & { id: string })>;
  input: unknown;
  expect: { ok: true; layout: unknown; used: string[] } | { ok: false; codes: string[] };
  messageIncludes?: string;
  mustNotContain?: string[];
  checkPrototype?: boolean;
}

// Raw text per file, so JSON.parse keeps a "__proto__" key as an own property (the injection cases need that).
const RAW = import.meta.glob('./fixtures/*.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const FILES = Object.keys(RAW).map((k) => k.replace('./fixtures/', '')).sort();
const load = (file: string): Fixture => JSON.parse(RAW[`./fixtures/${file}`]) as Fixture;

function libraryOf(fx: Fixture): FeatureLibrary {
  const defs = fx.library.map((entry): FeatureDefinition => {
    if (typeof entry === 'string') {
      const seed = SEED_FEATURES.find((s) => s.id === entry);
      if (seed === undefined) throw new Error(`fixture names an unknown seed "${entry}"`);
      return seed;
    }
    return { label: entry.id, description: `The ${entry.id} feature.`, version: 1, updatedAt: '2026-01-01T00:00:00.000Z', ...entry };
  });
  return new Map(defs.map((d) => [d.id, d]));
}

interface Outcome {
  ok: boolean;
  codes: string[];
  messages: string;
  layout?: unknown;
  used?: string[];
}

function run(fx: Fixture): Outcome {
  const lib = libraryOf(fx);
  if (fx.mode === 'validate') {
    const r = validateFeatureInput(fx.input, lib);
    return r.ok ? { ok: true, codes: [], messages: '' } : { ok: false, codes: r.issues.map((i) => i.code), messages: r.issues.map((i) => i.message).join('\n') };
  }
  const r = expandLayout(fx.input as LayoutLayer, lib, crewCtx());
  return r.ok
    ? { ok: true, codes: [], messages: '', layout: r.value, used: r.used }
    : { ok: false, codes: r.issues.map((i) => i.code), messages: r.issues.map((i) => i.message).join('\n') };
}

describe('feature golden fixtures', () => {
  it('finds the fixtures', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(40);
  });

  it('covers every contract area at least once', () => {
    const all = FILES.map(load);
    const codes = new Set(all.flatMap((f) => (f.expect.ok ? [] : f.expect.codes)));
    for (const code of ['feature_too_deep', 'feature_cycle', 'unknown_feature', 'param_type', 'missing_param', 'unknown_param', 'invalid_binding', 'feature_props']) {
      expect(codes.has(code), code).toBe(true);
    }
    const names = FILES.join(' ');
    for (const word of ['seed-kpi-row', 'seed-search-list', 'nested-depth-2', 'inject-classname', 'inject-style', 'inject-value', 'inject-proto', 'inject-key', 'inject-nonexistent']) {
      expect(names, word).toContain(word);
    }
  });

  it.each(FILES)('%s', (file) => {
    const fx = load(file);
    const before = JSON.stringify(fx.input);
    const out = run(fx);

    // Pure: the input is never changed.
    expect(JSON.stringify(fx.input)).toBe(before);
    // Deterministic: a second run (fresh library, fresh context) gives the same result, byte for byte.
    expect(JSON.stringify(run(load(file)))).toBe(JSON.stringify(out));

    if (fx.expect.ok) {
      expect(out.codes, out.messages).toEqual([]);
      expect(out.ok).toBe(true);
      expect(out.layout).toEqual(fx.expect.layout);
      expect([...(out.used ?? [])].sort()).toEqual([...fx.expect.used].sort());
      // The expansion must be a page the full validator accepts, with stable unique ids.
      const checked = validateAppSpec(crewSpec(out.layout as LayoutLayer), { checkLayout });
      expect(checked.issues).toEqual([]);
    } else {
      expect(out.ok).toBe(false);
      expect(out.codes).toEqual(fx.expect.codes);
    }
    if (fx.messageIncludes !== undefined) expect(out.messages).toContain(fx.messageIncludes);
    for (const bad of fx.mustNotContain ?? []) expect(JSON.stringify(out)).not.toContain(bad);
    if (fx.checkPrototype === true) {
      expect(Object.keys(Object.prototype)).toEqual([]);
      expect(Object.getPrototypeOf({})).toBe(Object.prototype);
      expect(({} as Record<string, unknown>).title).toBeUndefined();
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    }
  });

  it('every fixture file is well formed', () => {
    for (const file of FILES) {
      const fx = load(file);
      expect(typeof fx.description, file).toBe('string');
      expect(['expand', 'validate'], file).toContain(fx.mode);
      expect(Array.isArray(fx.library), file).toBe(true);
      expect(fx.expect, file).toBeDefined();
    }
  });
});
