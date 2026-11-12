import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NetworkSection from '../NetworkSection';

vi.mock('../../../services/networkService', () => ({
  networkService: { get: vi.fn(), set: vi.fn() },
}));
import { networkService } from '../../../services/networkService';

const features = (enabledId = null) => ({
  features: [
    { id: 'updates', enabled: enabledId === 'updates', label: 'Update checks', description: 'Looks for a newer version.', hosts: ['api.github.com'] },
    { id: 'cloudAi', enabled: enabledId === 'cloudAi', label: 'Cloud AI', description: 'Sends questions to a provider.', hosts: ['api.example.com'] },
  ],
});

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NetworkSection />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  networkService.get.mockResolvedValue(features());
  networkService.set.mockImplementation(async (id, enabled) => features(enabled ? id : null));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('NetworkSection', () => {
  it('lists every feature with its hosts, all off by default', async () => {
    renderSection();
    const list = await screen.findByRole('list', { name: 'Network features' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    for (const sw of within(list).getAllByRole('switch')) expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(items[0]).toHaveTextContent('This calls the internet: api.github.com');
    expect(items[1]).toHaveTextContent('api.example.com');
  });

  it('shows a feature that is not in this build without a switch or a network line', async () => {
    networkService.get.mockResolvedValue({
      features: [
        { id: 'updates', enabled: false, available: true, label: 'Update checks', description: 'Looks for a newer version.', hosts: ['api.github.com'] },
        { id: 'cloudAi', enabled: false, available: false, label: 'Cloud AI', description: 'Sends questions to a provider.', hosts: ['api.example.com'] },
      ],
    });
    renderSection();
    const list = await screen.findByRole('list', { name: 'Network features' });
    const [, row] = within(list).getAllByRole('listitem');
    expect(row).toHaveTextContent('Cloud AI');
    expect(row).toHaveTextContent('Not in this build. This copy of the app contains no cloud provider.');
    expect(within(row).queryByRole('switch')).toBeNull();
    expect(row).not.toHaveTextContent('This calls the internet');
    expect(within(list).getAllByRole('switch')).toHaveLength(1);
  });

  it('toggles a feature on through the API and reflects the saved state', async () => {
    const user = userEvent.setup();
    renderSection();
    const sw = await screen.findByRole('switch', { name: 'Update checks' });
    await user.click(sw);
    await waitFor(() => expect(networkService.set).toHaveBeenCalledWith('updates', true));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Update checks' })).toHaveAttribute('aria-checked', 'true'));
  });

  it('shows an error and keeps the toggle off when saving fails', async () => {
    networkService.set.mockRejectedValue(new Error('nope'));
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole('switch', { name: 'Cloud AI' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save that change");
    expect(screen.getByRole('switch', { name: 'Cloud AI' })).toHaveAttribute('aria-checked', 'false');
  });

  it('keeps focus on the toggle while saving (aria-disabled, not disabled)', async () => {
    let release;
    networkService.set.mockImplementation(
      () => new Promise((resolve) => { release = () => resolve(features('updates')); }),
    );
    const user = userEvent.setup();
    renderSection();
    const sw = await screen.findByRole('switch', { name: 'Update checks' });
    await user.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute('aria-disabled', 'true'));
    expect(sw).not.toBeDisabled();
    expect(sw).toHaveFocus();
    await user.click(sw);
    expect(networkService.set).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(sw).not.toHaveAttribute('aria-disabled'));
  });

  it('offers a retry when the settings cannot be loaded', async () => {
    networkService.get.mockRejectedValueOnce(new Error('down'));
    const user = userEvent.setup();
    renderSection();
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load network settings");
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('switch', { name: 'Update checks' })).toBeInTheDocument();
  });
});
