// Theme ids, modes and bounds. No imports (docs/ARCHITECTURE_DECISIONS.md ADR-006): the spec schema and the Studio
// server import this file directly, so it must stay erasable TypeScript.

/** The built-in themes a spec may name. Docs: docs/THEMES.md. */
export const THEME_IDS = ['slate', 'paper', 'midnight', 'forest', 'sand', 'ocean', 'rose', 'mono'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const THEME_MODES = ['light', 'dark'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

/** The accent hue override is a whole number of degrees, 0 to this value. */
export const ACCENT_HUE_MAX = 359;
