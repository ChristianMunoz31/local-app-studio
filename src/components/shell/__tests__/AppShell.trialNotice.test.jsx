import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AppShell from '../AppShell';
import { ToastProvider } from '../../../contexts/ToastContext';

vi.mock('../BurgerMenu', () => ({ default: () => null }));
vi.mock('../TopBar', () => ({ default: () => null }));
vi.mock('../../palette/CommandPalette', () => ({ default: () => null }));
vi.mock('../../assistant/AssistantAdvisor', () => ({ default: () => null }));

vi.mock('../../../services/licenseService', () => ({
  licenseService: { get: vi.fn(), dismissTrialNotice: vi.fn() },
}));
import { licenseService } from '../../../services/licenseService';

vi.mock('../../../hooks/useProfile', () => ({
  useProfile: () => ({ onboarded: true, isLoading: false, unresolved: false }),
}));

const trialStatus = (notice) => ({
  state: 'trial',
  pro: true,
  proSource: 'local_trial',
  purchaseUrl: null,
  trial: { state: 'active', startedAt: '2026-10-05T00:00:00Z', endsAt: '2026-10-19T00:00:00Z', daysLeft: 14, remindToday: false, notice },
});

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/settings']}>
          <AppShell>
            <p>page body</p>
          </AppShell>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  licenseService.get.mockResolvedValue(trialStatus('welcome'));
  licenseService.dismissTrialNotice.mockResolvedValue(trialStatus(null));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AppShell trial notice', () => {
  it('shows the welcome banner inside the page frame, and Got it dismisses it through the service', async () => {
    const user = userEvent.setup();
    mount();
    const banner = await screen.findByTestId('trial-notice');
    expect(within(screen.getByRole('main')).getByTestId('trial-notice')).toBe(banner);
    expect(banner).toHaveTextContent('Local App Studio Pro is on for 14 days.');
    expect(screen.getByText('page body')).toBeInTheDocument();
    await user.click(within(banner).getByRole('button', { name: 'Got it' }));
    expect(licenseService.dismissTrialNotice).toHaveBeenCalledWith('welcome');
    expect(screen.queryByTestId('trial-notice')).not.toBeInTheDocument();
  });

  it('shows no banner when no notice is due', async () => {
    licenseService.get.mockResolvedValue(trialStatus(null));
    mount();
    await screen.findByText('page body');
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('trial-notice')).not.toBeInTheDocument();
  });
});
