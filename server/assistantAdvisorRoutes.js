import { validateAdviceRequest } from './assistant/validateAdvice.js';
import { generateAdvice, streamAdvice } from './assistant/advisorService.js';
import { recordAudit } from './auditHook.js';
import { sendError, sseError } from './errors.js';
import { AiBusyError, aiAuditMeta, getAiClient, isAiQueueFull, openSse, sendAiError } from './ai/index.js';

const wantsStream = (req) => /\btext\/event-stream\b/i.test(String(req.get('accept') || ''));

/** Error body for a service error that carries a publicMessage. */
function errorBody(err) {
  return {
    error: err.publicMessage,
    code: typeof err.code === 'string' && err.code ? err.code : 'server_error',
    ...(typeof err.reason === 'string' ? { reason: err.reason } : {}),
    ...(Number.isFinite(err.retryAfterMs) ? { retryAfterMs: Math.min(Math.max(err.retryAfterMs, 0), 60000) } : {}),
  };
}

/**
 * POST /api/assistant/advice: page advice from Assistant. JSON { data } by default; with
 * `Accept: text/event-stream` it streams `delta` { content }, then `done` { content, model,
 * provider, ai, withheld, notice, blocked } (content is the full, sanitized answer) or `error`
 * { error, code, retryAfterMs? }. A `meta` { ai } event comes first. When a cloud client may not see
 * the page, `blocked` is true, no model is called, no deltas are sent and content is the notice.
 * AI that cannot run answers 503 JSON before any stream opens. Never echoes err.message or
 * request content.
 * @param {import('express').Express} app
 */
export function registerAssistantAdvisorRoutes(app) {
  app.post('/api/assistant/advice', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const v = validateAdviceRequest(req.body);
    if (!v.ok) return sendError(res, v.code, { status: v.status, message: v.error });

    let client;
    try {
      // When streaming, a full queue answers 429 now, before the stream opens.
      if (wantsStream(req) && isAiQueueFull()) throw new AiBusyError();
      client = await getAiClient({ purpose: 'chat' });
    } catch (err) {
      if (sendAiError(res, err)) return undefined;
      console.error('Assistant advice error:', err?.name || 'unknown');
      return sendError(res, 'server_error', { message: 'Failed to get advice' });
    }

    // Only the last user turn is logged next to the (already sanitized) page context.
    const lastUser = [...v.value.messages].reverse().find((m) => m.role === 'user');
    const question = lastUser ? lastUser.content : null;
    const started = Date.now();
    // Under cloud the audit row holds only what was actually sent (the filtered context),
    // never the unfiltered page snapshot.
    const audit = (status, sentContext) =>
      recordAudit({
        kind: 'llm',
        feature: 'assistant_advice',
        page: v.value.page,
        provider: client.provider,
        model: client.model,
        status,
        context: { context: client.isCloud ? (sentContext ?? '') : v.value.context, question },
        meta: { calls: client.stats.calls, ms: Date.now() - started, ...aiAuditMeta(client) },
      });
    const final = (out) => ({
      content: out.content,
      model: out.model,
      provider: out.provider,
      ai: out.ai,
      withheld: out.withheld,
      notice: out.notice,
      blocked: out.blocked,
    });

    if (wantsStream(req)) {
      const controller = new AbortController();
      let closed = false;
      res.on('close', () => {
        if (!res.writableFinished) {
          closed = true;
          controller.abort();
        }
      });
      const sse = openSse(res);
      sse.send('meta', { ai: client.ai });
      try {
        const out = await streamAdvice(v.value, {
          client,
          signal: controller.signal,
          onDelta: (content) => sse.send('delta', { content }),
        });
        await audit('ok', out.sentContext);
        sse.send('done', final(out));
      } catch (err) {
        await audit('error', err?.sentContext);
        if (!closed) {
          const { error: message, code, ...extra } =
            typeof err?.publicMessage === 'string'
              ? errorBody(err)
              : { error: 'Failed to get advice', code: 'server_error' };
          sse.send('error', sseError(code, { message, extra }));
        }
      } finally {
        sse.close();
      }
      return undefined;
    }

    // JSON mode: a client that goes away stops the model call and frees its queue slot.
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });
    try {
      const out = await generateAdvice(v.value, { client, signal: controller.signal });
      await audit('ok', out.sentContext);
      return res.json({ data: final(out) });
    } catch (err) {
      await audit('error', err?.sentContext);
      if (controller.signal.aborted) return undefined;
      if (sendAiError(res, err)) return undefined;
      // Only errors deliberately built by the service (they carry a publicMessage) are trusted.
      if (typeof err?.publicMessage !== 'string') {
        console.error('Assistant advice error:', err?.name || 'unknown');
        return sendError(res, 'server_error', { message: 'Failed to get advice' });
      }
      const status = Number.isInteger(err.httpStatus) && err.httpStatus >= 400 && err.httpStatus <= 599 ? err.httpStatus : 500;
      const { error: message, code, ...extra } = errorBody(err);
      return sendError(res, code, { status, message, extra });
    }
  });
}
