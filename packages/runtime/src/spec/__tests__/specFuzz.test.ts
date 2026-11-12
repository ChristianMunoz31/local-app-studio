// @vitest-environment node
// B1 spec fuzzing (DESIGN-phase11.md 2.1, A1.1 to A1.4): a seeded generator (src/test-utils/specFuzz.ts) builds random layer
// trees from the real catalog and attacks validateAppSpec, normalizeSpec, diffSpecs and feature expansion. Seeds are fixed;
// a failure message starts with the seed.
import { describe, expect, it } from 'vitest';
import { SEED_FEATURES, expandSpecFeatures, hasFeatureNodes } from '@/catalog/features';
import type { FeatureLibrary } from '@/catalog/features';
import { partContextFor } from '@/catalog/validateLayout';
import { normalizeSpec } from '../../runtime/normalizeSpec.js';
import { LIMITS, validateAppSpec } from '../schema';
import type { AppSpec, AppSpecInput, LayoutLayer } from '../schema';
import { CATALOG_CHECKS } from '@/catalog/validateLayout';
import { autoValues } from '@/studio/lib/layoutTree';
import { diffSpecs } from '@/studio/lib/specDiff';
import { HOSTILE_STRINGS, accepted, forSeeds, genSpec, mulberry32, mutate, pick, rawJsonValues, evolve } from '@/test-utils/specFuzz';
import type { Obj } from '@/test-utils/specFuzz';
import { fillLayouts } from '@/studio/test-utils/specFuzzLayouts';
import type { LayoutStats } from '@/studio/test-utils/specFuzzLayouts';

const SEEDS = 100;
const FEATURE_SEEDS = 50;
// Each test covers a few seeds so none of them runs long enough for a loaded machine to time it out. A chunk is [first, last].
// The generator tests come first and build each seed once, one seed a test (generation is the slow part, up to about a second
// for a 400-layer page); every later test reads the memoized specs, so ten seeds a test is small. Aggregate properties are
// checked by their own test, which runs after the chunks and reuses the memoized specs and tallies.
function chunksOf(total: number, size: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let first = 1; first <= total; first += size) out.push([first, Math.min(first + size - 1, total)]);
  return out;
}
const BUILD_SEEDS = Array.from({ length: SEEDS }, (_, i) => i + 1);
const SEED_CHUNKS = chunksOf(SEEDS, 10);
const FEATURE_CHUNKS = chunksOf(FEATURE_SEEDS, 10);
const inChunk = (first: number, last: number, fn: (seed: number) => void): void => forSeeds(last - first + 1, fn, first);
const tally = { rejected: 0, expanded: 0, hostileTried: 0, kpiUsed: 0 };

// Generating a big layout is the slow part, so each seed is built once and shared by every property (nothing below mutates it).
const built = new Map<number, { raw: AppSpecInput; stats: LayoutStats }>();
function build(seed: number): { raw: AppSpecInput; stats: LayoutStats } {
  let hit = built.get(seed);
  if (hit === undefined) {
    const rand = mulberry32(seed);
    const { spec, stats } = fillLayouts(rand, genSpec(rand));
    hit = { raw: spec, stats };
    built.set(seed, hit);
  }
  return hit;
}

const acceptedCache = new Map<number, AppSpec | null>();
function acceptedBuild(seed: number): AppSpec | null {
  if (!acceptedCache.has(seed)) acceptedCache.set(seed, accepted(build(seed).raw));
  return acceptedCache.get(seed) ?? null;
}

const protoBefore = JSON.stringify(Object.getOwnPropertyNames(Object.prototype).sort());
const expectCleanPrototype = (): void => {
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  expect(JSON.stringify(Object.getOwnPropertyNames(Object.prototype).sort())).toBe(protoBefore);
};

describe('the generator', () => {
  it.each(BUILD_SEEDS)('builds and validates seed %i', (seed) => {
    const { stats } = build(seed);
    acceptedBuild(seed);
    expect(stats.maxLayers, `seed ${seed}: more layers on a page than the limit`).toBeLessThanOrEqual(LIMITS.layersPerPage);
  });

  it('builds specs the validator accepts, nests to depth 8 and fills big pages', () => {
    let ok = 0;
    let deep = 0;
    let biggest = 0;
    forSeeds(SEEDS, (seed) => {
      const { stats } = build(seed);
      if (acceptedBuild(seed) !== null) ok += 1;
      if (stats.maxDepth >= 8) deep += 1;
      biggest = Math.max(biggest, stats.maxLayers);
    });
    expect(ok).toBeGreaterThanOrEqual(SEEDS * 0.9);
    expect(deep).toBeGreaterThanOrEqual(10);
    expect(biggest).toBeGreaterThanOrEqual(100);
    expect(biggest).toBeLessThanOrEqual(LIMITS.layersPerPage);
  });
});

