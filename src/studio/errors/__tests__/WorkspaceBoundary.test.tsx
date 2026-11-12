import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ERROR_COPY } from '@/errors/errorCopy.js';
import WorkspaceBoundary from '../WorkspaceBoundary';

let broken = true;
let mode: 'chunk' | 'render' = 'chunk';
function Page() {
  if (broken) throw mode === 'chunk' ? new TypeError('Failed to fetch dynamically imported module: /assets/x.js') : new Error('render exploded');
  return <p>Workspace works</p>;
}

function renderBoundary(variant?: 'page', start = '/apps/a1/design') {
  return render(
    <MemoryRouter initialEntries={[start]}>
      <Routes>
        <Route path="/apps" element={variant === 'page' ? <WorkspaceBoundary variant="page"><Page /></WorkspaceBoundary> : <p>Apps list</p>} />
        <Route
          path="/apps/:appId/*"
          element={
            <WorkspaceBoundary variant={variant}>
              <Page />
            </WorkspaceBoundary>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  broken = true;
  mode = 'chunk';
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('WorkspaceBoundary', () => {
  it('names a failed chunk load and its action, and says saved work is safe', () => {
    renderBoundary();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Local App Studio could not show this app');
    expect(alert.textContent).toContain(ERROR_COPY.chunk_load_failed.sentence ?? '');
    expect(alert.textContent).toContain(ERROR_COPY.chunk_load_failed.action);
    expect(alert.textContent).toContain('Your saved work is safe.');
    expect(alert.textContent).not.toContain('step');
  });

  it('offers Back to apps', () => {
    renderBoundary();
    fireEvent.click(screen.getByRole('link', { name: 'Back to apps' }));
    expect(screen.getByText('Apps list')).toBeTruthy();
  });

  it('a failed chunk load offers Reload as the primary button and no Try again', () => {
    renderBoundary();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });

  it('leaves out Back to apps on /apps itself', () => {
    renderBoundary('page', '/apps');
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Back to apps' })).toBeNull();
  });

  it('a Try again that fails again lands on the explanation again and clears the copy status', async () => {
    mode = 'render';
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { lines: [] } }))));
    renderBoundary();
    fireEvent.click(screen.getByRole('button', { name: 'Copy details' }));
    await screen.findByText('Details copied.');
    screen.getByRole('button', { name: 'Try again' }).focus();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.queryByText('Details copied.')).toBeNull();
    expect(document.activeElement?.tagName).toBe('H2');
    vi.unstubAllGlobals();
  });

  it('Try again renders the workspace again', () => {
    mode = 'render';
    renderBoundary();
    expect(screen.getByRole('button', { name: 'Copy details' })).toBeTruthy();
    broken = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Workspace works')).toBeTruthy();
  });

  it('uses the page title for the Apps and Features routes', () => {
    renderBoundary('page');
    expect(screen.getByRole('heading', { name: 'Local App Studio could not show this page' })).toBeTruthy();
  });
});
