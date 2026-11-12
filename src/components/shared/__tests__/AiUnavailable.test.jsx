import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../hooks/useEntitlements', async () => (await import('../../../test-utils/entitlements.js')).entitlementsModule());
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AiUnavailable from '../AiUnavailable';
import AssistantPanel from '../../assistant/AssistantPanel';

// The panel reads Assistant's source from the status query; these tests are not about that.
vi.mock('../../../hooks/useAssistantStatus', () => ({
  useAssistantStatus: () => ({ status: null, loading: false, error: null }),
}));

afterEach(cleanup);

describe('AiUnavailable', () => {
  it('shows one sentence, a link to Settings > AI and the server message', () => {
    render(
      <MemoryRouter>
        <AiUnavailable message="Assistant cannot reach Ollama at http://127.0.0.1:11434." />
      </MemoryRouter>,
    );
    expect(screen.getByText('Assistant needs Ollama')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set it up in Settings > AI' })).toHaveAttribute(
      'href',
      '/settings#ai',
    );
    expect(screen.getByText('Assistant cannot reach Ollama at http://127.0.0.1:11434.')).toBeInTheDocument();
  });

  it('says AI is turned off, with no Settings link, when the reason is ai_disabled', () => {
    render(
      <MemoryRouter>
        <AiUnavailable code="ai_not_configured" reason="ai_disabled" message="AI is turned off." />
      </MemoryRouter>,
    );
    expect(screen.getByText('AI is turned off')).toBeInTheDocument();
    expect(screen.queryByText('Assistant needs Ollama')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('keys the turned-off state off the reason, not the message text', () => {
    const { rerender } = render(
      <MemoryRouter>
        <AiUnavailable code="ai_not_configured" message="AI is turned off." />
      </MemoryRouter>,
    );
    expect(screen.queryByText('AI is turned off')).not.toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <AiUnavailable reason="ai_disabled" />
      </MemoryRouter>,
    );
    expect(screen.getByText('AI is turned off')).toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <AiUnavailable code="ai_not_configured" reason="no_model" message="No AI model is installed." />
      </MemoryRouter>,
    );
    expect(screen.getByText('Assistant needs Ollama')).toBeInTheDocument();
  });

  it('keeps the Ollama heading and link for ollama_unavailable and for no models', () => {
    const { rerender } = render(
      <MemoryRouter>
        <AiUnavailable code="ollama_unavailable" message="Assistant cannot reach Ollama." />
      </MemoryRouter>,
    );
    expect(screen.getByText('Assistant needs Ollama')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Settings > AI/ })).toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <AiUnavailable code="ai_not_configured" message="No AI model is installed." />
      </MemoryRouter>,
    );
    expect(screen.getByText('Assistant needs Ollama')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Settings > AI/ })).toBeInTheDocument();
  });

  it('says each thing once: the server message replaces the generic intro', () => {
    const { container, rerender } = render(
      <MemoryRouter>
        <AiUnavailable code="ollama_unavailable" message="Assistant can't reach Ollama at http://127.0.0.1:11434." />
      </MemoryRouter>,
    );
    expect(container.textContent).not.toMatch(/runs on your machine/);
    expect((container.textContent.match(/Ollama/g) ?? []).length).toBe(2); // heading + message
    rerender(
      <MemoryRouter>
        <AiUnavailable code="ai_not_configured" message='No AI model is installed. Run "ollama pull qwen2.5:7b", then pick it in Settings > AI.' />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Open Settings > AI' })).toBeInTheDocument();
    expect(screen.queryByText(/Set it up in/)).not.toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <AiUnavailable />
      </MemoryRouter>,
    );
    expect(container.textContent).toMatch(/Assistant runs on your machine through Ollama\./);
  });

  it('has no dashes in its own copy', () => {
    const { container } = render(
      <MemoryRouter>
        <AiUnavailable />
      </MemoryRouter>,
    );
    expect(container.textContent).not.toMatch(/[\u2013\u2014]/);
  });
});

function panelProps(error) {
  return {
    id: 'p',
    pageKey: 'items',
    pageLabel: 'Items',
    thread: {
      messages: [{ id: 'm1', role: 'user', content: 'hi' }],
      status: 'error',
      error,
      lastRequestMessages: [{ role: 'user', content: 'hi' }],
      partial: '',
    },
    suggestions: [],
    onSend: vi.fn(),
    onNewAdvice: vi.fn(),
    onRetry: vi.fn(),
    onClose: vi.fn(),
  };
}

describe('Assistant panel unavailable state', () => {
  it('renders the friendly state for ollama_unavailable', () => {
    render(
      <MemoryRouter>
        <AssistantPanel
          {...panelProps({
            message: 'Assistant cannot reach Ollama.',
            code: 'ollama_unavailable',
            retryAfterMs: null,
            at: Date.now(),
          })}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('Assistant needs Ollama')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Settings > AI/ })).toBeInTheDocument();
    expect(screen.getByText('Assistant cannot reach Ollama.')).toBeInTheDocument();
  });

  it('says AI is turned off when the 503 reason is ai_disabled', () => {
    render(
      <MemoryRouter>
        <AssistantPanel
          {...panelProps({ message: 'AI is turned off.', code: 'ai_not_configured', reason: 'ai_disabled', at: 1 })}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('AI is turned off')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Settings > AI/ })).not.toBeInTheDocument();
  });

  it('renders the same state for ai_not_configured and keeps other errors plain', () => {
    const { rerender } = render(
      <MemoryRouter>
        <AssistantPanel
          {...panelProps({ message: 'No AI model is installed.', code: 'ai_not_configured', at: 1 })}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('Assistant needs Ollama')).toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <AssistantPanel {...panelProps({ message: 'Try again later.', code: 'timeout', at: 1 })} />
      </MemoryRouter>,
    );
    expect(screen.queryByText('Assistant needs Ollama')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Try again later.');
  });

  it('makes the suggestion chips non-interactive while AI is unavailable', async () => {
    const props = panelProps({ message: 'Assistant cannot reach Ollama.', code: 'ollama_unavailable', at: 1 });
    props.thread = { ...props.thread, messages: [] };
    props.suggestions = ['What is overdue?'];
    const user = userEvent.setup();
    const { rerender } = render(
      <MemoryRouter>
        <AssistantPanel {...props} />
      </MemoryRouter>,
    );
    const chip = screen.getByRole('button', { name: 'What is overdue?' });
    expect(chip).toHaveAttribute('aria-disabled', 'true');
    await user.click(chip);
    expect(props.onSend).not.toHaveBeenCalled();

    const ok = { ...props, thread: { ...props.thread, status: 'idle', error: null } };
    rerender(
      <MemoryRouter>
        <AssistantPanel {...ok} />
      </MemoryRouter>,
    );
    const live = screen.getByRole('button', { name: 'What is overdue?' });
    expect(live).not.toHaveAttribute('aria-disabled');
    await user.click(live);
    expect(props.onSend).toHaveBeenCalledWith('What is overdue?');
  });

  it('shows streamed partial text while loading', () => {
    const props = panelProps(null);
    props.thread = { ...props.thread, status: 'loading', error: null, partial: 'Partial words' };
    render(
      <MemoryRouter>
        <AssistantPanel {...props} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Partial words')).toBeInTheDocument();
  });
});
