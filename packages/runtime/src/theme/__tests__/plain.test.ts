import { describe, expect, it } from 'vitest';
import { PLAIN_PAGE, isPlainTheme, plainPage, plainVars, withPlainTheme } from '../plain.ts';
import { rgbString } from '../color.ts';
import { sanitizeTheme } from '../sanitize.ts';
import { PEARL_PAGE } from '../themes.ts';
import { isThemeVariable } from '../variables.ts';

const ENV = { solidSurfaces: false, strongEdges: false };

describe('the plain look', () => {
  it('is Classic with the solid background: no id, no overrides', () => {
    expect(isPlainTheme(sanitizeTheme({ preset: 'solid', radius: 'md' }))).toBe(true);
    expect(isPlainTheme(sanitizeTheme({ preset: 'aurora', radius: 'md' }))).toBe(false);
    expect(isPlainTheme(sanitizeTheme({ preset: 'solid', radius: 'md', id: 'paper' }))).toBe(false);
    expect(withPlainTheme({ preset: 'forest', radius: 'lg', id: 'forest', overrides: { accentHue: 3 } })).toEqual({ preset: 'solid', radius: 'lg' });
  });

  it('resolves only allowed variables, none of them a mesh or accent one, with a pearl page in light mode', () => {
    for (const mode of ['light', 'dark'] as const) {
      const vars = plainVars(mode, ENV);
      const names = Object.keys(vars);
      expect(names.every(isThemeVariable)).toBe(true);
      expect(names.some((n) => n.startsWith('--mesh-') || n.startsWith('--brand') || n.startsWith('--radius-'))).toBe(false);
    }
    expect(plainVars('light', ENV)['--body-bg']).toBe('rgb(251, 249, 246)');
    expect(plainVars('light', ENV)['--slate-800']).toBe('255 255 255');
    expect(plainVars('dark', ENV)['--body-bg']).not.toBe(PLAIN_PAGE);
  });

  it('the light page is the pearl, apart from the white card step, and the dark page is one flat color', () => {
    expect(plainPage('light')).toBe('rgb(251, 249, 246)');
    expect(plainPage('light')).toBe(rgbString(PEARL_PAGE));
    expect(PLAIN_PAGE).toBe('rgb(251, 249, 246)');
    expect(plainPage('dark')).toBe('rgb(22, 19, 16)');
    const dark = plainVars('dark', ENV)['--body-bg'] ?? '';
    expect(dark).toBe(plainPage('dark'));
    expect(dark).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    expect(dark).not.toContain('gradient');
  });

  it('the hint text color on the pearl plain page keeps 4.5:1', () => {
    const lum = (rgb: readonly number[]): number => {
      const [r, g, b] = rgb.map((c) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
    };
    const vars = plainVars('light', ENV);
    const text = (vars['--slate-400'] ?? '').split(' ').map(Number);
    const [hi, lo] = [lum(PEARL_PAGE), lum(text)];
    expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
});
