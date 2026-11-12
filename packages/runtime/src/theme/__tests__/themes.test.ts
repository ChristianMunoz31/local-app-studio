import { describe, expect, it } from 'vitest';
import { RADII, THEME_PRESETS } from '../../spec/schema.ts';
import { contrast, over } from '../color.ts';
import type { Rgb } from '../color.ts';
import { THEME_IDS, THEME_MODES } from '../ids.ts';
import type { ThemeMode } from '../ids.ts';
import { defaultMode, pickMode, resolveTheme, themeLabel, withThemeId } from '../resolve.ts';
import type { ThemeEnv } from '../resolve.ts';
import { plainVars } from '../plain.ts';
import { DEFAULT_THEME_SETTINGS, sanitizeTheme } from '../sanitize.ts';
import type { ThemeSettings } from '../sanitize.ts';
import { CLASSIC_LABEL, DENSITY, FONTS, MESH, PEARL_PAGE, RADIUS_SCALE, STATUS_ACCENTS, THEMES, TONES } from '../themes.ts';
import type { SlateStep } from '../themes.ts';
import { LEGACY_VARIABLES, THEME_VARIABLES, isThemeVariable } from '../variables.ts';
import type { ThemeVarName } from '../variables.ts';

const ENVS: ThemeEnv[] = [
  { solidSurfaces: false, strongEdges: false },
  { solidSurfaces: true, strongEdges: false },
  { solidSurfaces: false, strongEdges: true },
  { solidSurfaces: true, strongEdges: true },
];
const STEPS: SlateStep[] = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const HUES = Array.from({ length: 24 }, (_, i) => i * 15);

const settingsFor = (id: (typeof THEME_IDS)[number], extra: Partial<ThemeSettings> = {}): ThemeSettings => ({ ...DEFAULT_THEME_SETTINGS, id, ...extra });

