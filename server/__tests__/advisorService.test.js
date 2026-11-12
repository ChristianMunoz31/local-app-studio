// Assistant page advisor service on the local chat model: one call, no fallback, user-safe error
// mapping, output sanitizing, context clipping, and token streaming. A fake AiClient is passed
// in, so nothing here touches Ollama.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../profile.js', () => ({ getDisplayName: vi.fn(async () => 'Sam') }));

import { ADVICE_MAX_TOKENS, ADVICE_TEMPERATURE, generateAdvice, streamAdvice } from '../assistant/advisorService.js';
import { AiBusyError, AiUnavailableError } from '../ai/gate.js';

const input = {
  page: 'items',
  pageLabel: 'Items',
  context: '{"today":"2026-06-01","spend":1234.5}',
  messages: [{ role: 'user', content: 'How am I doing?' }],
};

function fakeClient({ content = 'Looks fine.', tokens, error, numCtx = 8192 } = {}) {
  const client = {
    provider: 'ollama',
    model: 'qwen2.5:3b',
    purpose: 'chat',
    numCtx,
    stats: { calls: 0 },
    complete: vi.fn(async () => {
      client.stats.calls += 1;
      if (error) throw error;
      return { content, usage: null, model: 'qwen2.5:3b' };
    }),
    stream: vi.fn(async function* stream() {
      client.stats.calls += 1;
      for (const t of tokens || [content]) yield { type: 'token', text: t };
      if (error) throw error;
      yield { type: 'done', usage: null, finishReason: 'stop' };
    }),
  };
  return client;
}

let errors;
beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.APP_AI;
});

describe('generateAdvice', () => {
  it('makes one call with the advisor messages, 1200 tokens and the advice temperature', async () => {
    const client = fakeClient();
    const out = await generateAdvice(input, { client });
    expect(out).toMatchObject({ content: 'Looks fine.', model: 'qwen2.5:3b', provider: 'ollama', calls: 1, ai: { kind: 'local', host: null }, withheld: [], notice: null, blocked: false });
    expect(client.complete).toHaveBeenCalledTimes(1);
    const args = client.complete.mock.calls[0][0];
    expect(args.maxTokens).toBe(ADVICE_MAX_TOKENS);
    expect(args.temperature).toBe(ADVICE_TEMPERATURE);
    expect(args.messages[0].role).toBe('system');
    expect(args.messages[0].content).toContain("The user's name is Sam.");
    expect(args.messages[1].content).toContain('"spend":1234.5');
    expect(args.messages[1].content).toContain('How am I doing?');
    expect(args).not.toHaveProperty('tools');
  });

  it('resolves the chat client itself when none is passed (AI off -> AiUnavailableError)', async () => {
    process.env.APP_AI = '0';
    const err = await generateAdvice(input).catch((e) => e);
    expect(err).toBeInstanceOf(AiUnavailableError);
    expect(err.code).toBe('ai_not_configured');
  });

  it('clips the page context to the model budget before fencing it', async () => {
    const client = fakeClient({ numCtx: 2048 });
    await generateAdvice({ ...input, context: 'x'.repeat(50_000) }, { client });
    const user = client.complete.mock.calls[0][0].messages[1].content;
    expect(user.length).toBeLessThan(5000);
  });

  it('strips dashes and normalizes dollar amounts in the reply', async () => {
    const out = await generateAdvice(input, { client: fakeClient({ content: '- Kitchen \u2014 $1234.5 this month\n- Tools: $-50' }) });
    expect(out.content).toBe('- Kitchen, $1,234.50 this month\n- Tools: -$50');
  });

  it.each([
    ['empty content', '', 502, 'empty_response'],
    ['dash-only content', '\u2014', 502, 'empty_response'],
  ])('%s -> %s', async (_label, content, status, code) => {
    const err = await generateAdvice(input, { client: fakeClient({ content }) }).catch((e) => e);
    expect(err).toMatchObject({ httpStatus: status, code });
    expect(typeof err.publicMessage).toBe('string');
  });

  it('maps a timeout to 504 timeout', async () => {
    const error = Object.assign(new Error('x'), { code: 'timeout', isTimeout: true });
    const err = await generateAdvice(input, { client: fakeClient({ error }) }).catch((e) => e);
    expect(err).toMatchObject({ httpStatus: 504, code: 'timeout', publicMessage: 'Assistant took too long to answer. Try again.' });
  });

  it('maps a cloud 429 to provider_rate_limited with a clamped retry hint', async () => {
    const error = Object.assign(new Error('429'), { httpStatus: 429, retryAfterMs: 999_999 });
    const err = await generateAdvice(input, { client: fakeClient({ error }) }).catch((e) => e);
    expect(err).toMatchObject({ httpStatus: 429, code: 'provider_rate_limited', retryAfterMs: 60000 });
  });

  it('passes availability and busy errors through unchanged', async () => {
    const down = new AiUnavailableError('ollama_unavailable', 'down');
    expect(await generateAdvice(input, { client: fakeClient({ error: down }) }).catch((e) => e)).toBe(down);
    const busy = new AiBusyError();
    expect(await generateAdvice(input, { client: fakeClient({ error: busy }) }).catch((e) => e)).toBe(busy);
  });

  it('never logs or exposes provider text, context or messages', async () => {
    const error = Object.assign(new Error('UPSTREAM gsk_LEAKYLEAKYLEAKYLEAKY1234'), { httpStatus: 500, body: 'SECRET-BODY' });
    const err = await generateAdvice({ ...input, context: 'CONTEXT-SENTINEL' }, { client: fakeClient({ error }) }).catch((e) => e);
    expect(err).toMatchObject({ httpStatus: 502, code: 'upstream_error' });
    const logged = JSON.stringify(errors.mock.calls);
    for (const s of ['LEAKY', 'SECRET-BODY', 'CONTEXT-SENTINEL', 'How am I doing']) {
      expect(logged).not.toContain(s);
      expect(err.publicMessage).not.toContain(s);
    }
  });

  it('logs nothing on success', async () => {
    await generateAdvice(input, { client: fakeClient() });
    expect(errors).not.toHaveBeenCalled();
  });
});

describe('streamAdvice', () => {
  it('streams sanitized deltas whose concatenation equals the final content', async () => {
    const tokens = ['Kitchen', ' is ', '$1234', '.5 \u2014', ' trim', ' it.'];
    const deltas = [];
    const out = await streamAdvice(input, { client: fakeClient({ tokens }), onDelta: (t) => deltas.push(t) });
    expect(out.content).toBe('Kitchen is $1,234.50, trim it.');
    expect(deltas.join('').trim()).toBe(out.content);
    expect(out).toMatchObject({ model: 'qwen2.5:3b', provider: 'ollama' });
  });

  it('maps a mid-stream failure like generateAdvice', async () => {
    const error = Object.assign(new Error('x'), { code: 'timeout', isTimeout: true });
    const err = await streamAdvice(input, { client: fakeClient({ tokens: ['partial'], error }) }).catch((e) => e);
    expect(err).toMatchObject({ httpStatus: 504, code: 'timeout' });
  });

  it('an empty stream is empty_response', async () => {
    const err = await streamAdvice(input, { client: fakeClient({ tokens: ['  '] }) }).catch((e) => e);
    expect(err).toMatchObject({ httpStatus: 502, code: 'empty_response' });
  });
});
