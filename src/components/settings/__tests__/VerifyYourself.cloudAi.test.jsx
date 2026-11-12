// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import VerifyYourself from '../VerifyYourself';
import { getAppInfo } from '../../../services/appInfoService';

vi.mock('../../../services/appInfoService', () => ({ getAppInfo: vi.fn() }));

const LINE = 'This build contains no cloud provider.';

function renderIt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <VerifyYourself />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('VerifyYourself cloud line', () => {
  it('shows the line when the build has no cloud provider', async () => {
    getAppInfo.mockResolvedValue({ version: '1.0.0', channel: 'stable', desktop: true, cloudAi: 'absent' });
    renderIt();
    expect(await screen.findByText(LINE)).toBeInTheDocument();
  });

  it('does not show it when the cloud provider is present', async () => {
    getAppInfo.mockResolvedValue({ version: '1.0.0', channel: 'stable', desktop: true, cloudAi: 'present' });
    renderIt();
    await screen.findByText('Check your download');
    expect(screen.queryByText(LINE)).not.toBeInTheDocument();
  });
});
