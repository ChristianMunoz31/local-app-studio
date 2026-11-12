import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
vi.mock('../../../hooks/useEntitlements', async () => (await import('../../../test-utils/entitlements.js')).entitlementsModule());
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, useLocation } from 'react-router-dom';
import AssistantAdvisor from '../AssistantAdvisor';
import { openAssistant } from '../openAssistant';
import { jsonResponse, sseEvent, sseResponse } from '../../../test-utils/sseResponse';
import { PageContextProvider, usePageContext } from '../../../contexts/PageContextContext';
import { resolveAssistantPageKey } from '../../../constants/assistantPages';
import { allowSlowSuite } from '../../../test-utils/slowSuite';

// mockFetch serves page advice (and anything else); typed questions go to /api/assistant, served by
// assistantFetch; conversation creation is answered inline.
const mockFetch = vi.fn();
const assistantFetch = vi.fn();
const routedFetch = (url, init) => {
  const path = String(url);
  if (path === '/api/assistant/conversations') return Promise.resolve(jsonResponse({ id: 'conv-1' }));
  if (path === '/api/assistant' || path.startsWith('/api/assistant/actions/')) return assistantFetch(url, init);
  return mockFetch(url, init);
};

/** An SSE response the test can feed and finish by hand. */
function controlledSse() {
  const encoder = new TextEncoder();
  let controller;
  const body = new ReadableStream({
    start(c) {
      controller = c;
    },
  });
  return {
    response: { ok: true, status: 200, statusText: '', headers: new Headers(), body },
    push: (event, data) => controller.enqueue(encoder.encode(sseEvent(event, data))),
    close: () => controller.close(),
  };
}
const assistantBody = (i = 0) => JSON.parse(assistantFetch.mock.calls[i][1].body);

const ok = (content) => ({
  ok: true,
  status: 200,
  json: async () => ({ data: { content, model: 'm', provider: 'p' } }),
});

let pageLoading = false;
function FakePage() {
  usePageContext('home', () => (pageLoading ? { status: 'loading' } : { open: 3 }));
  return null;
}

const queryClient = new QueryClient();

function Harness({ autoAdvise = true, showButton = true }) {
  const { pathname } = useLocation();
  const key = resolveAssistantPageKey(pathname);
  return (
    <QueryClientProvider client={queryClient}>
      <PageContextProvider>
        <FakePage />
        <nav>
          <Link to="/settings">to settings</Link>
          <Link to="/">to home</Link>
          <Link to="/nowhere">to nowhere</Link>
        </nav>
        <button type="button">outside control</button>
        <AssistantAdvisor pageKey={key} visible={showButton && key !== null} autoAdvise={autoAdvise} />
      </PageContextProvider>
    </QueryClientProvider>
  );
}

