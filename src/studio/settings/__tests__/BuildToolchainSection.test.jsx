import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BuildToolchainSection from '../BuildToolchainSection';

const report = {
  ok: false,
  checkedAt: '2026-11-02T00:00:00.000Z',
  hostTriple: 'aarch64-pc-windows-msvc',
  items: [
    { id: 'node', label: 'Node.js 24 or newer', status: 'found', required: true, path: 'C:\\Program Files\\nodejs\\node.exe', version: '24.1.0', hint: '' },
    { id: 'rustc', label: 'Rust compiler (rustc)', status: 'missing', required: true, path: null, hint: 'Install Rust from rust-lang.org, then press Check again.' },
    { id: 'webview2', label: 'WebView2 Runtime', status: 'missing', required: false, path: null, hint: 'Windows 11 includes it.' },
  ],
};

const ok = (body) => Promise.resolve(new Response(JSON.stringify({ data: body }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BuildToolchainSection', () => {
  it('lists each tool with its path or hint and checks again on request', async () => {
    const fetchMock = vi.fn(() => ok(report));
    vi.stubGlobal('fetch', fetchMock);
    render(<BuildToolchainSection />);
    expect(screen.getByRole('heading', { name: 'Build tools' })).toBeTruthy();
    expect(await screen.findByText('Node.js')).toBeTruthy();
    expect(screen.getByText(/24\.1\.0 at C:\\Program Files\\nodejs\\node\.exe/)).toBeTruthy();
    expect(screen.getByText(/Install Rust from rust-lang\.org/)).toBeTruthy();
    expect(screen.getAllByText('Missing')).toHaveLength(2);
    expect(screen.getByText('Optional')).toBeTruthy();
    expect(screen.getAllByText('Required for builds')).toHaveLength(2);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/studio/build/toolchain');

    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe('/api/studio/build/toolchain?refresh=1');
  });

  it('shows an error with a Retry button', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: 'x', message: 'Could not check.' }), { status: 500 }))));
    render(<BuildToolchainSection />);
    expect(await screen.findByText('Could not check.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
