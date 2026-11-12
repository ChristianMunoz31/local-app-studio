import { describe, expect, it } from 'vitest';
import { SPEC_SHAPE, checkSpec, copyName, deriveIdentifier, deriveSlug, isValidAppName, jsonShapeProblem, starterSpec } from '../../studio/specCheck.js';

const nested = (depth) => {
  let v = 1;
  for (let i = 0; i < depth; i += 1) v = [v];
  return v;
};

describe('jsonShapeProblem', () => {
  it('accepts plain values and the limits themselves', () => {
    expect(jsonShapeProblem({ a: [1, 2, { b: null }] })).toBeNull();
    expect(jsonShapeProblem(nested(SPEC_SHAPE.maxDepth - 1))).toBeNull();
  });

  it('refuses depth 81 and 150001 nodes', () => {
    expect(jsonShapeProblem(nested(80))).toMatch(/nest/);
    expect(jsonShapeProblem(new Array(SPEC_SHAPE.maxNodes).fill(0))).toMatch(/too many/);
  });

  it('does not throw on a 100000-deep array', () => {
    expect(jsonShapeProblem(nested(100000))).toMatch(/nest/);
  });
});

describe('checkSpec', () => {
  it('accepts the starter spec', () => {
    const spec = starterSpec('Crew Roster', 'crew-roster');
    expect(checkSpec(spec)).toMatchObject({ ok: true, issues: [] });
  });

  it('accepts a hand-written spec using only the five spike parts', () => {
    const spec = starterSpec('Crew Roster', 'crew-roster');
    spec.pages[0].layout.children = [
      { id: 'heading_1', type: 'Heading', props: { size: 'lg' }, children: 'Hello' },
      { id: 'text_1', type: 'Text', props: {}, children: 'Some text' },
    ];
    expect(checkSpec(spec).ok).toBe(true);
  });

  it('reports a part the catalog does not know and a hostile deep value', () => {
    const spec = starterSpec('Crew Roster', 'crew-roster');
    spec.pages[0].layout.children[0].type = 'Nope';
    const bad = checkSpec(spec);
    expect(bad.ok).toBe(false);
    expect(bad.spec).toBeNull();
    expect(bad.issues.length).toBeGreaterThan(0);
    expect(checkSpec(nested(100000)).issues[0]).toMatchObject({ path: '(root)', code: 'too_complex' });
    expect(checkSpec(null).ok).toBe(false);
  });
});

describe('names', () => {
  it('derives slug and identifier', () => {
    expect(deriveSlug('Crew Roster 2')).toBe('crew-roster-2');
    expect(deriveIdentifier('crew-roster')).toBe('com.example.crewroster');
  });

  it('copyName keeps the result within 40 characters', () => {
    expect(copyName('Crew Roster')).toBe('Crew Roster Copy');
    const long = `${'a'.repeat(39)}b`;
    const copy = copyName(long);
    expect(copy.length).toBeLessThanOrEqual(40);
    expect(copy.endsWith(' Copy')).toBe(true);
    expect(copyName(`${'a'.repeat(34)} ${'b'.repeat(6)}`)).toBe(`${'a'.repeat(34)} Copy`);
  });

  it('isValidAppName enforces the rules and reserved names', () => {
    expect(isValidAppName('Crew Roster')).toBe(true);
    for (const bad of ['', 'a', ' Crew', 'Crew ', '1Crew', 'Crew  Roster', 'Crew-Roster', 'Local App Studio', 'local app studio dev', 'x'.repeat(41), 5, null]) {
      expect(isValidAppName(bad)).toBe(false);
    }
  });
});
