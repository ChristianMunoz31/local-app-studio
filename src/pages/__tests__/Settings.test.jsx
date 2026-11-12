import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Settings from '../Settings';
import { ThemeProvider } from '../../contexts/ThemeContext';
import { ToastProvider } from '../../contexts/ToastContext';
import { installMatchMedia, resetDom } from '../../test-utils/settingsHarness';

// Fake server: put() persists into `server`, get() reads it back.
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
  useAssistantStatus: () => ({ status: null }),
}));

vi.mock('../../services/aiSettingsService', () => ({
  aiSettingsService: {
    get: vi.fn(() => new Promise(() => {})),
    models: vi.fn(() => new Promise(() => {})),
  },
}));
vi.mock('../../services/secretsService', () => ({
  secretsService: {
    list: vi.fn(async () => ({
      encryption: { enabled: true },
      storage: { available: true },
      writable: true,
      secrets: [
        {
          name: 'EXAMPLE_API_KEY',
          label: 'Example Service',
          provider: 'example',
          description: 'Example provider',
          configured: true,
          source: 'settings',
          last4: '1234',
          updatedAt: '2026-01-01T00:00:00.000Z',
          envFallback: false,
          stale: false,
          testable: true,
        },
      ],
    })),
    save: vi.fn(),
    remove: vi.fn(),
    test: vi.fn(),
  },
}));

import { stateService } from '../../services/stateService';
import { secretsService } from '../../services/secretsService';
import { lsKey } from '../../utils/storageKeys';
import { allowSlowSuite } from '../../test-utils/slowSuite';

let media;

beforeEach(() => {
  server.map.clear();
  stateService.get.mockClear();
  stateService.put.mockReset();
  stateService.put.mockImplementation(async (key, value) => {
    server.map.set(key, value);
    return { ok: true };
  });
  stateService.getAll.mockClear();
  resetDom();
  media = installMatchMedia(false);
});

afterEach(() => {
  cleanup();
  resetDom();
});

function renderSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
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
  return utils;
}

// Let the initial background fetch settle so it cannot clobber a user change.
async function mountSettings() {
  const utils = renderSettings();
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  await waitFor(() => expect(stateService.get).toHaveBeenCalled());
  await act(async () => {});
  return utils;
}

const BUTTON = 'Show the Assistant button (you can still open Assistant from search)';
const AUTO = 'Auto-advise when opened';

const group = (name) => screen.getByRole('group', { name });
const radio = (legend, label) =>
  within(group(legend)).getByRole('radio', { name: new RegExp(`^${label}`) });
const html = document.documentElement;
const localJson = (key) => JSON.parse(localStorage.getItem(lsKey(key)));
const putCalls = () => stateService.put.mock.calls.map(([k, v]) => [k, v]);

// Heavy render-and-wait suite: raise the time limits so a busy machine does not trip them.
allowSlowSuite();

describe('Settings defaults', () => {
  it('shows System / Aurora / Aurora / button On / auto-advise On checked', async () => {
    await mountSettings();
    expect(radio('Theme', 'System')).toBeChecked();
    expect(radio('Dark mode background', 'Aurora')).toBeChecked();
    expect(radio('Light mode background', 'Aurora')).toBeChecked();
    expect(radio(BUTTON, 'On')).toBeChecked();
    expect(radio(AUTO, 'On')).toBeChecked();
    expect(html).toHaveAttribute('data-bg-dark', 'aurora');
    expect(html).toHaveAttribute('data-bg-light', 'aurora');
    expect(stateService.put).not.toHaveBeenCalled();
  });

  it('renders the page heading and a global reset trigger', async () => {
    await mountSettings();
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset all to defaults' })).toBeInTheDocument();
  });

  it('falls back to defaults for unknown stored values', async () => {
    localStorage.setItem(lsKey('theme'), JSON.stringify('neon'));
    localStorage.setItem(lsKey('appearance:bgDark'), JSON.stringify('nope'));
    localStorage.setItem(lsKey('assistant:advisorButton'), JSON.stringify('wat'));
    localStorage.setItem(lsKey('assistant:autoAdvise'), JSON.stringify('wat'));
    await mountSettings();
    expect(radio('Theme', 'System')).toBeChecked();
    expect(radio('Dark mode background', 'Aurora')).toBeChecked();
    expect(radio(BUTTON, 'On')).toBeChecked();
    expect(radio(AUTO, 'On')).toBeChecked();
  });

  it('tolerates legacy raw (non-JSON) localStorage values', async () => {
    localStorage.setItem(lsKey('theme'), 'light');
    renderSettings();
    expect(radio('Theme', 'Light')).toBeChecked();
    await act(async () => {});
  });
});

