// Assistant page advisor: one model call on the local chat model (server/ai), either as a
// single JSON answer (generateAdvice) or streamed token by token (streamAdvice).
// There is no fallback to another model or provider.
//
// Cloud AI: under a cloud client the page is first filtered by applyPagePolicy (categories the
// user did not share never reach the prompt; a page whose own category is withheld makes no
// model call at all). other callers pass their own `scope` and filter before calling.
//
// Logging contract: only the error class and scope are ever logged. Never err.message
// (it may echo provider text), messages, or context.
import {
  AiBusyError,
  AiUnavailableError,
  CloudScopeError,
  MSG_CLOUD_DISABLED,
  applyPagePolicy,
  classifyAiError,
  contextBudgetChars,
  createStreamSanitizer,
  createAiPolicy,
  getAiClient,
  sanitizeModelText,
  withheldMessage,
} from '../ai/index.js';
import { buildAdvisorMessages } from './advisorPrompt.js';
import { getDisplayName } from '../profile.js';

export const ADVICE_MAX_TOKENS = 1200;
export const ADVICE_TEMPERATURE = 0.4;
/** Upper bound for the retry hint surfaced to the client. */
export const RETRY_AFTER_MAX_MS = 60000;
/** Rough size of the advisor system prompt plus fence, reserved before clipping the page context. */
const PROMPT_RESERVE_CHARS = 3500;

const MSG_TIMEOUT = 'Assistant took too long to answer. Try again.';
const MSG_EMPTY = 'Assistant came back empty. Try again.';

/**
 * Build a user-safe error the route can pass straight through.
 * @param {number} httpStatus HTTP status for the response.
 * @param {string} code Machine-readable error code.
 * @param {string} publicMessage Fixed, user-safe message.
 * @param {number|null} [retryAfterMs] Optional retry hint in ms, clamped to [0, RETRY_AFTER_MAX_MS].
 * @returns {Error & { httpStatus: number, code: string, publicMessage: string, retryAfterMs?: number }}
 */
function adviceError(httpStatus, code, publicMessage, retryAfterMs) {
  const err = new Error(publicMessage);
  err.name = 'AssistantAdviceError';
  err.httpStatus = httpStatus;
  err.code = code;
  err.publicMessage = publicMessage;
  const retry = Number(retryAfterMs);
  if (retryAfterMs != null && Number.isFinite(retry)) {
    err.retryAfterMs = Math.min(RETRY_AFTER_MAX_MS, Math.max(0, Math.round(retry)));
  }
  return err;
}

/**
 * Map a failed model call to a user-safe error. AI availability errors pass through.
 * @param {unknown} err
 * @returns {Error}
 */
export function mapAdviceFailure(err) {
  if (err instanceof AiUnavailableError || err instanceof AiBusyError) return err;
  if (err instanceof CloudScopeError) {
    return adviceError(403, err.code, err.code === 'cloud_disabled' ? MSG_CLOUD_DISABLED : withheldMessage(err.categories));
  }
  if (err?.code === 'empty_response') return adviceError(502, 'empty_response', MSG_EMPTY);
  const c = classifyAiError(err);
  console.error('Assistant advice failed:', err?.name || 'unknown', c.code);
  if (c.code === 'minute' || c.code === 'day') return adviceError(429, 'provider_rate_limited', c.message, c.retryMs);
  if (c.code === 'timeout') return adviceError(504, 'timeout', MSG_TIMEOUT);
  if (c.code === 'model_missing') return adviceError(502, 'model_missing', c.message);
  return adviceError(502, 'upstream_error', c.message);
}

const LOCAL_AI = Object.freeze({ kind: 'local', host: null });

/**
 * Resolve the client, apply the page policy and build the prompt. `options.scope` (cross
 * insights) means the caller already filtered the context, so the page policy is skipped.
 * @returns {Promise<{ ai: object, messages?: object[], scope: object, withheld: string[], blocked: boolean, sentContext: string }>}
 */
async function prepare(input, client, { scope } = {}) {
  const ai = client || (await getAiClient({ purpose: 'chat' }));
  const policy = ai.policy ?? createAiPolicy({ isCloud: false });
  let context = String(input.context || '');
  let history = input.messages || [];
  let callScope = scope ?? { categories: [] };
  let withheld = scope?.withheld ? [...scope.withheld] : [];
  if (!scope && policy.isCloud) {
    const applied = applyPagePolicy({ page: input.page, context, messages: history }, policy);
    ai.noteWithheld?.(applied.withheld);
    if (!applied.allowed) return { ai, scope: callScope, withheld: applied.withheld, blocked: true, sentContext: '' };
    context = applied.context;
    history = applied.messages;
    withheld = applied.withheld;
    callScope = { categories: applied.categories, withheld: applied.withheld };
  }
  const historyChars = history.reduce((n, m) => n + String(m.content || '').length, 0);
  const budget = contextBudgetChars(ai, { maxTokens: ADVICE_MAX_TOKENS, reserveChars: PROMPT_RESERVE_CHARS + historyChars, minChars: 500 });
  const sentContext = context.slice(0, budget);
  const messages = buildAdvisorMessages({
    pageLabel: input.pageLabel,
    context: sentContext,
    messages: history,
    displayName: await getDisplayName(),
  });
  return { ai, messages, scope: callScope, withheld, blocked: false, sentContext };
}

