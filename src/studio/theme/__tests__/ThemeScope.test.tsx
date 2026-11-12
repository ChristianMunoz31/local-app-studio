import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Theme } from '@local-app-studio/runtime/spec/schema.ts';
import ThemeScope from '../ThemeScope';
import ThemeSwatch from '../ThemeSwatch';

afterEach(cleanup);

const legacy: Theme = { preset: 'aurora', radius: 'md' };
const forest: Theme = { preset: 'forest', radius: 'md', id: 'forest' };

describe('ThemeScope', () => {
  it('puts the theme variables on its wrapper, not on the document root', () => {
    render(
      <ThemeScope theme={forest} mode="dark" testId="scope">
        <p>Inside</p>
      </ThemeScope>,
    );
    const wrapper = screen.getByTestId('scope');
    expect(wrapper.style.getPropertyValue('--brand')).toMatch(/^\d+ \d+ \d+$/);
    expect(wrapper.style.getPropertyValue('--font-sans')).toContain('Segoe UI');
    expect(wrapper.style.colorScheme).toBe('dark');
    expect(wrapper.contains(screen.getByText('Inside'))).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--brand')).toBe('');
    expect(document.documentElement.getAttribute('style')).toBeNull();
    expect(document.body.getAttribute('style')).toBeNull();
  });

  it('a legacy theme sets only the glow and the corners', () => {
    render(
      <ThemeScope theme={{ preset: 'ocean', radius: 'lg' }} mode="light" testId="scope">
        <p>Inside</p>
      </ThemeScope>,
    );
    const wrapper = screen.getByTestId('scope');
    expect(wrapper.style.getPropertyValue('--mesh-c1')).toContain('rgba(125, 190, 250');
    expect(wrapper.style.getPropertyValue('--radius-md')).toBe('0.5rem');
    expect(wrapper.style.getPropertyValue('--brand')).toBe('');
    expect(wrapper.style.getPropertyValue('--slate-100')).toBe('');
  });

  it('uses the mode prop, else the theme own mode, else light, never the Studio mode', () => {
    const { rerender } = render(
      <ThemeScope theme={{ ...forest, overrides: { mode: 'dark' } }} testId="scope">
        x
      </ThemeScope>,
    );
    expect(screen.getByTestId('scope').getAttribute('data-theme-mode')).toBe('dark');
    rerender(
      <ThemeScope theme={{ ...forest, overrides: { mode: 'dark' } }} mode="light" testId="scope">
        x
      </ThemeScope>,
    );
    expect(screen.getByTestId('scope').getAttribute('data-theme-mode')).toBe('light');
    rerender(
      <ThemeScope theme={legacy} testId="scope">
        x
      </ThemeScope>,
    );
    expect(screen.getByTestId('scope').getAttribute('data-theme-mode')).toBe('light');
  });

  it('shows a Classic (no mode) theme in light even when Studio itself is dark', () => {
    document.documentElement.classList.add('dark');
    render(
      <ThemeScope theme={legacy} testId="scope">
        x
      </ThemeScope>,
    );
    expect(screen.getByTestId('scope').getAttribute('data-theme-mode')).toBe('light');
    expect(screen.getByTestId('scope').style.colorScheme).toBe('light');
    document.documentElement.classList.remove('dark');
  });

  it('keeps a dark theme dark, and an explicit mode wins over the theme', () => {
    const { rerender } = render(
      <ThemeScope theme={{ preset: 'aurora', radius: 'md', id: 'midnight' }} testId="scope">
        x
      </ThemeScope>,
    );
    expect(screen.getByTestId('scope').getAttribute('data-theme-mode')).toBe('dark');
    rerender(
      <ThemeScope theme={{ preset: 'aurora', radius: 'md', id: 'midnight' }} mode="light" testId="scope">
        x
      </ThemeScope>,
    );
    expect(screen.getByTestId('scope').getAttribute('data-theme-mode')).toBe('light');
    rerender(
      <ThemeScope theme={legacy} mode="dark" testId="scope">
        x
      </ThemeScope>,
    );
    expect(screen.getByTestId('scope').getAttribute('data-theme-mode')).toBe('dark');
  });

  it('drops hostile theme values instead of passing them on', () => {
    const hostile = JSON.parse('{"preset":"x;}","radius":"</style>","id":"a{b}","overrides":{"accentHue":"1;color:red"}}') as Theme;
    render(
      <ThemeScope theme={hostile} mode="light" testId="scope">
        x
      </ThemeScope>,
    );
    const style = screen.getByTestId('scope').getAttribute('style') ?? '';
    expect(style).not.toMatch(/[<>{}]|red/);
    expect(screen.getByTestId('scope').style.getPropertyValue('--radius-md')).toBe('0.375rem');
  });
});

describe('ThemeSwatch', () => {
  it('renders from the same data and is hidden from assistive tech', () => {
    render(<ThemeSwatch theme={forest} mode="light" size="md" />);
    const swatch = screen.getByTestId('theme-swatch');
    expect(swatch.getAttribute('aria-hidden')).toBe('true');
    expect(swatch.style.getPropertyValue('--brand')).toMatch(/^\d+ \d+ \d+$/);
  });
});

describe('ThemeScope: the plain look', () => {
  const plain: Theme = { preset: 'solid', radius: 'md' };

  it('is a light pearl sheet with no mesh variable and no gradient, even when Studio is dark', () => {
    document.documentElement.classList.add('dark');
    render(
      <ThemeScope theme={plain} testId="scope">
        x
      </ThemeScope>,
    );
    const wrapper = screen.getByTestId('scope');
    expect(wrapper.getAttribute('data-theme-mode')).toBe('light');
    expect(wrapper.getAttribute('style') ?? '').not.toContain('--mesh-');
    expect(wrapper.style.getPropertyValue('--body-bg')).toBe('rgb(251, 249, 246)');
    expect(wrapper.style.background).toContain('var(--body-bg)');
    expect(wrapper.style.backgroundImage).not.toContain('gradient');
    expect(wrapper.style.getPropertyValue('--slate-800')).toBe('255 255 255');
    expect(wrapper.style.getPropertyValue('--radius-md')).toBe('0.375rem');
    // Not a theme: no accent, font or spacing variable of its own.
    expect(wrapper.style.getPropertyValue('--brand')).toBe('');
    expect(wrapper.style.getPropertyValue('--font-sans')).toBe('');
    document.documentElement.classList.remove('dark');
  });

  it('shown dark is a flat dark page: no mesh variable and no gradient anywhere', () => {
    render(
      <ThemeScope theme={plain} mode="dark" testId="scope">
        x
      </ThemeScope>,
    );
    const wrapper = screen.getByTestId('scope');
    expect(wrapper.getAttribute('data-theme-mode')).toBe('dark');
    expect(wrapper.getAttribute('style') ?? '').not.toContain('--mesh-');
    expect(wrapper.getAttribute('style') ?? '').not.toContain('gradient');
    expect(wrapper.style.getPropertyValue('--body-bg')).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    expect(wrapper.style.getPropertyValue('--body-bg')).toBe('rgb(22, 19, 16)');
    expect(wrapper.style.backgroundImage).toBe('');
  });

  it('keeps the old Classic look for the other glows', () => {
    render(
      <ThemeScope theme={{ preset: 'aurora', radius: 'md' }} testId="scope">
        x
      </ThemeScope>,
    );
    expect(screen.getByTestId('scope').style.getPropertyValue('--mesh-c1')).not.toBe('');
  });
});
