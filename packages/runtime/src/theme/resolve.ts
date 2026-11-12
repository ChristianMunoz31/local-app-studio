// The resolver: ThemeSettings + mode + environment -> the CSS variable values. Pure and deterministic. Every value is built
// here from constants and clamped integers; nothing from a spec is ever pasted into a value. Erasable TypeScript.
import { hslToRgb, rgbString, rgba, solveLightness, triplet } from './color.ts';
import type { Alpha, Rgb } from './color.ts';
import type { ThemeId, ThemeMode } from './ids.ts';
import { CLASSIC_LABEL, DENSITY, FONTS, MESH, RADIUS_SCALE, STATUS_ACCENTS, THEMES, TONES } from './themes.ts';
import type { Preset, Radius, StatusName } from './themes.ts';
import type { ThemeSettings } from './sanitize.ts';
import type { ThemeVarName } from './variables.ts';

export interface ThemeEnv {
  /** No backdrop blur support, reduced transparency, or increased contrast: surfaces are solid and the glow is off. */
  solidSurfaces: boolean;
  /** Increased contrast: borders use the strong text color. */
  strongEdges: boolean;
}

export interface ResolvedTheme {
  id: ThemeId | null;
  label: string;
  mode: ThemeMode;
  vars: Partial<Record<ThemeVarName, string>>;
}

const DEFAULT_ENV: ThemeEnv = { solidSurfaces: false, strongEdges: false };

/** Alphas per mode: the kit's own (src/index.css :root and :root.light). */
const A = {
  dark: { glass: 0.66, dense: 0.86, strong: 0.9, flat: 0.94, subtle: 0.3, input: 0.45, border: 0.11, borderStrong: 0.2, inputBorder: 0.75, inputHover: 0.75, highlight: 0.08 },
  light: { glass: 0.8, dense: 0.93, strong: 0.95, flat: 0.97, subtle: 0.7, input: 0.85, border: 0.1, borderStrong: 0.16, inputBorder: 0.85, inputHover: 0.9, highlight: 0.9 },
} as const satisfies Record<ThemeMode, Record<string, Alpha>>;

const SHADOWS = {
  dark: {
    shadow: '0 1px 2px rgba(0, 0, 0, 0.25), 0 8px 24px -4px rgba(0, 0, 0, 0.35), 0 20px 48px -12px rgba(0, 0, 0, 0.3)',
    hover: '0 2px 4px rgba(0, 0, 0, 0.3), 0 12px 32px -4px rgba(0, 0, 0, 0.45), 0 28px 56px -14px rgba(0, 0, 0, 0.35)',
    filter: 'blur(18px) saturate(1.5)',
  },
  light: {
    shadow: '0 1px 2px rgba(17, 24, 39, 0.05), 0 8px 24px -6px rgba(31, 41, 55, 0.1), 0 18px 40px -14px rgba(31, 41, 55, 0.1)',
    hover: '0 2px 4px rgba(17, 24, 39, 0.06), 0 12px 30px -6px rgba(31, 41, 55, 0.16), 0 24px 48px -16px rgba(31, 41, 55, 0.14)',
    filter: 'blur(16px) saturate(1.5)',
  },
} as const;

/** Saturation per chroma level. */
const CHROMA = { none: 0, soft: 0.45, vivid: 0.75 } as const;

/** Relative luminance targets: white text on `--brand` is at least 5:1; accent text is at least 7:1 on the surface. */
const LUM = { brand: 0.13, brandDark: 0.09, brandLight: 0.22, brandAccent: 0.16, accentDark: 0.45, accentLight: 0.075 } as const;

const STATUS_VARS: ReadonlyArray<readonly [StatusName, ThemeVarName]> = [
  ['green', '--acc-green'], ['red', '--acc-red'], ['yellow', '--acc-yellow'], ['orange', '--acc-orange'], ['cyan', '--acc-cyan'],
  ['purple', '--acc-purple'], ['teal', '--acc-teal'], ['blue', '--acc-blue'], ['fuchsia', '--acc-fuchsia'], ['amber', '--acc-amber'],
];

const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

type Vars = Partial<Record<ThemeVarName, string>>;

function radiusVars(radius: Radius): Vars {
  const r = RADIUS_SCALE[radius];
  return { '--radius-sm': r.sm, '--radius-md': r.md, '--radius-lg': r.lg, '--radius-xl': r.xl, '--radius-2xl': r['2xl'] };
}

function meshVars(preset: Preset, mode: ThemeMode, off: boolean): Vars {
  const [c1, c2, c3] = off ? (['transparent', 'transparent', 'transparent'] as const) : MESH[preset][mode];
  return { '--mesh-c1': c1, '--mesh-c2': c2, '--mesh-c3': c3 };
}

function accentRgb(hue: number, sat: number, lum: number): Rgb {
  return hslToRgb(hue, sat, solveLightness(hue, sat, lum));
}

