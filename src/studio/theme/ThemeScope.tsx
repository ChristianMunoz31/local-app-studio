// The only place Studio applies theme variables. The variables live on this wrapper's inline style, so Studio's own chrome
// (which reads them from :root) keeps the kit theme. Kit modals portal to <body> and therefore show Studio's look (docs/THEMES.md).
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import type { Theme } from '@local-app-studio/runtime/spec/schema.ts';
import { defaultMode } from '@local-app-studio/runtime/theme/resolve.ts';
import { sanitizeTheme } from '@local-app-studio/runtime/theme/sanitize.ts';
import type { ThemeMode } from '@local-app-studio/runtime/theme/ids.ts';
import { scopeStyle } from './scopeStyle';
import { useThemeEnv } from './themeEnv';

export interface ThemeScopeProps {
  theme: Theme;
  /** The mode to show. Without it: the theme's own mode, else light (the app is ordinary software, so it never follows Studio's own mode). */
  mode?: 'light' | 'dark';
  className?: string;
  children: ReactNode;
  testId?: string;
}

export default function ThemeScope({ theme, mode, className, children, testId }: ThemeScopeProps) {
  const env = useThemeEnv();
  const chosen: ThemeMode = mode ?? defaultMode(sanitizeTheme(theme));
  const style = useMemo(() => scopeStyle(theme, chosen, env), [theme, chosen, env]);
  return (
    <div className={className} style={style} data-testid={testId} data-theme-mode={chosen}>
      {children}
    </div>
  );
}
