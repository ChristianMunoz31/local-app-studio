import { Suspense, lazy, useCallback, useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Skeleton } from '../shared/Skeleton';
import { ASSISTANT_MAX_INPUT_CHARS, ASSISTANT_PAGES } from '../../constants/assistantPages';
import { usePageContextReader } from '../../contexts/PageContextContext';
import { announceDataChanged } from '../../utils/dataChanged';
import { useAssistantSession } from '../../hooks/useAssistantSession';
import { useCachedAssistantAi } from '../../hooks/useCachedAssistantAi';
import { useAssistant } from '../../hooks/useAssistant';
import AssistantLauncher from './AssistantLauncher';
import { errorWaitMs } from './retryWait';
import { ASSISTANT_OPEN_EVENT } from './openAssistant';

// Panel chunk loads on first open only.
const AssistantPanel = lazy(() => import('./AssistantPanel'));

// While the page's data is still loading, re-check this often (up to the cap) before
// giving up and leaving the "Get advice" button.
const READY_POLL_MS = 400;
const READY_POLL_MAX_MS = 20000;


const RUNTIME_WRITE_PREFIX = 'save_record__';

const FALLBACK_CLASS =
  'glass-assistant fixed z-40 inset-x-0 bottom-0 space-y-2 rounded-t-2xl px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:inset-x-auto sm:right-4 sm:bottom-20 sm:w-[24rem] sm:rounded-2xl';

// Toasts sit above the launcher (and left of / above the open panel) only while the launcher
// is shown or the panel is open; the variables are removed otherwise so e.g. the login screen keeps the default.
const TOAST_OFFSET_VAR = '--assistant-toast-offset';
const TOAST_RIGHT_VAR = '--assistant-toast-right';

function useToastOffset(active, open) {
  useEffect(() => {
    if (!active) return undefined;
    const root = document.documentElement.style;
    const desktop =
      typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 640px)').matches;
    if (!open) {
      root.setProperty(TOAST_OFFSET_VAR, '5rem');
    } else if (desktop) {
      root.setProperty(TOAST_OFFSET_VAR, '5rem');
      root.setProperty(TOAST_RIGHT_VAR, '26rem');
    } else {
      root.setProperty(TOAST_OFFSET_VAR, 'calc(85dvh + 0.5rem)');
    }
    return () => {
      root.removeProperty(TOAST_OFFSET_VAR);
      root.removeProperty(TOAST_RIGHT_VAR);
    };
  }, [active, open]);
}

// Where focus goes when the panel closes without a launcher: the element that had focus
// before Assistant opened if it is still on the page, else the main content.
function focusFallback(opener) {
  if (opener instanceof HTMLElement && opener.isConnected && typeof opener.focus === 'function') {
    opener.focus();
    return;
  }
  const main = document.querySelector('main');
  if (!main) return;
  if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
  main.focus({ preventScroll: true });
}

function AssistantPanelFallback({ id, onClose }) {
  const closeRef = useRef(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  return (
    <div
      id={id}
      role="dialog"
      aria-label="Assistant"
      className={FALLBACK_CLASS}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.nativeEvent?.isComposing) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <p role="status" className="sr-only">
        Loading Assistant
      </p>
      <div className="flex justify-end">
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close Assistant"
          className="glass-assistant-chip flex h-9 w-9 max-sm:h-11 max-sm:w-11 items-center justify-center rounded-full text-slate-slate400 hover:text-slate-slate100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:[outline-color:var(--focus-ring)]"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  );
}

/**
 * Always-mounted host (AppShell). Owns the per-page advice history, the free-form Assistant chat
 * (useAssistant), the open state and the "auto-advice exactly once per open" rule. Navigation
 * alone never calls the LLM. Also opens the panel on the 'assistant:open' event (command palette),
 * sending the question straight away unless Assistant is busy, in which case it fills the composer.
 * `visible` means Assistant is available on this page (the panel can open); `showLauncher` only
 * controls whether the floating button is drawn, so hiding it never disables Assistant.
 * @param {{ pageKey: string | null, visible: boolean, showLauncher?: boolean, autoAdvise: boolean }} props
 */
