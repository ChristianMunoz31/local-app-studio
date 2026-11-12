// The kit boundary: a page or section that throws, or whose lazy chunk fails, shows words and a way out.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { lazy, Suspense } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUTE_FAILURE } from '../../../utils/routeFailureWords.js';
import RouteBoundary from '../RouteBoundary.jsx';

let broken = true;
function Page() {
  if (broken) throw new Error('render exploded');
  return <p>Page works</p>;
}

const mount = (props, child = <Page />) =>
  render(
    <MemoryRouter>
      <RouteBoundary {...props}>{child}</RouteBoundary>
    </MemoryRouter>,
  );

beforeEach(() => {
  broken = true;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('RouteBoundary', () => {
  it('names what happened, that saved work is safe and the next step, and Try again renders the page again', () => {
    mount({ resetKey: '/x' });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(ROUTE_FAILURE.pageTitle);
    expect(alert.textContent).toContain(ROUTE_FAILURE.renderSentence);
    expect(alert.textContent).toContain(ROUTE_FAILURE.safe);
    expect(alert.textContent).toContain(ROUTE_FAILURE.renderAction);
    expect(screen.getByRole('link', { name: ROUTE_FAILURE.goHome })).toBeTruthy();
    broken = false;
    fireEvent.click(screen.getByRole('button', { name: ROUTE_FAILURE.tryAgain }));
    expect(screen.getByText('Page works')).toBeTruthy();
  });

  it('a lazy chunk that fails to load shows Reload as the way out and no Try again', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    const Lazy = lazy(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/x.js')));
    const { container } = mount(
      { resetKey: '/x' },
      <Suspense fallback={null}>
        <Lazy />
      </Suspense>,
    );
    return screen.findByRole('alert').then((alert) => {
      expect(alert.textContent).toContain(ROUTE_FAILURE.chunkSentence);
      expect(alert.textContent).toContain(ROUTE_FAILURE.chunkAction);
      expect(container.textContent).not.toContain(ROUTE_FAILURE.tryAgain);
      fireEvent.click(screen.getByRole('button', { name: ROUTE_FAILURE.reload }));
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });

  it('the section variant is compact and has no home link; no home link when homeTo is null', () => {
    mount({ variant: 'section' });
    expect(screen.getByRole('alert').textContent).toContain(ROUTE_FAILURE.sectionTitle);
    expect(screen.queryByRole('link')).toBeNull();
    cleanup();
    mount({ homeTo: null });
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('a new resetKey starts a fresh try', () => {
    const { rerender } = mount({ resetKey: '/a' });
    expect(screen.getByRole('alert')).toBeTruthy();
    broken = false;
    rerender(
      <MemoryRouter>
        <RouteBoundary resetKey="/b">
          <Page />
        </RouteBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByText('Page works')).toBeTruthy();
  });
});