describe('Settings persistence round-trip', () => {
  it('writes localStorage + stateService.put and restores on a fresh tree', async () => {
    const user = userEvent.setup();
    const first = await mountSettings();

    await user.click(radio('Theme', 'Dark'));
    await user.click(radio('Dark mode background', 'Ocean'));
    await user.click(radio('Light mode background', 'Sunset'));
    await user.click(radio(AUTO, 'Off'));
    await user.click(radio(BUTTON, 'Off'));

    expect(localJson('theme')).toBe('dark');
    expect(localJson('appearance:bgDark')).toBe('ocean');
    expect(localJson('appearance:bgLight')).toBe('sunset');
    expect(localJson('assistant:autoAdvise')).toBe(false);
    expect(localJson('assistant:advisorButton')).toBe(false);

    const puts = putCalls();
    expect(puts).toContainEqual(['theme', 'dark']);
    expect(puts).toContainEqual(['appearance:bgDark', 'ocean']);
    expect(puts).toContainEqual(['appearance:bgLight', 'sunset']);
    expect(puts).toContainEqual(['assistant:autoAdvise', false]);
    expect(puts).toContainEqual(['assistant:advisorButton', false]);

    first.unmount();
    resetDom(); // wipe local cache so restoration must come from the "server"

    await mountSettings();
    await waitFor(() => expect(radio('Theme', 'Dark')).toBeChecked());
    expect(radio('Dark mode background', 'Ocean')).toBeChecked();
    expect(radio('Light mode background', 'Sunset')).toBeChecked();
    expect(radio(AUTO, 'Off')).toBeChecked();
    expect(radio(BUTTON, 'Off')).toBeChecked();
  });

  it('restores from the localStorage cache synchronously on first render', async () => {
    localStorage.setItem(lsKey('appearance:bgDark'), JSON.stringify('forest'));
    localStorage.setItem(lsKey('assistant:autoAdvise'), JSON.stringify(false));
    server.map.set('appearance:bgDark', 'forest');
    server.map.set('assistant:autoAdvise', false);
    renderSettings();
    expect(radio('Dark mode background', 'Forest')).toBeChecked();
    expect(radio(AUTO, 'Off')).toBeChecked();
    expect(html).toHaveAttribute('data-bg-dark', 'forest');
    await act(async () => {});
  });

  it('a failed server PUT does not break the local update', async () => {
    stateService.put.mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    await mountSettings();
    await user.click(radio('Dark mode background', 'Forest'));
    expect(radio('Dark mode background', 'Forest')).toBeChecked();
    expect(localJson('appearance:bgDark')).toBe('forest');
  });
});

