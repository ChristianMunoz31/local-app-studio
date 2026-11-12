// The accessibility environment a Studio theme scope follows: the same three cases the kit's media blocks handle in
// src/index.css (no backdrop blur support, reduced transparency, increased contrast). Mirrors src/theme/applyRoot.ts.
import { useSyncExternalStore } from 'react';
import type { ThemeEnv } from '@local-app-studio/runtime/theme/resolve.ts';

const REDUCED = '(prefers-reduced-transparency: reduce)';
const CONTRAST = '(prefers-contrast: more)';

const hasMatchMedia = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

function subscribe(onChange: () => void): () => void {
  if (!hasMatchMedia()) return () => {};
  const lists = [window.matchMedia(REDUCED), window.matchMedia(CONTRAST)];
  for (const list of lists) list.addEventListener?.('change', onChange);
  return () => {
    for (const list of lists) list.removeEventListener?.('change', onChange);
  };
}

function noBlurSupport(): boolean {
  return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && !CSS.supports('backdrop-filter', 'blur(1px)') && !CSS.supports('-webkit-backdrop-filter', 'blur(1px)');
}

/** Packs the environment into one string so useSyncExternalStore can compare snapshots by value. */
function snapshot(): string {
  const reduced = hasMatchMedia() && window.matchMedia(REDUCED).matches === true;
  const contrast = hasMatchMedia() && window.matchMedia(CONTRAST).matches === true;
  return `${noBlurSupport() || reduced || contrast ? 1 : 0}${contrast ? 1 : 0}`;
}

const SNAPSHOTS: Readonly<Record<string, ThemeEnv>> = {
  '00': { solidSurfaces: false, strongEdges: false },
  '01': { solidSurfaces: false, strongEdges: true },
  '10': { solidSurfaces: true, strongEdges: false },
  '11': { solidSurfaces: true, strongEdges: true },
};

/** The current environment; re-renders when a media query changes. */
export function useThemeEnv(): ThemeEnv {
  const key = useSyncExternalStore(subscribe, snapshot, () => '00');
  return SNAPSHOTS[key] ?? SNAPSHOTS['00']!;
}
