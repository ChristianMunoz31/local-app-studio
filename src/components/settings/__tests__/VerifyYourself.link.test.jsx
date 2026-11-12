// @vitest-environment jsdom
// Once init-app has replaced the placeholder owner, the checksum step links to the release page.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import VerifyYourself from '../VerifyYourself';

vi.mock('../../../services/appInfoService', () => ({
  getAppInfo: vi.fn(async () => ({ version: '1.0.0', channel: 'stable', desktop: true })),
}));
vi.mock('../../../../scripts/release/placeholder.js', () => ({ isPlaceholderRepo: () => false }));

describe('VerifyYourself with a configured release repo', () => {
  it('renders the release page link', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <VerifyYourself />
      </QueryClientProvider>,
    );
    const link = await screen.findByRole('link', { name: 'the latest release page' });
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(screen.queryByText(/the release page you downloaded the installer from/)).toBeNull();
  });
});
