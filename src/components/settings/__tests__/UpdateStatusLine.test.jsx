import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import UpdateStatusLine from '../UpdateStatusLine';
import NetworkSection from '../NetworkSection';

vi.mock('../../../services/updateService', () => ({ updateService: { check: vi.fn() } }));
vi.mock('../../../services/networkService', () => ({ networkService: { get: vi.fn(), set: vi.fn() } }));
import { updateService } from '../../../services/updateService';
import { networkService } from '../../../services/networkService';

const wrap = (ui) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

const checkedAt = '2030-01-01T00:00:00Z';
const noEmDash = (el) => expect(el.textContent).not.toContain('\u2014');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('UpdateStatusLine', () => {
  it('renders nothing and makes no call while disabled', () => {
    const { container } = wrap(<UpdateStatusLine enabled={false} />);
    expect(container).toBeEmptyDOMElement();
    expect(updateService.check).not.toHaveBeenCalled();
  });

  it('shows the loading copy first', async () => {
    updateService.check.mockReturnValue(new Promise(() => {}));
    const { container } = wrap(<UpdateStatusLine enabled />);
    expect(await screen.findByText('Checking for updates...')).toBeInTheDocument();
    noEmDash(container);
  });

  it('shows the current-version line', async () => {
    updateService.check.mockResolvedValue({ status: 'current', current: '1.0.0', latest: '1.0.0', checkedAt });
    const { container } = wrap(<UpdateStatusLine enabled />);
    expect(await screen.findByText('You have the latest version (1.0.0).')).toBeInTheDocument();
    noEmDash(container);
  });

  it('shows the available line with a safe external link', async () => {
    updateService.check.mockResolvedValue({
      status: 'available',
      current: '1.0.0',
      latest: '1.1.0',
      url: 'https://github.com/ChristianMunoz31/local-app-studio/releases/tag/v1.1.0',
      publishedAt: null,
      checkedAt,
    });
    const { container } = wrap(<UpdateStatusLine enabled />);
    expect(await screen.findByText(/Update available: version 1\.1\.0\. You have 1\.0\.0\./)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: "See what's new" });
    expect(link).toHaveAttribute('href', 'https://github.com/ChristianMunoz31/local-app-studio/releases/tag/v1.1.0');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    noEmDash(container);
  });

  it.each(['javascript:alert(1)', 'https://evil.example/x', 'http://github.com/x', undefined])(
    'renders no link for an unsafe url %s',
    async (url) => {
      updateService.check.mockResolvedValue({ status: 'available', current: '1.0.0', latest: '1.1.0', url, publishedAt: null, checkedAt });
      wrap(<UpdateStatusLine enabled />);
      expect(await screen.findByText(/Update available: version 1\.1\.0\./)).toBeInTheDocument();
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    },
  );

  it('shows the unavailable line and rechecks with refresh', async () => {
    updateService.check.mockResolvedValueOnce({ status: 'unavailable', current: '1.0.0', reason: 'not_found', checkedAt });
    updateService.check.mockResolvedValueOnce({ status: 'current', current: '1.0.0', latest: '1.0.0', checkedAt });
    const user = userEvent.setup();
    const { container } = wrap(<UpdateStatusLine enabled />);
    expect(await screen.findByText("Couldn't check for updates right now.")).toBeInTheDocument();
    noEmDash(container);
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText('You have the latest version (1.0.0).')).toBeInTheDocument();
    expect(updateService.check).toHaveBeenLastCalledWith({ refresh: true });
  });

  it('says updates are not set up for a not_configured build, with no retry button', async () => {
    updateService.check.mockResolvedValue({ status: 'unavailable', current: '1.0.0', reason: 'not_configured', checkedAt });
    const { container } = wrap(<UpdateStatusLine enabled />);
    expect(await screen.findByText('Updates are not set up for this build.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument();
    noEmDash(container);
  });

  it('shows the unavailable line when the request itself fails', async () => {
    updateService.check.mockRejectedValue(new Error('403'));
    wrap(<UpdateStatusLine enabled />);
    expect(await screen.findByText("Couldn't check for updates right now.")).toBeInTheDocument();
  });
});

describe('NetworkSection update row', () => {
  const rows = (enabled) => ({
    features: [
      { id: 'cloudAi', enabled: false, label: 'Cloud AI', description: 'Sends questions to a provider.', hosts: ['api.example.com'] },
      {
        id: 'updates',
        enabled,
        label: 'Update check',
        description: 'Asks GitHub whether a newer Local App Studio release exists.',
        hosts: ['api.github.com'],
      },
    ],
  });

  it('shows the status line only when the feature is on, under the internet label', async () => {
    networkService.get.mockResolvedValue(rows(true));
    updateService.check.mockResolvedValue({ status: 'current', current: '1.0.0', latest: '1.0.0', checkedAt });
    wrap(<NetworkSection />);
    expect(await screen.findByText('You have the latest version (1.0.0).')).toBeInTheDocument();
    expect(screen.getByText('api.github.com')).toBeInTheDocument();
  });

  it('makes no update call while the feature is off', async () => {
    networkService.get.mockResolvedValue(rows(false));
    wrap(<NetworkSection />);
    await screen.findByRole('switch', { name: 'Update check' });
    await waitFor(() => expect(updateService.check).not.toHaveBeenCalled());
    expect(screen.queryByText(/latest version/)).not.toBeInTheDocument();
  });
});
