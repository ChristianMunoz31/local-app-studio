// A small uniform preview of one theme from the same data the app uses: the glow, a tile with a heading line, a muted
// line and an accent pill. Decorative (the label next to it names the theme).
import { useMemo } from 'react';
import type { Theme } from '@local-app-studio/runtime/spec/schema.ts';
import { scopeStyle } from './scopeStyle';
import { useThemeEnv } from './themeEnv';

export interface ThemeSwatchProps {
  theme: Theme;
  mode: 'light' | 'dark';
  size: 'sm' | 'md';
}

export default function ThemeSwatch({ theme, mode, size }: ThemeSwatchProps) {
  const env = useThemeEnv();
  const style = useMemo(() => ({ ...scopeStyle(theme, mode, env), borderRadius: 'var(--radius-xl)' }), [theme, mode, env]);
  const height = size === 'sm' ? 'h-14' : 'h-24';
  return (
    <span
      aria-hidden="true"
      data-testid="theme-swatch"
      data-theme-mode={mode}
      style={style}
      className={`block ${height} w-full overflow-hidden border border-[color:var(--glass-border-strong)] p-2`}
    >
      <span
        className="flex h-full flex-col justify-between border border-[color:var(--glass-border-strong)] p-1.5"
        style={{ background: 'var(--glass-bg-dense)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--glass-shadow)' }}
      >
        <span className="block h-1.5 w-2/3 bg-slate-slate100" style={{ borderRadius: 'var(--radius-sm)' }} />
        <span className="block h-1 w-1/2 bg-slate-slate400" style={{ borderRadius: 'var(--radius-sm)' }} />
        <span className="block h-2.5 w-8 bg-slate-brand" style={{ borderRadius: 'var(--radius-md)' }} />
      </span>
    </span>
  );
}
