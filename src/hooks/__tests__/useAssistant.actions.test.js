// useAssistant streaming deltas and the write confirmation flow.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAssistant } from '../useAssistant';
import { jsonResponse, sseEvent, sseResponse, withConversations } from '../../test-utils/sseResponse';

const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', withConversations(mockFetch));
  mockFetch.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const assistantText = (result) =>
  result.current.messages.find((m) => m.role === 'assistant')?.content;

describe('useAssistant delta events', () => {
  it('grows the assistant bubble from deltas and replaces it with the final content', async () => {
    mockFetch.mockResolvedValueOnce(
      sseResponse([
        sseEvent('delta', { type: 'delta', round: 1, content: 'You ' }),
        sseEvent('delta', { type: 'delta', round: 1, content: 'have' }),
        sseEvent('final', { content: 'You have 2 features.' }),
        sseEvent('run.done', { pending: 0 }),
      ]),
    );
    const { result } = renderHook(() => useAssistant());
    await act(async () => {
      await result.current.send('features?');
    });
    expect(assistantText(result)).toBe('You have 2 features.');
  });

  it('shows the draft while streaming and clears it on tool.start', async () => {
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(sseEvent('delta', { round: 1, content: 'Let me check' })));
        await gate;
        controller.enqueue(encoder.encode(sseEvent('tool.start', { id: 't1', name: 'list_features' })));
        controller.enqueue(encoder.encode(sseEvent('final', { content: 'Done.' })));
        controller.close();
      },
    });
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, body: stream });
    const { result } = renderHook(() => useAssistant());
    let sending;
    await act(async () => {
      sending = result.current.send('check');
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(assistantText(result)).toBe('Let me check');
    await act(async () => {
      release();
      await sending;
    });
    expect(assistantText(result)).toBe('Done.');
  });
});

describe('useAssistant confirm.required', () => {
  const confirmStream = () =>
    sseResponse([
      sseEvent('confirm.required', {
        token: 'tok123',
        name: 'save_record__crews',
        args: { title: 'Buy milk' },
        summary: 'Add an item: Buy milk',
      }),
      sseEvent('final', { content: 'I need your approval first.' }),
      sseEvent('run.done', { pending: 1 }),
    ]);

  it('records a pending action and the pending count', async () => {
    mockFetch.mockResolvedValueOnce(confirmStream());
    const { result } = renderHook(() => useAssistant());
    await act(async () => {
      await result.current.send('add milk');
    });
    expect(result.current.actions).toEqual([
      expect.objectContaining({ token: 'tok123', name: 'save_record__crews', status: 'pending' }),
    ]);
    expect(result.current.pendingCount).toBe(1);
  });

  it('approving posts the decision and marks the action approved', async () => {
    mockFetch.mockResolvedValueOnce(confirmStream());
    const { result } = renderHook(() => useAssistant());
    await act(async () => {
      await result.current.send('add milk');
    });
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ data: { name: 'save_record__crews', approved: true, result: { id: 5 } } }),
    );
    await act(async () => {
      await result.current.respond('tok123', true);
    });
    const [url, init] = mockFetch.mock.calls[1];
    expect(url).toBe('/api/assistant/actions/tok123');
    expect(JSON.parse(init.body)).toEqual({ approve: true, conversationId: 'conv-1' });
    expect(result.current.actions[0].status).toBe('approved');
    expect(result.current.pendingCount).toBe(0);
  });

  it('declining marks the action declined', async () => {
    mockFetch.mockResolvedValueOnce(confirmStream());
    const { result } = renderHook(() => useAssistant());
    await act(async () => {
      await result.current.send('add milk');
    });
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: { name: 'save_record__crews', approved: false } }));
    await act(async () => {
      await result.current.respond('tok123', false);
    });
    expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({ approve: false, conversationId: 'conv-1' });
    expect(result.current.actions[0].status).toBe('declined');
  });

  it('treats 404 action_not_found as a terminal expired state and shows fixed copy for 409 write_cap_reached', async () => {
    mockFetch.mockResolvedValueOnce(confirmStream());
    const { result } = renderHook(() => useAssistant());
    await act(async () => {
      await result.current.send('add milk');
    });
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'action_not_found' }, 404));
    await act(async () => {
      await result.current.respond('tok123', true);
    });
    expect(result.current.actions[0].status).toBe('expired');

    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'write_cap_reached' }, 409));
    await act(async () => {
      await result.current.respond('tok123', true);
    });
    expect(result.current.actions[0].error).toMatch(/limit for changes/);
  });

  it('posts a decision only once when respond is called twice synchronously', async () => {
    mockFetch.mockResolvedValueOnce(confirmStream());
    const { result } = renderHook(() => useAssistant());
    await act(async () => {
      await result.current.send('add milk');
    });
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: { name: 'save_record__crews', approved: true } }));
    await act(async () => {
      await Promise.all([
        result.current.respond('tok123', true),
        result.current.respond('tok123', true),
      ]);
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe('useAssistant unavailable errors', () => {
  it('exposes the structured code for a 503 ollama_unavailable', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: 'ollama_unavailable', message: 'Assistant cannot reach Ollama.' }, 503),
    );
    const { result } = renderHook(() => useAssistant());
    await act(async () => {
      await result.current.send('hi');
    });
    expect(result.current.error).toBe('Assistant cannot reach Ollama.');
    expect(result.current.errorCode).toBe('ollama_unavailable');
  });
});
