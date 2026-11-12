import { useCallback, useEffect, useRef, useState } from 'react';
import { readSse } from '../utils/sse';
import { buildApiError, codeOf } from '../utils/apiError';
import { newId } from '../utils/ids';
import { asAiSource } from '../utils/aiSource';

// Friendly, human-readable labels for the tool chips shown while Assistant works.
const TOOL_LABELS = {
  list_features: 'Checking your features',
  // Runtime mode (a built app): the stream carries the per-table name, `<verb>__<table>`, so these match on the verb.
  describe_data: 'Looking at your data',
  list_records: 'Reading records',
  get_stats: 'Working out totals',
  save_record: 'Preparing a change',
};
export const toolLabel = (name) => {
  if (typeof name !== 'string') return 'Working on it';
  const verb = name.split('__', 1)[0];
  if (Object.hasOwn(TOOL_LABELS, name)) return TOOL_LABELS[name];
  return Object.hasOwn(TOOL_LABELS, verb) ? TOOL_LABELS[verb] : 'Working on it';
};

/**
 * Drives POST /api/assistant SSE streams into UI state for the Assistant panel. Keeps a running
 * transcript of user/assistant turns and the tool activity for the in-flight turn. A
 * server conversation is created lazily on the first send so confirmation tokens (which
 * are bound to a conversation) can be approved later.
 *
 * Returns: { messages, tools, actions, pendingCount, running, error, errorCode, errorReason, send, stop, reset, respond }
 *  - messages: { id, role: 'user'|'assistant', content, at, ai?, notice? }[]
 *              ai is { kind, host } from the `meta` event; notice is { message, categories } from
 *              the `notice` event (some data was not shared with cloud AI)
 *  - tools:    { id, name, status: 'running'|'done', result }[]  (current turn)
 *  - actions:  write requests waiting for Approve / Decline:
 *              { token, name, args, summary, at, status: 'pending'|'working'|'approved'|'declined'|'expired'|'error', result?, error? }[]
 *  - errorCode: structured code for `error` (ollama_unavailable, ai_not_configured, ai_busy), or null
 *  - errorReason: the 503 reason (e.g. ai_disabled), or null
 *  - send(input, { page }): `page` is a page key hint only; the page snapshot is never sent
 *  - respond(token, approve): resolves to { status, name } (status is the action's final status)
 *
 * Streaming: `delta` events grow the assistant bubble; `tool.start` clears that draft (the model
 * moved on to a tool call) and `final` replaces it with the authoritative text.
 */

const ACTION_ERRORS = {
  action_not_found: 'That request expired or was already handled. Ask Assistant again.',
  write_cap_reached: 'Assistant has reached its limit for changes in this chat. Start a new chat to continue.',
  pro_required: 'Assistant changes are part of Local App Studio Pro. Open Settings > License to start your trial or add a license.',
};
const ACTION_FALLBACK = "Couldn't complete that request. Try again.";

// Drop a trailing assistant bubble that never received any text (error or abort).
const dropEmptyAssistant = (prev) => {
  const last = prev[prev.length - 1];
  return last && last.role === 'assistant' && !last.content ? prev.slice(0, -1) : prev;
};

