import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('../../../hooks/useEntitlements', async () => (await import('../../../test-utils/entitlements.js')).entitlementsModule());
import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, useLocation } from 'react-router-dom';
import AssistantPanel from '../AssistantPanel';
import AssistantMessage from '../AssistantMessage';
import AssistantAdvisor from '../AssistantAdvisor';
import { errorWaitMs } from '../retryWait';
import { PageContextProvider, usePageContext } from '../../../contexts/PageContextContext';
import { resolveAssistantPageKey } from '../../../constants/assistantPages';

// The panel reads Assistant's source from the status query; these tests are not about that.
vi.mock('../../../hooks/useAssistantStatus', () => ({
  useAssistantStatus: () => ({ status: null, loading: false, error: null }),
}));

const mockFetch = vi.fn();
const ok = (content) => ({
  ok: true,
  status: 200,
  json: async () => ({ data: { content, model: 'm', provider: 'p' } }),
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function panelProps(error) {
  return {
    id: 'p',
    pageKey: 'home',
    pageLabel: 'Home',
    thread: {
      messages: [{ id: 'm1', role: 'user', content: 'hi' }],
      status: 'error',
      error,
      lastRequestMessages: [{ role: 'user', content: 'hi' }],
    },
    suggestions: [],
    onSend: vi.fn(),
    onNewAdvice: vi.fn(),
    onRetry: vi.fn(),
    onClose: vi.fn(),
  };
}

describe('S1 shared retry wait', () => {
  it('uses the 30s default for rate-limit codes without retryAfterMs, none for others', () => {
    const at = 1000;
    expect(errorWaitMs({ code: 'rate_limited', at }, at)).toBe(30000);
    expect(errorWaitMs({ code: 'provider_rate_limited', retryAfterMs: null, at }, at)).toBe(30000);
    expect(errorWaitMs({ code: 'rate_limited', retryAfterMs: 5000, at }, at)).toBe(5000);
    expect(errorWaitMs({ code: 'upstream', at }, at)).toBe(0);
  });

  it('disables Retry in the panel for a rate-limit error without retryAfterMs', () => {
    render(
      <AssistantPanel
        {...panelProps({ message: 'Slow down', code: 'rate_limited', retryAfterMs: null, at: Date.now() })}
      />,
    );
    expect(screen.getByRole('button', { name: /try again in/i })).toBeDisabled();
  });
});

describe('S2 retry wait a11y', () => {
  it('keeps role=alert on the message only and the button outside it', () => {
    render(
      <AssistantPanel
        {...panelProps({ message: 'Slow down', code: 'rate_limited', retryAfterMs: null, at: Date.now() })}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Slow down');
    const btn = screen.getByRole('button', { name: /try again in/i });
    expect(alert).not.toContainElement(btn);
    expect(btn).toHaveAccessibleName(/^Try again in \d+s$/);
  });

  it('only runs the interval while a wait is open', () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const { unmount } = render(
      <AssistantPanel {...panelProps({ message: 'Boom', code: 'upstream', retryAfterMs: null, at: Date.now() })} />,
    );
    const secondTicks = () => spy.mock.calls.filter(([, ms]) => ms === 1000).length;
    expect(secondTicks()).toBe(0);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
    unmount();
    render(
      <AssistantPanel {...panelProps({ message: 'Slow', code: 'rate_limited', retryAfterMs: null, at: Date.now() })} />,
    );
    expect(secondTicks()).toBe(1);
    spy.mockRestore();
  });
});

const queryClient = new QueryClient();

function Harness({ visible = true }) {
  const { pathname } = useLocation();
  const key = resolveAssistantPageKey(pathname);
  return (
    <QueryClientProvider client={queryClient}>
      <PageContextProvider>
        <FakePage />
        <Link to="/settings">to settings</Link>
        <AssistantAdvisor pageKey={key} visible={visible && key !== null} autoAdvise />
      </PageContextProvider>
    </QueryClientProvider>
  );
}

let pageLoading = false;
function FakePage() {
  usePageContext('home', () => (pageLoading ? { status: 'loading' } : { open: 3 }));
  return null;
}

const mount = (props = {}) =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Harness {...props} />
    </MemoryRouter>,
  );

describe('S3 toast offset variable', () => {
  beforeEach(() => {
    pageLoading = false;
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(ok('advice'));
  });

  it('is set while the launcher is visible and cleared on unmount', () => {
    const style = document.documentElement.style;
    const { unmount } = mount();
    expect(style.getPropertyValue('--assistant-toast-offset')).toBe('5rem');
    unmount();
    expect(style.getPropertyValue('--assistant-toast-offset')).toBe('');
  });

  it('is cleared when hidden', () => {
    const style = document.documentElement.style;
    const { rerender } = mount();
    expect(style.getPropertyValue('--assistant-toast-offset')).toBe('5rem');
    rerender(
      <MemoryRouter initialEntries={['/']}>
        <Harness visible={false} />
      </MemoryRouter>,
    );
    expect(style.getPropertyValue('--assistant-toast-offset')).toBe('');
  });
});

describe('N2 pageKey change cancels pending auto-advice', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(ok('advice'));
  });

  it('does not request advice for the new page once the poll resumes', async () => {
    pageLoading = true;
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Ask Assistant about this page' }));
    await user.click(screen.getByRole('link', { name: 'to settings' }));
    pageLoading = false;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1200));
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('AssistantMessage polish', () => {
  it('renders dollars intact, strips dashes, and labels the speaker for screen readers', () => {
    const { container } = render(
      <>
        <AssistantMessage role="user" content="how am I doing?" />
        <AssistantMessage role="assistant" content={'You have $1,234.56 \u2014 over the limit, $50\u2013$75 range'} />
      </>,
    );
    const text = container.textContent;
    expect(text).toContain('$1,234.56');
    expect(text).toContain('$50-$75');
    expect(text).not.toMatch(/[\u2013\u2014]/);
    expect(text).toContain('You said: how am I doing?');
    expect(text).toContain('Assistant said: ');
  });
});

