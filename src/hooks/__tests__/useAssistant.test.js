// useAssistant hook tests - drives the SSE stream and verifies state transitions.
// Uses @testing-library/react renderHook + act to wrap React state updates.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAssistant } from '../useAssistant';
import { withConversations } from '../../test-utils/sseResponse';

// Build a fake SSE response stream from an array of { type, data } events.
function fakeSseResponse(events) {
  const body = events
    .map(({ type, data }) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
    .join('');
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return { ok: true, body: stream };
}

const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', withConversations(mockFetch));
  mockFetch.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useAssistant', () => {
  it('starts with empty messages and not running', () => {
    const { result } = renderHook(() => useAssistant());
    expect(result.current.messages).toEqual([]);
    expect(result.current.running).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('a 409 conversation_busy shows the fixed message and drops the empty bubble', async () => {
    const message = 'Assistant is still answering in this chat. Wait for it to finish, then ask again.';
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      json: async () => ({ error: 'conversation_busy', code: 'conversation_busy', message }),
    });
    const { result } = renderHook(() => useAssistant());
    await act(async () => {
      await result.current.send('hi');
    });
    expect(result.current.error).toBe(message);
    expect(result.current.running).toBe(false);
    expect(result.current.messages.some((m) => m.role === 'assistant')).toBe(false);
  });

  it('send adds a user bubble immediately', async () => {
    mockFetch.mockResolvedValueOnce(
      fakeSseResponse([{ type: 'final', data: { content: 'Hello!' } }]),
    );
    const { result } = renderHook(() => useAssistant());
    await act(async () => {
      await result.current.send('what time is it?');
    });
    expect(result.current.messages.some((m) => m.role === 'user' && m.content === 'what time is it?')).toBe(true);
  });

  it('populates the assistant bubble from the final event', async () => {
    mockFetch.mockResolvedValueOnce(
      fakeSseResponse([{ type: 'final', data: { content: 'It is 5pm.' } }]),
    );
    const { result } = renderHook(() => useAssistant());
    await act(async () => {
      await result.current.send('what time is it?');
    });
    const assistant = result.current.messages.find((m) => m.role === 'assistant');
    expect(assistant?.content).toBe('It is 5pm.');
  });

  it('running is false after the stream finishes', async () => {
    mockFetch.mockResolvedValueOnce(
      fakeSseResponse([{ type: 'final', data: { content: 'Done.' } }]),
    );
    const { result } = renderHook(() => useAssistant());
    await act(async () => {
      await result.current.send('hi');
    });
    expect(result.current.running).toBe(false);
  });

  it('tool.start adds a chip with status running', async () => {
    mockFetch.mockResolvedValueOnce(
      fakeSseResponse([
        { type: 'tool.start', data: { id: 'tc1', name: 'list_features' } },
        { type: 'final', data: { content: 'Done.' } },
      ]),
    );
    const { result } = renderHook(() => useAssistant());
    await act(async () => {
      await result.current.send('check features');
    });
    expect(result.current.tools.some((t) => t.id === 'tc1' && t.name === 'list_features')).toBe(true);
  });

  it('tool.done marks the chip as done', async () => {
    mockFetch.mockResolvedValueOnce(
      fakeSseResponse([
        { type: 'tool.start', data: { id: 'tc1', name: 'list_features' } },
        { type: 'tool.done', data: { id: 'tc1', result: [] } },
        { type: 'final', data: { content: 'Done.' } },
      ]),
    );
    const { result } = renderHook(() => useAssistant());
    await act(async () => {
      await result.current.send('check features');
    });
    const chip = result.current.tools.find((t) => t.id === 'tc1');
    expect(chip?.status).toBe('done');
  });

  it('error event sets error state and stops running', async () => {
    mockFetch.mockResolvedValueOnce(
      fakeSseResponse([{ type: 'error', data: { message: 'The model took too long' } }]),
    );
    const { result } = renderHook(() => useAssistant());
    await act(async () => {
      await result.current.send('hi');
    });
    expect(result.current.error).toBe('The model took too long');
    expect(result.current.running).toBe(false);
  });

  it('fetch rejection sets error state', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const { result } = renderHook(() => useAssistant());
    await act(async () => {
      await result.current.send('hi');
    });
    expect(result.current.error).toBe('Network error');
    expect(result.current.running).toBe(false);
  });

  it('AbortError does NOT set error state', async () => {
    const abortErr = new DOMException('Aborted', 'AbortError');
    mockFetch.mockRejectedValueOnce(abortErr);
    const { result } = renderHook(() => useAssistant());
    await act(async () => {
      await result.current.send('hi');
    });
    expect(result.current.error).toBeNull();
    expect(result.current.running).toBe(false);
  });

  it('stop sets running to false', async () => {
    let resolveFetch;
    mockFetch.mockReturnValueOnce(new Promise((r) => { resolveFetch = r; }));
    const { result } = renderHook(() => useAssistant());
    act(() => { result.current.send('hi'); });
    await act(async () => { result.current.stop(); });
    expect(result.current.running).toBe(false);
    // Resolve to avoid unhandled promise rejection in the test.
    resolveFetch({ ok: false, body: null });
  });

  it('reset clears messages, tools, error, and running', async () => {
    mockFetch.mockResolvedValueOnce(
      fakeSseResponse([
        { type: 'error', data: { message: 'oops' } },
      ]),
    );
    const { result } = renderHook(() => useAssistant());
    await act(async () => { await result.current.send('hi'); });
    expect(result.current.messages.length).toBeGreaterThan(0);
    act(() => { result.current.reset(); });
    expect(result.current.messages).toEqual([]);
    expect(result.current.tools).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.running).toBe(false);
  });

  it('second send while running is ignored', async () => {
    let resolveFirst;
    mockFetch.mockReturnValueOnce(new Promise((r) => { resolveFirst = r; }));
    const { result } = renderHook(() => useAssistant());
    act(() => { result.current.send('first'); });
    // Running is now true - second send should be a no-op.
    await act(async () => { await result.current.send('second'); });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    resolveFirst({ ok: false, body: null });
  });
});