describe('A1.1 validateAppSpec never throws', () => {
  it.each(SEED_CHUNKS)('returns { ok, issues } for generated specs attacked 0 to 3 times, seeds %i to %i', (first, last) => {
    inChunk(first, last, (seed) => {
      const rand = mulberry32(seed + 10_000);
      const { raw } = build(seed);
      const attacked = mutate(rand, raw);
      const result = validateAppSpec(attacked, { ...CATALOG_CHECKS });
      expect(typeof result.ok).toBe('boolean');
      expect(result.issues.length).toBeLessThanOrEqual(LIMITS.issues);
      for (const issue of result.issues) {
        expect(typeof issue.path).toBe('string');
        expect(typeof issue.message).toBe('string');
        expect(issue.message.length).toBeGreaterThan(0);
      }
      if (result.ok) expect(result.issues).toEqual([]);
      else tally.rejected += 1;
    });
    expectCleanPrototype();
  });

  // Relies on file order: it reads the tally the tests above fill, so it fails closed under shuffle or -t.
  it('rejects more than a tenth of the attacked specs', () => {
    expect(tally.rejected).toBeGreaterThan(SEEDS / 10);
  });

  it('answers raw JSON values that are not specs', () => {
    for (const value of rawJsonValues()) {
      const result = validateAppSpec(value, { ...CATALOG_CHECKS });
      expect(result.ok).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues.length).toBeLessThanOrEqual(LIMITS.issues);
    }
    expectCleanPrototype();
  });
});

/** Every object in the tree is a plain object or an array: no key ever swapped a prototype. */
function expectPlainTree(value: unknown): void {
  const stack: unknown[] = [value];
  for (let v = stack.pop(); v !== undefined; v = stack.pop()) {
    if (typeof v !== 'object' || v === null) continue;
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== Array.prototype) throw new Error('an object has a prototype other than Object.prototype');
    stack.push(...Object.values(v));
  }
}

describe('A1.2 normalizeSpec', () => {
  it.each(SEED_CHUNKS)('never throws and is idempotent, on accepted and on attacked specs, seeds %i to %i', (first, last) => {
    inChunk(first, last, (seed) => {
      const rand = mulberry32(seed + 20_000);
      const { raw } = build(seed);
      for (const input of [raw, mutate(rand, raw)]) {
        const once = normalizeSpec(input);
        const twice = normalizeSpec(once);
        expect(twice).toStrictEqual(once);
        expectPlainTree(once);
      }
    });
    expectCleanPrototype();
  });

  it('never throws on raw JSON values that are not specs', () => {
    for (const value of rawJsonValues()) expect(() => normalizeSpec(value)).not.toThrow();
    expectCleanPrototype();
  });

  it.each(SEED_CHUNKS)('fills the same defaults as the schema, seeds %i to %i', (first, last) => {
    inChunk(first, last, (seed) => {
      const spec = acceptedBuild(seed);
      if (spec === null) return;
      expect(normalizeSpec(build(seed).raw)).toEqual(spec);
    });
  });
});

describe('A1.2 regression: an own "__proto__" key', () => {
  it('is copied as data, never as a prototype swap', () => {
    const raw = JSON.parse('{"specVersion":1,"tables":[],"pages":[{"id":"home","layout":{"id":"r","type":"Page","props":{"__proto__":{"polluted":true}},"children":[]}}],"__proto__":{"polluted":true}}');
    const once = normalizeSpec(raw) as Record<string, unknown>;
    expect(once.polluted).toBeUndefined();
    expect(Object.getPrototypeOf(once)).toBe(Object.prototype);
    expect(Object.hasOwn(once, '__proto__')).toBe(true);
    expect(normalizeSpec(once)).toStrictEqual(once);
    expectPlainTree(once);
    expectCleanPrototype();
  });
});