/** Result for a page whose own category is withheld: fixed copy, no model call. */
function blockedResult(prep) {
  const content = withheldMessage(prep.withheld);
  return {
    content,
    model: prep.ai.model,
    provider: prep.ai.provider,
    calls: 0,
    ai: prep.ai.ai ?? LOCAL_AI,
    withheld: prep.withheld,
    notice: content,
    blocked: true,
    sentContext: '',
  };
}

const okResult = (prep, content) => ({
  content,
  model: prep.ai.model,
  provider: prep.ai.provider,
  calls: prep.ai.stats?.calls ?? 1,
  ai: prep.ai.ai ?? LOCAL_AI,
  withheld: prep.withheld,
  notice: prep.withheld.length ? withheldMessage(prep.withheld) : null,
  blocked: false,
  sentContext: prep.sentContext,
});

/** Map a failure and tell the route which context was actually sent (for the audit row). */
function failure(err, prep) {
  const mapped = mapAdviceFailure(err);
  if (mapped !== null && typeof mapped === 'object') mapped.sentContext = prep.sentContext;
  return mapped;
}

/**
 * Generate page advice (or a follow-up answer) as one JSON reply.
 * @param {{ page: string, pageLabel: string, context: string, messages: Array<{ role: 'user'|'assistant', content: string }> }} input
 *   The validated request value from `validateAdviceRequest`.
 * @param {{ client?: object, signal?: AbortSignal, scope?: { categories: string[], withheld?: string[] } }} [options]
 *   `client` is a chat AiClient (resolved when omitted). `scope` skips the page policy (the caller filtered).
 * @returns {Promise<{ content: string, model: string, provider: string, calls: number, ai: { kind: string, host: string|null },
 *   withheld: string[], notice: string|null, blocked: boolean, sentContext: string }>}
 * @throws {AiUnavailableError | AiBusyError | Error & { httpStatus: number, code: string, publicMessage: string }}
 */
export async function generateAdvice(input, { client, signal, scope } = {}) {
  const prep = await prepare(input, client, { scope });
  if (prep.blocked) return blockedResult(prep);
  try {
    const result = await prep.ai.complete({
      messages: prep.messages,
      maxTokens: ADVICE_MAX_TOKENS,
      temperature: ADVICE_TEMPERATURE,
      signal,
      scope: prep.scope,
    });
    const content = sanitizeModelText(typeof result?.content === 'string' ? result.content : '').trim();
    if (!content) throw Object.assign(new Error('empty response'), { code: 'empty_response' });
    return okResult(prep, content);
  } catch (err) {
    throw failure(err, prep);
  }
}

/**
 * Stream page advice. `onDelta` receives sanitized text as it becomes safe to show; the
 * resolved content is the full sanitized answer (authoritative).
 * @param {Parameters<typeof generateAdvice>[0]} input
 * @param {{ client?: object, signal?: AbortSignal, onDelta?: (text: string) => void, scope?: { categories: string[], withheld?: string[] } }} [options]
 * @returns {Promise<Awaited<ReturnType<typeof generateAdvice>>>} A blocked page resolves at once with no deltas.
 */
export async function streamAdvice(input, { client, signal, onDelta, scope } = {}) {
  const prep = await prepare(input, client, { scope });
  if (prep.blocked) return blockedResult(prep);
  const sanitizer = createStreamSanitizer();
  let raw = '';
  const emit = (text) => {
    if (text) onDelta?.(text);
  };
  try {
    for await (const ev of prep.ai.stream({
      messages: prep.messages,
      maxTokens: ADVICE_MAX_TOKENS,
      temperature: ADVICE_TEMPERATURE,
      signal,
      scope: prep.scope,
    })) {
      if (ev.type !== 'token') continue;
      raw += ev.text;
      emit(sanitizer.push(ev.text));
    }
    emit(sanitizer.flush());
    const content = sanitizeModelText(raw).trim();
    if (!content) throw Object.assign(new Error('empty response'), { code: 'empty_response' });
    return okResult(prep, content);
  } catch (err) {
    throw failure(err, prep);
  }
}