export function useAssistant() {
  const [messages, setMessages] = useState([]);
  const [tools, setTools] = useState([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  const [errorReason, setErrorReason] = useState(null);
  const [actions, setActions] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const controllerRef = useRef(null);
  const runningRef = useRef(false);
  const inFlightRef = useRef(new Set());
  const conversationRef = useRef(null);
  const tokenConvRef = useRef(new Map());

  useEffect(
    () => () => controllerRef.current?.abort(),
    [],
  );

  const send = useCallback(
    async (input, { page } = {}) => {
      const prompt = (input || '').trim();
      if (!prompt || running || runningRef.current) return;
      runningRef.current = true;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      setError(null);
      setErrorCode(null);
      setErrorReason(null);
      setTools([]);
      let draft = '';
      let failed = false;
      const at = Date.now();
      setMessages((prev) => [
        ...prev,
        { id: newId(), role: 'user', content: prompt, at },
        { id: newId(), role: 'assistant', content: '', at },
      ]);
      setRunning(true);

      const patchAssistant = (patch) =>
        setMessages((prev) => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].role === 'assistant') {
              next[i] = { ...next[i], ...patch };
              break;
            }
          }
          return next;
        });
      const setAssistant = (content) => patchAssistant({ content });

      try {
        if (!conversationRef.current) {
          // Best effort: without a conversation Assistant still answers and approvals still work;
          // what is lost is the server-side turn history.
          try {
            const created = await fetch('/api/assistant/conversations', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({}),
              signal: controller.signal,
            });
            const body = created.ok ? await created.json().catch(() => null) : null;
            if (typeof body?.id === 'string') conversationRef.current = body.id;
          } catch (err) {
            if (err?.name === 'AbortError') throw err;
          }
        }
        const conversationId = conversationRef.current;
        const res = await fetch('/api/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            ...(conversationId ? { conversationId } : {}),
            ...(page ? { page } : {}),
          }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const body = await res.json().catch(() => ({}));
          const failure = buildApiError(res, body);
          if (!failure.message || failure.message === res.statusText) {
            failure.message = `Request failed (${res.status})`;
          }
          throw failure;
        }
        await readSse(res, (event, payload) => {
          if (event === 'meta') {
            const ai = asAiSource(payload?.ai);
            if (ai) patchAssistant({ ai });
          } else if (event === 'notice') {
            if (typeof payload?.message === 'string' && payload.message) {
              patchAssistant({
                notice: {
                  message: payload.message,
                  categories: Array.isArray(payload.categories)
                    ? payload.categories.filter((c) => typeof c === 'string')
                    : [],
                },
              });
            }
          } else if (event === 'delta') {
            draft += payload.content || '';
            setAssistant(draft);
          } else if (event === 'tool.start') {
            draft = '';
            setAssistant('');
            setTools((prev) => [...prev, { id: payload.id, name: payload.name, status: 'running' }]);
          } else if (event === 'tool.done') {
            setTools((prev) =>
              prev.map((t) => (t.id === payload.id ? { ...t, status: 'done', result: payload.result } : t)),
            );
          } else if (event === 'final') {
            draft = payload.content || '';
            setAssistant(draft);
          } else if (event === 'confirm.required') {
            tokenConvRef.current.set(payload.token, { conversationId, name: payload.name });
            setActions((prev) => [
              ...prev,
              {
                token: payload.token,
                name: payload.name,
                args: payload.args ?? {},
                summary: payload.summary || toolLabel(payload.name),
                at: Date.now(),
                status: 'pending',
              },
            ]);
          } else if (event === 'run.done') {
            setPendingCount(Number(payload.pending) || 0);
            const ai = asAiSource(payload?.ai);
            if (ai) patchAssistant({ ai });
          } else if (event === 'error') {
            failed = true;
            setError(payload.message || 'Assistant failed');
            setErrorCode(payload.code ?? null);
            setErrorReason(payload.reason ?? null);
          }
        });
      } catch (err) {
        if (err.name === 'AbortError') {
          setMessages(dropEmptyAssistant);
        } else {
          failed = true;
          setError(err.message || 'Network error');
          setErrorCode(err.code ?? null);
          setErrorReason(err.reason ?? null);
        }
      } finally {
        if (failed && !draft) setMessages(dropEmptyAssistant);
        if (controllerRef.current === controller) {
          runningRef.current = false;
          setRunning(false);
        }
      }
    },
    [running],
  );

  const respond = useCallback(async (token, approve) => {
    if (inFlightRef.current.has(token)) return null;
    inFlightRef.current.add(token);
    const known = tokenConvRef.current.get(token) ?? {};
    const name = known.name ?? null;
    const update = (patch) =>
      setActions((prev) => prev.map((a) => (a.token === token ? { ...a, ...patch } : a)));
    update({ status: 'working', error: null });
    try {
      const res = await fetch(`/api/assistant/actions/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approve: approve === true,
          ...(known.conversationId ? { conversationId: known.conversationId } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = codeOf(body);
        if (res.status === 404 && code === 'action_not_found') {
          update({ status: 'expired', error: null });
          setPendingCount((n) => Math.max(0, n - 1));
          return { status: 'expired', name };
        }
        update({ status: 'error', error: ACTION_ERRORS[code] ?? ACTION_FALLBACK });
        return { status: 'error', name };
      }
      const approved = body?.data?.approved === true;
      update({ status: approved ? 'approved' : 'declined', result: body?.data?.result });
      setPendingCount((n) => Math.max(0, n - 1));
      return { status: approved ? 'approved' : 'declined', name };
    } catch {
      update({ status: 'error', error: ACTION_FALLBACK });
      return { status: 'error', name };
    } finally {
      inFlightRef.current.delete(token);
    }
  }, []);

  const stop = useCallback(() => {
    controllerRef.current?.abort();
    runningRef.current = false;
    setRunning(false);
  }, []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    runningRef.current = false;
    inFlightRef.current.clear();
    conversationRef.current = null;
    tokenConvRef.current.clear();
    setMessages([]);
    setTools([]);
    setActions([]);
    setPendingCount(0);
    setError(null);
    setErrorCode(null);
    setErrorReason(null);
    setRunning(false);
  }, []);

  return {
    messages,
    tools,
    actions,
    pendingCount,
    running,
    error,
    errorCode,
    errorReason,
    send,
    stop,
    reset,
    respond,
  };
}
