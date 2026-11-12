import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowUp, CheckSquare, Loader2, MessageSquarePlus, RefreshCw, X } from 'lucide-react';
import { Skeleton } from '../shared/Skeleton';
import { ASSISTANT_MAX_INPUT_CHARS } from '../../constants/assistantPages';
import { errorWaitMs } from './retryWait';
import AssistantMessage from './AssistantMessage';
import ConfirmActionCard from './ConfirmActionCard';
import AiSourceBadge from './AiSourceBadge';
import WithheldNotice from './WithheldNotice';
import CloudHint from './CloudHint';
import { EMPTY_AGENT, buildTimeline } from './timeline';
import { toolLabel } from '../../hooks/useAssistant';
import { useAssistantStatus } from '../../hooks/useAssistantStatus';
import AiUnavailable from '../shared/AiUnavailable';
import { AI_NOT_CONFIGURED, OLLAMA_UNAVAILABLE } from '../../utils/apiError';
import { stripDashes } from '../../utils/assistantDashes';

const PANEL_CLASS =
  'glass-assistant fixed z-40 inset-x-0 bottom-0 flex max-h-[85dvh] flex-col overflow-hidden rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))] motion-safe:animate-overlay-in sm:inset-x-auto sm:right-4 sm:bottom-20 sm:w-[24rem] sm:max-h-[min(40rem,calc(100dvh-7rem))] sm:rounded-2xl sm:pb-0';

const ICON_BTN =
  'glass-assistant-chip flex h-9 w-9 max-sm:h-11 max-sm:w-11 items-center justify-center rounded-full text-slate-slate400 hover:text-slate-slate100 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:[outline-color:var(--focus-ring)]';

const noop = () => {};

function ThinkingSkeleton() {
  return (
    <div aria-hidden="true" className="glass-assistant-inner w-5/6 space-y-2 rounded-lg px-3 py-3">
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  );
}

// The notice is a string on advice replies and { message, categories } on chat replies.
const noticeText = (notice) => (typeof notice === 'string' ? notice : notice?.message || null);

// One reply or question. A blocked advice reply is a notice (nothing was sent anywhere), never
// an error. A cloud reply carries a small badge so the user can see where it was computed.
function TimelineMessage({ message }) {
  const isAssistant = message.role === 'assistant';
  const notice = isAssistant ? noticeText(message.notice) : null;
  if (isAssistant && message.blocked) {
    return <WithheldNotice message={notice ?? message.content} />;
  }
  return (
    <div>
      <AssistantMessage role={message.role} content={message.content} />
      {isAssistant && message.ai?.kind === 'cloud' && <AiSourceBadge ai={message.ai} className="mt-1" />}
      {notice && <WithheldNotice message={notice} className="mt-1.5" />}
    </div>
  );
}

