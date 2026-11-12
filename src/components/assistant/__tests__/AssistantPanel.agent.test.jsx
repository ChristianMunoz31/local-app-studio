import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../hooks/useEntitlements', async () => (await import('../../../test-utils/entitlements.js')).entitlementsModule());
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AssistantPanel from '../AssistantPanel';
import { EMPTY_AGENT } from '../timeline';

// The panel reads Assistant's source from the status query; these tests are not about that.
vi.mock('../../../hooks/useAssistantStatus', () => ({
  useAssistantStatus: () => ({ status: null, loading: false, error: null }),
}));

afterEach(cleanup);

const idleThread = { messages: [], status: 'idle', error: null, lastRequestMessages: null, partial: '' };

function setup(overrides = {}) {
  const props = {
    id: 'panel',
    pageKey: 'items',
    pageLabel: 'Items',
    thread: idleThread,
    suggestions: ['What should I tackle first?'],
    agent: EMPTY_AGENT,
    onSend: vi.fn(),
    onSuggestion: vi.fn(),
    onNewAdvice: vi.fn(),
    onRetry: vi.fn(),
    onRespond: vi.fn(),
    onNewChat: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  const ui = (p) => (
    <MemoryRouter>
      <AssistantPanel {...p} />
    </MemoryRouter>
  );
  const view = render(ui(props));
  return { props, ...view, rerenderWith: (next) => view.rerender(ui({ ...props, ...next })) };
}

const agentWith = (patch) => ({ ...EMPTY_AGENT, ...patch });

describe('AssistantPanel free-form chat', () => {
  it('sends typed text through onSend and chips through onSuggestion', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await user.click(screen.getByRole('button', { name: 'What should I tackle first?' }));
    expect(props.onSuggestion).toHaveBeenCalledWith('What should I tackle first?');
    expect(props.onSend).not.toHaveBeenCalled();
    await user.type(screen.getByRole('textbox', { name: 'Message Assistant' }), 'how much did I spend{Enter}');
    expect(props.onSend).toHaveBeenCalledWith('how much did I spend');
  });

  it('uses the Assistant placeholder and no other product or bot names', () => {
    setup();
    expect(screen.getByPlaceholderText('Ask Assistant anything…')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/chatgpt|chatbot|copilot/i);
  });

  it('hides the chips once a typed question exists, and shows the merged timeline in time order', () => {
    const agent = agentWith({
      messages: [
        { id: 'u1', role: 'user', content: 'What is due?', at: 20 },
        { id: 'b1', role: 'assistant', content: 'Two things.', at: 21 },
      ],
    });
    const thread = { ...idleThread, messages: [{ id: 'a1', role: 'assistant', content: 'Page advice here', at: 10 }] };
    setup({ agent, thread });
    expect(screen.queryByRole('button', { name: 'What should I tackle first?' })).not.toBeInTheDocument();
    const text = document.body.textContent;
    expect(text.indexOf('Page advice here')).toBeLessThan(text.indexOf('What is due?'));
    expect(text.indexOf('What is due?')).toBeLessThan(text.indexOf('Two things.'));
  });

  it('shows tool progress chips while the agent runs, and a skeleton before any text', () => {
    const agent = agentWith({
      running: true,
      messages: [
        { id: 'u1', role: 'user', content: 'features?', at: 1 },
        { id: 'b1', role: 'assistant', content: '', at: 1 },
      ],
      tools: [
        { id: 't1', name: 'list_features', status: 'done' },
        { id: 't2', name: 'get_stats', status: 'running' },
      ],
    });
    setup({ agent });
    expect(screen.getByText('Checking your features')).toBeInTheDocument();
    expect(screen.getByText('Working out totals')).toBeInTheDocument();
    expect(screen.getByText('Assistant is thinking')).toBeInTheDocument();
  });

  it('disables send, chips and refresh while the agent runs', async () => {
    const user = userEvent.setup();
    const agent = agentWith({ running: true, messages: [{ id: 'u1', role: 'user', content: 'q', at: 1 }] });
    const { props } = setup({ agent });
    await user.type(screen.getByRole('textbox', { name: 'Message Assistant' }), 'next');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Get new advice for this page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Start a new chat with Assistant' })).toBeDisabled();
    expect(props.onSend).not.toHaveBeenCalled();
  });

  it('renders a pending change as a confirm card and announces it', async () => {
    const user = userEvent.setup();
    const agent = agentWith({
      messages: [{ id: 'u1', role: 'user', content: 'add milk', at: 1 }],
      actions: [{ token: 'tok', name: 'save_record__crews', args: {}, summary: 'Add item "milk"', status: 'pending', at: 2 }],
    });
    const { props } = setup({ agent });
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(props.onRespond).toHaveBeenCalledWith('tok', true);
    expect(screen.getAllByRole('status').some((el) => /Assistant wants to make a change\. Approve or decline\./.test(el.textContent))).toBe(true);
  });

  it('shows agent errors in the error chip, with AiUnavailable for unavailable codes and no Retry', () => {
    const { rerenderWith } = setup({
      agent: agentWith({ error: 'Assistant cannot reach Ollama.', errorCode: 'ollama_unavailable', errorReason: 'ollama_unavailable' }),
    });
    expect(screen.getByText('Assistant needs Ollama')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    rerenderWith({ agent: agentWith({ error: 'Assistant took too long.', errorCode: 'timeout' }) });
    expect(screen.getByRole('alert')).toHaveTextContent('Assistant took too long.');
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('puts a prefill in the composer once per prefill id and focuses it', async () => {
    const user = userEvent.setup();
    const { rerenderWith } = setup({ prefill: { id: 1, text: 'first' } });
    const input = screen.getByRole('textbox', { name: 'Message Assistant' });
    expect(input).toHaveValue('first');
    await user.clear(input);
    await user.type(input, 'edited');
    rerenderWith({ prefill: { id: 1, text: 'first' } });
    expect(input).toHaveValue('edited');
    rerenderWith({ prefill: { id: 2, text: 'second' } });
    expect(input).toHaveValue('second');
    await vi.waitFor(() => expect(input).toHaveFocus());
  });

  it('New chat calls onNewChat when there is a typed conversation', async () => {
    const user = userEvent.setup();
    const agent = agentWith({ messages: [{ id: 'u1', role: 'user', content: 'q', at: 1 }, { id: 'b1', role: 'assistant', content: 'a', at: 2 }] });
    const { props } = setup({ agent });
    await user.click(screen.getByRole('button', { name: 'Start a new chat with Assistant' }));
    expect(props.onNewChat).toHaveBeenCalledTimes(1);
  });
});
