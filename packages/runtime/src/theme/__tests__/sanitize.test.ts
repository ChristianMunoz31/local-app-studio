import { describe, expect, it } from 'vitest';
import { sanitizeTheme } from '../sanitize.ts';

const DEFAULTS = { id: null, preset: 'aurora', radius: 'md', accentHue: null, radiusOverride: null, mode: null };

describe('sanitizeTheme', () => {
  it('returns the defaults for junk and never throws', () => {
    for (const raw of [undefined, null, 0, 1, 'forest', true, [], [1, 2], () => 1, Symbol('x'), 10n, NaN]) {
      expect(sanitizeTheme(raw)).toEqual(DEFAULTS);
    }
  });

  it('keeps legacy values', () => {
    expect(sanitizeTheme({ preset: 'forest', radius: 'lg' })).toEqual({ ...DEFAULTS, preset: 'forest', radius: 'lg' });
  });

  it('keeps a valid id and overrides', () => {
    expect(sanitizeTheme({ preset: 'ocean', radius: 'sm', id: 'forest', overrides: { accentHue: 140, radius: 'none', mode: 'dark' } })).toEqual({
      id: 'forest', preset: 'ocean', radius: 'sm', accentHue: 140, radiusOverride: 'none', mode: 'dark',
    });
  });

  it('drops unknown ids, wrong types and out of range hues', () => {
    expect(sanitizeTheme({ id: 'nope', overrides: { accentHue: 10 } }).id).toBeNull();
    expect(sanitizeTheme({ id: 'nope', overrides: { accentHue: 10 } }).accentHue).toBeNull();
    for (const hue of [-1, 360, 12.5, '12', NaN, Infinity, null, {}, [12], 1e9]) {
      expect(sanitizeTheme({ id: 'slate', overrides: { accentHue: hue } }).accentHue).toBeNull();
    }
    for (const hue of [0, 1, 359]) expect(sanitizeTheme({ id: 'slate', overrides: { accentHue: hue } }).accentHue).toBe(hue);
    expect(sanitizeTheme({ id: 'slate', overrides: { mode: 'system', radius: 'huge' } })).toMatchObject({ mode: null, radiusOverride: null });
    expect(sanitizeTheme({ id: ['slate'], preset: {}, radius: 5 })).toEqual(DEFAULTS);
  });

  it('ignores overrides without an id', () => {
    expect(sanitizeTheme({ overrides: { accentHue: 10, mode: 'dark' } })).toEqual(DEFAULTS);
  });

  it('ignores inherited and prototype keys', () => {
    const polluted = JSON.parse('{"__proto__": {"id": "forest"}, "preset": "ocean"}') as unknown;
    expect(sanitizeTheme(polluted)).toEqual({ ...DEFAULTS, preset: 'ocean' });
    const inherited = Object.create({ id: 'forest', preset: 'sunset' }) as unknown;
    expect(sanitizeTheme(inherited)).toEqual(DEFAULTS);
    expect(({} as Record<string, unknown>).id).toBeUndefined();
  });

  it('never lets a CSS looking string through', () => {
    const evil = 'red; background: url(http://x)';
    const out = sanitizeTheme({ id: evil, preset: evil, radius: evil, overrides: { accentHue: evil, radius: evil, mode: evil } });
    expect(out).toEqual(DEFAULTS);
    const evil2 = sanitizeTheme({ id: 'slate', overrides: { accentHue: '1; }', radius: '}', mode: '<' } });
    expect(evil2).toMatchObject({ accentHue: null, radiusOverride: null, mode: null });
  });
});
