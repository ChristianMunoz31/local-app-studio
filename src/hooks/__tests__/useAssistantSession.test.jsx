import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAssistantSession } from '../useAssistantSession';

const mockFetch = vi.fn();
const readPageContext = vi.fn(() => ({ context: '{"page":"items"}' }));

const ok = (content) => ({ ok: true, status: 200, json: async () => ({ data: { content, model: 'm', provider: 'p' } }) });
const fail = (status, error, code) => ({ ok: false, status, json: async () => ({ error, code }) });

function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

const bodyOf = (call) => JSON.parse(call[1].body);

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
  readPageContext.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

const setup = () => renderHook(() => useAssistantSession({ readPageContext }));

describe('useAssistantSession', () => {
  it('requestAdvice posts page, context and no messages', async () => {
    mockFetch.mockResolvedValueOnce(ok('Do the thing'));
    const { result } = setup();
    await act(async () => result.current.requestAdvice('items'));
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/assistant/advice');
    expect(bodyOf(mockFetch.mock.calls[0])).toEqual({ page: 'items', context: '{"page":"items"}', messages: [] });
    const t = result.current.threadFor('items');
    expect(t.status).toBe('idle');
    expect(t.messages).toHaveLength(1);
    expect(t.messages[0]).toMatchObject({ role: 'assistant', content: 'Do the thing', auto: true });
  });

  it('sendMessage appends the user message and posts a window that ends with user', async () => {
    mockFetch.mockResolvedValue(ok('reply'));
    const { result } = setup();
    for (let i = 0; i < 10; i += 1) {
      await act(async () => result.current.sendMessage('items', `q${i}`));
    }
    const lastBody = bodyOf(mockFetch.mock.calls.at(-1));
    expect(lastBody.messages.length).toBeLessThanOrEqual(12);
    expect(lastBody.messages.at(-1)).toEqual({ role: 'user', content: 'q9' });
    expect(lastBody.messages.every((m, i, a) => i === 0 || m.role !== a[i - 1].role)).toBe(true);
  });

  it('keeps the posted payload under the total character cap with long turns', async () => {
    mockFetch.mockResolvedValue(ok('a'.repeat(4000)));
    const { result } = setup();
    for (let i = 0; i < 6; i += 1) {
      await act(async () => result.current.sendMessage('items', `question ${i}`));
    }
    for (const call of mockFetch.mock.calls) {
      const { messages } = bodyOf(call);
      expect(messages.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(16000);
      expect(messages.at(-1).role).toBe('user');
    }
    expect(bodyOf(mockFetch.mock.calls.at(-1)).messages.at(-1).content).toBe('question 5');
  });

  it('maps a 401 to the session-expired message', async () => {
    mockFetch.mockResolvedValueOnce(fail(401, 'Unauthorized'));
    const { result } = setup();
    await act(async () => result.current.requestAdvice('items'));
    expect(result.current.threadFor('items').error.message).toBe('Session expired. Please sign in again.');
  });

  it('ignores a second send while one is in flight', async () => {
    const d = deferred();
    mockFetch.mockReturnValueOnce(d.promise);
    const { result } = setup();
    act(() => {
      result.current.sendMessage('items', 'one');
      result.current.sendMessage('items', 'two');
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve(ok('done')));
  });

  it('keeps the user message on error and retry re-reads the context', async () => {
    mockFetch.mockResolvedValueOnce(fail(429, 'Slow down', 'rate_limited'));
    const { result } = setup();
    await act(async () => result.current.sendMessage('items', 'hello'));
    let t = result.current.threadFor('items');
    expect(t.status).toBe('error');
    expect(t.error).toMatchObject({ message: "Assistant couldn't answer (error 429). Try again.", code: 'rate_limited' });
    expect(t.messages.at(-1)).toMatchObject({ role: 'user', content: 'hello' });

    readPageContext.mockReturnValueOnce({ context: '{"fresh":true}' });
    mockFetch.mockResolvedValueOnce(ok('now ok'));
    await act(async () => result.current.retry('items'));
    const body = bodyOf(mockFetch.mock.calls.at(-1));
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(body.context).toBe('{"fresh":true}');
    t = result.current.threadFor('items');
    expect(t.status).toBe('idle');
    expect(t.error).toBeNull();
    expect(t.messages.at(-1)).toMatchObject({ role: 'assistant', content: 'now ok' });
  });

  it('reports network failures with a friendly message', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { result } = setup();
    await act(async () => result.current.requestAdvice('items'));
    expect(result.current.threadFor('items').error).toMatchObject({ code: 'network' });
  });

  it('aborting an auto-advice leaves no error state', async () => {
    mockFetch.mockImplementationOnce(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const { result } = setup();
    act(() => result.current.requestAdvice('items'));
    expect(result.current.threadFor('items').status).toBe('loading');
    act(() => result.current.abortAll());
    await waitFor(() => expect(result.current.threadFor('items').status).toBe('idle'));
    expect(result.current.threadFor('items').error).toBeNull();
  });

  it('lands the result on the requested page key', async () => {
    const d = deferred();
    mockFetch.mockReturnValueOnce(d.promise);
    const { result } = setup();
    act(() => result.current.requestAdvice('items'));
    await act(async () => d.resolve(ok('for items')));
    expect(result.current.threadFor('items').messages).toHaveLength(1);
    expect(result.current.threadFor('settings').messages).toHaveLength(0);
  });

  it('does not call the LLM on its own', () => {
    setup();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
