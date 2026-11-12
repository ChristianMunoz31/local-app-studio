import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BuildOptInSwitch from '../BuildOptInSwitch';

const feature = (over: Record<string, unknown> = {}) => ({ id: 'build', enabled: false, available: true, label: 'Allow downloads for builds', description: 'Needed once per build. Nothing about your apps or data is sent.', hosts: ['registry.npmjs.org'], ...over });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const renderSwitch = () => render(<QueryClientProvider client={new QueryClient()}><BuildOptInSwitch /></QueryClientProvider>);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BuildOptInSwitch', () => {
  it('shows label, description and hosts, and PUTs the same settings route when toggled', async () => {
    const fetchMock = vi.fn(async (_u: string, init?: RequestInit) => json(200, { features: [feature({ enabled: init?.method === 'PUT' })] }));
    vi.stubGlobal('fetch', fetchMock);
    renderSwitch();
    const sw = await screen.findByRole('switch', { name: 'Allow downloads for builds' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    // The switch sits in the same row as its label, right after the words.
    const row = sw.parentElement as HTMLElement;
    expect(within(row).getByText('Allow downloads for builds')).toBeTruthy();
    expect(row.className).toContain('items-center');
    expect(screen.getByText('Needed once per build. Nothing about your apps or data is sent.')).toBeTruthy();
    // The hosts fold under Details; the one-line description stays visible.
    const hosts = screen.getByText('It contacts: registry.npmjs.org.');
    const details = hosts.closest('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(within(details).getByText('Details')).toBeTruthy();
    expect(details.querySelector('summary')?.textContent).toBe('Details about the sites a build contacts');
    expect(screen.getByText('You can also change this in Settings, Network.')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    fireEvent.click(sw);
    await waitFor(() => expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true'));
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(put?.[0]).toBe('/api/settings/network');
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ id: 'build', enabled: true });
  });

  it('shows an error when the change fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => (init?.method === 'PUT' ? json(500, { error: 'x' }) : json(200, { features: [feature()] }))));
    renderSwitch();
    fireEvent.click(await screen.findByRole('switch'));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not save that change. Try again.');
  });

  it('shows a retry when settings fail to load, and nothing when the feature is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(500, { error: 'x' })));
    renderSwitch();
    expect(await screen.findByText('Could not load the internet settings.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    cleanup();
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { features: [feature({ available: false })] })));
    const { container } = renderSwitch();
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
});