function parse(value: string): { rgb: Rgb; a: number } {
  const m = /^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/.exec(value);
  if (!m) throw new Error(`not a color: ${value}`);
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], a: m[4] === undefined ? 1 : Number(m[4]) };
}
const triplet = (value: string): Rgb => {
  const m = /^(\d+) (\d+) (\d+)$/.exec(value);
  if (!m) throw new Error(`not a triplet: ${value}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};
const bodyStops = (value: string): Rgb[] => [...value.matchAll(/rgb\((\d+), (\d+), (\d+)\)/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])] as Rgb);

describe('theme data', () => {
  it('has exactly the ids of THEME_IDS and the lists of the spec schema', () => {
    expect(Object.keys(THEMES).sort()).toEqual([...THEME_IDS].sort());
    expect(Object.keys(MESH).sort()).toEqual([...THEME_PRESETS].sort());
    expect(Object.keys(RADIUS_SCALE).sort()).toEqual([...RADII].sort());
    for (const def of Object.values(THEMES)) {
      expect(THEME_PRESETS).toContain(def.background);
      expect(RADII).toContain(def.radius);
      expect(Object.keys(TONES)).toContain(def.tone);
      expect(Object.keys(FONTS)).toContain(def.font);
      expect(Object.keys(DENSITY)).toContain(def.density);
      expect(THEME_MODES).toContain(def.mode);
      expect(def.accent.hue).toBeGreaterThanOrEqual(0);
      expect(def.accent.hue).toBeLessThanOrEqual(359);
    }
  });

  it('uses plain labels', () => {
    expect(Object.values(THEMES).map((t) => t.label)).toEqual(['Slate', 'Paper', 'Midnight', 'Forest', 'Sand', 'Ocean', 'Rose', 'Mono']);
    expect(CLASSIC_LABEL).toBe('Classic');
  });

  it('status colors are the kit values and never change with the theme', () => {
    expect(STATUS_ACCENTS.dark.green).toEqual([154, 224, 149]);
    expect(STATUS_ACCENTS.light.red).toEqual([185, 28, 28]);
    for (const id of THEME_IDS) {
      for (const mode of THEME_MODES) {
        const vars = resolveTheme(settingsFor(id), mode).vars;
        expect(vars['--acc-green']).toBe(STATUS_ACCENTS[mode].green.join(' '));
        expect(vars['--acc-red']).toBe(STATUS_ACCENTS[mode].red.join(' '));
      }
    }
  });
});

describe('tone rules', () => {
  for (const [toneId, tone] of Object.entries(TONES)) {
    for (const mode of THEME_MODES) {
      it(`${toneId} ${mode}: scale luminance is monotonic`, () => {
        const m = tone[mode];
        const values = STEPS.map((step) => contrast(m.scale[step], [0, 0, 0]));
        if (mode === 'dark') {
          for (let i = 1; i < values.length; i += 1) expect(values[i]!).toBeLessThanOrEqual(values[i - 1]!);
        } else {
          // light: inverted as in the kit, 50 darkest up to 800, then the page surfaces step down a little
          const top = STEPS.indexOf(800);
          for (let i = 1; i <= top; i += 1) expect(values[i]!).toBeGreaterThanOrEqual(values[i - 1]!);
          for (let i = top + 1; i < values.length; i += 1) expect(values[i]!).toBeLessThanOrEqual(values[i - 1]!);
        }
      });
    }
  }

  for (const id of THEME_IDS) {
    for (const mode of THEME_MODES) {
      it(`${id} ${mode}: text, glass and input contrast`, () => {
        const vars = resolveTheme(settingsFor(id), mode).vars as Record<ThemeVarName, string>;
        const surface = parse(vars['--surface-solid']).rgb;
        const glass = parse(vars['--glass-bg']);
        const glassOver = over(glass.rgb, glass.a, bodyStops(vars['--body-bg'])[1]!);
        expect(contrast(triplet(vars['--slate-100']), surface)).toBeGreaterThanOrEqual(7);
        expect(contrast(triplet(vars['--slate-400']), glassOver)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(triplet(vars['--slate-500']), glassOver)).toBeGreaterThanOrEqual(4.5);
        const fill = parse(vars['--glass-input-bg']);
        const fillOver = over(fill.rgb, fill.a, glassOver);
        const border = parse(vars['--glass-input-border']);
        expect(contrast(over(border.rgb, border.a, glassOver), fillOver)).toBeGreaterThanOrEqual(3);
      });
    }
  }
});

/** The kit brand fill: a copy of `--brand` in src/index.css :root (the plain scope leaves --brand to the kit, KEPT_OUT in plain.ts). Keep in sync. */
const KIT_BRAND: Rgb = [106, 90, 205];

describe('pearl page contrast (plain look, light)', () => {
  for (const env of ENVS) {
    it(`text, status colors, input border and brand keep their contrast on the pearl page ${JSON.stringify(env)}`, () => {
      const vars = plainVars('light', env) as Record<ThemeVarName, string>;
      expect(contrast(parse(vars['--body-text']).rgb, PEARL_PAGE)).toBeGreaterThanOrEqual(7);
      expect(contrast(triplet(vars['--slate-400']), PEARL_PAGE)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(triplet(vars['--slate-500']), PEARL_PAGE)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(triplet(vars['--slate-300']), PEARL_PAGE)).toBeGreaterThanOrEqual(4.5);
      for (const [name, color] of Object.entries(STATUS_ACCENTS.light)) {
        expect(contrast(color, PEARL_PAGE), `status ${name}`).toBeGreaterThanOrEqual(4.5);
      }
      const fill = parse(vars['--glass-input-bg']);
      const fillOver = over(fill.rgb, fill.a, PEARL_PAGE);
      const border = parse(vars['--glass-input-border']);
      expect(contrast(over(border.rgb, border.a, PEARL_PAGE), fillOver)).toBeGreaterThanOrEqual(3);
      const brand = KIT_BRAND;
      expect(contrast(brand, PEARL_PAGE)).toBeGreaterThanOrEqual(4.5);
      expect(contrast([255, 255, 255], brand)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('resolveTheme', () => {
  it('resolves every variable name for every theme, mode and environment', () => {
    for (const id of THEME_IDS) {
      for (const mode of THEME_MODES) {
        for (const env of ENVS) {
          const vars = resolveTheme(settingsFor(id), mode, env).vars;
          expect(Object.keys(vars).sort()).toEqual([...THEME_VARIABLES].sort());
          expect(Object.keys(vars).every(isThemeVariable)).toBe(true);
        }
      }
    }
  });

  it('a legacy theme resolves exactly the legacy variables', () => {
    for (const preset of THEME_PRESETS) {
      for (const radius of RADII) {
        for (const mode of THEME_MODES) {
          const r = resolveTheme({ ...DEFAULT_THEME_SETTINGS, preset, radius }, mode);
          expect(Object.keys(r.vars).sort()).toEqual([...LEGACY_VARIABLES].sort());
          expect(r.id).toBeNull();
          expect(r.label).toBe('Classic');
          expect(r.vars['--mesh-c1']).toBe(MESH[preset][mode][0]);
          expect(r.vars['--radius-md']).toBe(RADIUS_SCALE[radius].md);
        }
      }
    }
  });

  it('the default legacy theme equals the kit look', () => {
    const r = resolveTheme(DEFAULT_THEME_SETTINGS, 'dark');
    expect(r.vars['--mesh-c1']).toBe('rgba(217, 152, 72, 0.16)');
    expect(r.vars['--radius-md']).toBe('0.375rem');
    expect(r.vars['--radius-xl']).toBe('0.75rem');
    expect(r.vars['--radius-2xl']).toBe('1rem');
  });

  it('contrast holds for every theme, mode, accent hue (step 15) and environment', () => {
    for (const id of THEME_IDS) {
      for (const mode of THEME_MODES) {
        for (const hue of [null, ...HUES]) {
          for (const env of ENVS) {
            const vars = resolveTheme(settingsFor(id, { accentHue: hue }), mode, env).vars as Record<ThemeVarName, string>;
            const surface = parse(vars['--surface-solid']).rgb;
            const strong = parse(vars['--surface-solid-strong']).rgb;
            const where = `${id} ${mode} hue ${String(hue)} ${JSON.stringify(env)}`;
            for (const name of ['--brand', '--brand-dark', '--brand-accent'] as const) {
              expect(contrast([255, 255, 255], triplet(vars[name])), `${where} white on ${name}`).toBeGreaterThanOrEqual(4.5);
            }
            for (const name of ['--acc-indigo', '--acc-green', '--acc-red', '--acc-yellow', '--acc-orange', '--acc-cyan', '--acc-purple', '--acc-teal', '--acc-blue', '--acc-fuchsia', '--acc-amber'] as const) {
              expect(contrast(triplet(vars[name]), surface), `${where} ${name}`).toBeGreaterThanOrEqual(4.5);
              expect(contrast(triplet(vars[name]), strong), `${where} ${name} strong`).toBeGreaterThanOrEqual(4.5);
            }
            expect(contrast(parse(vars['--focus-ring']).rgb, surface), `${where} focus ring`).toBeGreaterThanOrEqual(3);
          }
        }
      }
    }
  });

  it('solid surfaces and strong edges follow the kit fallbacks', () => {
    const solid = resolveTheme(settingsFor('forest'), 'dark', { solidSurfaces: true, strongEdges: false }).vars;
    expect(solid['--glass-bg']).toBe(solid['--surface-solid']);
    expect(solid['--glass-bg-dense']).toBe(solid['--surface-solid-strong']);
    expect(solid['--glass-filter']).toBe('none');
    expect(solid['--mesh-c1']).toBe('transparent');
    const edges = resolveTheme(settingsFor('forest'), 'dark', { solidSurfaces: true, strongEdges: true }).vars;
    expect(edges['--glass-border']).toBe(edges['--glass-input-border']);
    expect(edges['--glass-border']).toMatch(/^rgb\(/);
    expect(resolveTheme(settingsFor('forest'), 'dark').vars['--glass-filter']).toMatch(/^blur\(/);
  });

  it('overrides change only what they name', () => {
    const base = resolveTheme(settingsFor('slate'), 'light').vars;
    const hue = resolveTheme(settingsFor('slate', { accentHue: 140 }), 'light').vars;
    expect(hue['--brand']).not.toBe(base['--brand']);
    expect(hue['--slate-100']).toBe(base['--slate-100']);
    expect(hue['--radius-md']).toBe(base['--radius-md']);
    const round = resolveTheme(settingsFor('slate', { radiusOverride: 'lg' }), 'light').vars;
    expect(round['--radius-md']).toBe(RADIUS_SCALE.lg.md);
    expect(round['--brand']).toBe(base['--brand']);
    const gray = resolveTheme(settingsFor('mono', { accentHue: 140 }), 'light').vars;
    expect(gray['--brand']).not.toBe(resolveTheme(settingsFor('mono'), 'light').vars['--brand']);
  });

  it('is deterministic and memoized', () => {
    const a = resolveTheme(settingsFor('sand'), 'dark');
    expect(resolveTheme(settingsFor('sand'), 'dark')).toBe(a);
  });

  it('snapshot of all themes and modes', () => {
    const all: Record<string, Partial<Record<ThemeVarName, string>>> = {};
    for (const id of THEME_IDS) for (const mode of THEME_MODES) all[`${id}-${mode}`] = resolveTheme(settingsFor(id), mode).vars;
    expect(all).toMatchSnapshot();
  });

  it('every value is built from constants: no value can hold CSS control text', () => {
    const forbidden = /[;{}<>"\\]|url\(|expression|@import|\/\*|!important/i;
    const color = /^rgba?\(\d{1,3}, \d{1,3}, \d{1,3}(, [01]\.\d{2})?\)$/;
    const family: Array<[RegExp, RegExp]> = [
      [/^--(slate-\d+|brand.*|acc-.*)$/, /^\d{1,3} \d{1,3} \d{1,3}$/],
      [/^--(body-text|focus-ring|surface-solid.*)$/, /^rgb\(\d{1,3}, \d{1,3}, \d{1,3}\)$/],
      [/^--focus-ring-soft$/, /^rgba\(\d{1,3}, \d{1,3}, \d{1,3}, [01]\.\d{2}\)$/],
      [/^--body-bg$/, /^radial-gradient\(ellipse at top left, rgb\(\d+, \d+, \d+\) 0%, rgb\(\d+, \d+, \d+\) 50%, rgb\(\d+, \d+, \d+\) 100%\)$/],
      [/^--glass-(bg.*|input-bg|border.*|input-border.*)$/, color],
      [/^--glass-highlight$/, /^inset 0 1px 0 rgba\(\d{1,3}, \d{1,3}, \d{1,3}, [01]\.\d{2}\)$/],
      [/^--glass-shadow(-hover)?$/, /^[0-9a-z\s.,()-]+$/],
      [/^--glass-filter$/, /^(none|blur\(\d+px\) saturate\(1\.5\))$/],
      [/^--mesh-c[123]$/, /^(transparent|rgba\(\d{1,3}, \d{1,3}, \d{1,3}, [01]\.\d{2}\))$/],
      [/^--radius-.*$/, /^\d(\.\d+)?rem$/],
      [/^--spacing$/, /^0\.\d+rem$/],
      [/^--font-(sans|display)$/, /^[A-Za-z0-9' ,-]+$/],
    ];
    const check = (vars: Partial<Record<ThemeVarName, string>>, where: string): void => {
      for (const [name, value] of Object.entries(vars)) {
        expect(value, `${where} ${name}`).not.toMatch(forbidden);
        const rule = family.find(([nameRe]) => nameRe.test(name));
        expect(rule, `no family for ${name}`).toBeDefined();
        expect(value, `${where} ${name}`).toMatch(rule![1]);
      }
    };
    for (const id of THEME_IDS) {
      for (const mode of THEME_MODES) {
        for (const env of ENVS) {
          for (const hue of [null, 0, 359]) check(resolveTheme(settingsFor(id, { accentHue: hue, radiusOverride: 'sm' }), mode, env).vars, `${id} ${mode}`);
        }
      }
    }
    for (const preset of THEME_PRESETS) for (const radius of RADII) for (const mode of THEME_MODES) check(resolveTheme({ ...DEFAULT_THEME_SETTINGS, preset, radius }, mode).vars, `legacy ${preset}`);
  });

  it('rgb channels are whole numbers 0..255', () => {
    for (const id of THEME_IDS) {
      for (const mode of THEME_MODES) {
        for (const [name, value] of Object.entries(resolveTheme(settingsFor(id), mode).vars)) {
          if (/^--(slate|brand|acc)/.test(name)) for (const ch of value.split(' ')) expect(Number(ch)).toBeLessThanOrEqual(255);
          for (const m of value.matchAll(/rgba?\((\d+), (\d+), (\d+)/g)) for (const ch of [m[1], m[2], m[3]]) expect(Number(ch)).toBeLessThanOrEqual(255);
        }
      }
    }
  });
});

describe('helpers', () => {
  it('names and modes', () => {
    expect(themeLabel(sanitizeTheme({ id: 'forest' }))).toBe('Forest');
    expect(themeLabel(sanitizeTheme({}))).toBe('Classic');
    expect(pickMode(sanitizeTheme({ id: 'forest', overrides: { mode: 'dark' } }), 'light')).toBe('dark');
    expect(pickMode(sanitizeTheme({ id: 'forest' }), 'light')).toBe('light');
  });

  it('a built app starts in overrides.mode, else the theme mode, else light', () => {
    expect(defaultMode(sanitizeTheme({ id: 'paper', overrides: { mode: 'dark' } }))).toBe('dark');
    expect(defaultMode(sanitizeTheme({ id: 'midnight' }))).toBe('dark');
    expect(defaultMode(sanitizeTheme({ id: 'paper' }))).toBe('light');
    expect(defaultMode(sanitizeTheme({}))).toBe('light');
    const modes: ThemeMode[] = THEME_IDS.map((id) => defaultMode(sanitizeTheme({ id })));
    expect(modes.every((m) => m === 'light' || m === 'dark')).toBe(true);
  });

  it('withThemeId sets the legacy preset and radius and drops overrides', () => {
    const next = withThemeId({ preset: 'aurora', radius: 'md', overrides: { accentHue: 5 } }, 'mono');
    expect(next).toEqual({ preset: 'graphite', radius: 'none', id: 'mono' });
  });
});
