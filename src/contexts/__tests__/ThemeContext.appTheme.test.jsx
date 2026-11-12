// In a built app the module registry carries the spec's theme: the default preference is its mode, and a stored 'system'
// (from before the app had a theme) falls back to it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, useTheme } from '../ThemeContext';
import { installMatchMedia, resetDom } from '../../test-utils/settingsHarness';
import { lsKey } from '../../utils/storageKeys';

const app = vi.hoisted(() => ({ theme: { name: 'Midnight', mode: 'dark' }, background: null, mode: 'studio' }));
vi.mock('../../appMode.js', () => ({
  get APP_MODE() {
    return app.mode;
  },
}));
vi.mock('../../modules', () => ({
  get MODULE_APP_THEME() {
    return app.theme;
  },
  get MODULE_APP_BACKGROUND() {
    return app.background;
  },
}));
vi.mock('../../services/stateService', () => ({
  stateService: { get: vi.fn(async () => undefined), put: vi.fn(async () => ({})) },
}));

let client;
const wrapper = ({ children }) => (
  <QueryClientProvider client={client}>
    <ThemeProvider>{children}</ThemeProvider>
  </QueryClientProvider>
);

beforeEach(() => {
  app.background = null;
  app.mode = 'runtime';
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  resetDom();
  installMatchMedia(true); // the computer prefers light: the app's own mode must still win
});
afterEach(() => {
  cleanup();
  resetDom();
});

describe('ThemeProvider in a built app', () => {
  it('starts in the spec mode, not the computer mode', async () => {
    app.theme = { name: 'Midnight', mode: 'dark' };
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.preference).toBe('dark');
    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.classList.contains('light')).toBe(false);
  });

  it('a themed dark app starts dark while the computer prefers light, and a themed light app starts light while it prefers dark', () => {
    app.theme = { name: 'Forest', mode: 'dark' };
    expect(renderHook(() => useTheme(), { wrapper }).result.current.theme).toBe('dark');
    cleanup();
    resetDom();
    installMatchMedia(false);
    app.theme = { name: 'Paper', mode: 'light' };
    expect(renderHook(() => useTheme(), { wrapper }).result.current.theme).toBe('light');
  });

  it('starts light when the spec says light', () => {
    app.theme = { name: 'Paper', mode: 'light' };
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe('light');
    expect(document.documentElement.classList.contains('light')).toBe(true);
  });

  it('keeps the choice the user made', async () => {
    app.theme = { name: 'Paper', mode: 'light' };
    window.localStorage.setItem(lsKey('theme'), JSON.stringify('dark'));
    const { result } = renderHook(() => useTheme(), { wrapper });
    await waitFor(() => expect(result.current.theme).toBe('dark'));
  });

  it('turns a stored system choice into the spec mode', async () => {
    app.theme = { name: 'Paper', mode: 'light' };
    window.localStorage.setItem(lsKey('theme'), JSON.stringify('system'));
    const { result } = renderHook(() => useTheme(), { wrapper });
    await waitFor(() => expect(result.current.preference).toBe('light'));
    expect(result.current.theme).toBe('light');
  });
});

describe('ThemeProvider in a built Classic app (no theme id)', () => {
  it('starts light even when the computer prefers dark', () => {
    app.theme = null;
    installMatchMedia(false);
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.preference).toBe('light');
    expect(result.current.theme).toBe('light');
    expect(document.documentElement.classList.contains('light')).toBe(true);
  });

  it('keeps a saved Settings choice, dark or system', async () => {
    app.theme = null;
    installMatchMedia(false);
    window.localStorage.setItem(lsKey('theme'), JSON.stringify('dark'));
    const { result } = renderHook(() => useTheme(), { wrapper });
    await waitFor(() => expect(result.current.theme).toBe('dark'));
  });

  it('keeps a stored system choice and follows the computer, with no forced light start', async () => {
    app.theme = null;
    app.background = 'ocean';
    window.localStorage.setItem(lsKey('theme'), JSON.stringify('system'));
    const { result } = renderHook(() => useTheme(), { wrapper });
    await waitFor(() => expect(result.current.preference).toBe('system'));
    expect(result.current.theme).toBe('light'); // the computer prefers light here
  });

  it('uses the baked background until the user picks one, and the saved pick wins', async () => {
    app.theme = null;
    app.background = 'ocean';
    const first = renderHook(() => useTheme(), { wrapper });
    expect(first.result.current.bgDark).toBe('ocean');
    expect(first.result.current.bgLight).toBe('ocean');
    expect(document.documentElement.dataset.bgDark).toBe('ocean');
    first.unmount();
    window.localStorage.setItem(lsKey('appearance:bgDark'), JSON.stringify('forest'));
    const second = renderHook(() => useTheme(), { wrapper });
    await waitFor(() => expect(second.result.current.bgDark).toBe('forest'));
    expect(second.result.current.bgLight).toBe('ocean');
  });
});

describe('ThemeProvider without an app theme (Studio and the kit)', () => {
  it('follows the computer by default', () => {
    app.theme = null;
    app.mode = 'studio';
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.preference).toBe('system');
    expect(result.current.theme).toBe('light');
  });

  it('follows the computer when it prefers dark', () => {
    app.theme = null;
    app.mode = 'studio';
    installMatchMedia(false);
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.preference).toBe('system');
    expect(result.current.theme).toBe('dark');
  });
});