describe('regression: control characters in text that reaches SQL', () => {
  // A select option of "\u0000" used to pass LABEL_RE and cut the CHECK clause of the create script (planMigrationFuzz.test.js).
  const withField = (field: Obj): unknown => {
    const raw = structuredClone(genSpec(mulberry32(2), { sources: false })) as unknown as Obj;
    (raw.tables as Obj[]) = [{ id: 'things', label: 'Things', fields: [field] }];
    return raw;
  };
  const NUL = String.fromCharCode(0);
  const bad: Array<[string, Obj]> = [
    ['a NUL in a label', { id: 'a', label: `x${NUL}y`, type: 'text' }],
    ['a bell in a label', { id: 'a', label: 'x\u0007y', type: 'text' }],
    ['a tab in a label', { id: 'a', label: 'x' + String.fromCharCode(9) + 'y', type: 'text' }],
    ['a line separator in a label', { id: 'a', label: 'x\u2028y', type: 'text' }],
    ['a C1 control in a label', { id: 'a', label: 'x\u0085y', type: 'text' }],
    ['a C1 control at the end of a label', { id: 'a', label: 'xy\u009f', type: 'text' }],
    ['a right-to-left override in a label', { id: 'a', label: 'x‮y', type: 'text' }],
    ['a bidi isolate in a label', { id: 'a', label: 'x⁦y', type: 'text' }],
    ['a bidi isolate at the start of a label', { id: 'a', label: '⁧xy', type: 'text' }],
    ['a bidi override in an option', { id: 'a', label: 'A', type: 'select', options: ['ok', 'b‭c'] }],
    ['a NUL in an option', { id: 'a', label: 'A', type: 'select', options: ['ok', `b${NUL}`] }],
    ['a NUL in a text default', { id: 'a', label: 'A', type: 'text', default: `a${NUL}` }],
    ['a NUL in a longtext default', { id: 'a', label: 'A', type: 'longtext', default: `a${NUL}` }],
  ];

  it.each(bad)('refuses %s', (_name, field) => {
    const result = validateAppSpec(withField(field), { ...CATALOG_CHECKS });
    expect(result.ok).toBe(false);
  });

  it('keeps accepting unicode, quotes and a newline in a longtext default', () => {
    const ok: Obj[] = [
      { id: 'a', label: 'é漢🙂', type: 'text' },
      { id: 'a', label: 'Ünïcödé Ωmega', type: 'text' },
      { id: 'a', label: '日本語のラベル', type: 'text' },
      { id: 'a', label: '🙂 ok 🚀', type: 'text' },
      { id: 'a', label: 'say "hi"', type: 'select', options: ["it's", '<b>'] },
      { id: 'a', label: 'A', type: 'longtext', default: ['line one', 'line two'].join(String.fromCharCode(10)) },
    ];
    for (const field of ok) expect(validateAppSpec(withField(field), { ...CATALOG_CHECKS }).ok).toBe(true);
  });
});

describe('A1.3 specDiff', () => {
  it.each(SEED_CHUNKS)('diffSpecs(a, a) is empty, seeds %i to %i', (first, last) => {
    inChunk(first, last, (seed) => {
      const spec = acceptedBuild(seed);
      if (spec === null) return;
      expect(diffSpecs(spec, structuredClone(spec))).toEqual([]);
    });
  });

  it('two accepted specs always diff', () => {
    const specs: AppSpec[] = [];
    forSeeds(SEEDS, (seed) => {
      const spec = acceptedBuild(seed);
      if (spec !== null) specs.push(spec);
    });
    expect(specs.length).toBeGreaterThan(SEEDS * 0.9);
    for (let i = 0; i + 1 < specs.length; i += 1) {
      const changes = diffSpecs(specs[i], specs[i + 1]);
      for (const c of changes) expect(c.sentence.length).toBeGreaterThan(0);
    }
  });

  it.each(FEATURE_CHUNKS)('diffs a spec against its own evolution without throwing, seeds %i to %i', (first, last) => {
    inChunk(first, last, (seed) => {
      const rand = mulberry32(seed + 30_000);
      const spec = acceptedBuild(seed);
      if (spec === null) return;
      const next = accepted(evolve(rand, spec));
      if (next === null) return;
      expect(() => diffSpecs(spec, next)).not.toThrow();
    });
  });
});

