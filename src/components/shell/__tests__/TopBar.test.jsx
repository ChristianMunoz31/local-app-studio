import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TopBar from '../TopBar';
import { resetDom } from '../../../test-utils/settingsHarness';

// No server in tests: the synced-setting hook falls back to localStorage.
vi.mock('../../../services/stateService', () => ({
  stateService: {
    get: vi.fn(async () => undefined),
    put: vi.fn(async () => undefined),
  },
}));

const profile = vi.hoisted(() => ({ displayName: null }));
vi.mock('../../../hooks/useProfile', () => ({
  useProfile: () => ({ displayName: profile.displayName, onboarded: true, isLoading: false, save: vi.fn() }),
}));

const appInfo = vi.hoisted(() => ({ info: null }));
vi.mock('../../../hooks/useAppInfo', () => ({ useAppInfo: () => ({ info: appInfo.info }) }));

// Deliberately no ThemeProvider: TopBar must not depend on the theme context.
function renderTopBar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TopBar />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  profile.displayName = null;
  appInfo.info = null;
  resetDom();
});
afterEach(() => {
  cleanup();
  resetDom();
});

describe('TopBar', () => {
  it('greets without a name when no display name is set', () => {
    renderTopBar();
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toMatch(/^(Up late|Good (morning|afternoon|evening|night))$/);
  });

  it('greets by the chosen display name', () => {
    profile.displayName = 'Sam';
    renderTopBar();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/^.+, Sam$/);
  });

  it('shows the Dev build badge in the dev channel only', () => {
    appInfo.info = { version: '0.2.0-dev.1', channel: 'dev', desktop: true };
    renderTopBar();
    expect(screen.getByText('Dev build')).toBeInTheDocument();
    cleanup();
    appInfo.info = { version: '0.1.0', channel: 'stable', desktop: true };
    renderTopBar();
    expect(screen.queryByText('Dev build')).not.toBeInTheDocument();
  });

  it('has no theme toggle button (theme is controlled from Settings only)', () => {
    renderTopBar();
    expect(screen.queryByRole('button', { name: /\b(theme|light|dark)\b/i })).toBeNull();
  });

  it('still renders the search control', () => {
    renderTopBar();
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
  });

  it('names the search control from its visible word, not a different phrase', () => {
    renderTopBar();
    expect(screen.queryByRole('button', { name: 'Open command palette' })).toBeNull();
  });

  describe('search key hint', () => {
    const setPlatform = (platform) => vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue(platform);
    afterEach(() => vi.restoreAllMocks());

    it('shows Ctrl K on Windows', () => {
      setPlatform('Win32');
      renderTopBar();
      expect(screen.getByText('Ctrl K')).toBeInTheDocument();
      expect(screen.queryByText('⌘K')).not.toBeInTheDocument();
    });

    it('shows the command key on a Mac', () => {
      setPlatform('MacIntel');
      renderTopBar();
      expect(screen.getByText('⌘K')).toBeInTheDocument();
    });

    it('falls back to Ctrl K when the platform is empty', () => {
      setPlatform('');
      renderTopBar();
      expect(screen.getByText('Ctrl K')).toBeInTheDocument();
    });
  });
});
