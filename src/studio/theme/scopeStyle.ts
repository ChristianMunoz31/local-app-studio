// The inline style of a Studio theme scope: the resolved variables (names from THEME_VARIABLES, values built by the
// resolver), the color scheme, the font and text color, and the mesh plus page background. Nothing here comes from a spec
// except through sanitizeTheme, so a hostile theme block cannot reach a CSS value.
import type { CSSProperties } from 'react';
import { resolveTheme } from '@local-app-studio/runtime/theme/resolve.ts';
import type { ThemeEnv } from '@local-app-studio/runtime/theme/resolve.ts';
import { sanitizeTheme } from '@local-app-studio/runtime/theme/sanitize.ts';
import { isPlainTheme, plainVars } from '@local-app-studio/runtime/theme/plain.ts';
import type { ThemeMode } from '@local-app-studio/runtime/theme/ids.ts';
import { isThemeVariable } from '@local-app-studio/runtime/theme/variables.ts';
import type { Theme } from '@local-app-studio/runtime/spec/schema.ts';

/** The mesh blobs laid out for a box (percent geometry, like the Settings swatches), over the theme's page gradient. */
const BACKGROUND =
  'radial-gradient(70% 90% at 6% 0%, var(--mesh-c1), transparent 62%), radial-gradient(60% 90% at 96% 42%, var(--mesh-c2), transparent 62%), radial-gradient(60% 80% at 38% 108%, var(--mesh-c3), transparent 62%), var(--body-bg)';

export function scopeStyle(theme: Theme, mode: ThemeMode, env: ThemeEnv): CSSProperties {
  const settings = sanitizeTheme(theme);
  const style: Record<string, string> = {};
  if (isPlainTheme(settings)) {
    // The plain look: a pearl sheet. Neutral kit tokens, the corners, and no mesh variable or gradient at all.
    const { vars: corners } = resolveTheme(settings, mode, env);
    for (const [name, value] of Object.entries({ ...plainVars(mode, env), ...corners })) {
      if (isThemeVariable(name) && typeof value === 'string' && !name.startsWith('--mesh-')) style[name] = value;
    }
    style.colorScheme = mode;
    style.background = 'var(--body-bg)';
    style.color = 'var(--body-text)';
    return style as CSSProperties;
  }
  const { vars } = resolveTheme(settings, mode, env);
  for (const [name, value] of Object.entries(vars)) {
    if (isThemeVariable(name) && typeof value === 'string') style[name] = value;
  }
  style.colorScheme = mode;
  if (settings.id !== null) {
    style.fontFamily = 'var(--font-sans)';
    style.color = 'var(--body-text)';
    style.backgroundImage = BACKGROUND;
  } else {
    style.backgroundImage = BACKGROUND.replace(', var(--body-bg)', '');
  }
  return style as CSSProperties;
}
