import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AssistantPanel from '../AssistantPanel';
import { EMPTY_AGENT } from '../timeline';
import { aiSettingsService } from '../../../services/aiSettingsService';

let mockStatus = null;
vi.mock('../../../hooks/useAssistantStatus', () => ({
  useAssistantStatus: () => ({ status: mockStatus, loading: false, error: null }),
}));
vi.mock('../../../services/aiSettingsService', () => ({
  aiSettingsService: {
    cloudHint: vi.fn(),
    enableCloud: vi.fn(),
    disableCloud: vi.fn(),
    setProvider: vi.fn(),
    setCloud: vi.fn(),
    setCloudCategories: vi.fn(),
  },
}));

const CLOUD = { kind: 'cloud', host: 'api.example.com' };
const LOCAL = { kind: 'local', host: null };
const idleThread = { messages: [], status: 'idle', error: null, lastRequestMessages: null, partial: '' };
const NOTICE = "Your item notes aren't shared with cloud AI. You can change that in Settings > AI.";
// The notice paragraph holds a nested no-break span, so match on the paragraph's full text.
const noticeMatcher = (_content, el) => el?.tagName === 'P' && el.textContent === NOTICE;
const SLOW = { show: true, reason: 'slow' };

beforeEach(() => {
  mockStatus = { available: true, provider: 'ollama', model: 'm', ai: LOCAL, cloudHint: { show: false, reason: null } };
  aiSettingsService.cloudHint.mockResolvedValue({ cloudHint: { show: false, reason: null } });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const baseProps = (overrides = {}) => ({
  id: 'panel',
  pageKey: 'items',
  pageLabel: 'Items',
  thread: idleThread,
  suggestions: [],
  agent: EMPTY_AGENT,
  onSend: vi.fn(),
  onSuggestion: vi.fn(),
  onNewAdvice: vi.fn(),
  onRetry: vi.fn(),
  onRespond: vi.fn(),
  onNewChat: vi.fn(),
  onClose: vi.fn(),
  ...overrides,
});

function setup(overrides = {}, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const props = baseProps(overrides);
  const ui = (p) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AssistantPanel {...p} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(ui(props));
  return { props, client, rerenderWith: (next) => view.rerender(ui({ ...props, ...next })) };
}

const adviceThread = (message) => ({ ...idleThread, messages: [{ id: 'a1', role: 'assistant', at: 1, ...message }] });

describe('AssistantPanel source badge', () => {
  it.each([
    [LOCAL, 'On this computer'],
    [{ kind: 'lan', host: 'nas.example.com' }, 'On your network: nas.example.com'],
    [CLOUD, 'Cloud: api.example.com'],
  ])('shows %j in the header', (ai, text) => {
    mockStatus = { ...mockStatus, ai };
    setup();
    const header = screen.getByRole('heading', { name: 'Assistant' }).closest('.glass-assistant-head');
    expect(within(header).getByText(text)).toBeInTheDocument();
  });

  it('keeps the header badge in the same row as the Assistant title chip', () => {
    mockStatus = { ...mockStatus, ai: CLOUD };
    setup();
    const header = screen.getByRole('heading', { name: 'Assistant' }).closest('.glass-assistant-head');
    const badge = within(header).getByText('Cloud: api.example.com').closest('[data-ai-kind]');
    const chip = screen.getByRole('heading', { name: 'Assistant' }).closest('.glass-assistant-chip');
    expect(badge.parentElement).toBe(chip.parentElement);
    expect(chip.parentElement).toHaveClass('flex', 'items-center');
    // Narrow widths wrap the badge onto its own line (full host stays readable); sm+ stays inline.
    expect(chip.parentElement).toHaveClass('flex-wrap', 'sm:flex-nowrap');
    expect(badge).toHaveClass('max-sm:basis-full');
    expect(badge).toHaveAttribute('title', 'Cloud: api.example.com');
  });

  it('shows no badge before the status loads', () => {
    mockStatus = null;
    setup();
    expect(screen.queryByText(/On this computer|Cloud:|On your network/)).not.toBeInTheDocument();
  });

  it('adds a badge under a cloud reply only', () => {
    mockStatus = { ...mockStatus, ai: CLOUD };
    setup({
      thread: {
        ...idleThread,
        messages: [
          { id: 'a1', role: 'assistant', content: 'Cloud reply', at: 1, ai: CLOUD },
          { id: 'a2', role: 'assistant', content: 'Local reply', at: 2, ai: LOCAL },
          { id: 'a3', role: 'assistant', content: 'Old reply', at: 3 },
        ],
      },
    });
    // One in the header, one under the cloud reply, none under the local or older replies.
    expect(screen.getAllByText('Cloud: api.example.com')).toHaveLength(2);
    expect(screen.queryByText('On this computer')).not.toBeInTheDocument();
  });

  it('adds no per-reply badge under a lan or local reply', () => {
    mockStatus = { ...mockStatus, ai: LOCAL };
    setup({
      thread: {
        ...idleThread,
        messages: [
          { id: 'a1', role: 'assistant', content: 'Lan reply', at: 1, ai: { kind: 'lan', host: 'nas.example.com' } },
          { id: 'a2', role: 'assistant', content: 'Local reply', at: 2, ai: LOCAL },
        ],
      },
    });
    expect(screen.queryByText(/On your network/)).not.toBeInTheDocument();
    // Only the header badge.
    expect(screen.getAllByText('On this computer')).toHaveLength(1);
  });

  it('adds a badge under a cloud chat reply', () => {
    setup({
      agent: {
        ...EMPTY_AGENT,
        messages: [
          { id: 'u1', role: 'user', content: 'hi', at: 5 },
          { id: 'b1', role: 'assistant', content: 'Hello', at: 6, ai: CLOUD },
        ],
      },
    });
    expect(screen.getByText('Cloud: api.example.com')).toBeInTheDocument();
  });
});

describe('AssistantPanel withheld notice', () => {
  it('shows the server message and a link to Settings > AI under the reply', () => {
    setup({ thread: adviceThread({ content: 'Here is what I can see.', ai: CLOUD, notice: NOTICE, withheld: ['notes'] }) });
    expect(screen.getByText('Here is what I can see.')).toBeInTheDocument();
    const notice = screen.getByText(noticeMatcher).closest('[role="status"]');
    expect(within(notice).getByRole('link', { name: 'Change what cloud AI can see' })).toHaveAttribute('href', '/settings#ai');
  });

  it('shows a chat notice object the same way', () => {
    setup({
      agent: {
        ...EMPTY_AGENT,
        messages: [
          { id: 'u1', role: 'user', content: 'notes?', at: 5 },
          {
            id: 'b1',
            role: 'assistant',
            content: 'I cannot see that.',
            at: 6,
            ai: CLOUD,
            notice: { message: NOTICE, categories: ['notes'] },
          },
        ],
      },
    });
    expect(screen.getByText(noticeMatcher)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Change what cloud AI can see' })).toHaveAttribute('href', '/settings#ai');
  });

  it('renders a blocked advice reply as a notice, not an error or a chat bubble', () => {
    mockStatus = { ...mockStatus, ai: CLOUD };
    setup({ thread: adviceThread({ content: NOTICE, ai: CLOUD, notice: NOTICE, blocked: true, withheld: ['notes'] }) });
    expect(screen.getByText(noticeMatcher)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Assistant said:')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Change what cloud AI can see' })).toHaveAttribute('href', '/settings#ai');
  });

  it('does not announce a blocked reply a second time', () => {
    mockStatus = { ...mockStatus, ai: CLOUD };
    const { rerenderWith } = setup();
    rerenderWith({ thread: adviceThread({ content: NOTICE, ai: CLOUD, notice: NOTICE, blocked: true }) });
    expect(screen.getAllByText(noticeMatcher)).toHaveLength(1);
    expect(screen.queryByText(/^Assistant said:|^Assistant replied\./)).not.toBeInTheDocument();
  });

  it('shows no notice for an ordinary reply', () => {
    setup({ thread: adviceThread({ content: 'Fine.', ai: LOCAL, notice: null }) });
    expect(screen.queryByRole('link', { name: 'Change what cloud AI can see' })).not.toBeInTheDocument();
  });
});

describe('AssistantPanel cloud hint', () => {
  const postedEvents = () => aiSettingsService.cloudHint.mock.calls.map((c) => c[0]);

  const expectNothingEnabled = () => {
    for (const fn of [
      aiSettingsService.enableCloud,
      aiSettingsService.disableCloud,
      aiSettingsService.setProvider,
      aiSettingsService.setCloud,
      aiSettingsService.setCloudCategories,
    ]) {
      expect(fn).not.toHaveBeenCalled();
    }
  };

  it('is absent when the status says not to show it, and posts nothing', () => {
    setup();
    expect(screen.queryByText(/Assistant is slow on this computer/)).not.toBeInTheDocument();
    expect(aiSettingsService.cloudHint).not.toHaveBeenCalled();
  });

  it('shows the copy and posts shown exactly once, even across re-renders', async () => {
    mockStatus = { ...mockStatus, cloudHint: SLOW };
    const { rerenderWith } = setup();
    expect(
      screen.getByText('Assistant is slow on this computer. You can keep it local, or connect your own cloud AI in Settings.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(aiSettingsService.cloudHint).toHaveBeenCalledTimes(1));
    expect(postedEvents()).toEqual(['shown']);
    rerenderWith({ pageLabel: 'Items again' });
    rerenderWith({ pageLabel: 'Items once more' });
    expect(aiSettingsService.cloudHint).toHaveBeenCalledTimes(1);
    expectNothingEnabled();
  });

  it('posts shown once under StrictMode', async () => {
    mockStatus = { ...mockStatus, cloudHint: SLOW };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <AssistantPanel {...baseProps()} />
          </MemoryRouter>
        </QueryClientProvider>
      </StrictMode>,
    );
    await waitFor(() => expect(aiSettingsService.cloudHint).toHaveBeenCalledTimes(1));
    expect(postedEvents()).toEqual(['shown']);
  });

  it('refetches the status after shown settles', async () => {
    mockStatus = { ...mockStatus, cloudHint: SLOW };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(client, 'invalidateQueries');
    setup({}, client);
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['assistant-status'] }));
  });

  it('stays visible for the panel session after the status learns it was shown', async () => {
    mockStatus = { ...mockStatus, cloudHint: SLOW };
    const { rerenderWith } = setup();
    await waitFor(() => expect(postedEvents()).toEqual(['shown']));
    mockStatus = { ...mockStatus, cloudHint: { show: false, reason: null } };
    rerenderWith({});
    expect(screen.getByText(/Assistant is slow on this computer/)).toBeInTheDocument();
  });

  it('writes show:false into the cached status so reopening the panel does not show it again', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['assistant-status'], { available: true, cloudHint: SLOW });
    mockStatus = { ...mockStatus, cloudHint: SLOW };
    setup({}, client);
    await waitFor(() =>
      expect(client.getQueryData(['assistant-status']).cloudHint).toEqual({ show: false, reason: null }),
    );
    expect(client.getQueryData(['assistant-status']).available).toBe(true);
  });

  it('Keep it local posts dismissed, hides the hint and never enables anything', async () => {
    const user = userEvent.setup();
    mockStatus = { ...mockStatus, cloudHint: SLOW };
    setup();
    await user.click(screen.getByRole('button', { name: 'Keep it local' }));
    expect(postedEvents()).toEqual(['shown', 'dismissed']);
    expect(screen.queryByText(/Assistant is slow on this computer/)).not.toBeInTheDocument();
    expectNothingEnabled();
  });

  it('the X button is labelled Dismiss and posts dismissed', async () => {
    const user = userEvent.setup();
    mockStatus = { ...mockStatus, cloudHint: { show: true, reason: 'low_memory' } };
    setup();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(postedEvents()).toEqual(['shown', 'dismissed']);
    expect(screen.queryByText(/Assistant is slow on this computer/)).not.toBeInTheDocument();
  });

  it('Open Settings links to Settings > AI and posts dismissed without enabling anything', async () => {
    const user = userEvent.setup();
    mockStatus = { ...mockStatus, cloudHint: SLOW };
    setup();
    const link = screen.getByRole('link', { name: 'Open Settings' });
    expect(link).toHaveAttribute('href', '/settings#ai');
    await user.click(link);
    expect(postedEvents()).toEqual(['shown', 'dismissed']);
    expectNothingEnabled();
  });

  it('survives a failed hint post', async () => {
    const user = userEvent.setup();
    aiSettingsService.cloudHint.mockRejectedValue(new Error('offline'));
    mockStatus = { ...mockStatus, cloudHint: SLOW };
    setup();
    await user.click(screen.getByRole('button', { name: 'Keep it local' }));
    expect(screen.queryByText(/Assistant is slow on this computer/)).not.toBeInTheDocument();
  });
});