export default function AssistantAdvisor({ pageKey, visible, showLauncher = true, autoAdvise }) {
  const { readPageContext } = usePageContextReader();
  const { ai: statusAi } = useCachedAssistantAi();
  const session = useAssistantSession({ readPageContext, ai: statusAi });
  const { threadFor, requestAdvice, sendMessage, retry, abortAll } = session;
  const agent = useAssistant();
  const { stop: stopAgent, reset: resetAgent, respond: respondAgent, send: sendAgent } = agent;
  const [open, setOpen] = useState(false);
  const [prefill, setPrefill] = useState(null);
  const [openSeq, setOpenSeq] = useState(0);
  const launcherRef = useRef(null);
  const firedSeqRef = useRef(0);
  const restoreFocusRef = useRef(false);
  const openerRef = useRef(null);
  const openPageKeyRef = useRef(null);
  const sessionFnsRef = useRef({ threadFor, requestAdvice });
  const suppressAutoRef = useRef(false);
  const prefillSeqRef = useRef(0);
  const liveRef = useRef({ open: false, shown: false, pageKey: null, busy: false, agentRunning: false });
  const panelId = useId();
  const available = visible && Boolean(pageKey);
  const launcherShown = available && showLauncher;
  useToastOffset(launcherShown || (available && open), open && visible);

  // Hidden (the setting turned off, or a path with no Assistant page) while open: close without
  // moving focus. Adjusting state during render is the sanctioned pattern for derived resets.
  if (open && !visible) {
    setOpen(false);
    setPrefill(null);
  }

  useEffect(() => {
    if (!visible) {
      abortAll();
      stopAgent();
    }
  }, [visible, abortAll, stopAgent]);

  // Auto-advice: once per open, only for an empty thread, only when the setting is on, and
  // not while the page's data is still loading (re-checked until ready, so the open is not
  // wasted on an empty snapshot) nor right after a rate-limit error. Keyed on the open
  // sequence so StrictMode's double effect and navigating while the panel is open never
  // fire a second request.
  useEffect(() => {
    sessionFnsRef.current = { threadFor, requestAdvice };
    liveRef.current = {
      open,
      available,
      pageKey,
      busy: agent.running || threadFor(pageKey ?? '').status === 'loading',
      agentRunning: agent.running,
    };
  });

  useEffect(() => {
    if (!open || !visible || !pageKey) return undefined;
    if (firedSeqRef.current === openSeq) return undefined;
    // Navigated away before the pending auto-advice fired: drop it for this open.
    if (openPageKeyRef.current !== pageKey) {
      firedSeqRef.current = openSeq;
      suppressAutoRef.current = false;
      return undefined;
    }
    const attempt = () => {
      if (firedSeqRef.current === openSeq) return true;
      // Opened with a question: the answer to that, not page advice, is what the user wants.
      if (suppressAutoRef.current) {
        suppressAutoRef.current = false;
        firedSeqRef.current = openSeq;
        return true;
      }
      if (autoAdvise && readPageContext(pageKey).loading) return false;
      firedSeqRef.current = openSeq;
      const t = sessionFnsRef.current.threadFor(pageKey);
      const waiting = errorWaitMs(t.error, Date.now()) > 0;
      if (autoAdvise && t.messages.length === 0 && t.status !== 'loading' && !waiting && !liveRef.current.agentRunning) {
        sessionFnsRef.current.requestAdvice(pageKey);
      }
      return true;
    };
    if (attempt()) return undefined;
    const startedAt = Date.now();
    const id = setInterval(() => {
      if (attempt() || Date.now() - startedAt > READY_POLL_MAX_MS) clearInterval(id);
    }, READY_POLL_MS);
    return () => clearInterval(id);
  }, [open, openSeq, visible, pageKey, autoAdvise, readPageContext]);

  // Focus returns to the launcher after it re-renders visible (it is invisible on mobile
  // while the sheet is open, and an invisible element cannot take focus). With no launcher
  // it returns to the element focused before opening, else the main content.
  useEffect(() => {
    if (!open && restoreFocusRef.current) {
      restoreFocusRef.current = false;
      const opener = openerRef.current;
      openerRef.current = null;
      if (launcherRef.current) launcherRef.current.focus();
      else focusFallback(opener);
    }
  }, [open]);

  // `close({ restoreFocus: false })` is for a caller that moves focus elsewhere itself (the
  // import dialog); anything else (click and key events included) restores focus as usual.
  const close = useCallback(
    (options) => {
      abortAll();
      stopAgent();
      const restore = options?.restoreFocus !== false;
      restoreFocusRef.current = restore;
      if (!restore) openerRef.current = null;
      setPrefill(null);
      setOpen(false);
    },
    [abortAll, stopAgent],
  );

  // 'assistant:open' (command palette): open the panel and, with a question, send it at once.
  // While a request is already running the question fills the composer instead, so the
  // panel never has two AI requests in flight.
  useEffect(() => {
    const onOpen = (e) => {
      const live = liveRef.current;
      if (!live.available || !live.pageKey) return;
      const prompt =
        typeof e.detail?.prompt === 'string' ? e.detail.prompt.trim().slice(0, ASSISTANT_MAX_INPUT_CHARS) : '';
      if (!live.open) {
        openerRef.current = document.activeElement;
        openPageKeyRef.current = live.pageKey;
        suppressAutoRef.current = Boolean(prompt);
        setOpenSeq((n) => n + 1);
        setOpen(true);
      }
      if (!prompt) return;
      if (live.busy) {
        prefillSeqRef.current += 1;
        setPrefill({ id: prefillSeqRef.current, text: prompt });
      } else {
        sendAgent(prompt, { page: live.pageKey });
      }
    };
    window.addEventListener(ASSISTANT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(ASSISTANT_OPEN_EVENT, onOpen);
  }, [sendAgent]);

  const respond = useCallback(
    async (token, approve) => {
      const out = await respondAgent(token, approve);
      if (out?.status === 'approved') {
        // A built app's write tool is `save_record__<table>`: its spec pages and data browser refetch on this event.
        if (typeof out.name === 'string' && out.name.startsWith(RUNTIME_WRITE_PREFIX)) {
          announceDataChanged(out.name.slice(RUNTIME_WRITE_PREFIX.length));
        }
      }
    },
    [respondAgent],
  );

  const toggle = () => {
    if (open) {
      close();
    } else {
      suppressAutoRef.current = false;
      openerRef.current = document.activeElement;
      openPageKeyRef.current = pageKey;
      setOpenSeq((n) => n + 1);
      setOpen(true);
    }
  };

  if (!visible || !pageKey) return null;
  const page = ASSISTANT_PAGES[pageKey];
  const pageLabel = page?.label ?? 'this page';

  return (
    <>
      {showLauncher && (
        <AssistantLauncher
          ref={launcherRef}
          open={open}
          onToggle={toggle}
          onEscape={close}
          controlsId={panelId}
        />
      )}
      {open && (
        <Suspense fallback={<AssistantPanelFallback id={panelId} onClose={close} />}>
          <AssistantPanel
            id={panelId}
            pageKey={pageKey}
            pageLabel={pageLabel}
            thread={threadFor(pageKey)}
            suggestions={page?.suggestions ?? []}
            agent={agent}
            prefill={prefill}
            onSend={(text) => sendAgent(text, { page: pageKey })}
            onSuggestion={(text) => sendMessage(pageKey, text)}
            onNewAdvice={() => requestAdvice(pageKey)}
            onRetry={() => retry(pageKey)}
            onRespond={respond}
            onNewChat={resetAgent}
            onClose={close}
          />
        </Suspense>
      )}
    </>
  );
}
