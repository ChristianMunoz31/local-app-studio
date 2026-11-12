// Client for the Assistant page advisor: POST /api/assistant/advice. Asks for an SSE stream
// (`delta`, `done`, `error`) and falls back to the plain JSON body when the server answers
// with anything else.
import { AI_BUSY, AI_BUSY_MESSAGE, codeOf, errorText } from '../utils/apiError';
import { readSse } from '../utils/sse';
import { asAiSource } from '../utils/aiSource';

/** @typedef {'user'|'assistant'} AssistantRole */
/** @typedef {{ role: AssistantRole, content: string }} WireMessage */
/** @typedef {{ page: string, context: string, messages: WireMessage[] }} AdviceRequest */
/** @typedef {{ kind: 'local'|'lan'|'cloud', host: string|null }} AiSource */
/** @typedef {{ content: string, model: string, provider: string, ai: AiSource|null,
 *   withheld: string[], notice: string|null, blocked: boolean }} AdviceResult */
/** @typedef {{ data: AdviceResult }} AdviceSuccess */
/** @typedef {{ error: string, code: string, reason?: string, retryAfterMs?: number }} AdviceFailure */
/** @typedef {{ id: string, role: AssistantRole, content: string, auto?: boolean }} AssistantMessage */

const fail = (message, extra) => Object.assign(new Error(message), extra);

// Fields added by the cloud safeguards; older servers omit them, so every one has a safe default.
const cloudFields = (payload, fallbackAi = null) => ({
  ai: asAiSource(payload?.ai) ?? fallbackAi,
  withheld: Array.isArray(payload?.withheld) ? payload.withheld.filter((c) => typeof c === 'string') : [],
  notice: typeof payload?.notice === 'string' && payload.notice ? payload.notice : null,
  blocked: payload?.blocked === true,
});

const isSse = (res) => (res.headers?.get?.('content-type') ?? '').includes('text/event-stream');

/**
 * @param {{ page: string, context: string, messages: WireMessage[], signal?: AbortSignal,
 *   onDelta?: (textSoFar: string) => void }} input
 * onDelta receives the full text received so far each time a delta arrives.
 * @returns {Promise<AdviceResult>}
 */
export async function requestAssistantAdvice({ page, context, messages, signal, onDelta }) {
  let res;
  try {
    res = await fetch('/api/assistant/advice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ page, context, messages }),
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw fail("Couldn't reach Assistant. Check your connection.", { code: 'network', status: 0 });
  }

  if (res.ok && res.body && isSse(res)) return readAdviceStream(res, onDelta);

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw fail(errorText(body, `Assistant couldn't answer (error ${res.status}). Try again.`), {
      status: res.status,
      code: codeOf(body) ?? 'http_error',
      reason: typeof body?.reason === 'string' ? body.reason : null,
      retryAfterMs: body?.retryAfterMs ?? null,
    });
  }
  if (typeof body?.data?.content !== 'string') {
    throw fail("Assistant sent back something unreadable. Try again.", { status: res.status, code: 'bad_response' });
  }
  return { ...body.data, ...cloudFields(body.data) };
}

async function readAdviceStream(res, onDelta) {
  let text = '';
  let result = null;
  let failure = null;
  let metaAi = null;
  try {
    await readSse(res, (event, payload) => {
      if (event === 'meta') {
        metaAi = asAiSource(payload?.ai);
      } else if (event === 'delta') {
        if (typeof payload?.content === 'string' && payload.content) {
          text += payload.content;
          onDelta?.(text);
        }
      } else if (event === 'done') {
        result = {
          content: typeof payload?.content === 'string' ? payload.content : text,
          model: payload?.model ?? '',
          provider: payload?.provider ?? '',
          ...cloudFields(payload, metaAi),
        };
      } else if (event === 'error') {
        const code = payload?.code || 'stream_error';
        failure = fail(
          code === AI_BUSY
            ? AI_BUSY_MESSAGE
            : payload?.error || payload?.message || "Assistant couldn't answer. Try again.",
          { status: 200, code, reason: payload?.reason ?? null, retryAfterMs: payload?.retryAfterMs ?? null },
        );
      }
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw fail("Assistant's answer was cut off. Try again.", { status: 200, code: 'stream_error' });
  }
  if (failure) throw failure;
  if (result) return result;
  throw fail("Assistant's answer was cut off. Try again.", { status: 200, code: 'stream_error' });
}
