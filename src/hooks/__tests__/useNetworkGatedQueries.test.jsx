import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useNetworkFeature } from '../useNetworkFeature';
import { NETWORK_OPT_IN_REQUIRED } from '../../utils/apiError';

vi.mock('../../services/networkService', () => ({ networkService: { get: vi.fn(), set: vi.fn() } }));
import { networkService } from '../../services/networkService';

const settings = (updates) => ({
  features: [{ id: 'updates', enabled: updates }],
});

function run(hook) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(hook, { wrapper });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useNetworkFeature gate', () => {
  it('stays disabled and exposes an opt-in error while the feature is off', async () => {
    networkService.get.mockResolvedValue(settings(false));
    const { result } = run(() => useNetworkFeature('updates'));
    await waitFor(() => expect(result.current.offError?.code).toBe(NETWORK_OPT_IN_REQUIRED));
    expect(result.current.enabled).toBe(false);
    expect(result.current.offError.status).toBe(403);
    expect(result.current.offError.feature).toBe('updates');
  });

  it('enables the queries once the feature is on', async () => {
    networkService.get.mockResolvedValue(settings(true));
    const { result } = run(() => useNetworkFeature('updates'));
    await waitFor(() => expect(result.current.enabled).toBe(true));
    expect(result.current.offError).toBeNull();
  });

  it('stays enabled (server 403 stays the fallback) when settings fail to load', async () => {
    networkService.get.mockRejectedValue(new Error('boom'));
    const { result } = run(() => useNetworkFeature('updates'));
    await waitFor(() => expect(result.current.settingsLoading).toBe(false));
    expect(result.current.enabled).toBe(true);
    expect(result.current.offError).toBeNull();
  });
});
