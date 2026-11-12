// The theme data copies values from src/index.css (the kit palette). These tests fail when the two drift apart.
/* global process */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEME_MODES } from '../ids.ts';
import { MESH, RADIUS_SCALE, TONES } from '../themes.ts';

// Line endings differ between checkouts (autocrlf); compare as LF.
const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8').split('\r\n').join('\n');
const PRESETS = ['aurora', 'ocean', 'sunset', 'forest', 'graphite', 'solid'];
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

describe('theme data against src/index.css', () => {
  it('MESH equals the --mesh-* values', () => {
    const found = new Map();
    for (const m of css.matchAll(/--mesh-([a-z]+)-(dark|light)-([123]): (rgba\([^)]*\));/g)) found.set(`${m[1]}-${m[2]}-${m[3]}`, m[4]);
    expect(found.size).toBe(30);
    for (const preset of PRESETS) {
      for (const mode of THEME_MODES) {
        MESH[preset][mode].forEach((value, i) => {
          expect(value).toBe(preset === 'solid' ? 'transparent' : found.get(`${preset}-${mode}-${i + 1}`));
        });
      }
    }
  });

  it('the :root corner defaults equal the md corner scale', () => {
    const root = css.slice(css.indexOf(':root {'), css.indexOf(':root.light {'));
    for (const size of ['sm', 'md', 'lg']) {
      const m = new RegExp(String.raw`--radius-${size}: ([0-9.]+rem);`).exec(root);
      expect(m?.[1]).toBe(RADIUS_SCALE.md[size]);
    }
  });

  it('the warm tone equals the kit slate scale and surfaces', () => {
    const darkStart = css.indexOf('--slate-50: 245 238 226;');
    const lightStart = css.indexOf(':root.light {\n    color-scheme: light;');
    expect(darkStart).toBeGreaterThan(0);
    expect(lightStart).toBeGreaterThan(darkStart);
    for (const [mode, text] of [['dark', css.slice(darkStart, lightStart)], ['light', css.slice(lightStart)]]) {
      for (const step of STEPS) {
        const m = new RegExp(String.raw`--slate-${step}: (\d+) (\d+) (\d+);`).exec(text);
        expect(TONES.warm[mode].scale[step]).toEqual([Number(m[1]), Number(m[2]), Number(m[3])]);
      }
      const surface = /--surface-solid: rgb\((\d+), (\d+), (\d+)\);/.exec(text);
      expect(TONES.warm[mode].surface).toEqual([Number(surface[1]), Number(surface[2]), Number(surface[3])]);
    }
  });
});