describe('Independent light/dark backgrounds', () => {
  it('picking Ocean for dark does not change light, and updates <html> instantly', async () => {
    const user = userEvent.setup();
    await mountSettings();
    await user.click(radio('Dark mode background', 'Ocean'));
    expect(html).toHaveAttribute('data-bg-dark', 'ocean');
    expect(html).toHaveAttribute('data-bg-light', 'aurora');
    expect(radio('Light mode background', 'Aurora')).toBeChecked();
    expect(radio('Dark mode background', 'Ocean')).toBeChecked();
    expect(stateService.put).toHaveBeenCalledTimes(1);
    expect(putCalls()[0]).toEqual(['appearance:bgDark', 'ocean']);
  });

  it('picking a light background does not change dark', async () => {
    const user = userEvent.setup();
    await mountSettings();
    await user.click(radio('Light mode background', 'Graphite'));
    expect(html).toHaveAttribute('data-bg-light', 'graphite');
    expect(html).toHaveAttribute('data-bg-dark', 'aurora');
    expect(radio('Dark mode background', 'Aurora')).toBeChecked();
  });

  it('the two pickers use distinct radio group names', async () => {
    await mountSettings();
    expect(radio('Dark mode background', 'Aurora').name).not.toBe(
      radio('Light mode background', 'Aurora').name,
    );
  });
});

