// The plain look: a new app is a blank pearl sheet (cards stay white). It is not a theme id (that would change the spec schema); it is Classic
// with the `solid` background (no glow). Pure helpers shared by the Studio theme scope and the built app's runtime theme.
// Erasable TypeScript. No value here comes from a spec: the settings are already sanitized.
import { resolveTheme } from "./resolve.ts";
import type { ThemeEnv } from "./resolve.ts";
import type { ThemeSettings } from "./sanitize.ts";
import type { ThemeMode } from "./ids.ts";
import { rgbString } from "./color.ts";
import { PEARL_PAGE, THEMES, TONES } from "./themes.ts";
import type { ThemeVarName } from "./variables.ts";

/**
 * The flat page color of the plain look in `mode`: the pearl in light mode (cards stay white), the darkest step of the
 * Slate tone data (the kit palette the plain look uses) in dark mode. Never a gradient.
 */
export function plainPage(mode: ThemeMode): string {
  if (mode === "light") return rgbString(PEARL_PAGE);
  return rgbString(TONES[THEMES.slate.tone][mode].scale[950]);
}

/** The page color of the plain look in light mode. */
export const PLAIN_PAGE = plainPage("light");

/** True for the plain look: no theme id and no background glow. */
export function isPlainTheme(settings: ThemeSettings): boolean {
  return settings.id === null && settings.preset === "solid";
}

/** Variables the plain scope leaves to the kit (the accent family, fonts, corners, glow): they come from the page or the legacy corners. */
const KEPT_OUT = [
  "--brand",
  "--font-",
  "--spacing",
  "--radius-",
  "--mesh-",
  "--body-bg",
] as const;

/**
 * The variables of a plain scope in `mode`: the kit's own neutral palette (the Slate tone is the kit palette), so the app
 * is light even inside a dark Studio, with a flat pearl page in light mode and a flat dark page in dark mode (never a gradient), and no glow variable at all.
 */
export function plainVars(
  mode: ThemeMode,
  env: ThemeEnv,
): Partial<Record<ThemeVarName, string>> {
  const base = resolveTheme(
    {
      id: "slate",
      preset: "solid",
      radius: "md",
      accentHue: null,
      radiusOverride: null,
      mode: null,
    },
    mode,
    env,
  ).vars;
  const out: Partial<Record<ThemeVarName, string>> = {};
  for (const [name, value] of Object.entries(base)) {
    if (!KEPT_OUT.some((prefix) => name.startsWith(prefix)))
      out[name as ThemeVarName] = value;
  }
  out["--body-bg"] = plainPage(mode);
  return out;
}

export { withPlainTheme } from "./plainTheme.ts";
