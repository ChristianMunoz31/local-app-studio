import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAssistant } from '../useAssistant';
import { withConversations } from '../../test-utils/sseResponse';

function fakeSseResponse(events) {
  const body = events.map(({ type, data }) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`).join('');
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
afterEach(() => vi.unstubAllGlobals());

const CLOUD = { kind: 'cloud', host: 'api.example.com' };
const NOTICE_MESSAGE = "Your item notes aren't shared with cloud AI. You can change that in Settings > AI.";

const lastAssistant = (result) => [...result.current.messages].reverse().find((m) => m.role === 'assistant');

async function run(events) {
  mockFetch.mockResolvedValueOnce(fakeSseResponse(events));
  const { result } = renderHook(() => useAssistant());
  await act(async () => {
    await result.current.send('what did I write?', { page: 'items' });
  });
  return result;
}

describe('useAssistant cloud events', () => {
  it('stores the source from the meta event on the turn assistant message', async () => {
    const result = await run([
      { type: 'meta', data: { type: 'meta', ai: CLOUD } },
      { type: 'delta', data: { content: 'Hello' } },
      { type: 'final', data: { content: 'Hello there.' } },
      { type: 'run.done', data: { pending: 0 } },
    ]);
    const reply = lastAssistant(result);
    expect(reply.content).toBe('Hello there.');
    expect(reply.ai).toEqual(CLOUD);
    expect(reply.notice).toBeUndefined();
    expect(result.current.messages.find((m) => m.role === 'user').ai).toBeUndefined();
  });

  it('stores a notice with its message and categories', async () => {
    const result = await run([
      { type: 'meta', data: { type: 'meta', ai: CLOUD } },
      {
        type: 'notice',
        data: { type: 'notice', code: 'cloud_withheld', categories: ['features'], message: NOTICE_MESSAGE },
      },
      { type: 'final', data: { content: 'I cannot see your item notes.' } },
      { type: 'run.done', data: { pending: 0, ai: CLOUD } },
    ]);
    expect(lastAssistant(result).notice).toEqual({ message: NOTICE_MESSAGE, categories: ['features'] });
    expect(lastAssistant(result).content).toBe('I cannot see your item notes.');
  });

  it('keeps the notice when text streams in after it', async () => {
    const result = await run([
      { type: 'meta', data: { type: 'meta', ai: CLOUD } },
      { type: 'tool.start', data: { id: 't1', name: 'list_features' } },
      { type: 'tool.done', data: { id: 't1', result: { not_shared: true } } },
      { type: 'notice', data: { type: 'notice', code: 'cloud_withheld', categories: ['features'], message: NOTICE_MESSAGE } },
      { type: 'delta', data: { content: 'Sorry' } },
      { type: 'final', data: { content: 'Sorry, I cannot see that.' } },
    ]);
    const reply = lastAssistant(result);
    expect(reply.content).toBe('Sorry, I cannot see that.');
    expect(reply.notice.message).toBe(NOTICE_MESSAGE);
    expect(reply.ai).toEqual(CLOUD);
  });

  it('takes the source from run.done when no meta arrived', async () => {
    const result = await run([
      { type: 'final', data: { content: 'Hi.' } },
      { type: 'run.done', data: { pending: 0, ai: { kind: 'lan', host: 'nas.example.com' } } },
    ]);
    expect(lastAssistant(result).ai).toEqual({ kind: 'lan', host: 'nas.example.com' });
  });

  it('ignores malformed meta and notice payloads', async () => {
    const result = await run([
      { type: 'meta', data: { type: 'meta', ai: { kind: 'mystery', host: 'x' } } },
      { type: 'notice', data: { type: 'notice', categories: ['features'] } },
      { type: 'final', data: { content: 'Hi.' } },
    ]);
    const reply = lastAssistant(result);
    expect(reply.ai).toBeUndefined();
    expect(reply.notice).toBeUndefined();
  });

  it('a local run adds a local source and no notice', async () => {
    const result = await run([
      { type: 'meta', data: { type: 'meta', ai: { kind: 'local', host: null } } },
      { type: 'final', data: { content: 'Hi.' } },
    ]);
    expect(lastAssistant(result).ai).toEqual({ kind: 'local', host: null });
    expect(lastAssistant(result).notice).toBeUndefined();
  });
});