function themedVars(settings: ThemeSettings & { id: ThemeId }, mode: ThemeMode, env: ThemeEnv): Vars {
  const def = THEMES[settings.id];
  const tone = TONES[def.tone][mode];
  const alpha = A[mode];
  const shade = SHADOWS[mode];
  const vars: Vars = {};

  for (const step of STEPS) vars[`--slate-${step}` as ThemeVarName] = triplet(tone.scale[step]);
  const [b1, b2, b3] = tone.bodyBg;
  vars['--body-bg'] = `radial-gradient(ellipse at top left, ${rgbString(b1)} 0%, ${rgbString(b2)} 50%, ${rgbString(b3)} 100%)`;
  vars['--body-text'] = rgbString(tone.bodyText);

  const hue = settings.accentHue ?? def.accent.hue;
  // A plain gray theme (no chroma) still honors an explicit accent color: it gets the soft level.
  const sat = CHROMA[settings.accentHue !== null && def.accent.chroma === 'none' ? 'soft' : def.accent.chroma];
  vars['--brand'] = triplet(accentRgb(hue, sat, LUM.brand));
  vars['--brand-dark'] = triplet(accentRgb(hue, sat, LUM.brandDark));
  vars['--brand-light'] = triplet(accentRgb(hue, sat, LUM.brandLight));
  vars['--brand-accent'] = triplet(accentRgb(hue, sat, LUM.brandAccent));
  const accent = accentRgb(hue, sat, mode === 'dark' ? LUM.accentDark : LUM.accentLight);
  vars['--acc-indigo'] = triplet(accent);
  vars['--focus-ring'] = rgbString(accent);
  vars['--focus-ring-soft'] = rgba(accent, 0.45);
  for (const [name, varName] of STATUS_VARS) vars[varName] = triplet(STATUS_ACCENTS[mode][name]);

  const solid = env.solidSurfaces;
  vars['--surface-solid'] = rgbString(tone.surface);
  vars['--surface-solid-strong'] = rgbString(tone.surfaceStrong);
  vars['--glass-bg'] = solid ? rgbString(tone.surface) : rgba(tone.glass, alpha.glass);
  vars['--glass-bg-dense'] = solid ? rgbString(tone.surfaceStrong) : rgba(tone.dense, alpha.dense);
  vars['--glass-bg-strong'] = solid ? rgbString(tone.surfaceStrong) : rgba(tone.surfaceStrong, alpha.strong);
  vars['--glass-bg-flat'] = solid ? rgbString(tone.surfaceStrong) : rgba(tone.surfaceStrong, alpha.flat);
  vars['--glass-bg-subtle'] = rgba(tone.well, alpha.subtle);
  vars['--glass-input-bg'] = rgba(tone.well, alpha.input);
  vars['--glass-filter'] = solid ? 'none' : shade.filter;

  if (env.strongEdges) {
    const strong = rgbString(tone.scale[400]);
    const hover = rgbString(tone.scale[200]);
    vars['--glass-border'] = strong;
    vars['--glass-border-strong'] = strong;
    vars['--glass-input-border'] = strong;
    vars['--glass-input-border-hover'] = hover;
  } else {
    vars['--glass-border'] = rgba(tone.edge, alpha.border);
    vars['--glass-border-strong'] = rgba(tone.edge, alpha.borderStrong);
    vars['--glass-input-border'] = rgba(mode === 'dark' ? tone.scale[400] : tone.scale[500], alpha.inputBorder);
    vars['--glass-input-border-hover'] = rgba(tone.scale[300], alpha.inputHover);
  }
  vars['--glass-highlight'] = `inset 0 1px 0 ${rgba(tone.highlight, alpha.highlight)}`;
  vars['--glass-shadow'] = shade.shadow;
  vars['--glass-shadow-hover'] = shade.hover;

  Object.assign(vars, meshVars(def.background, mode, solid), radiusVars(settings.radiusOverride ?? def.radius));
  vars['--spacing'] = DENSITY[def.density];
  vars['--font-sans'] = FONTS[def.font].body;
  vars['--font-display'] = FONTS[def.font].heading;
  return vars;
}

const MEMO = new Map<string, ResolvedTheme>();
const MEMO_MAX = 64;

/**
 * The variable values for `settings` in `mode`. A built-in id sets every name in THEME_VARIABLES; without an id only
 * LEGACY_VARIABLES are set (the glow from `preset` and the corners from `radius`), so legacy apps keep the kit look.
 * Memoized on the inputs; the returned object is shared, so callers must not change it.
 */
export function resolveTheme(settings: ThemeSettings, mode: ThemeMode, env: ThemeEnv = DEFAULT_ENV): ResolvedTheme {
  const key = [settings.id ?? '-', settings.preset, settings.radius, settings.accentHue ?? '-', settings.radiusOverride ?? '-', mode, env.solidSurfaces ? 1 : 0, env.strongEdges ? 1 : 0].join('|');
  const hit = MEMO.get(key);
  if (hit) return hit;
  let resolved: ResolvedTheme;
  if (settings.id === null) {
    resolved = { id: null, label: CLASSIC_LABEL, mode, vars: { ...meshVars(settings.preset, mode, false), ...radiusVars(settings.radius) } };
  } else {
    resolved = { id: settings.id, label: THEMES[settings.id].label, mode, vars: themedVars({ ...settings, id: settings.id }, mode, env) };
  }
  if (MEMO.size >= MEMO_MAX) MEMO.clear();
  MEMO.set(key, resolved);
  return resolved;
}

/** 'Forest', or 'Classic' for a spec without an id. */
export function themeLabel(settings: ThemeSettings): string {
  return settings.id === null ? CLASSIC_LABEL : THEMES[settings.id].label;
}

/** The mode the spec asks for (`overrides.mode`), else `fallback`. */
export function pickMode(settings: ThemeSettings, fallback: ThemeMode): ThemeMode {
  return settings.mode ?? fallback;
}

/** The mode a built app starts in: `overrides.mode`, else the theme's own mode, else light (Classic). */
export function defaultMode(settings: ThemeSettings): ThemeMode {
  return settings.mode ?? (settings.id === null ? 'light' : THEMES[settings.id].mode);
}

/** Picks theme `id`: also writes the legacy `preset` and `radius` from the theme data and drops `overrides`. */
export function withThemeId<T extends { preset: string; radius: string }>(theme: T, id: ThemeId): T & { id: ThemeId } {
  const def = THEMES[id];
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(theme)) {
    if (key !== 'overrides') next[key] = value;
  }
  next.preset = def.background;
  next.radius = def.radius;
  next.id = id;
  return next as T & { id: ThemeId };
}
