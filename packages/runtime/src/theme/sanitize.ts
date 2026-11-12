// The runtime boundary for a theme: built apps have no zod, so the baked spec's theme block is re-checked here. Only enum
// members and whole numbers 0..359 survive; anything else becomes the default. Never throws. Erasable TypeScript.
import { ACCENT_HUE_MAX, THEME_IDS, THEME_MODES } from './ids.ts';
import type { ThemeId, ThemeMode } from './ids.ts';
import { MESH, RADIUS_SCALE } from './themes.ts';
import type { Preset, Radius } from './themes.ts';

export interface ThemeSettings {
  id: ThemeId | null;
  /** The legacy background glow, used only without an id. */
  preset: Preset;
  /** The legacy corners, used only without an id. */
  radius: Radius;
  accentHue: number | null;
  radiusOverride: Radius | null;
  mode: ThemeMode | null;
}

export const DEFAULT_PRESET: Preset = 'aurora';
export const DEFAULT_RADIUS: Radius = 'md';

export const DEFAULT_THEME_SETTINGS: ThemeSettings = Object.freeze({
  id: null,
  preset: DEFAULT_PRESET,
  radius: DEFAULT_RADIUS,
  accentHue: null,
  radiusOverride: null,
  mode: null,
});

const PRESET_IDS = Object.keys(MESH) as Preset[];
const RADIUS_IDS = Object.keys(RADIUS_SCALE) as Radius[];

/** The own, enumerable value of `key` on a plain object; inherited keys (`__proto__`, `constructor`) never count. */
function own(obj: unknown, key: string): unknown {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return undefined;
  return Object.prototype.hasOwnProperty.call(obj, key) ? (obj as Record<string, unknown>)[key] : undefined;
}

function pickOf<T extends string>(allowed: readonly T[], value: unknown): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/** `raw` is the spec's `theme` block (or anything at all). The result holds nothing but members of the known sets. */
export function sanitizeTheme(raw: unknown): ThemeSettings {
  const id = pickOf<ThemeId>(THEME_IDS, own(raw, 'id'));
  const preset = pickOf<Preset>(PRESET_IDS, own(raw, 'preset')) ?? DEFAULT_PRESET;
  const radius = pickOf<Radius>(RADIUS_IDS, own(raw, 'radius')) ?? DEFAULT_RADIUS;
  if (id === null) return { id: null, preset, radius, accentHue: null, radiusOverride: null, mode: null };
  const overrides = own(raw, 'overrides');
  const hue = own(overrides, 'accentHue');
  const accentHue = typeof hue === 'number' && Number.isInteger(hue) && hue >= 0 && hue <= ACCENT_HUE_MAX ? hue : null;
  return {
    id,
    preset,
    radius,
    accentHue,
    radiusOverride: pickOf<Radius>(RADIUS_IDS, own(overrides, 'radius')),
    mode: pickOf<ThemeMode>(THEME_MODES, own(overrides, 'mode')),
  };
}
