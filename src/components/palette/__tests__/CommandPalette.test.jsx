import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import CommandPalette from '../CommandPalette';
import { openCommandPalette } from '../../../hooks/useCommandPalette';
import { ASSISTANT_OPEN_EVENT } from '../../assistant/openAssistant';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';

const opened = [];
const onAssistantOpen = (e) => opened.push(e.detail);

beforeEach(() => {
  opened.length = 0;
  window.addEventListener(ASSISTANT_OPEN_EVENT, onAssistantOpen);
});
afterEach(() => {
  window.removeEventListener(ASSISTANT_OPEN_EVENT, onAssistantOpen);
  cleanup();
  vi.unstubAllGlobals();
});

async function openPalette(props) {
  renderWithProviders(
    <MemoryRouter>
      <CommandPalette {...props} />
    </MemoryRouter>,
  );
  act(() => openCommandPalette());
  return screen.findByRole('dialog', { name: 'Command palette' });
}

describe('CommandPalette', () => {
  it('Enter on the Ask Assistant item closes the palette and opens Assistant with the query', async () => {
    const user = userEvent.setup();
    await openPalette({ assistantAvailable: true });
    const input = screen.getByRole('combobox', { name: 'Search' });
    await user.type(input, 'what is in my list');
    expect(screen.getByRole('option', { name: /Ask Assistant: “what is in my list”/ })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(opened).toEqual([{ prompt: 'what is in my list' }]);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument());
  });

  it('offers Open Assistant when the query is empty', async () => {
    const user = userEvent.setup();
    await openPalette({ assistantAvailable: true });
    await user.click(screen.getByRole('option', { name: /Open Assistant/ }));
    expect(opened).toEqual([{ prompt: '' }]);
  });

  it('has no Ask item when Assistant is not available', async () => {
    const user = userEvent.setup();
    await openPalette({ assistantAvailable: false });
    await user.type(screen.getByRole('combobox', { name: 'Search' }), 'what is in my list');
    expect(screen.queryByText(/Ask Assistant/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Open Assistant/)).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(opened).toEqual([]);
  });

  it('has no chat UI: no Ask toggle, back-to-commands button or provider badge', async () => {
    await openPalette({ assistantAvailable: true });
    expect(screen.queryByRole('button', { name: 'Ask Assistant' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back to commands' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Assistant: /)).not.toBeInTheDocument();
    expect(screen.queryByText(/Chat/)).not.toBeInTheDocument();
  });

  it('still navigates', async () => {
    const user = userEvent.setup();
    await openPalette({ assistantAvailable: true });
    expect(screen.getByText('Go to Settings')).toBeInTheDocument();
    await user.type(screen.getByRole('combobox', { name: 'Search' }), 'sett');
    expect(screen.getByText('Go to Settings')).toBeInTheDocument();
  });

  it('Enter on a query that matches a command goes to it, not Ask Assistant', async () => {
    const user = userEvent.setup();
    await openPalette({ assistantAvailable: true });
    await user.type(screen.getByRole('combobox', { name: 'Search' }), 'settings');
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveTextContent('Go to Settings');
    expect(options.at(-1)).toHaveTextContent(/Ask Assistant/);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Enter}');
    expect(opened).toEqual([]);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument());
  });

  it('wires combobox attributes to the listbox and the selected option', async () => {
    const user = userEvent.setup();
    await openPalette({ assistantAvailable: true });
    const input = screen.getByRole('combobox', { name: 'Search' });
    const list = screen.getByRole('listbox');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-controls', list.id);
    const first = screen.getAllByRole('option')[0];
    expect(input).toHaveAttribute('aria-activedescendant', first.id);
    // The palette focuses its input in a requestAnimationFrame after mount. user.keyboard types
    // into document.activeElement, so wait for that focus or the ArrowDown can land on <body>
    // (the flaky failure under load).
    await waitFor(() => expect(input).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(input).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[1].id));
  });

  it('nav hints do not show the raw path', async () => {
    await openPalette({ assistantAvailable: false });
    const option = screen.getByRole('option', { name: /Go to Settings/ });
    expect(option).not.toHaveTextContent('/settings');
  });
});