describe('AssistantPanel live region', () => {
  const thread = (messages, status = 'idle') => ({ messages, status, error: null, lastRequestMessages: null });
  const props = (t) => ({ ...panelProps(null), thread: t });

  it('announces only Assistant, never the user message', () => {
    const { rerender } = render(<AssistantPanel {...props(thread([{ id: 'u', role: 'user', content: 'secret question' }]))} />);
    expect(screen.getByRole('status')).toHaveTextContent('');
    rerender(<AssistantPanel {...props(thread([{ id: 'u', role: 'user', content: 'secret question' }], 'loading'))} />);
    expect(screen.getByRole('status')).toHaveTextContent('Assistant is thinking');
    rerender(
      <AssistantPanel
        {...props(
          thread([
            { id: 'u', role: 'user', content: 'secret question' },
            { id: 'a', role: 'assistant', content: 'Spend $1,234.56 less' },
          ]),
        )}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Spend $1,234.56 less');
  });

  it('stays silent on a page switch even when the other thread already has a reply', () => {
    const reply = (id, content) => thread([{ id, role: 'assistant', content }]);
    const { rerender } = render(<AssistantPanel {...props(reply('a1', 'Page A advice'))} />);
    expect(screen.getByRole('status')).toHaveTextContent('');
    rerender(<AssistantPanel {...props(reply('b1', 'Page B advice'))} pageKey="settings" pageLabel="Settings" />);
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('announces a new reply after loading, stripped of markdown and prefixed', () => {
    const user = { id: 'u', role: 'user', content: 'q' };
    const { rerender } = render(<AssistantPanel {...props(thread([user], 'loading'))} />);
    expect(screen.getByRole('status')).toHaveTextContent('Assistant is thinking');
    rerender(
      <AssistantPanel
        {...props(thread([user, { id: 'a', role: 'assistant', content: '- **Lamp** is `$800` > limit' }]))}
      />,
    );
    expect(screen.getByRole('status').textContent).toBe('Assistant said: Lamp is $800 limit');
  });

  it('describes the dialog with the page label', () => {
    render(<AssistantPanel {...props(thread([]))} />);
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('About: Home');
  });

  it('gives a built app (page key app) a plain line, not "About: App"', () => {
    render(<AssistantPanel {...props(thread([]))} pageKey="app" pageLabel="App" />);
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('About this app');
  });
});
