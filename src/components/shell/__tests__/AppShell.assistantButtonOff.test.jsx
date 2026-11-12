import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AppShell from '../AppShell';
import { openCommandPalette } from '../../../hooks/useCommandPalette';
import { openAssistant } from '../../assistant/openAssistant';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import { jsonResponse, sseEvent, sseResponse } from '../../../test-utils/sseResponse';

// Real AppShell, command palette and Assistant panel; only the shell chrome, settings and network are faked.
vi.mock('../BurgerMenu', () => ({ default: () => null }));
vi.mock('../TopBar', () => ({ default: () => null }));
const settings = vi.hoisted(() => ({ value: { showButton: false, autoAdvise: false } }));
vi.mock('../../../hooks/useAssistantSettings', () => ({ useAssistantSettings: () => settings.value }));

const LAUNCHER = 'Ask Assistant about this page';
const assistantFetch = vi.fn();

function routedFetch(url, init) {
  const path = String(url);
  if (path === '/api/assistant/conversations') return Promise.resolve(jsonResponse({ id: 'conv-1' }));
  if (path === '/api/assistant') return assistantFetch(url, init);
  // Typed questions run Assistant's tools, a Pro capability, so this user has Pro.
  if (path === '/api/license') return Promise.resolve(jsonResponse({ pro: true, state: 'pro', edition: 'standard', proSource: 'license', trial: null }));
  return Promise.resolve(jsonResponse({ results: [] }));
}

function mount(path = '/settings') {
  return renderWithProviders(
    <MemoryRouter initialEntries={[path]}>
      <AppShell>
        <button type="button">page control</button>
      </AppShell>
    </MemoryRouter>,
  );
}

beforeAll(async () => {
  await import('../../assistant/AssistantPanel');
}, 30000);

beforeEach(() => {
  settings.value = { showButton: false, autoAdvise: false };
  assistantFetch.mockReset();
  vi.stubGlobal('fetch', routedFetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Assistant button setting off', () => {
  it('draws no launcher and no bottom padding', () => {
    const { container } = mount();
    expect(screen.queryByRole('button', { name: LAUNCHER })).not.toBeInTheDocument();
    expect(container.querySelector('.animate-page-in')).not.toHaveClass('pb-24');
    expect(document.documentElement.style.getPropertyValue('--assistant-toast-offset')).toBe('');
  });

  it('the palette still offers Open Assistant and choosing it opens the panel', async () => {
    const user = userEvent.setup();
    mount();
    act(() => openCommandPalette());
    await user.click(await screen.findByRole('option', { name: /Open Assistant/ }));
    expect(await screen.findByRole('dialog', { name: 'Assistant' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: LAUNCHER })).not.toBeInTheDocument();
  });

  it('a question asked from the palette is sent and answered', async () => {
    const user = userEvent.setup();
    assistantFetch.mockResolvedValueOnce(
      sseResponse([sseEvent('final', { content: 'Nothing to review.' }), sseEvent('run.done', { pending: 0 })]),
    );
    mount();
    act(() => openCommandPalette());
    await user.type(await screen.findByRole('combobox', { name: 'Search' }), 'what is in my list');
    await user.click(await screen.findByRole('option', { name: /Ask Assistant: “what is in my list”/ }));
    expect(await screen.findByText('Nothing to review.')).toBeInTheDocument();
    expect(JSON.parse(assistantFetch.mock.calls[0][1].body)).toEqual({
      prompt: 'what is in my list',
      conversationId: 'conv-1',
      page: 'settings',
    });
  });

  it('a typed question in the open panel works', async () => {
    const user = userEvent.setup();
    assistantFetch.mockResolvedValueOnce(
      sseResponse([sseEvent('final', { content: 'Start with the oldest.' }), sseEvent('run.done', { pending: 0 })]),
    );
    mount();
    act(() => openAssistant());
    const input = await screen.findByRole('textbox', { name: 'Message Assistant' });
    await user.type(input, 'what first{Enter}');
    expect(await screen.findByText('Start with the oldest.')).toBeInTheDocument();
  });

  it('closing returns focus to the element focused before opening', async () => {
    const user = userEvent.setup();
    mount();
    const control = screen.getByRole('button', { name: 'page control' });
    control.focus();
    act(() => openAssistant());
    await screen.findByRole('dialog', { name: 'Assistant' });
    await user.click(screen.getByRole('button', { name: 'Close Assistant' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Assistant' })).not.toBeInTheDocument());
    expect(control).toHaveFocus();
  });

  it('closing falls back to the main content when the opener is gone, without throwing', async () => {
    const user = userEvent.setup();
    mount();
    const control = screen.getByRole('button', { name: 'page control' });
    control.focus();
    act(() => openAssistant());
    await screen.findByRole('dialog', { name: 'Assistant' });
    control.remove();
    await user.click(screen.getByRole('button', { name: 'Close Assistant' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Assistant' })).not.toBeInTheDocument());
    expect(document.querySelector('main')).toHaveFocus();
  });

  it('Assistant is unavailable on a path with no Assistant page', async () => {
    mount('/nowhere');
    act(() => openAssistant());
    await act(async () => {});
    expect(screen.queryByRole('dialog', { name: 'Assistant' })).not.toBeInTheDocument();
  });
});
