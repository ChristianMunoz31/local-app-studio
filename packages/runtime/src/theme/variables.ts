// The variable contract: the only CSS custom property names a theme may set. Everything that applies a theme (the Studio
// scope, the built app root) writes names from this list and nothing else. Erasable TypeScript, no imports.

export const THEME_VARIABLES = [
  '--slate-50', '--slate-100', '--slate-200', '--slate-300', '--slate-400', '--slate-500', '--slate-600', '--slate-700', '--slate-800', '--slate-900', '--slate-950',
  '--body-bg', '--body-text', '--brand', '--brand-light', '--brand-dark', '--brand-accent',
  '--acc-green', '--acc-red', '--acc-yellow', '--acc-orange', '--acc-cyan', '--acc-purple', '--acc-teal', '--acc-blue', '--acc-fuchsia', '--acc-amber', '--acc-indigo',
  '--glass-bg', '--glass-bg-dense', '--glass-bg-strong', '--glass-bg-flat', '--glass-bg-subtle', '--glass-input-bg', '--glass-border', '--glass-border-strong',
  '--glass-input-border', '--glass-input-border-hover', '--glass-highlight', '--glass-shadow', '--glass-shadow-hover', '--glass-filter',
  '--surface-solid', '--surface-solid-strong', '--focus-ring', '--focus-ring-soft', '--mesh-c1', '--mesh-c2', '--mesh-c3',
  '--radius-sm', '--radius-md', '--radius-lg', '--radius-xl', '--radius-2xl', '--spacing', '--font-sans', '--font-display',
] as const;

export type ThemeVarName = (typeof THEME_VARIABLES)[number];

/** What a spec without a theme id sets: the background glow and the corners (the "Classic" look keeps everything else). */
export const LEGACY_VARIABLES: readonly ThemeVarName[] = [
  '--mesh-c1', '--mesh-c2', '--mesh-c3', '--radius-sm', '--radius-md', '--radius-lg', '--radius-xl', '--radius-2xl',
];

const KNOWN: ReadonlySet<string> = new Set(THEME_VARIABLES);

/** True for a name in the contract. */
export function isThemeVariable(name: string): name is ThemeVarName {
  return KNOWN.has(name);
}