describe('Reset to defaults', () => {
  async function dirty(user) {
    await user.click(radio('Theme', 'Dark'));
    await user.click(radio('Dark mode background', 'Ocean'));
    await user.click(radio('Light mode background', 'Sunset'));
    await user.click(radio(AUTO, 'Off'));
    await user.click(radio(BUTTON, 'Off'));
  }

  it('Cancel leaves values unchanged and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    await mountSettings();
    await dirty(user);
    await user.click(screen.getByRole('button', { name: 'Reset Appearance' }));
    expect(screen.getByRole('group', { name: 'Confirm reset of Appearance' })).toBeInTheDocument();
    const confirmGroup = screen.getByRole('group', { name: 'Confirm reset of Appearance' });
    expect(within(confirmGroup).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(within(confirmGroup).getByRole('button', { name: 'Cancel' }));
    expect(radio('Theme', 'Dark')).toBeChecked();
    expect(radio('Dark mode background', 'Ocean')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Reset Appearance' })).toHaveFocus();
    expect(screen.queryByText('Appearance reset to defaults.')).not.toBeInTheDocument();
  });

  it('Escape leaves values unchanged and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    await mountSettings();
    await dirty(user);
    await user.click(screen.getByRole('button', { name: 'Reset General' }));
    await user.keyboard('{Escape}');
    expect(radio(AUTO, 'Off')).toBeChecked();
    expect(radio(BUTTON, 'Off')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Reset General' })).toHaveFocus();
  });

  it('Confirm on Appearance restores appearance only and shows a toast', async () => {
    const user = userEvent.setup();
    await mountSettings();
    await dirty(user);
    await user.click(screen.getByRole('button', { name: 'Reset Appearance' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(radio('Theme', 'System')).toBeChecked();
    expect(radio('Dark mode background', 'Aurora')).toBeChecked();
    expect(radio('Light mode background', 'Aurora')).toBeChecked();
    expect(html).toHaveAttribute('data-bg-dark', 'aurora');
    expect(html).toHaveAttribute('data-bg-light', 'aurora');
    // Other sections untouched.
    expect(radio(AUTO, 'Off')).toBeChecked();
    expect(radio(BUTTON, 'Off')).toBeChecked();
    expect(screen.getByText('Appearance reset to defaults.')).toBeInTheDocument();
    expect(putCalls()).toContainEqual(['theme', 'system']);
    expect(putCalls()).toContainEqual(['appearance:bgDark', 'aurora']);
    expect(putCalls()).toContainEqual(['appearance:bgLight', 'aurora']);
  });

  it('Confirm on General restores the Assistant options only and shows a toast', async () => {
    const user = userEvent.setup();
    await mountSettings();
    await dirty(user);
    await user.click(screen.getByRole('button', { name: 'Reset General' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(radio(AUTO, 'On')).toBeChecked();
    expect(radio(BUTTON, 'On')).toBeChecked();
    expect(radio('Theme', 'Dark')).toBeChecked();
    expect(screen.getByText('General reset to defaults.')).toBeInTheDocument();
  });

  it('global reset restores everything', async () => {
    const user = userEvent.setup();
    await mountSettings();
    await dirty(user);
    await user.click(screen.getByRole('button', { name: 'Reset all to defaults' }));
    expect(screen.getByRole('group', { name: 'Confirm reset of all settings' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(radio('Theme', 'System')).toBeChecked();
    expect(radio('Dark mode background', 'Aurora')).toBeChecked();
    expect(radio('Light mode background', 'Aurora')).toBeChecked();
    expect(radio(AUTO, 'On')).toBeChecked();
    expect(radio(BUTTON, 'On')).toBeChecked();
    expect(screen.getByText('All settings reset to defaults.')).toBeInTheDocument();
    expect(localJson('assistant:advisorButton')).toBe(true);
    expect(localJson('assistant:autoAdvise')).toBe(true);
  });

  it('global reset Cancel changes nothing', async () => {
    const user = userEvent.setup();
    await mountSettings();
    await dirty(user);
    await user.click(screen.getByRole('button', { name: 'Reset all to defaults' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(radio('Theme', 'Dark')).toBeChecked();
    expect(radio(BUTTON, 'Off')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Reset all to defaults' })).toHaveFocus();
  });
});

describe('Save failure feedback', () => {
  const ERROR_TOAST = "Couldn't save settings. Changes are kept on this device only.";

  afterEach(() => {
    stateService.put.mockImplementation(async (key, value) => {
      server.map.set(key, value);
      return { ok: true };
    });
  });

  it('shows the error toast when a change fails to save, keeping the local value', async () => {
    stateService.put.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    await mountSettings();
    await user.click(radio(AUTO, 'Off'));
    expect(await screen.findByText(ERROR_TOAST)).toBeInTheDocument();
    expect(radio(AUTO, 'Off')).toBeChecked();
    expect(localJson('assistant:autoAdvise')).toBe(false);
  });

  it('shows no error toast when saves succeed', async () => {
    const user = userEvent.setup();
    await mountSettings();
    await user.click(radio(AUTO, 'Off'));
    await act(async () => {});
    expect(screen.queryByText(ERROR_TOAST)).not.toBeInTheDocument();
  });

  it('shows the error toast once for a multi-key reset', async () => {
    const user = userEvent.setup();
    await mountSettings();
    await user.click(radio('Theme', 'Dark'));
    await user.click(radio(AUTO, 'Off'));
    await user.click(radio(BUTTON, 'Off'));
    stateService.put.mockClear();
    stateService.put.mockRejectedValue(new Error('offline'));

    await user.click(screen.getByRole('button', { name: 'Reset all to defaults' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(screen.getAllByText(ERROR_TOAST)).toHaveLength(1));
    expect(stateService.put.mock.calls.length).toBeGreaterThan(1);
    await act(async () => {});
    expect(screen.getAllByText(ERROR_TOAST)).toHaveLength(1);
    expect(screen.getByText('All settings reset to defaults.')).toBeInTheDocument();
    expect(radio(AUTO, 'On')).toBeChecked();
  });

  it('shows the error toast once for a section reset (Appearance, three keys)', async () => {
    const user = userEvent.setup();
    await mountSettings();
    await user.click(radio('Theme', 'Dark'));
    await user.click(radio('Dark mode background', 'Ocean'));
    stateService.put.mockRejectedValue(new Error('offline'));
    await user.click(screen.getByRole('button', { name: 'Reset Appearance' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.getAllByText(ERROR_TOAST)).toHaveLength(1));
    await act(async () => {});
    expect(screen.getAllByText(ERROR_TOAST)).toHaveLength(1);
  });

  it('shows a fresh error toast for each separate failing action', async () => {
    stateService.put.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    await mountSettings();
    await user.click(radio(AUTO, 'Off'));
    await user.click(radio(BUTTON, 'Off'));
    await waitFor(() => expect(screen.getAllByText(ERROR_TOAST)).toHaveLength(2));
  });
});

describe('Connected services section', () => {
  it('renders the section and Reset all never touches secrets', async () => {
    const user = userEvent.setup();
    await mountSettings();
    expect(screen.getByRole('heading', { name: 'Connected services' })).toBeInTheDocument();
    expect(await screen.findByText('Saved in settings')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset all to defaults' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await act(async () => {});
    expect(secretsService.save).not.toHaveBeenCalled();
    expect(secretsService.remove).not.toHaveBeenCalled();
    expect(secretsService.test).not.toHaveBeenCalled();
  });
});

describe('Settings page static hints', () => {
  it('shows the global reset hint about AI models and connected services', async () => {
    await mountSettings();
    expect(
      screen.getByText('Does not change your AI model choices or connected services.'),
    ).toBeInTheDocument();
  });

  it('says settings are saved on this computer', async () => {
    await mountSettings();
    expect(screen.getByText(/Saved on this computer\./)).toBeInTheDocument();
  });

  it('GeneralSection points the Assistant brain at Settings > AI', async () => {
    await mountSettings();
    const link = screen
      .getAllByRole('link', { name: 'Settings > AI' })
      .find((a) => a.getAttribute('href') === '/settings#ai');
    expect(link).toBeTruthy();
  });
});

describe('Theme radio applies the theme to <html>', () => {
  it('Light adds the `light` class and Dark removes it', async () => {
    const user = userEvent.setup();
    await mountSettings();
    expect(html).not.toHaveClass('light');
    await user.click(radio('Theme', 'Light'));
    expect(html).toHaveClass('light');
    await user.click(radio('Theme', 'Dark'));
    expect(html).not.toHaveClass('light');
  });
});

describe('Data & storage', () => {
  const RESET_DEFAULTS = {
    theme: 'system',
    'appearance:bgDark': 'aurora',
    'appearance:bgLight': 'aurora',
    'assistant:advisorButton': true,
    'assistant:autoAdvise': true,
  };

  it('renders the section without sync-mode or connection controls', async () => {
    await mountSettings();
    expect(screen.getByRole('heading', { name: 'Data & storage' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Settings sync' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset Data & storage' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Recheck' })).not.toBeInTheDocument();
  });

  it('Reset all in account mode: PUTs resolving out of order still end at the defaults', async () => {
    const user = userEvent.setup();
    await mountSettings();
    await user.click(radio('Theme', 'Dark'));
    await user.click(radio(AUTO, 'Off'));
    await act(async () => {});
    stateService.put.mockClear();
    const releasers = [];
    stateService.put.mockImplementation(
      (key, value) =>
        new Promise((resolve) => {
          releasers.push(() => {
            server.map.set(key, value);
            resolve({ ok: true });
          });
        }),
    );
    await user.click(screen.getByRole('button', { name: 'Reset all to defaults' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await act(async () => {});
    releasers.splice(0).reverse().forEach((release) => release());
    await act(async () => {});
    expect(putCalls().map(([k]) => k).sort()).toEqual(Object.keys(RESET_DEFAULTS).sort());
    for (const [key, def] of Object.entries(RESET_DEFAULTS)) expect(server.map.get(key)).toBe(def);
    expect(localJson('storage:pendingSync')).toBeNull();
    expect(screen.getAllByText('All settings reset to defaults.')).toHaveLength(1);
  });
});

describe('Theme hint', () => {
  it('describes the resolved system theme only while on System', async () => {
    const user = userEvent.setup();
    await mountSettings();
    expect(screen.getByText(/currently dark/)).toBeInTheDocument();
    await user.click(radio('Theme', 'Light'));
    expect(screen.queryByText(/Follows your device/)).not.toBeInTheDocument();
    act(() => media.setMatches(true));
    await user.click(radio('Theme', 'System'));
    expect(screen.getByText(/currently light/)).toBeInTheDocument();
  });
});
