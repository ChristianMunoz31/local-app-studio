import { lazy } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import LazySection from '../LazySection';

afterEach(cleanup);

const renderLazy = (load) => {
  const Section = lazy(load);
  return render(
    <MemoryRouter>
      <LazySection id="ai">
        <Section />
      </LazySection>
    </MemoryRouter>,
  );
};

describe('LazySection', () => {
  it('shows the section card with its anchor and heading ids and a loading status, then the section', async () => {
    let finish;
    renderLazy(() => new Promise((resolve) => (finish = resolve)));
    const heading = screen.getByRole('heading', { name: 'AI' });
    expect(heading).toHaveAttribute('id', 'ai-heading');
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(heading.closest('[id="ai"]')).not.toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Loading this section.');

    await act(async () => finish({ default: () => <p>Loaded body</p> }));
    expect(await screen.findByText('Loaded body')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the section error card, not a blank gap, when the chunk fails to load', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderLazy(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module')));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    error.mockRestore();
  });
});