describe('A1.4 feature expansion', () => {
  const lib: FeatureLibrary = new Map(SEED_FEATURES.map((d) => [d.id, d]));

  /** A Feature node with the first fitting values of the seed feature on this page, or null. */
  function featureNode(spec: AppSpec, pageIndex: number, id: string, def: (typeof SEED_FEATURES)[number]): LayoutLayer | null {
    const values = autoValues(def, partContextFor(spec, spec.pages[pageIndex]));
    return values === null ? null : ({ id, type: 'Feature', props: { featureId: def.id, params: values }, children: [] } as unknown as LayoutLayer);
  }

  function withFeatures(spec: AppSpec): { raw: Obj; placed: number } {
    const raw = structuredClone(spec) as unknown as Obj;
    let placed = 0;
    (raw.pages as Obj[]).forEach((page, i) => {
      const root = page.layout as LayoutLayer;
      SEED_FEATURES.forEach((def, k) => {
        const node = featureNode(spec, i, `feature_node_${k}`, def);
        if (node === null || !Array.isArray(root.children)) return;
        root.children = [...root.children, node];
        placed += 1;
      });
    });
    return { raw, placed };
  }

  it.each(FEATURE_CHUNKS)('leaves a spec with no Feature node exactly as it is, seeds %i to %i', (first, last) => {
    inChunk(first, last, (seed) => {
      const spec = acceptedBuild(seed);
      if (spec === null) return;
      const before = structuredClone(spec);
      const result = expandSpecFeatures(spec, lib);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual(before);
      expect(spec).toEqual(before);
    });
  });

  it.each(FEATURE_CHUNKS)('expands seeded features, then a second expansion changes nothing and the result validates, seeds %i to %i', (first, last) => {
    inChunk(first, last, (seed) => {
      const spec = acceptedBuild(seed);
      if (spec === null) return;
      const { raw, placed } = withFeatures(spec);
      if (placed === 0) return;
      expect(hasFeatureNodes(raw)).toBe(true);
      const once = expandSpecFeatures(raw, lib);
      // A page already at the layer limit may refuse the block; anything else must expand to a valid spec.
      if (!once.ok) {
        expect(once.issues.length).toBeGreaterThan(0);
        expect(once.issues.length).toBeLessThanOrEqual(LIMITS.issues);
        return;
      }
      tally.expanded += 1;
      expect(hasFeatureNodes(once.value)).toBe(false);
      expect(validateAppSpec(once.value, { ...CATALOG_CHECKS }).ok).toBe(true);
      const twice = expandSpecFeatures(once.value, lib);
      expect(twice.ok).toBe(true);
      if (twice.ok) expect(twice.value).toEqual(once.value);
    });
  });

  // Relies on file order: it reads the tally the tests above fill, so it fails closed under shuffle or -t.
  it('expands seeded features on more than ten specs', () => {
    expect(tally.expanded).toBeGreaterThan(10);
  });

  it.each(FEATURE_CHUNKS)('refuses every hostile param value in plain issues and never pollutes Object.prototype, seeds %i to %i', (first, last) => {
    inChunk(first, last, (seed) => {
      const spec = acceptedBuild(seed);
      if (spec === null) return;
      const { raw } = withFeatures(spec);
      for (const bad of HOSTILE_STRINGS) {
        const attacked = structuredClone(raw);
        const stack = [...(attacked.pages as Obj[]).map((p) => p.layout as LayoutLayer)];
        for (let l = stack.pop(); l !== undefined; l = stack.pop()) {
          if (l.type === 'Feature') {
            const params = (l.props as { params: Record<string, string> }).params;
            // Hostile value on every param, and a hostile param name (an own "__proto__" key as JSON.parse makes it).
            for (const key of Object.keys(params)) params[key] = bad;
            Object.defineProperty(params, '__proto__', { value: bad, enumerable: true, configurable: true, writable: true });
          }
          if (Array.isArray(l.children)) stack.push(...l.children);
        }
        if (!hasFeatureNodes(attacked)) continue;
        const result = expandSpecFeatures(attacked, lib);
        tally.hostileTried += 1;
        // Source, table and field params are checked against the page, so a hostile id is refused, never expanded.
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.issues.length).toBeGreaterThan(0);
          for (const i of result.issues) expect(typeof i.message).toBe('string');
        }
      }
    });
    expectCleanPrototype();
  });

  it('tried more hostile attacks than there are hostile strings', () => {
    expect(tally.hostileTried).toBeGreaterThan(HOSTILE_STRINGS.length);
  });

  it.each(FEATURE_CHUNKS)('expands a free text param with any hostile string, which stays inert text in the spec, seeds %i to %i', (first, last) => {
    const def = SEED_FEATURES.find((d) => d.id === 'kpi_row');
    expect(def).toBeDefined();
    inChunk(first, last, (seed) => {
      const spec = acceptedBuild(seed);
      if (spec === null || def === undefined) return;
      const node = featureNode(spec, 0, 'feature_node_0', def);
      if (node === null) return;
      const rand = mulberry32(seed);
      const title = pick(rand, HOSTILE_STRINGS);
      (node.props as { params: Record<string, string> }).params.title = title;
      const raw = structuredClone(spec) as unknown as Obj;
      const root = (raw.pages as Obj[])[0].layout as LayoutLayer;
      if (!Array.isArray(root.children)) return;
      root.children = [...root.children, node];
      const result = expandSpecFeatures(raw, lib);
      if (!result.ok) return;
      tally.kpiUsed += 1;
      // Whatever the text is, the expanded spec either validates or is refused with issues; it never throws.
      const checked = validateAppSpec(result.value, { ...CATALOG_CHECKS });
      expect(typeof checked.ok).toBe('boolean');
    });
    expectCleanPrototype();
  });

  it('expanded a free text param on at least one spec', () => {
    expect(tally.kpiUsed).toBeGreaterThan(0);
  });
});
