// The grid overlay keeps its contrast (DESIGN-phase21.md 6.3 and 15 #8): the inner dotted layer (--slate-300), the free outline
// (--brand-light) and the taken outline (--acc-red) hold 3:1 against the solid surfaces of every theme in both modes, and against the
// pearl page of the plain look in light.
import { describe, expect, it } from 'vitest';
import { contrast } from '@local-app-studio/runtime/theme/color';
import type { Rgb } from '@local-app-studio/runtime/theme/color';
import { THEME_IDS, THEME_MODES } from '@local-app-studio/runtime/theme/ids';
import { plainVars } from '@local-app-studio/runtime/theme/plain';
import { resolveTheme } from '@local-app-studio/runtime/theme/resolve';
import { DEFAULT_THEME_SETTINGS } from '@local-app-studio/runtime/theme/sanitize';
import { PEARL_PAGE, STATUS_ACCENTS } from '@local-app-studio/runtime/theme/themes';

const MIN = 3;
const TEXT_MIN = 4.5;
const WHITE: Rgb = [255, 255, 255];

function rgbOf(value: string): Rgb {
  const m = /^rgba?\((\d+), (\d+), (\d+)/.exec(value);
  if (m === null) throw new Error(`not a color: ${value}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
function tripletOf(value: string): Rgb {
  const m = /^(\d+) (\d+) (\d+)$/.exec(value);
  if (m === null) throw new Error(`not a triplet: ${value}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

describe('grid overlay contrast on the solid surfaces', () => {
  for (const id of THEME_IDS) {
    for (const mode of THEME_MODES) {
      it(`${id} ${mode}: the dotted layer, the free outline and the taken outline hold ${MIN}:1`, () => {
        const vars = resolveTheme({ ...DEFAULT_THEME_SETTINGS, id }, mode).vars as Record<string, string>;
        const surfaces = [rgbOf(vars['--surface-solid']), rgbOf(vars['--surface-solid-strong'])];
        for (const surface of surfaces) {
          expect(contrast(tripletOf(vars['--slate-300']), surface), 'dotted inner layer').toBeGreaterThanOrEqual(MIN);
          expect(contrast(tripletOf(vars['--brand-light']), surface), 'free outline').toBeGreaterThanOrEqual(MIN);
          expect(contrast(tripletOf(vars['--acc-red']), surface), 'taken outline').toBeGreaterThanOrEqual(MIN);
        }
      });
    }
  }
});

describe('grid overlay pills and handle bars', () => {
  for (const id of THEME_IDS) {
    for (const mode of THEME_MODES) {
      it(`${id} ${mode}: white on the brand pill holds ${TEXT_MIN}:1 and the idle handle bar holds ${MIN}:1`, () => {
        const vars = resolveTheme({ ...DEFAULT_THEME_SETTINGS, id }, mode).vars as Record<string, string>;
        expect(contrast(WHITE, tripletOf(vars['--brand'])), 'Drop here pill').toBeGreaterThanOrEqual(TEXT_MIN);
        for (const surface of [rgbOf(vars['--surface-solid']), rgbOf(vars['--surface-solid-strong'])]) {
          expect(contrast(tripletOf(vars['--slate-300']), surface), 'idle handle bar').toBeGreaterThanOrEqual(MIN);
        }
      });
    }
  }
  it('holds on the pearl page of the plain look in light', () => {
    const vars = plainVars('light', { solidSurfaces: false, strongEdges: false }) as Record<string, string>;
    expect(contrast(tripletOf(vars['--slate-300']), PEARL_PAGE)).toBeGreaterThanOrEqual(MIN);
  });
});

describe('grid overlay contrast on the pearl page (plain look, light)', () => {
  it('holds 3:1 for the dotted layer and the taken outline', () => {
    const vars = plainVars('light', { solidSurfaces: false, strongEdges: false }) as Record<string, string>;
    expect(contrast(tripletOf(vars['--slate-300']), PEARL_PAGE)).toBeGreaterThanOrEqual(MIN);
    expect(contrast(STATUS_ACCENTS.light.red, PEARL_PAGE)).toBeGreaterThanOrEqual(MIN);
  });
});