const mount = (props = {}, path = '/', strict = false) => {
  const tree = (
    <MemoryRouter initialEntries={[path]}>
      <Harness {...props} />
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
};

const launcher = () => screen.getByRole('button', { name: 'Ask Assistant about this page' });
const flush = () => new Promise((r) => setTimeout(r, 0));

// AssistantPanel is React.lazy-loaded. Warm the module once so the first test that opens the
// panel doesn't pay its (markdown/highlight) import cost inside a 5s findBy wait; under
// parallel jsdom workers that cold import intermittently exceeded the wait.
beforeAll(async () => {
  await import('../AssistantPanel');
}, 30000);

beforeEach(() => {
  pageLoading = false;
  vi.stubGlobal('fetch', routedFetch);
  mockFetch.mockReset();
  assistantFetch.mockReset();
  mockFetch.mockResolvedValue(ok('**Advice** here'));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Heavy render-and-wait suite: raise the time limits so a busy machine does not trip them.
allowSlowSuite();

describe('launcher', () => {
  it('has the fixed accessible name and no aria-controls while closed', () => {
    mount();
    expect(screen.getByRole('button', { name: 'Ask Assistant about this page' })).toBeInTheDocument();
    expect(launcher()).not.toHaveAttribute('aria-controls');
    expect(launcher().className).not.toMatch(/max-sm:invisible/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sets aria-controls and hides on mobile only while open', async () => {
    const user = userEvent.setup();
    mount({ autoAdvise: false });
    await user.click(launcher());
    expect(launcher()).toHaveAttribute('aria-controls');
    expect(launcher().className).toMatch(/max-sm:invisible/);
    await screen.findByLabelText('Message Assistant', {}, { timeout: 5000 });
    expect(launcher()).toHaveAttribute('aria-haspopup', 'dialog');
    expect(document.getElementById(launcher().getAttribute('aria-controls'))).toBeInTheDocument();
    // The test timeout must exceed the 5s findBy wait above, or a slow lazy mount under
    // full-suite load trips Vitest's default 5s test timeout first.
  }, 15000);

  it('is not rendered when not visible or on a hidden route', () => {
    mount({ showButton: false });
    expect(screen.queryByRole('button', { name: 'Ask Assistant about this page' })).not.toBeInTheDocument();
    cleanup();
    mount({}, '/nowhere');
    expect(screen.queryByRole('button', { name: 'Ask Assistant about this page' })).not.toBeInTheDocument();
  });

  it('uses a round fixed button above content, below modals', () => {
    mount();
    expect(launcher().className).toMatch(/fixed/);
    expect(launcher().className).toMatch(/z-40/);
    expect(launcher().className).toMatch(/rounded-full/);
    expect(launcher().className).toMatch(/safe-area-inset-bottom/);
  });
});

describe('panel', () => {
  it('opens as a non-modal dialog, focuses the input, closes on Escape and returns focus', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(launcher());
    expect(launcher()).toHaveAttribute('aria-expanded', 'true');
    const dialog = await screen.findByRole('dialog', { name: 'Assistant' }, { timeout: 5000 });
    expect(dialog).not.toHaveAttribute('aria-modal');
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message Assistant' })).toHaveFocus());
    expect(screen.getByRole('button', { name: 'outside control' })).toBeEnabled();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(launcher()).toHaveAttribute('aria-expanded', 'false');
    expect(launcher()).toHaveFocus();
  });

  it('closes on Escape when focus is on the launcher', async () => {
    const user = userEvent.setup();
    mount({ autoAdvise: false });
    await user.click(launcher());
    await screen.findByRole('dialog', {}, { timeout: 5000 });
    launcher().focus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(launcher()).toHaveFocus();
  });

  it('the close button behaves the same', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(launcher());
    await screen.findByRole('dialog', {}, { timeout: 5000 });
    await user.click(screen.getByRole('button', { name: 'Close Assistant' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(launcher()).toHaveFocus();
  });

  it('only uses motion-safe animation classes', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(launcher());
    const dialog = await screen.findByRole('dialog', {}, { timeout: 5000 });
    expect(dialog.className).toMatch(/motion-safe:animate-overlay-in/);
    expect(dialog.className).not.toMatch(/(^|\s)animate-/);
  });
});

describe('auto-advice', () => {
  it('fires exactly once per open (StrictMode, rerenders, navigation while open)', async () => {
    const user = userEvent.setup();
    mount({}, '/', true);
    await user.click(launcher());
    await screen.findByText('Advice');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      page: 'home',
      context: expect.stringContaining('"open":3'),
      messages: [],
    });
    await user.click(screen.getByRole('link', { name: 'to settings' }));
    await flush();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Get advice' })).toBeInTheDocument();
  });

  it('reopening a page with history adds no request; an empty page adds one', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(launcher());
    await screen.findByText('Advice');
    await user.click(screen.getByRole('button', { name: 'Close Assistant' }));
    await user.click(launcher());
    await screen.findByText('Advice');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Close Assistant' }));
    await user.click(screen.getByRole('link', { name: 'to settings' }));
    await user.click(launcher());
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(mockFetch.mock.calls[1][1].body).page).toBe('settings');
  });

  it('waits for page data to finish loading before using the once-per-open advice', async () => {
    const user = userEvent.setup();
    pageLoading = true;
    mount();
    await user.click(launcher());
    await screen.findByRole('dialog', {}, { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 900));
    expect(mockFetch).not.toHaveBeenCalled();
    pageLoading = false;
    await screen.findByText('Advice', {}, { timeout: 3000 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).context).toContain('"open":3');
    await new Promise((r) => setTimeout(r, 900));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does not re-fire on reopen while a rate-limit window is still open', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: 'Slow down', code: 'rate_limited', retryAfterMs: 60000 }),
    });
    mount();
    await user.click(launcher());
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: /Try again in \d+s/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Close Assistant' }));
    await user.click(launcher());
    await screen.findByRole('dialog', {}, { timeout: 5000 });
    await flush();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does nothing automatically when the setting is off', async () => {
    const user = userEvent.setup();
    mount({ autoAdvise: false });
    await user.click(launcher());
    await user.click(await screen.findByRole('button', { name: 'Get advice' }));
    await screen.findByText('Advice');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('opening with auto-advise off makes no request', async () => {
    const user = userEvent.setup();
    mount({ autoAdvise: false });
    await user.click(launcher());
    await screen.findByRole('dialog', {}, { timeout: 5000 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('closes without a request when the page becomes hidden', async () => {
    const user = userEvent.setup();
    mount({ autoAdvise: false });
    await user.click(launcher());
    await screen.findByRole('dialog', {}, { timeout: 5000 });
    await user.click(screen.getByRole('link', { name: 'to nowhere' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'to home' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('follow-ups', () => {
  it('sends a typed question on Enter to Assistant (tools path), streams the reply; Shift+Enter adds a newline', async () => {
    const user = userEvent.setup();
    mount({ autoAdvise: false });
    await user.click(launcher());
    const input = await screen.findByRole('textbox', { name: 'Message Assistant' });

    await user.type(input, 'line1{Shift>}{Enter}{/Shift}line2');
    expect(input).toHaveValue('line1\nline2');
    expect(assistantFetch).not.toHaveBeenCalled();

    const stream = controlledSse();
    assistantFetch.mockResolvedValueOnce(stream.response);
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Assistant is thinking')).toBeInTheDocument();
    expect(screen.getByText(/line1/)).toBeInTheDocument();
    await act(async () => {
      stream.push('delta', { round: 0, content: 'Answer with ' });
      await flush();
    });
    expect(await screen.findByText(/Answer with/)).toBeInTheDocument();
    await act(async () => {
      stream.push('final', { content: 'Answer with **bold**' });
      stream.push('run.done', { pending: 0 });
      stream.close();
      await flush();
    });
    expect(await screen.findByText('bold')).toBeInTheDocument();
    expect(screen.queryByText('Assistant is thinking')).not.toBeInTheDocument();
    expect(assistantBody()).toEqual({ prompt: 'line1\nline2', conversationId: 'conv-1', page: 'home' });
    expect(mockFetch).not.toHaveBeenCalled();
    // Suggestion chips are for the first question only.
    expect(screen.queryByRole('button', { name: 'Give me a quick overview' })).not.toBeInTheDocument();
  });

  it('a suggestion chip sends its text', async () => {
    const user = userEvent.setup();
    mount({ autoAdvise: false });
    await user.click(launcher());
    await user.click(await screen.findByRole('button', { name: 'Give me a quick overview' }));
    await screen.findByText('Advice');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).messages).toEqual([
      { role: 'user', content: 'Give me a quick overview' },
    ]);
  });
});

describe('errors', () => {
  it('shows the server error with Retry, and clears it on success', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({
        error: 'Too many requests, please try again later.',
        code: 'rate_limited',
        retryAfterMs: 0,
      }),
    });
    mount();
    await user.click(launcher());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Assistant couldn't answer (error 429). Try again.");
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Advice');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe('401', () => {
  it('shows a friendly session-expired message', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) });
    mount();
    await user.click(launcher());
    expect(await screen.findByRole('alert')).toHaveTextContent('Session expired. Please sign in again.');
  });
});

describe('markdown safety', () => {
  it('shows the host after link text as plain text, never a link, and keeps non-http links plain', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(
      ok('[a](https://example.com/x) and [b](javascript:alert(1)) and [c](mailto:x@y.io)'),
    );
    mount();
    await user.click(launcher());
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(dialog).toHaveTextContent('a (example.com) and b and c'));
    expect(within(dialog).queryByRole('link')).toBeNull();
    expect(dialog.querySelector('a')).toBeNull();
    expect(screen.getByText('b')).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent('b (');
    expect(dialog).not.toHaveTextContent('c (');
  });

  it('shows the real host when the link text names another host', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(ok('[mybank.com](https://evil.example/login)'));
    mount();
    await user.click(launcher());
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(dialog).toHaveTextContent('mybank.com (evil.example)'));
    expect(within(dialog).queryByRole('link')).toBeNull();
  });

  it('drops images and renders links with no anchor', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue(ok('![x](http://evil.example/?q=1)\n\n[link](https://example.com)'));
    mount();
    await user.click(launcher());
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(dialog).toHaveTextContent('link (example.com)'));
    expect(dialog.querySelector('a')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('typed questions: change requests and new chat', () => {
  const ask = async (user, text) => {
    const input = await screen.findByRole('textbox', { name: 'Message Assistant' });
    await user.type(input, text);
    await user.keyboard('{Enter}');
  };
  const confirmStream = () =>
    sseResponse([
      sseEvent('tool.start', { id: 't1', name: 'save_record__crews' }),
      sseEvent('confirm.required', { token: 'tok1', name: 'save_record__crews', args: { name: 'Buy milk' }, summary: 'Add item "Buy milk"' }),
      sseEvent('final', { content: 'I can add that once you approve.' }),
      sseEvent('run.done', { pending: 1 }),
    ]);

  it('shows the reply then a confirm card; Approve posts with the conversation id and shows done', async () => {
    const user = userEvent.setup();
    assistantFetch.mockResolvedValueOnce(confirmStream());
    mount({ autoAdvise: false });
    await user.click(launcher());
    await ask(user, 'add an item called Buy milk');

    expect(await screen.findByText('I can add that once you approve.')).toBeInTheDocument();
    const card = await screen.findByRole('group', { name: 'Confirm: Add item "Buy milk"' });
    expect(within(card).getByText('Assistant wants to make a change')).toBeInTheDocument();
    expect(screen.getAllByRole('status').some((el) => el.textContent === 'Assistant wants to make a change. Approve or decline.')).toBe(true);

    assistantFetch.mockResolvedValueOnce(jsonResponse({ data: { name: 'save_record__crews', approved: true, result: { added: {} } } }));
    await user.click(within(card).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Done. The change was made.')).toBeInTheDocument();
    const [url, init] = assistantFetch.mock.calls[1];
    expect(url).toBe('/api/assistant/actions/tok1');
    expect(JSON.parse(init.body)).toEqual({ approve: true, conversationId: 'conv-1' });
  });

  it('announces the table when an approved runtime write lands', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    window.addEventListener('app:data-changed', changed);
    try {
      const stream = () =>
        sseResponse([
          sseEvent('tool.start', { id: 't1', name: 'save_record__crews' }),
          sseEvent('confirm.required', { token: 'tok1', name: 'save_record__crews', args: { name: 'Alpha' }, summary: 'Add a crew "Alpha"' }),
          sseEvent('final', { content: 'Ready when you are.' }),
          sseEvent('run.done', { pending: 1 }),
        ]);
      assistantFetch.mockResolvedValueOnce(stream());
      mount({ autoAdvise: false });
      await user.click(launcher());
      await ask(user, 'add a crew called Alpha');
      const again = await screen.findByRole('group', { name: /Confirm:/ });
      expect(changed).not.toHaveBeenCalled();
      assistantFetch.mockResolvedValueOnce(jsonResponse({ data: { name: 'save_record__crews', approved: true, result: { saved: {} } } }));
      await user.click(within(again).getByRole('button', { name: 'Approve' }));
      await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
      expect(changed.mock.calls[0][0].detail).toEqual({ table: 'crews' });
    } finally {
      window.removeEventListener('app:data-changed', changed);
    }
  });

  it('declining shows the declined state', async () => {
    const user = userEvent.setup();
    assistantFetch.mockResolvedValueOnce(confirmStream());
    mount({ autoAdvise: false });
    await user.click(launcher());
    await ask(user, 'add milk');
    const card = await screen.findByRole('group', { name: /Confirm:/ });
    assistantFetch.mockResolvedValueOnce(jsonResponse({ data: { name: 'save_record__crews', approved: false } }));
    await user.click(within(card).getByRole('button', { name: 'Decline' }));
    expect(await screen.findByText('Declined. Nothing was changed.')).toBeInTheDocument();
  });

  it('New chat clears the typed conversation and its change requests', async () => {
    const user = userEvent.setup();
    assistantFetch.mockResolvedValueOnce(confirmStream());
    mount({ autoAdvise: false });
    await user.click(launcher());
    const newChat = await screen.findByRole('button', { name: 'Start a new chat with Assistant' });
    expect(newChat).toBeDisabled();
    await ask(user, 'add milk');
    await screen.findByRole('group', { name: /Confirm:/ });
    await waitFor(() => expect(newChat).toBeEnabled());
    await user.click(newChat);
    expect(screen.queryByText('I can add that once you approve.')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /Confirm:/ })).not.toBeInTheDocument();
    expect(newChat).toBeDisabled();
  });

  it('shows the unavailable state for a 503 from Assistant, with no Retry button', async () => {
    const user = userEvent.setup();
    assistantFetch.mockResolvedValueOnce(
      jsonResponse({ error: 'ollama_unavailable', reason: 'ollama_unavailable', message: 'Assistant cannot reach Ollama.' }, 503),
    );
    mount({ autoAdvise: false });
    await user.click(launcher());
    await ask(user, 'hello');
    expect(await screen.findByText('Assistant needs Ollama')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });
});

describe('assistant:open event (command palette)', () => {
  it('opens the panel and sends the question to Assistant with no page-advice request', async () => {
    assistantFetch.mockResolvedValueOnce(sseResponse([sseEvent('final', { content: 'Two things are due.' }), sseEvent('run.done', { pending: 0 })]));
    mount({ autoAdvise: true });
    act(() => openAssistant({ prompt: 'what is in my list' }));
    expect(await screen.findByText('Two things are due.')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(assistantBody()).toEqual({ prompt: 'what is in my list', conversationId: 'conv-1', page: 'home' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('without a prompt it just opens, and auto-advice still runs once', async () => {
    mount({ autoAdvise: true });
    act(() => openAssistant());
    await screen.findByText('Advice');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(assistantFetch).not.toHaveBeenCalled();
  });

  it('while Assistant is busy the question fills the composer instead of sending', async () => {
    const user = userEvent.setup();
    const stream = controlledSse();
    assistantFetch.mockResolvedValueOnce(stream.response);
    mount({ autoAdvise: false });
    act(() => openAssistant({ prompt: 'first question' }));
    expect(await screen.findByText('Assistant is thinking')).toBeInTheDocument();
    act(() => openAssistant({ prompt: 'second question' }));
    const input = await screen.findByRole('textbox', { name: 'Message Assistant' });
    await waitFor(() => expect(input).toHaveValue('second question'));
    expect(assistantFetch).toHaveBeenCalledTimes(1);
    assistantFetch.mockResolvedValueOnce(sseResponse([sseEvent('final', { content: 'Second.' })]));
    await act(async () => {
      stream.push('final', { content: 'Done.' });
      stream.close();
      await flush();
    });
    await user.click(await screen.findByRole('button', { name: 'Send' }));
    await waitFor(() => expect(assistantFetch).toHaveBeenCalledTimes(2));
    expect(assistantBody(1).prompt).toBe('second question');
  });

  it('is ignored when the launcher is not shown', async () => {
    mount({ showButton: false });
    act(() => openAssistant({ prompt: 'hello' }));
    await act(async () => {
      await flush();
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(assistantFetch).not.toHaveBeenCalled();
  });

  it('clips an over-long prompt to the composer limit', async () => {
    assistantFetch.mockResolvedValueOnce(sseResponse([sseEvent('final', { content: 'ok' })]));
    mount({ autoAdvise: false });
    act(() => openAssistant({ prompt: 'x'.repeat(5000) }));
    await waitFor(() => expect(assistantFetch).toHaveBeenCalledTimes(1));
    expect(assistantBody().prompt).toHaveLength(1000);
  });

  it('closing the panel stops a running question', async () => {
    const user = userEvent.setup();
    const stream = controlledSse();
    assistantFetch.mockResolvedValueOnce(stream.response);
    mount({ autoAdvise: false });
    act(() => openAssistant({ prompt: 'long one' }));
    await screen.findByText('Assistant is thinking');
    await user.click(screen.getByRole('button', { name: 'Close Assistant' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(assistantFetch.mock.calls[0][1].signal.aborted).toBe(true);
  });
});
