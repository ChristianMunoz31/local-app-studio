import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LazyCommandPalette from '../LazyCommandPalette';
import { openCommandPalette } from '../../../hooks/useCommandPalette';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';

afterEach(cleanup);

function renderHost() {
  renderWithProviders(
    <MemoryRouter>
      <LazyCommandPalette assistantAvailable />
    </MemoryRouter>,
  );
}

const palette = () => screen.findByRole('dialog', { name: 'Command palette' });

describe('LazyCommandPalette', () => {
  it('renders nothing until it is triggered', () => {
    renderHost();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the first Ctrl+K opens the palette even though its chunk was not loaded yet', async () => {
    renderHost();
    act(() => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    });
    expect(await palette()).toBeInTheDocument();
  });

  it('the first palette:open event opens it, and Ctrl+K then toggles it closed', async () => {
    renderHost();
    act(() => openCommandPalette());
    expect(await palette()).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    });
    await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull());
  });
});
