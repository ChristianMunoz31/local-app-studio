import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolchainReport } from '../../buildTypes';
import ToolchainChecklist from '../ToolchainChecklist';

const report = (ok: boolean): ToolchainReport => ({
  ok,
  checkedAt: 'now',
  hostTriple: null,
  items: [
    { id: 'node', label: 'Node.js 24 or newer', status: 'found', required: true, path: 'C:\\node.exe', version: '24.1.0', hint: '' },
    ok
      ? { id: 'webview2', label: 'WebView2 Runtime', status: 'missing', required: false, path: null, hint: 'Windows 11 includes it.' }
      : { id: 'rustc', label: 'Rust compiler (rustc)', status: 'missing', required: true, path: null, hint: 'Install Rust with rustup.' },
  ],
});

afterEach(cleanup);

describe('ToolchainChecklist', () => {
  it('lists status, requirement and the install hint for a missing tool', () => {
    render(<ToolchainChecklist report={report(false)} loading={false} error={null} onRefresh={vi.fn()} collapseWhenReady />);
    expect(screen.getByRole('heading', { name: 'Build tools' })).toBeTruthy();
    expect(screen.getByText('Found')).toBeTruthy();
    expect(screen.getByText('Missing')).toBeTruthy();
    expect(screen.getByText('Rust')).toBeTruthy();
    expect(screen.getByText('Node.js')).toBeTruthy();
    expect(screen.queryByText(/rustc|toolchain|Cargo/i)).toBeNull();
    const where = screen.getByText('Show where each tool was found').closest('details') as HTMLDetailsElement;
    expect(where.open).toBe(false);
    expect(within(where).getByText('Node.js: 24.1.0 at C:\\node.exe')).toBeTruthy();
    expect(screen.getByText('How to install: Install Rust with rustup.')).toBeTruthy();
    expect(screen.queryByText('Build tools: ready')).toBeNull();
  });

  it('keeps a one-line summary visible and folds the tool table under Details when tools are missing', () => {
    render(<ToolchainChecklist report={report(false)} loading={false} error={null} onRefresh={vi.fn()} collapseWhenReady />);
    expect(screen.getByText('This computer needs Rust before it can make an installer.')).toBeTruthy();
    const details = screen.getByText('Details').closest('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')?.textContent).toBe('Details about the build tools');
    expect(within(details).getByText('Rust')).toBeTruthy();
    expect(screen.getByText('This computer needs Rust before it can make an installer.').closest('details')).toBeNull();
  });

  it('names every missing required tool in the summary and ignores optional ones', () => {
    const items: ToolchainReport['items'] = [
      { id: 'rustc', label: 'x', status: 'missing', required: true, path: null, hint: 'h' },
      { id: 'cargo', label: 'x', status: 'missing', required: true, path: null, hint: 'h' },
      { id: 'winsdk', label: 'x', status: 'missing', required: true, path: null, hint: 'h' },
      { id: 'webview2', label: 'x', status: 'missing', required: false, path: null, hint: 'h' },
    ];
    render(<ToolchainChecklist report={{ ok: false, checkedAt: 'now', hostTriple: null, items }} loading={false} error={null} onRefresh={vi.fn()} collapseWhenReady />);
    expect(screen.getByText('This computer needs Rust, Cargo and Windows SDK before it can make an installer.')).toBeTruthy();
  });

  it('folds the list behind Show tools when ready and collapsing', () => {
    render(<ToolchainChecklist report={report(true)} loading={false} error={null} onRefresh={vi.fn()} collapseWhenReady />);
    expect(screen.getByText('Build tools: ready')).toBeTruthy();
    expect((screen.getByText('Show tools').closest('details') as HTMLDetailsElement).open).toBe(false);
  });

  it('calls onRefresh from Check again and Retry, and omits the heading when null', () => {
    const onRefresh = vi.fn();
    render(<ToolchainChecklist report={report(true)} loading={false} error="Could not check." onRefresh={onRefresh} heading={null} />);
    expect(screen.queryByRole('heading')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it('shows a skeleton on first load', () => {
    render(<ToolchainChecklist report={null} loading error={null} onRefresh={vi.fn()} />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
  });

  it('uses plain tool names by id and keeps the server label for an unknown id', () => {
    const items: ToolchainReport['items'] = [
      { id: 'cargo', label: 'Cargo', status: 'missing', required: true, path: null, hint: 'h' },
      { id: 'msvc', label: 'x', status: 'missing', required: true, path: null, hint: 'h' },
      { id: 'winsdk', label: 'x', status: 'missing', required: true, path: null, hint: 'h' },
      { id: 'webview2', label: 'WebView2 Runtime', status: 'missing', required: false, path: null, hint: 'h' },
      { id: 'npm', label: 'npm from the server', status: 'missing', required: true, path: null, hint: 'h' },
    ];
    render(<ToolchainChecklist report={{ ok: false, checkedAt: 'now', hostTriple: null, items }} loading={false} error={null} onRefresh={vi.fn()} />);
    for (const name of ['Cargo (comes with Rust)', 'Microsoft C++ build tools', 'Windows SDK', 'WebView2 (shows the app window)', 'npm from the server']) {
      expect(screen.getByText(name)).toBeTruthy();
    }
  });
});