// Ticks once a second only while a retry-after window is open so the Retry button re-enables.
function useRetryWait(error) {
  const [now, setNow] = useState(() => Date.now());
  // `now` can predate the error (state is only refreshed by the tick), so clamp it.
  const waitMs = error ? errorWaitMs(error, Math.max(now, error.at ?? 0)) : 0;
  const waiting = waitMs > 0;
  useEffect(() => {
    if (!error || !waiting) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [error, waiting]);
  return waitMs;
}

/**
 * Non-modal dialog: no overlay, no scroll lock, no focus trap. Escape is handled on the
 * panel itself so it cannot fight Modal's document-level handling.
 *
 * One scroll holds both page advice (`thread`, from useAssistantSession) and free-form turns with
 * their change requests (`agent`, from useAssistant). Typed questions go to `onSend`; the
 * suggestion chips go to `onSuggestion` (advice).
 * @param {{ id: string, pageKey: string, pageLabel: string, thread: object, suggestions: readonly string[],
 *   agent?: object, prefill?: { id: number, text: string } | null,
 *   onSend: (text: string) => void, onSuggestion?: (text: string) => void, onNewAdvice: () => void,
 *   onRetry: () => void, onRespond?: (token: string, approve: boolean) => void, onNewChat?: () => void,
 *   onClose: (options?: { restoreFocus?: boolean }) => void }} props
 */
export default function AssistantPanel({
  id,
  pageKey,
  pageLabel,
  thread,
  suggestions,
  agent = EMPTY_AGENT,
  prefill = null,
  onSend,
  onSuggestion = onSend,
  onNewAdvice,
  onRetry,
  onRespond = noop,
  onNewChat = noop,
  onClose,
}) {
  const titleId = useId();
  const aboutId = useId();
  const { status } = useAssistantStatus();
  // The hint is latched when it first appears so it stays for this panel session even after the
  // status query learns it was shown.
  const [hint, setHint] = useState('idle');
  if (hint === 'idle' && status?.cloudHint?.show === true) setHint('visible');
  const inputRef = useRef(null);
  const endRef = useRef(null);
  const [draft, setDraft] = useState(prefill?.text ?? '');
  // A prefill (a question typed while Assistant was busy) replaces the draft once per prefill id.
  const [seenPrefill, setSeenPrefill] = useState(prefill?.id ?? null);
  if (prefill && prefill.id !== seenPrefill) {
    setSeenPrefill(prefill.id);
    setDraft(prefill.text);
  }
  const advising = thread.status === 'loading';
  const loading = advising || agent.running;
  const timeline = useMemo(() => buildTimeline(thread, agent), [thread, agent]);
  const pendingAction = agent.actions.some((a) => a.status === 'pending');
  const waitMs = useRetryWait(thread.error);
  const waitSecs = Math.ceil(waitMs / 1000);
  const hasUserMessage = timeline.some((i) => i.kind === 'message' && i.message.role === 'user');
  // While AI cannot run, the chips would only fail again; Retry is the one action offered.
  const aiUnavailable =
    thread.error?.code === OLLAMA_UNAVAILABLE ||
    thread.error?.code === AI_NOT_CONFIGURED ||
    agent.errorCode === OLLAMA_UNAVAILABLE ||
    agent.errorCode === AI_NOT_CONFIGURED;
  const agentUnavailable = agent.errorCode === OLLAMA_UNAVAILABLE || agent.errorCode === AI_NOT_CONFIGURED;
  const lastItem = timeline[timeline.length - 1];
  const lastAssistant = lastItem?.kind === 'message' && lastItem.message.role === 'assistant' ? lastItem.message : null;
  const lastAgentAssistant = [...agent.messages].reverse().find((m) => m.role === 'assistant');
  const agentReplyLength = lastAgentAssistant?.content?.length ?? 0;
  const agentWaiting = agent.running && !lastAgentAssistant?.content;
  // Last assistant message already on screen (seeded, and re-seeded when the page changes), so
  // only a reply that arrives afterwards is read out, never another page's old reply.
  const [announced, setAnnounced] = useState({ pageKey, id: lastAssistant?.id ?? null });
  if (announced.pageKey !== pageKey) setAnnounced({ pageKey, id: lastAssistant?.id ?? null });
  const freshReply =
    !loading && lastAssistant && !lastAssistant.blocked && announced.pageKey === pageKey && lastAssistant.id !== announced.id
      ? lastAssistant.content
      : null;
  const replyAnnouncement = useMemo(() => {
    if (freshReply === null) return '';
    const plain = stripDashes(freshReply)
      .replace(/^[ \t]*- /gm, '')
      .replace(/[*_#>|`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return plain ? `Assistant said: ${plain}` : 'Assistant replied.';
  }, [freshReply]);
  // Single live region: announces only Assistant (thinking, then a new reply), never the user's own message.
  const announcement = loading
    ? 'Assistant is thinking'
    : pendingAction
      ? 'Assistant wants to make a change. Approve or decline.'
      : replyAnnouncement;

  const prefillId = prefill?.id ?? null;
  useEffect(() => {
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [prefillId]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [
    timeline.length,
    thread.status,
    thread.partial,
    agent.tools.length,
    agent.running,
    agent.error,
    agentReplyLength,
  ]);

  const submit = () => {
    const text = draft.trim();
    if (!text || loading) return;
    onSend(text);
    setDraft('');
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape' && !e.nativeEvent?.isComposing) {
      e.stopPropagation();
      onClose();
    }
  };

  const onInputKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent?.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div
      id={id}
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={aboutId}
      onKeyDown={onKeyDown}
      className={PANEL_CLASS}
    >
      <div className="glass-assistant-head flex items-center gap-2 px-3 py-2.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 sm:flex-nowrap">
          <div className="glass-assistant-chip min-w-0 rounded-xl px-3 py-1 max-sm:basis-full">
            <h2 id={titleId} className="text-sm font-semibold text-slate-slate100">
              Assistant
            </h2>
            <p id={aboutId} className="truncate text-xs text-slate-slate300">{pageKey === 'app' ? 'About this app' : `About: ${pageLabel}`}</p>
          </div>
          <AiSourceBadge ai={status?.ai} className="max-sm:basis-full sm:max-w-[50%] sm:shrink-0" />
        </div>
        <button
          type="button"
          onClick={onNewChat}
          disabled={loading || (agent.messages.length === 0 && agent.actions.length === 0)}
          aria-label="Start a new chat with Assistant"
          className={ICON_BTN}
        >
          <MessageSquarePlus size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onNewAdvice}
          disabled={loading}
          aria-label="Get new advice for this page"
          className={ICON_BTN}
        >
          <RefreshCw size={15} aria-hidden="true" />
        </button>
        <button type="button" onClick={onClose} aria-label="Close Assistant" className={ICON_BTN}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="glass-assistant-body min-h-[10rem] flex-1 space-y-3 overflow-y-auto px-4 pb-4 pt-7">
        <p role="status" className="sr-only">
          {announcement}
        </p>
        {hint === 'visible' && <CloudHint onDismiss={() => setHint('dismissed')} />}
        <div className="space-y-3">
          {timeline.map((item) =>
            item.kind === 'action' ? (
              <ConfirmActionCard key={item.key} action={item.action} onRespond={onRespond} />
            ) : (
              <TimelineMessage key={item.key} message={item.message} />
            ),
          )}
        </div>
        {agent.running && agent.tools.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {agent.tools.map((t) => (
              <span
                key={t.id}
                className="glass-assistant-chip inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-slate-slate300"
              >
                {t.status === 'running' ? (
                  <Loader2 size={10} className="animate-spin" aria-hidden="true" />
                ) : (
                  <CheckSquare size={10} className="text-accent-green" aria-hidden="true" />
                )}
                {toolLabel(t.name)}
              </span>
            ))}
          </div>
        )}
        {agentWaiting && agent.tools.length === 0 && <ThinkingSkeleton />}
        {advising && thread.partial && <AssistantMessage role="assistant" content={thread.partial} />}
        {advising && !thread.partial && <ThinkingSkeleton />}
        {!loading && timeline.length === 0 && !thread.error && !agent.error && (
          <div className="glass-assistant-chip mx-auto max-w-[18rem] space-y-3 rounded-xl px-4 py-4 text-center">
            <p className="text-sm text-slate-slate300">Ask Assistant anything about your data, or get advice for this page.</p>
            <button
              type="button"
              onClick={onNewAdvice}
              className="rounded-md border border-accent-purple/40 bg-accent-purple/10 px-3 py-1.5 text-sm text-accent-purple hover:bg-accent-purple/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:var(--focus-ring)]"
            >
              Get advice
            </button>
          </div>
        )}
        {thread.error && (
          <div className="glass-assistant-chip flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-accent-red">
            {aiUnavailable ? (
              <AiUnavailable message={thread.error.message} code={thread.error.code} reason={thread.error.reason} className="min-w-0 flex-1 text-xs text-slate-slate300" />
            ) : (
              <span role="alert" className="min-w-0 flex-1">
                {thread.error.message}
              </span>
            )}
            {thread.lastRequestMessages && (
              <button
                type="button"
                onClick={onRetry}
                disabled={loading || waitMs > 0}
                className="shrink-0 rounded-md border border-slate-slate700 px-3 py-1.5 text-slate-slate200 hover:text-slate-slate100 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:var(--focus-ring)]"
              >
                {waitMs > 0 ? `Try again in ${waitSecs}s` : 'Retry'}
              </button>
            )}
          </div>
        )}
        {agent.error && (
          <div className="glass-assistant-chip flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-accent-red">
            {agentUnavailable ? (
              <AiUnavailable message={agent.error} code={agent.errorCode} reason={agent.errorReason} className="min-w-0 flex-1 text-xs text-slate-slate300" />
            ) : (
              <span role="alert" className="min-w-0 flex-1">
                {agent.error}
              </span>
            )}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {!hasUserMessage && suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pb-2.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              disabled={loading}
              aria-disabled={aiUnavailable || undefined}
              onClick={() => {
                if (aiUnavailable) return;
                onSuggestion(s);
              }}
              className="glass-assistant-suggest rounded-full px-3 py-1.5 text-sm text-slate-slate300 hover:text-slate-slate100 disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:text-slate-slate300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:[outline-color:var(--focus-ring)]"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="glass-assistant-dock shrink-0 px-3 py-3">
        <div className="glass-assistant-composer flex items-end gap-2 rounded-2xl py-1.5 pl-3.5 pr-1.5">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onInputKeyDown}
            aria-label="Message Assistant"
            placeholder="Ask Assistant anything…"
            maxLength={ASSISTANT_MAX_INPUT_CHARS}
            rows={1}
            className="max-h-32 min-w-0 flex-1 resize-none bg-transparent py-1.5 text-base leading-snug text-slate-slate100 placeholder:text-slate-slate300 focus:outline-hidden"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim() || loading}
            aria-label="Send"
            className="glass-assistant-send flex h-9 w-9 max-sm:h-11 max-sm:w-11 shrink-0 items-center justify-center rounded-full disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:var(--focus-ring)]"
          >
            <ArrowUp size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
