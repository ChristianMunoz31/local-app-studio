import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Settings from '../Settings';
import { ThemeProvider } from '../../contexts/ThemeContext';
import { ToastProvider } from '../../contexts/ToastContext';
import { installMatchMedia, resetDom } from '../../test-utils/settingsHarness';
import { useAssistantSettings } from '../../hooks/useAssistantSettings';
import { SETTINGS_DEFAULTS, SETTINGS_KEYS } from '../../constants/settingsDefaults';

const server = vi.hoisted(() => ({ map: new Map() }));

vi.mock('../../services/stateService', () => ({
  stateService: {
    getAll: vi.fn(async () => Object.fromEntries(server.map)),
    get: vi.fn(async (key) => server.map.get(key)),
    put: vi.fn(async (key, value) => {
      server.map.set(key, value);
      return { ok: true };
    }),
  },
}));
vi.mock('../../hooks/useAssistantStatus', () => ({
  useAssistantStatus: () => ({ status: null, loading: false }),
}));
vi.mock('../../services/secretsService', () => ({
  secretsService: {
    list: vi.fn(async () => ({
      encryption: { enabled: true },
      storage: { available: true },
      writable: true,
      secrets: [],
    })),
    save: vi.fn(),
    remove: vi.fn(),
    test: vi.fn(),
  },
}));

import { stateService } from '../../services/stateService';
import { lsKey } from '../../utils/storageKeys';
import { allowSlowSuite } from '../../test-utils/slowSuite';

allowSlowSuite();

const wrapper = ({ children }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

async function mountSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <ThemeProvider>
            <Settings />
          </ThemeProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  await waitFor(() => expect(stateService.get).toHaveBeenCalled());
  await act(async () => {});
}

const radios = (legend) => {
  const g = screen.getByRole('group', { name: legend });
  return { on: within(g).getByRole('radio', { name: /^On/ }), off: within(g).getByRole('radio', { name: /^Off/ }), g };
};
const BUTTON = 'Show the Assistant button (you can still open Assistant from search)';
const AUTO = 'Auto-advise when opened';
const localJson = (key) => JSON.parse(localStorage.getItem(lsKey(key)));

beforeEach(() => {
  server.map.clear();
  stateService.get.mockClear();
  stateService.put.mockClear();
  resetDom();
  installMatchMedia(false);
});
afterEach(() => {
  cleanup();
  resetDom();
});

describe('Assistant settings on the Settings page', () => {
  it('both toggles default to On and nothing is written on load', async () => {
    await mountSettings();
    expect(radios(BUTTON).on).toBeChecked();
    expect(radios(AUTO).on).toBeChecked();
    expect(stateService.put).not.toHaveBeenCalled();
  });

  it('turning the button Off persists it and leaves auto-advise enabled', async () => {
    const user = userEvent.setup();
    await mountSettings();
    await user.click(radios(BUTTON).off);
    expect(radios(BUTTON).off).toBeChecked();
    expect(localJson('assistant:advisorButton')).toBe(false);
    expect(stateService.put).toHaveBeenCalledWith('assistant:advisorButton', false);
    expect(radios(AUTO).g).toBeEnabled();
  });

  it('turning auto-advise Off persists it', async () => {
    const user = userEvent.setup();
    await mountSettings();
    await user.click(radios(AUTO).off);
    expect(localJson('assistant:autoAdvise')).toBe(false);
    expect(stateService.put).toHaveBeenCalledWith('assistant:autoAdvise', false);
  });

  it('Reset General restores both toggles to On', async () => {
    const user = userEvent.setup();
    await mountSettings();
    await user.click(radios(BUTTON).off);
    await user.click(radios(AUTO).off);
    await user.click(screen.getByRole('button', { name: 'Reset General' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(radios(BUTTON).on).toBeChecked();
    expect(radios(AUTO).on).toBeChecked();
    expect(localJson('assistant:advisorButton')).toBe(true);
    expect(localJson('assistant:autoAdvise')).toBe(true);
  });

  it('Reset all to defaults restores both toggles to On', async () => {
    const user = userEvent.setup();
    await mountSettings();
    await user.click(radios(BUTTON).off);
    await user.click(radios(AUTO).off);
    await user.click(screen.getByRole('button', { name: 'Reset all to defaults' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(radios(BUTTON).on).toBeChecked();
    expect(radios(AUTO).on).toBeChecked();
    expect(stateService.put).toHaveBeenCalledWith('assistant:advisorButton', true);
    expect(stateService.put).toHaveBeenCalledWith('assistant:autoAdvise', true);
  });

  it('an unknown stored value falls back to On', async () => {
    localStorage.setItem(lsKey('assistant:advisorButton'), JSON.stringify('banana'));
    localStorage.setItem(lsKey('assistant:autoAdvise'), JSON.stringify(7));
    await mountSettings();
    expect(radios(BUTTON).on).toBeChecked();
    expect(radios(AUTO).on).toBeChecked();
  });
});

describe('useAssistantSettings', () => {
  it('defaults to showButton + autoAdvise on', () => {
    expect(SETTINGS_DEFAULTS.assistantAdvisorButton).toBe(true);
    expect(SETTINGS_DEFAULTS.assistantAutoAdvise).toBe(true);
    const { result } = renderHook(() => useAssistantSettings(), { wrapper });
    expect(result.current).toEqual({ showButton: true, autoAdvise: true });
  });

  it('reads stored Off values', () => {
    localStorage.setItem(lsKey(SETTINGS_KEYS.assistantAdvisorButton), JSON.stringify(false));
    localStorage.setItem(lsKey(SETTINGS_KEYS.assistantAutoAdvise), JSON.stringify(false));
    const { result } = renderHook(() => useAssistantSettings(), { wrapper });
    expect(result.current).toEqual({ showButton: false, autoAdvise: false });
  });
});
