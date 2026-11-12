import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestAssistantAdvice } from '../assistantService';
import { jsonResponse, sseEvent, sseResponse } from '../../test-utils/sseResponse';

const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const input = { page: 'home', context: 'ctx', messages: [] };

describe('requestAssistantAdvice streaming', () => {
  it('asks for an event stream', async () => {
    mockFetch.mockResolvedValueOnce(
      sseResponse([sseEvent('done', { content: 'x', model: 'm', provider: 'ollama' })]),
    );
    await requestAssistantAdvice(input);
    expect(mockFetch.mock.calls[0][1].headers.Accept).toBe('text/event-stream');
  });

  it('reports progressive text and replaces it with the authoritative done content', async () => {
    mockFetch.mockResolvedValueOnce(
      sseResponse([
        sseEvent('delta', { content: 'You have ' }),
        sseEvent('delta', { content: '3 items' }),
        sseEvent('done', { content: 'You have 3 items.', model: 'qwen2.5:3b', provider: 'ollama' }),
      ]),
    );
    const seen = [];
    const out = await requestAssistantAdvice({ ...input, onDelta: (t) => seen.push(t) });
    expect(seen).toEqual(['You have ', 'You have 3 items']);
    expect(out).toEqual({
      content: 'You have 3 items.',
      model: 'qwen2.5:3b',
      provider: 'ollama',
      ai: null,
      withheld: [],
      notice: null,
      blocked: false,
    });
  });

  it('rejects with the error event code and retry hint', async () => {
    mockFetch.mockResolvedValueOnce(
      sseResponse([
        sseEvent('delta', { content: 'part' }),
        sseEvent('error', { error: 'The model took too long.', code: 'timeout', retryAfterMs: 5000 }),
      ]),
    );
    await expect(requestAssistantAdvice(input)).rejects.toMatchObject({
      message: 'The model took too long.',
      code: 'timeout',
      retryAfterMs: 5000,
    });
  });

  it('falls back to the JSON body when the response is not an event stream', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ data: { content: 'Plain answer', model: 'm', provider: 'ollama' } }),
    );
    const out = await requestAssistantAdvice(input);
    expect(out.content).toBe('Plain answer');
  });

  it('keeps the structured code for a 503 before any stream starts', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: 'ollama_unavailable', message: 'Assistant cannot reach Ollama.' }, 503),
    );
    await expect(requestAssistantAdvice(input)).rejects.toMatchObject({
      status: 503,
      code: 'ollama_unavailable',
      message: 'Assistant cannot reach Ollama.',
    });
  });

  it('rejects when the stream ends without a done event', async () => {
    mockFetch.mockResolvedValueOnce(sseResponse([sseEvent('delta', { content: 'cut' })]));
    await expect(requestAssistantAdvice(input)).rejects.toMatchObject({ code: 'stream_error' });
  });
});
