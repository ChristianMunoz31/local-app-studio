import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AppShell from '../AppShell';
import { ToastProvider } from '../../../contexts/ToastContext';

// Shell chrome is irrelevant here; only the launcher wiring (settings + route) is under test.
vi.mock('../BurgerMenu', () => ({ default: () => null }));
vi.mock('../TopBar', () => ({ default: () => null }));
vi.mock('../../palette/CommandPalette', () => ({ default: () => null }));

// TrialNotice reads the license status through the service; keep it off the network.
vi.mock('../../../services/licenseService', () => ({
  licenseService: { get: vi.fn(async () => ({ state: 'free', pro: false })) },
}));

// TrialNotice also waits for the profile (no banner during onboarding); keep that off the network too.
vi.mock('../../../hooks/useProfile', () => ({
  useProfile: () => ({ onboarded: true, isLoading: false, unresolved: false }),
}));

const settings = vi.hoisted(() => ({ value: { showButton: true, autoAdvise: true } }));
vi.mock('../../../hooks/useAssistantSettings', () => ({ useAssistantSettings: () => settings.value }));

const NAME = 'Ask Assistant about this page';

const queryClient = new QueryClient();

function mount(path) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <AppShell>
            <p>page body</p>
          </AppShell>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  settings.value = { showButton: true, autoAdvise: true };
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AppShell Assistant launcher wiring', () => {
  it('shows the launcher on a normal page', () => {
    mount('/settings');
    expect(screen.getByRole('button', { name: NAME })).toBeInTheDocument();
  });

  it('hides the launcher on a path with no Assistant page', () => {
    mount('/nowhere');
    expect(screen.queryByRole('button', { name: NAME })).not.toBeInTheDocument();
    expect(screen.getByText('page body')).toBeInTheDocument();
  });

  it('hides the launcher when the button setting is off', () => {
    settings.value = { showButton: false, autoAdvise: true };
    mount('/settings');
    expect(screen.queryByRole('button', { name: NAME })).not.toBeInTheDocument();
  });

  it('reserves bottom padding only while the launcher is visible', () => {
    const { container, unmount } = mount('/settings');
    expect(container.querySelector('.animate-page-in')).toHaveClass('pb-24');
    unmount();
    settings.value = { showButton: false, autoAdvise: true };
    const off = mount('/settings');
    expect(off.container.querySelector('.animate-page-in')).not.toHaveClass('pb-24');
  });

  it('makes no network request just by rendering', () => {
    mount('/settings');
    expect(fetch).not.toHaveBeenCalled();
  });
});
