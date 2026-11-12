// Runtime only: applies the baked theme to <html> in a built app. Variable names come from THEME_VARIABLES, values from the
// resolver; they are set with style.setProperty, never as stylesheet text (the desktop CSP allows inline styles, not <style>).
// Re-applies when the .light class changes (the Settings mode switch) and when the accessibility media queries change.
// Erasable TypeScript; this file and its imports are the only theme code a built app carries.
import { sanitizeTheme } from './sanitize.ts';
import type { ThemeSettings } from './sanitize.ts';
import { defaultMode, resolveTheme, themeLabel } from './resolve.ts';
import { isPlainTheme, plainPage } from './plain.ts';
import type { ThemeEnv } from './resolve.ts';
import type { ThemeMode } from './ids.ts';
import { isThemeVariable } from './variables.ts';

const QUERIES = ['(prefers-reduced-transparency: reduce)', '(prefers-contrast: more)'] as const;

function matches(query: string): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(query).matches === true;
}

function readEnv(): ThemeEnv {
  const noBlur =
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    !CSS.supports('backdrop-filter', 'blur(1px)') &&
    !CSS.supports('-webkit-backdrop-filter', 'blur(1px)');
  const contrastMore = matches('(prefers-contrast: more)');
  return { solidSurfaces: noBlur || matches('(prefers-reduced-transparency: reduce)') || contrastMore, strongEdges: contrastMore };
}

/**
 * Applies the baked theme and keeps it applied. `raw` is the spec's theme block (sanitized here). Returns the theme's name
 * and the mode a fresh install starts in (the user's own choice in Settings wins once made); `stop()` detaches the listeners.
 * `themed` is false for a Classic spec (no theme id): it behaves as before themes existed. Its corners are applied here, but its
 * glow is not: `background` (the baked preset) is handed back as the default of the user's own background choice instead, so a
 * saved choice wins.
 */
export function startRuntimeTheme(raw: unknown): { label: string; mode: ThemeMode; themed: boolean; background: string | null; stop(): void } {
  const settings: ThemeSettings = sanitizeTheme(raw);
  const root = document.documentElement;
  const applied = new Set<string>();

  const apply = (): void => {
    const mode: ThemeMode = root.classList.contains('light') ? 'light' : 'dark';
    const { vars } = resolveTheme(settings, mode, readEnv());
    for (const [name, value] of Object.entries(vars)) {
      if (settings.id === null && name.startsWith('--mesh-')) continue;
      if (isThemeVariable(name) && typeof value === 'string') {
        root.style.setProperty(name, value);
        applied.add(name);
      }
    }
    // The plain look (Classic, no glow) is a flat page, never a gradient: pearl in light mode, the flat dark tone in dark mode.
    if (isPlainTheme(settings)) {
      root.style.setProperty('--body-bg', plainPage(mode));
      applied.add('--body-bg');
    } else if (settings.id === null && applied.has('--body-bg')) {
      root.style.removeProperty('--body-bg');
      applied.delete('--body-bg');
    }
  };

  if (settings.id !== null) document.body.style.fontFamily = 'var(--font-sans)';
  apply();

  const observer = new MutationObserver(apply);
  observer.observe(root, { attributes: true, attributeFilter: ['class'] });
  const lists: MediaQueryList[] = [];
  if (typeof window.matchMedia === 'function') {
    for (const query of QUERIES) {
      const list = window.matchMedia(query);
      list.addEventListener?.('change', apply);
      lists.push(list);
    }
  }

  return {
    label: themeLabel(settings),
    mode: defaultMode(settings),
    themed: settings.id !== null,
    background: settings.id === null ? settings.preset : null,
    stop() {
      observer.disconnect();
      for (const list of lists) list.removeEventListener?.('change', apply);
      for (const name of applied) root.style.removeProperty(name);
      applied.clear();
    },
  };
}
