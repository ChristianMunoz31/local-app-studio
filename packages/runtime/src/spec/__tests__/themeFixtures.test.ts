/// <reference types="vite/client" />
// Golden fixtures for the spec theme block (docs/THEMES.md). Each fixture in fixtures/theme/ holds a theme block (or none)
// and what the validator must answer: the parsed block, or the issue paths and codes. Synthetic data only.
import { describe, expect, it } from 'vitest';
import crew from '../fixtures/crew-roster.json';
import { AppSpecSchema, THEME_PRESETS, validateAppSpec } from '../schema.ts';
import { THEME_IDS } from '../../theme/ids.ts';
import { sanitizeTheme } from '../../theme/sanitize.ts';

interface Fixture {
  name: string;
  description: string;
  theme: unknown;
  absent: boolean;
  expected: { ok: true; theme: unknown } | { ok: false; issues: Array<{ path: string; code: string }> };
}

// Read as text and parsed with JSON.parse: a bundler's JSON module would turn a "__proto__" key into a prototype.
const RAW = import.meta.glob('./fixtures/theme/*.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const FIXTURES = Object.values(RAW).map((text) => JSON.parse(text) as Fixture);
const withTheme = (fixture: Fixture): Record<string, unknown> => {
  const spec: Record<string, unknown> = { ...(crew as Record<string, unknown>) };
  if (fixture.absent) delete spec.theme;
  else spec.theme = fixture.theme;
  return spec;
};

describe('theme golden fixtures', () => {
  it('has at least 16 fixtures, each named once', () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(16);
    expect(new Set(FIXTURES.map((f) => f.name)).size).toBe(FIXTURES.length);
  });

  for (const fixture of FIXTURES) {
    it(`${fixture.name}: ${fixture.description}`, () => {
      const result = validateAppSpec(withTheme(fixture));
      if (fixture.expected.ok) {
        expect(result.ok).toBe(true);
        expect(result.value?.theme).toEqual(fixture.expected.theme);
      } else {
        expect(result.ok).toBe(false);
        expect(result.issues.map((i) => ({ path: i.path, code: i.code }))).toEqual(fixture.expected.issues);
      }
    });

    it(`${fixture.name}: the runtime sanitizer never passes anything unsafe`, () => {
      const out = sanitizeTheme(fixture.absent ? undefined : fixture.theme);
      expect(out.id === null || (THEME_IDS as readonly string[]).includes(out.id)).toBe(true);
      expect(THEME_PRESETS).toContain(out.preset);
      if (out.accentHue !== null) {
        expect(Number.isInteger(out.accentHue)).toBe(true);
        expect(out.accentHue).toBeGreaterThanOrEqual(0);
        expect(out.accentHue).toBeLessThanOrEqual(359);
      }
      if (fixture.expected.ok) {
        const parsed = fixture.expected.theme as { id?: string; overrides?: { accentHue?: number } };
        expect(out.id).toBe(parsed.id ?? null);
        expect(out.accentHue).toBe(parsed.overrides?.accentHue ?? null);
      }
    });
  }

  it('every existing spec parses to the same theme as before', () => {
    const parsed = AppSpecSchema.parse(crew);
    expect(parsed.theme).toEqual({ preset: 'aurora', radius: 'md' });
    expect(Object.keys(parsed.theme)).toEqual(['preset', 'radius']);
    const rest: Record<string, unknown> = { ...(crew as Record<string, unknown>) };
    delete rest.theme;
    expect(AppSpecSchema.parse(rest).theme).toEqual({ preset: 'aurora', radius: 'md' });
  });

  it('every theme id is accepted, alone and with each override', () => {
    for (const id of THEME_IDS) {
      for (const theme of [{ id }, { id, overrides: { accentHue: 120 } }, { id, overrides: { radius: 'sm' } }, { id, overrides: { mode: 'light' } }]) {
        expect(validateAppSpec({ ...(crew as Record<string, unknown>), theme }).ok, JSON.stringify(theme)).toBe(true);
      }
    }
  });
});