describe('useAssistant conversation and page hint', () => {
  const finalOnly = () => fakeSseResponse([{ type: 'final', data: { content: 'Ok.' } }]);
  const bodyOfCall = (i) => JSON.parse(mockFetch.mock.calls[i][1].body);

  it('creates a conversation on the first send only and reuses it', async () => {
    const routed = withConversations(mockFetch);
    vi.stubGlobal('fetch', routed);
    mockFetch.mockResolvedValueOnce(finalOnly());
    const { result } = renderHook(() => useAssistant());
    await act(async () => { await result.current.send('one', { page: 'settings' }); });
    mockFetch.mockResolvedValueOnce(finalOnly());
    await act(async () => { await result.current.send('two', { page: 'notes' }); });
    expect(routed.convCalls).toHaveLength(1);
    expect(bodyOfCall(0)).toEqual({ prompt: 'one', conversationId: 'conv-1', page: 'settings' });
    expect(bodyOfCall(1)).toEqual({ prompt: 'two', conversationId: 'conv-1', page: 'notes' });
  });

  it('sends only the page key, never a snapshot, and omits page when none is given', async () => {
    mockFetch.mockResolvedValueOnce(finalOnly());
    const { result } = renderHook(() => useAssistant());
    await act(async () => { await result.current.send('hello'); });
    expect(bodyOfCall(0)).toEqual({ prompt: 'hello', conversationId: 'conv-1' });
  });

  it('continues without a conversation when creating one fails', async () => {
    vi.stubGlobal('fetch', (url, init) =>
      String(url) === '/api/assistant/conversations' ? Promise.resolve({ ok: false, status: 503 }) : mockFetch(url, init),
    );
    mockFetch.mockResolvedValueOnce(finalOnly());
    const { result } = renderHook(() => useAssistant());
    await act(async () => { await result.current.send('hello', { page: 'home' }); });
    expect(bodyOfCall(0)).toEqual({ prompt: 'hello', page: 'home' });
    expect(result.current.messages.at(-1).content).toBe('Ok.');
  });

  it('gives messages ids and timestamps, and reset starts a fresh conversation', async () => {
    const routed = withConversations(mockFetch);
    vi.stubGlobal('fetch', routed);
    mockFetch.mockResolvedValueOnce(finalOnly());
    const { result } = renderHook(() => useAssistant());
    await act(async () => { await result.current.send('hello'); });
    for (const m of result.current.messages) {
      expect(typeof m.id).toBe('string');
      expect(typeof m.at).toBe('number');
    }
    act(() => { result.current.reset(); });
    mockFetch.mockResolvedValueOnce(finalOnly());
    await act(async () => { await result.current.send('again'); });
    expect(routed.convCalls).toHaveLength(2);
    expect(bodyOfCall(1).conversationId).toBe('conv-2');
  });

  it('records when a change request arrived', async () => {
    mockFetch.mockResolvedValueOnce(
      fakeSseResponse([
        { type: 'confirm.required', data: { token: 't1', name: 'save_record__crews', args: {}, summary: 'Add item' } },
        { type: 'final', data: { content: 'Waiting for you.' } },
      ]),
    );
    const { result } = renderHook(() => useAssistant());
    await act(async () => { await result.current.send('add milk'); });
    expect(typeof result.current.actions[0].at).toBe('number');
  });

  it('respond resolves to the final status and tool name', async () => {
    mockFetch.mockResolvedValueOnce(
      fakeSseResponse([{ type: 'confirm.required', data: { token: 't1', name: 'save_record__crews', args: {}, summary: 'Add item' } }]),
    );
    const { result } = renderHook(() => useAssistant());
    await act(async () => { await result.current.send('add milk'); });
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { name: 'save_record__crews', approved: true } }) });
    let out;
    await act(async () => { out = await result.current.respond('t1', true); });
    expect(out).toEqual({ status: 'approved', name: 'save_record__crews' });
  });
});
