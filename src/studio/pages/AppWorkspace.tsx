// /apps/:appId/*: header, the five step rail, the step heading, the step routes, the announcer and the save on move rule
// (DESIGN-phase12.md 2.1). Moving to another step saves first; a dialog shows only when the save cannot happen.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject, ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useNavigationType, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { PageSkeleton } from '@/components/shared/Skeleton.jsx';
import { btnSecondary, formErrorClass } from '@/components/shared/formStyles.js';
import AppDetailsDialog from '../components/AppDetailsDialog';
import BrokenAppView from '../components/BrokenAppView';
import { HelpButton } from '../components/HelpSheet';
import { LiveAnnouncer } from '../components/LiveAnnouncer';
import StepHeader from '../components/StepHeader';
import StudioConfirm from '../components/StudioConfirm';
import { HINT_CLASS, TEXT_BUTTON } from '../components/ui';
import { useAnnouncer } from '../hooks/useAnnouncer';
import { DescribeSessionProvider, useDescribeSession } from '../hooks/useDescribeSession';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { StepChromeContext } from '../hooks/useStepChrome';
import type { DraftTab, SaveOutcome, StepChrome, StepDraft } from '../hooks/useStepChrome';
import { WorkspaceContext, useWorkspaceLoader } from '../hooks/useWorkspace';
import type { WorkspaceLoader } from '../hooks/useWorkspace';
import { forgetApp, readHelperUsed, readPrompt, removableEmptyApp, removedAppState, writeStartWords } from '../lib/appMemory';
import { clearDraft } from '../lib/draftStore';
import { exportFileName } from '../lib/appFiles';
import { downloadJson } from '../lib/download';
import { markProgress, readProgress } from '../lib/progress';
import type { Progress } from '../lib/progress';
import { STEP_FOCUS, STEPS, hasDesignedPage, isStarterSpec, landingStep, nextStepOf, routeOf, stepIndex, stepIntro, stepPath, stepStates, wantsStepFocus } from '../lib/steps';
import type { StepId } from '../lib/steps';
import { deleteApp, getApp, saveSpec } from '../services/studioApi';
import { APP_GONE_START } from '../types';
import type { WorkspaceValue } from '../types';
import StepBoundary from '../errors/StepBoundary';
import DataTab from './DataTab';
import DescribeTab from './DescribeTab';

// The editor and the renderer stay out of this chunk until their step opens.
const DesignTab = lazy(() => import('./DesignTab'));
const PreviewTab = lazy(() => import('./PreviewTab'));
const BuildTab = lazy(() => import('./BuildTab'));

const ALL_SAVED = 'All changes saved.';
const WAITING_TEXT = 'Saving your changes...';
const SETTINGS_WAIT = 'Saving your changes first...';
const NOT_SAVED_YET = 'Your changes are not saved yet.';
const SAVE_FAILED = 'Could not save. Your changes are still here. Try again.';
const EXPORT_COPY = 'Export a copy';
const TAB_LABEL: Record<DraftTab, string> = { design: 'Design', data: 'Data' };
const SAVE_ORDER: ReadonlyArray<DraftTab> = ['design', 'data'];
/** Announcements made within this long of each other are read once, as one sentence (a save, then the step it moved to). */
const JOIN_MS = 250;

/** The announcements of one moment, in order; the generic save line goes when a more precise "Saved ..." line is there. */
function joinAnnouncements(parts: readonly string[]): string {
  const precise = parts.some((p) => p !== ALL_SAVED && p.startsWith('Saved '));
  const kept = parts.filter((p, i) => (precise ? p !== ALL_SAVED : true) && parts.indexOf(p) === i);
  return kept.join(' ');
}

/**
 * A polite message for a save made while the workspace is already leaving the screen (see saveLeftBehind): the workspace's own
 * region may be gone by then, so this one lives on the page body for a few seconds.
 */
function announceDetached(text: string): void {
  const region = document.createElement('p');
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'polite');
  region.setAttribute('data-testid', 'detached-announcer');
  region.className = 'sr-only';
  document.body.appendChild(region);
  window.setTimeout(() => {
    region.textContent = text;
  }, 50);
  window.setTimeout(() => region.remove(), 8000);
}

/** The polite region; announce goes through a ref so speaking never re-renders the workspace. */
function AnnouncerHost({ sinkRef }: { sinkRef: MutableRefObject<((text: string) => void) | null> }) {
  const { text, n, announce } = useAnnouncer();
  useEffect(() => {
    sinkRef.current = announce;
    return () => {
      sinkRef.current = null;
    };
  }, [announce, sinkRef]);
  return (
    <div data-testid="announcer">
      <LiveAnnouncer text={text} n={n} />
    </div>
  );
}

/**
 * say(text) holds the message; when no other comes for JOIN_MS, everything held is spoken once as one string. Speaking each part
 * as it came made a screen reader say the first part again inside the second message.
 */
function useJoinedAnnouncer(): { sink: MutableRefObject<((text: string) => void) | null>; say(text: string): void } {
  const sink = useRef<((text: string) => void) | null>(null);
  const parts = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const say = useCallback((text: string): void => {
    parts.current = [...parts.current, text];
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const joined = joinAnnouncements(parts.current);
      parts.current = [];
      if (joined !== '') sink.current?.(joined);
    }, JOIN_MS);
  }, []);
  return { sink, say };
}

/**
 * Design and Data start from the latest record, so a step that arrives while a save is still on its way (a left-behind save, a move's
 * save) waits for it to finish and mounts after. Once it has mounted it stays, whatever it saves itself.
 */
function ArrivalGate({ busy, say, children }: { busy: boolean; say(text: string): void; children: ReactNode }) {
  const [open, setOpen] = useState(!busy);
  if (!open && !busy) setOpen(true);
  // The paragraph is mounted already holding its text, which a live region would not speak; the shell announcer says it instead.
  const waiting = !open;
  useEffect(() => {
    if (waiting) say(WAITING_TEXT);
  }, [waiting, say]);
  if (!open) {
    return (
      <p className={`mx-auto w-full max-w-5xl px-4 sm:px-6 ${HINT_CLASS}`}>
        {WAITING_TEXT}
      </p>
    );
  }
  return <>{children}</>;
}

const NOOP = (): void => undefined;
/** How many saves a move makes for one step at most, when more edits arrive while it is saving. */
const MAX_SAVE_ROUNDS = 3;

export default function AppWorkspace() {
  const { appId = '' } = useParams();
  const navigate = useNavigate();
  const loader = useWorkspaceLoader(appId);
  const { state, reload } = loader;
  const { sink, say } = useJoinedAnnouncer();
  const outerChrome = useMemo<StepChrome>(() => ({ setDraft: NOOP, go: NOOP, announce: (text: string) => say(text), markDone: NOOP }), [say]);
  const arrivedBy = useNavigationType();
  // An app that is gone, reached by Back or Forward (an app this person removed earlier, for example), is not a page to stay on:
  // the location is replaced by the Apps list. A link or a first visit to a missing app still says so.
  const goneByHistory = state.kind === 'error' && state.notFound && arrivedBy === 'POP' && (entryIdx() ?? 0) >= 1;
  useEffect(() => {
    if (goneByHistory) void navigate('/apps', { replace: true });
  }, [goneByHistory, navigate]);

  if (state.kind === 'loading' || goneByHistory) return <PageSkeleton />;
  if (state.kind === 'error') {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-3 p-4 sm:p-6">
        <p role="alert" className={formErrorClass}>
          {state.message}
        </p>
        <Link to="/apps" className={btnSecondary}>
          Back to apps
        </Link>
      </div>
    );
  }
  if (state.kind === 'broken') {
    return (
      <BrokenAppView
        record={state.record}
        onRepair={async (spec) => {
          await saveSpec(appId, spec, state.record.revision);
          await reload();
        }}
        onDelete={async () => {
          await deleteApp(appId);
          forgetApp(appId);
          navigate('/apps');
        }}
      />
    );
  }

  return (
    <WorkspaceContext.Provider value={state.value}>
      <StepChromeContext.Provider value={outerChrome}>
        <DescribeSessionProvider key={appId}>
          <WorkspaceShell value={state.value} loader={loader} say={say} />
        </DescribeSessionProvider>
      </StepChromeContext.Provider>
      <AnnouncerHost sinkRef={sink} />
    </WorkspaceContext.Provider>
  );
}

interface Stuck {
  tab: DraftTab;
  reason: string;
  to: string;
  state: Record<string, unknown> | undefined;
  /** The move started as the person's Back, so it finishes by going back in history (see settleMove). */
  pop: boolean;
}

interface Leave {
  kind: 'waiting' | 'running';
  to: string;
  state: Record<string, unknown> | undefined;
  pop: boolean;
}

type DraftFacts = Record<DraftTab, { saveBlocked: string | null; nextBlocked: string | null } | null>;

/** The extra history entry that holds Back while a move matters is marked in its state, so it is found by what it is. */
const isSentinelState = (state: unknown): boolean => typeof state === 'object' && state !== null && 'studioSentinel' in state;
const topIsSentinel = (): boolean => isSentinelState(window.history.state);
/** react-router keeps an index and a key in the state of every entry it makes; the sentinel copies both from the entry under it. */
const entryField = (name: 'idx' | 'key'): unknown => {
  const own: unknown = window.history.state;
  return typeof own === 'object' && own !== null ? (own as Record<string, unknown>)[name] : null;
};
const entryIdx = (): number | null => {
  const idx = entryField('idx');
  return typeof idx === 'number' ? idx : null;
};
const entryKey = (): string | null => {
  const key = entryField('key');
  return typeof key === 'string' ? key : null;
};
/** How long a history step this code asked for may take before it is taken as never having happened. */
const POP_TIMEOUT_MS = 1000;
const pushSentinel = (): void => {
  const own: unknown = window.history.state;
  window.history.pushState({ ...(typeof own === 'object' && own !== null ? own : {}), studioSentinel: true }, '');
};

const sameFacts = (a: DraftFacts[DraftTab], b: DraftFacts[DraftTab]): boolean =>
  a === b || (a !== null && b !== null && a.saveBlocked === b.saveBlocked && a.nextBlocked === b.nextBlocked);

function WorkspaceShell({ value, loader, say }: { value: WorkspaceValue; loader: WorkspaceLoader; say(text: string): void }) {
  const { record, spec, revision } = value;
  const appId = record.id;
  const { dirtyTabs, saving, lastSaveOk, clearDirty, savedCount } = loader;
  const describe = useDescribeSession();
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [stuck, setStuck] = useState<Stuck | null>(null);
  const [leave, setLeave] = useState<Leave | null>(null);
  const [moving, setMoving] = useState(false);
  // True from the render that leaves Design or Data with edits still unsaved until their left-behind save is over, so the step that
  // arrives does not read a base the save is about to move.
  const [settling, setSettling] = useState(false);
  const [progress, setProgress] = useState<Progress>(() => readProgress(appId));
  const drafts = useRef<Record<DraftTab, StepDraft | null>>({ design: null, data: null });
  // The last draft each tab registered, kept after the tab unmounts so its edits can still be saved (saveLeftBehind).
  const lastDrafts = useRef<Record<DraftTab, StepDraft | null>>({ design: null, data: null });
  const [draftFacts, setDraftFacts] = useState<DraftFacts>({ design: null, data: null });
  // Where focus was when a move began, so a dialog it opens can hand focus back.
  const triggerRef = useRef<HTMLElement | null>(null);

  const segments = location.pathname.split('/');
  const step: StepId | null = routeOf(segments[3], segments[4]);
  const meta = step === null ? null : STEPS[stepIndex(step)];
  const starter = isStarterSpec(spec);
  const designed = hasDesignedPage(spec);
  // A helper design was used for this app. An app with no such memory counts by the old rule (it has a design) only when it was
  // made from words (a prompt is kept). Revision and phase change when Use this is pressed, which is when the memory is written.
  const helperUsed = useMemo(
    () => readHelperUsed(appId) || (!starter && readPrompt(appId) !== ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revision and phase are the moments the stored memory can have changed
    [appId, starter, revision, describe.phase],
  );
  // A design made before a save can no longer be used, so it neither blocks Next nor asks to be kept when leaving.
  const proposalWaiting = describe.phase === 'proposal' && !describe.stale;
  const describeActive = describe.phase === 'running' || proposalWaiting;
  const anyDirty = dirtyTabs.data || dirtyTabs.design;
  // An app made by Make my app that is still the untouched starter after the helper failed or was stopped: leaving it removes it.
  const madeEmpty = removableEmptyApp(appId, revision, starter);
  // A real stop in this window (cancelled or failed), not words that were only found on the server when the app opened.
  const helperStopped = describe.stopped && (describe.phase === 'error' || describe.phase === 'idle');
  const removeOnLeave = madeEmpty && helperStopped;
  const removeIfStopped = madeEmpty && (helperStopped || describe.phase === 'running');
  // Back and Forward are held back while leaving would lose or change something.
  const guarded = anyDirty || describeActive || removeOnLeave;

  // Latest values for the async move and the document listeners.
  const live = useRef({ dirtyTabs, describeActive, describePhase: describe.phase, pathname: location.pathname, removeOnLeave, removeIfStopped, instruction: describe.instruction });
  useEffect(() => {
    live.current = { dirtyTabs, describeActive, describePhase: describe.phase, pathname: location.pathname, removeOnLeave, removeIfStopped, instruction: describe.instruction };
  });
  const latestValue = useRef(value);
  useEffect(() => {
    latestValue.current = value;
  });
  const movingRef = useRef(false);
  const moveToken = useRef(0);
  // When a move itself said "All changes saved." (so the save line and the step line are one message), until when the
  // save-finished effect below keeps quiet.
  const saidSavedUntil = useRef(0);
  // How many left-behind saves are on their way; the generic save line stays quiet until the last one is spoken.
  const activeLeft = useRef(0);

  // History sentinel bookkeeping (see the Back and Forward effect): a pop this code asked for (and must not treat as the person's
  // Back), whether the entry on top is the sentinel, whether the workspace is still mounted, and the guard facts the one popstate
  // listener reads.
  const swallow = useRef<{ rearm: boolean; done: (() => void) | null; key?: string | null } | null>(null);
  // True when the navigation that is about to render replaced the sentinel: the browser got a new entry, so for Back it is a push.
  const replacedSentinel = useRef(false);
  // True while Back is heading for a place nobody knows (the first place of this workspace): history decides where it lands.
  const unknownBack = useRef(false);
  const onSentinel = useRef(false);
  const mounted = useRef(true);
  const guardLive = useRef<{ guarded: boolean; go: ((to: string) => void) | null }>({ guarded: false, go: null });
  // The place a Back press asked for through go(); the move that goes there finishes by history instead of a new entry.
  const popTarget = useRef<string | null>(null);
  /** Takes the sentinel off the history when it is on top (one back step the listener ignores); resolves when that pop happened. */
  const popSentinel = useCallback(
    (): Promise<void> =>
      new Promise<void>((resolve) => {
        if (!topIsSentinel()) {
          resolve();
          return;
        }
        const timer = window.setTimeout(() => {
          swallow.current = null;
          resolve();
        }, POP_TIMEOUT_MS);
        swallow.current = {
          rearm: false,
          done: () => {
            window.clearTimeout(timer);
            resolve();
          },
        };
        window.history.back();
      }),
    [],
  );

  const appRoot = `/apps/${appId}`;
  const insideApp = useCallback((path: string): boolean => path === appRoot || path.startsWith(`${appRoot}/`), [appRoot]);
  const stateFor = useCallback(
    (to: string, state: Record<string, unknown> | undefined): Record<string, unknown> | undefined => {
      if (state !== undefined) return state;
      if (!insideApp(to)) return undefined;
      const parts = to.split(/[?#]/)[0].split('/');
      return routeOf(parts[3], parts[4]) !== null ? STEP_FOCUS : undefined;
    },
    [insideApp],
  );

  /**
   * Leaves an app that is still the untouched starter after its first helper run failed or was stopped: the app is removed (the
   * existing delete), the words go back in the Apps start box, and the Apps page says so once. If the delete fails the app stays.
   */
  const leaveRemoving = useCallback(
    async (to: string, state: Record<string, unknown> | undefined, words: string): Promise<void> => {
      const name = latestValue.current.record.name;
      // A history sentinel on top is replaced by the move, so the history does not grow.
      const stay = (): void => {
        const replace = topIsSentinel();
        replacedSentinel.current = replace;
        void navigate(to, { state: stateFor(to, state), replace });
      };
      try {
        // The record is read again right now: a save made a moment ago (or in another window) means the app has work in it.
        const fresh = await getApp(appId);
        if (fresh.spec === null || !removableEmptyApp(appId, fresh.revision, isStarterSpec(fresh.spec))) {
          stay();
          return;
        }
        await deleteApp(appId, fresh.revision);
      } catch {
        stay();
        return;
      }
      writeStartWords(words);
      forgetApp(appId);
      // Back must not land on the removed app: take the sentinel off, then replace the app's own entry.
      await popSentinel();
      navigate(to, { replace: true, state: to.split(/[?#]/)[0] === '/apps' ? removedAppState(name) : undefined });
    },
    [appId, navigate, popSentinel, stateFor],
  );

  /**
   * Completes an allowed move. One that began as the person's Back goes back in history past the sentinel it re-pushed and the
   * step's own entry (two steps the listener ignores), so the real previous entry is current and Forward returns to the step.
   * That needs an entry to go back to (the first entry of a tab has none) and nothing newer in between; otherwise, and for any
   * other move, the sentinel is replaced when one is on top, so the history does not grow.
   */
  const settleMove = useCallback(
    (to: string, state: Record<string, unknown> | undefined, pop: boolean): void => {
      const replaceHere = (): void => {
        const replace = topIsSentinel();
        replacedSentinel.current = replace;
        navigate(to, { state: stateFor(to, state), replace });
      };
      const unknown = unknownBack.current;
      unknownBack.current = false;
      const at = entryIdx();
      if (pop && topIsSentinel() && swallow.current === null && (at === null || at >= 1)) {
        const wantedPath = to.split(/[?#]/)[0];
        // The two steps back land on the entry below the step's own; anything else means a newer navigation got in between.
        const landing = at === null ? null : at - 1;
        let timer = 0;
        const mine = {
          rearm: false,
          done: () => {
            window.clearTimeout(timer);
            if (landing !== null && entryIdx() !== landing) return;
            // History did not hold the place Back was heading for (it landed in or out of the app against the target): go there.
            if (!unknown && insideApp(window.location.pathname) !== insideApp(wantedPath)) {
              navigate(to, { state: stateFor(to, state), replace: true });
            }
          },
        };
        timer = window.setTimeout(() => {
          // The browser never went back (nothing to go to): the sentinel is still on top, so the move replaces it.
          if (swallow.current !== mine) return;
          swallow.current = null;
          if (topIsSentinel()) replaceHere();
        }, POP_TIMEOUT_MS);
        swallow.current = mine;
        window.history.go(-2);
        return;
      }
      replaceHere();
    },
    [insideApp, navigate, stateFor],
  );

  /** After every draft is saved (or thrown away): ask before leaving with the run of the helper, else move. */
  const finish = useCallback(
    (to: string, state: Record<string, unknown> | undefined, savedBefore?: number, pop = false): void => {
      const pathOnly = to.split(/[?#]/)[0];
      if (!insideApp(pathOnly) && live.current.describeActive) {
        setLeave({ kind: live.current.describePhase === 'running' ? 'running' : 'waiting', to, state, pop });
        return;
      }
      // live.current is refreshed after a render, so right after a save it can still say "untouched starter": a move that saved
      // something never removes the app.
      const savedNow = savedBefore !== undefined && savedCount() > savedBefore;
      if (!insideApp(pathOnly) && live.current.removeOnLeave && !savedNow) {
        void leaveRemoving(to, state, readPrompt(appId) || (live.current.instruction ?? ''));
        return;
      }
      settleMove(to, state, pop);
    },
    [appId, insideApp, leaveRemoving, savedCount, settleMove],
  );

  /**
   * The one path for every move go() does not run: Back, Forward and the kit command palette (which calls navigate() itself), and
   * leaving the app. It is decided when the step or the app goes, not later: a draft that is still dirty then (and was not
   * discarded) gets its save queued at once. The draft reads its own base when that save runs, so a save of it already on its way
   * finishes first and the new one starts from the revision it returned. A draft that go() saved, or Discard reset, is not dirty,
   * so it is never sent twice. Saved: "Saved your changes on <Step>."; not saved (blocked, refused, failed or cancelled): the
   * changes are lost, but the person is told. Browser history is never touched.
   */
  const saveLeftBehind = useCallback((tabs: readonly DraftTab[]): void => {
    const runs: Array<{ label: string; tab: DraftTab; scope: string | undefined; saved: Promise<boolean> }> = [];
    for (const tab of tabs) {
      const draft = lastDrafts.current[tab];
      if (draft === null || !draft.isDirty()) continue;
      // Queued once: a later call (the workspace going away) must not send it again from an old base.
      lastDrafts.current[tab] = null;
      const saved =
        draft.saveBlocked !== null
          ? Promise.resolve(false)
          : draft.save().then(
              (outcome) => outcome.ok && outcome.cancelled !== true,
              () => false,
            );
      runs.push({ label: TAB_LABEL[tab], tab, scope: draft.scope, saved });
    }
    if (runs.length === 0) {
      if (activeLeft.current === 0) setSettling(false);
      return;
    }
    // This save is spoken precisely below; the generic "All changes saved." must stay quiet while it runs and just after.
    activeLeft.current += 1;
    saidSavedUntil.current = Number.MAX_SAFE_INTEGER;
    void (async () => {
      try {
        for (const run of runs) {
          const saved = await run.saved;
          // Saved edits need no stored copy; edits that were not saved keep theirs, to be offered when the step opens again.
          if (saved) clearDraft(appId, run.tab, run.scope);
          announceDetached(saved ? `Saved your changes on ${run.label}.` : `Your changes on ${run.label} were not saved.`);
        }
      } finally {
        activeLeft.current -= 1;
        if (activeLeft.current === 0) {
          saidSavedUntil.current = Date.now() + JOIN_MS * 4;
          setSettling(false);
        }
      }
    })();
  }, [appId]);

  /**
   * The save on move rule: each registered draft (Design, then Data) is saved while it is dirty, then the move happens. Dirty is
   * asked again after every save, so edits typed while a save was on its way are saved too (at most MAX_SAVE_ROUNDS saves). A draft
   * that cannot be saved opens the stuck dialog with the reason. When the location changes under the move (Back, the palette),
   * the move stops: saveLeftBehind has taken what is left.
   */
  const go = useCallback(
    (to: string, opts?: { state?: Record<string, unknown> }): void => {
      if (movingRef.current) return;
      const state = opts?.state;
      const pop = popTarget.current === to;
      popTarget.current = null;
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body) triggerRef.current = active;
      movingRef.current = true;
      setMoving(true);
      const token = ++moveToken.current;
      const gone = (): boolean => moveToken.current !== token;
      void (async () => {
        try {
          const savedBefore = savedCount();
          // The steps whose edits this move saved, for the sentence a Back says (the same one Back said before the guard).
          const savedTabs: DraftTab[] = [];
          for (const tab of SAVE_ORDER) {
            // A step that says it has edits but registered no draft to save them with.
            if (drafts.current[tab] === null && live.current.dirtyTabs[tab]) {
              setStuck({ tab, reason: NOT_SAVED_YET, to, state, pop });
              return;
            }
            for (let round = 1; ; round += 1) {
              const draft = drafts.current[tab];
              if (draft === null || !draft.isDirty()) break;
              if (round > MAX_SAVE_ROUNDS) {
                setStuck({ tab, reason: NOT_SAVED_YET, to, state, pop });
                return;
              }
              if (draft.saveBlocked !== null) {
                setStuck({ tab, reason: draft.saveBlocked, to, state, pop });
                return;
              }
              let outcome: SaveOutcome;
              try {
                outcome = await draft.save();
              } catch {
                outcome = { ok: false, reason: SAVE_FAILED };
              }
              if (gone() || outcome.cancelled === true) return;
              if (!outcome.ok) {
                setStuck({ tab, reason: outcome.reason ?? SAVE_FAILED, to, state, pop });
                return;
              }
              if (!savedTabs.includes(tab)) savedTabs.push(tab);
            }
          }
          if (savedCount() > savedBefore) {
            // A Back names what it saved, as before the guard; every other move says the one save line.
            if (pop && savedTabs.length > 0) for (const tab of savedTabs) announceDetached(`Saved your changes on ${TAB_LABEL[tab]}.`);
            else say(ALL_SAVED);
            saidSavedUntil.current = Date.now() + JOIN_MS * 4;
          }
          finish(to, state, savedBefore, pop);
        } finally {
          // A newer move (or a location change) already took over the lock; leave it alone.
          if (moveToken.current === token) {
            movingRef.current = false;
            setMoving(false);
          }
        }
      })();
    },
    [finish, savedCount, say],
  );

  // A move that never settled (for example a confirm that closed because its step unmounted) must not lock the next one.
  const [moveKey, setMoveKey] = useState(location.key);
  if (moveKey !== location.key) {
    setMoveKey(location.key);
    setMoving(false);
  }
  useEffect(() => {
    moveToken.current += 1;
    movingRef.current = false;
  }, [location.key]);

  const setDraft = useCallback((tab: DraftTab, draft: StepDraft | null): void => {
    drafts.current[tab] = draft;
    if (draft !== null) lastDrafts.current[tab] = draft;
    const facts = draft === null ? null : { saveBlocked: draft.saveBlocked, nextBlocked: draft.nextBlocked };
    setDraftFacts((prev) => (sameFacts(prev[tab], facts) ? prev : { ...prev, [tab]: facts }));
  }, []);

  const markDone = useCallback(
    (which: 'preview' | 'build', rev: number): void => {
      markProgress(appId, which, rev);
      setProgress((prev) => {
        const key = which === 'preview' ? 'previewed' : 'built';
        return prev[key] === rev ? prev : { ...prev, [key]: rev };
      });
    },
    [appId],
  );

  const chrome = useMemo<StepChrome>(() => ({ setDraft, go, announce: (text: string) => say(text), markDone }), [setDraft, go, say, markDone]);

  // Leaving Design or Data: decided as the step changes (go() already saved what it could, so its drafts are not dirty).
  const [shownStep, setShownStep] = useState<StepId | null>(step);
  if (shownStep !== step) {
    setShownStep(step);
    const was = shownStep;
    if ((was === 'data' || was === 'design') && dirtyTabs[was]) setSettling(true);
  }
  const lastStep = useRef<StepId | null>(step);
  useEffect(() => {
    const was = lastStep.current;
    lastStep.current = step;
    if (was !== step && (was === 'data' || was === 'design')) saveLeftBehind([was]);
  }, [step, saveLeftBehind]);
  // Leaving the whole app (or opening another one): decided as the workspace goes. A move still saving stops there too.
  useEffect(() => {
    const token = moveToken;
    return () => {
      token.current += 1;
      saveLeftBehind(SAVE_ORDER);
    };
  }, [saveLeftBehind]);

  // One announcement per finished save that reached the server.
  const wasSaving = useRef(saving);
  useEffect(() => {
    if (wasSaving.current && !saving && lastSaveOk === true && Date.now() > saidSavedUntil.current) say(ALL_SAVED);
    wasSaving.current = saving;
  }, [saving, lastSaveOk, say]);

  // Every step change that asks for it moves focus to the step heading. The heading says its own name when it takes focus, so the
  // announcer adds only the position (after the save line, when there is one).
  const seenKey = useRef<string | null>(null);
  useEffect(() => {
    if (seenKey.current === location.key) return;
    seenKey.current = location.key;
    // An old /review (and /review/data, /review/design) or /describe link redirects at once; the arrival there focuses and speaks.
    const [, , , seg3] = location.pathname.split('/');
    const redirecting = seg3 === 'review' || seg3 === 'describe';
    if (meta === null || redirecting || !wantsStepFocus(location.state)) return;
    headingRef.current?.focus();
    say(`Step ${stepIndex(meta.id) + 1} of ${STEPS.length}.`);
  }, [location.key, location.pathname, location.state, meta, say]);

  useEffect(() => {
    if (!anyDirty && !describeActive) return undefined;
    const handler = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [anyDirty, describeActive]);

  // Where Back goes: the location before this one (a replace, such as a redirect, is not a place to go back to). The first location
  // is not known (it may be the Apps page, Features or an earlier step): the real history decides where Back lands.
  const previousPlace = useRef<string | null>(null);
  const hereRef = useRef(`${location.pathname}${location.search}`);
  useEffect(() => {
    const here = `${location.pathname}${location.search}`;
    const replacedTheSentinel = replacedSentinel.current;
    replacedSentinel.current = false;
    if (hereRef.current === here) return;
    // A move that replaced the sentinel is a REPLACE for the router, but the browser got a new entry, so it is a place to go back to.
    if (navigationType !== 'REPLACE' || replacedTheSentinel) previousPlace.current = hereRef.current;
    hereRef.current = here;
  }, [location.pathname, location.search, navigationType]);

  // Back and Forward. The app uses BrowserRouter, which cannot hold a move back, so while `guarded` one extra history entry (the
  // sentinel, same address, one per location) sits on top. Back from it lands on the own entry of this step: the sentinel is put
  // back and the move is asked for through go(), toward where Back was heading, so the same dialogs answer as for the rail.
  // The sentinel is found by the marker in the state of the entry on top (not by a remembered key), so the guard puts one back
  // whenever none is on top. The move that follows replaces the sentinel (finish), so the history does not grow per guarded Back.
  // When the guard turns off with the sentinel still on top, it is taken off again (one back step, ignored by the listener below),
  // so one Back press leaves.
  useEffect(() => {
    guardLive.current = { guarded, go };
  });
  // A sentinel is pushed only for what the step on screen holds: edits of a step that was just left are saved by then, and while the
  // location changes they still read as dirty for one render, so a push then would cut the forward entry the move keeps.
  const needsSentinel = describeActive || removeOnLeave || (step === 'data' && dirtyTabs.data) || (step === 'design' && dirtyTabs.design);
  useEffect(() => {
    if (needsSentinel && !topIsSentinel()) pushSentinel();
    onSentinel.current = topIsSentinel();
  }, [needsSentinel, location.key]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!guarded) return undefined;
    return () => {
      // Not while a move is on its way (its own navigation replaces the sentinel) and not when the workspace goes away.
      if (!mounted.current || movingRef.current || !topIsSentinel()) return;
      // The back runs after this commit's other effects, and only if the sentinel is still the entry on top then: a navigation
      // made in the same turn (the helper answering) has pushed a newer entry, and a back now would undo it.
      window.setTimeout(() => {
        if (!mounted.current || movingRef.current || guardLive.current.guarded || swallow.current !== null || !topIsSentinel()) return;
        swallow.current = { rearm: true, done: null, key: entryKey() };
        window.history.back();
      }, 0);
    };
  }, [guarded]);
  useEffect(() => {
    const onPop = (): void => {
      const was = onSentinel.current;
      const now = topIsSentinel();
      onSentinel.current = now;
      const pending = swallow.current;
      if (pending !== null) {
        swallow.current = null;
        if (pending.rearm && guardLive.current.guarded && (pending.key === undefined || pending.key === null || entryKey() === pending.key)) {
          pushSentinel();
          onSentinel.current = true;
        }
        pending.done?.();
        return;
      }
      const { guarded: armed, go: move } = guardLive.current;
      if (!armed || !was || now || move === null) return;
      pushSentinel();
      onSentinel.current = true;
      const place = previousPlace.current;
      const known = place !== null && place !== hereRef.current;
      const target = known ? place : '/apps';
      unknownBack.current = !known;
      popTarget.current = target;
      move(target);
      popTarget.current = null;
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Links anywhere on the screen (the rail, the Apps link, the kit sidebar) move through the save rule while it matters.
  useEffect(() => {
    if (!guarded) return undefined;
    const handler = (e: MouseEvent): void => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.hasAttribute('download') || (anchor.target !== '' && anchor.target !== '_self')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const { dirtyTabs: tabs, pathname } = live.current;
      if (url.pathname === pathname) return;
      const dirtyNow = tabs.data || tabs.design;
      if (!dirtyNow && insideApp(url.pathname)) return;
      e.preventDefault();
      go(`${url.pathname}${url.search}${url.hash}`);
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [guarded, go, insideApp]);

  const name = spec.app.name;
  useDocumentTitle(meta === null ? `${name}, Local App Studio` : `${meta.label}, ${name}, Local App Studio`);

  const states = stepStates(
    {
      designed,
      helperUsed,
      tableCount: spec.tables.length,
      proposalWaiting,
      revision,
      previewedRevision: progress.previewed ?? null,
      builtRevision: progress.built ?? null,
    },
    step,
  );
  const next = nextStepOf(states, step, proposalWaiting);
  const at = step === null ? -1 : stepIndex(step);
  const back = at > 0 ? STEPS[at - 1].id : null;
  const forward = at >= 0 && at < STEPS.length - 1 ? STEPS[at + 1].id : null;
  const forwardBlocked =
    step === 'prompt' && proposalWaiting
      ? 'Press Use this or Try again first.'
      : step === 'design' || step === 'data'
        ? (draftFacts[step]?.nextBlocked ?? null)
        : null;
  const busy = moving || saving;
  // The App settings dialog's own save is not a reason for it to say it waits for other saves.
  const [detailsSaving, setDetailsSaving] = useState(false);
  const queueBusy = saving || settling;

  const status = saving
    ? 'Saving...'
    : describe.phase === 'running'
      ? 'The helper is working on a design.'
      : proposalWaiting
        ? "The helper's design is not used yet."
        : dirtyTabs.design && dirtyTabs.data
          ? 'Unsaved changes on Design and Data'
          : dirtyTabs.design
            ? 'Unsaved changes on Design'
            : dirtyTabs.data
              ? 'Unsaved changes on Data'
              : 'All changes saved';

  const landing = stepPath(appId, landingStep(spec));
  // Design is the one wide step: its header and body share one width, so the page header lines up with the canvas. The other steps stay narrow.
  const stepWidth = step === 'design' ? 'max-w-screen-2xl' : 'max-w-5xl';

  return (
    <StepChromeContext.Provider value={chrome}>
      <div className="space-y-3">
        <header className={`mx-auto flex w-full ${stepWidth} flex-wrap items-center justify-between gap-3 px-4 pt-4 sm:px-6`}>
          <div className="flex min-w-0 items-center gap-3">
            <Link to="/apps" className={btnSecondary} aria-label="Back to apps">
              <span className="inline-flex items-center gap-1.5">
                <ArrowLeft size={14} aria-hidden="true" />
                Apps
              </span>
            </Link>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold tracking-tight text-slate-slate100">{name}</h2>
              <p data-testid="save-status" className={HINT_CLASS}>
                {status}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <HelpButton />
            <button type="button" className={btnSecondary} onClick={() => setShowDetails(true)}>
              App settings
            </button>
          </div>
        </header>
        <StepHeader
          appId={appId}
          states={states}
          current={step}
          next={next}
          widthClass={stepWidth}
          nav={{
            back,
            forward,
            forwardPrimary: step === 'design' || step === 'data' || step === 'preview',
            forwardBlocked,
            busy,
            // aria-disabled buttons still get the click, so a keyboard user keeps focus and hears why nothing moved.
            onBack: () => {
              if (back !== null && !busy) go(stepPath(appId, back));
            },
            onNext: () => {
              if (forward === null || busy) return;
              if (forwardBlocked !== null) say(forwardBlocked);
              else go(stepPath(appId, forward));
            },
          }}
        />
        {meta !== null && (
          <div className={`mx-auto w-full ${stepWidth} px-4 sm:px-6`}>
            <p className={HINT_CLASS}>{`Step ${stepIndex(meta.id) + 1} of ${STEPS.length}`}</p>
            <h3 ref={headingRef} tabIndex={-1} className="scroll-mt-[calc(var(--topbar-h,4rem)_+_0.75rem)] text-sm font-semibold text-slate-slate100">
              {meta.label}
            </h3>
            <p className="text-sm text-slate-slate400">{stepIntro(meta.id)}</p>
          </div>
        )}
        <StepBoundary key={meta?.id ?? 'none'} step={meta?.id ?? null} appId={appId}>
        <Suspense fallback={<PageSkeleton />}>
          <Routes>
            <Route index element={<Navigate to={landing} replace state={location.state} />} />
            <Route path="prompt" element={<DescribeTab />} />
            <Route
              path="describe"
              element={
                <Navigate
                  to={{ pathname: '../prompt', search: location.search, hash: location.hash }}
                  relative="path"
                  replace
                  state={location.state}
                />
              }
            />
            <Route
              path="review"
              element={
                <Navigate
                  to={{ pathname: '../prompt', search: location.search, hash: location.hash }}
                  relative="path"
                  replace
                  state={location.state}
                />
              }
            />
            <Route
              path="review/data"
              element={<Navigate to={{ pathname: stepPath(appId, 'data'), search: location.search, hash: location.hash }} replace state={location.state} />}
            />
            <Route
              path="review/design"
              element={<Navigate to={{ pathname: stepPath(appId, 'design'), search: location.search, hash: location.hash }} replace state={location.state} />}
            />
            <Route
              path="design"
              element={
                <ArrivalGate key="design" busy={queueBusy} say={say}>
                  <DesignTab />
                </ArrivalGate>
              }
            />
            <Route
              path="data"
              element={
                <ArrivalGate key="data" busy={queueBusy} say={say}>
                  <DataTab />
                </ArrivalGate>
              }
            />
            <Route path="preview/*" element={<PreviewTab />} />
            <Route path="build" element={<BuildTab key={appId} />} />
            <Route path="*" element={<Navigate to={landing} replace state={location.state} />} />
          </Routes>
        </Suspense>
        </StepBoundary>
      </div>
      {showDetails && (
        <AppDetailsDialog
          spec={spec}
          blockedReason={queueBusy && !detailsSaving ? SETTINGS_WAIT : null}
          onCancel={() => setShowDetails(false)}
          onSave={async (nextSpec) => {
            // The revision is read now, when the person presses Save settings, not when the dialog opened.
            const now = latestValue.current;
            setDetailsSaving(true);
            try {
              const result = await now.save(nextSpec, { baseRevision: now.revision });
              if (result.ok) setShowDetails(false);
              return result;
            } catch {
              return { ok: false, code: 'error', message: SAVE_FAILED, issues: [] };
            } finally {
              setDetailsSaving(false);
            }
          }}
        />
      )}
      {stuck && (
        <StudioConfirm
          title={`Your changes on ${TAB_LABEL[stuck.tab]} cannot be saved yet`}
          message={
            stuck.reason.startsWith(APP_GONE_START) ? (
              <>
                {stuck.reason}{' '}
                <button
                  type="button"
                  className={TEXT_BUTTON}
                  onClick={() => {
                    const draft = drafts.current[stuck.tab] ?? lastDrafts.current[stuck.tab];
                    const copy = draft?.exportSpec?.() ?? latestValue.current.spec;
                    downloadJson(exportFileName(copy.app.name), copy);
                  }}
                >
                  {EXPORT_COPY}
                </button>
              </>
            ) : (
              stuck.reason
            )
          }
          confirmLabel="Discard changes"
          busyLabel="Discarding..."
          cancelLabel="Stay"
          finalFocusRef={triggerRef}
          onConfirm={() => {
            const { to, state, pop } = stuck;
            setStuck(null);
            // Discard means gone: the step shows its saved state again and its draft is not dirty, so nothing saves it later and
            // Stay (on the leave dialog) leaves nothing untracked.
            for (const tab of SAVE_ORDER) {
              const draft = drafts.current[tab] ?? lastDrafts.current[tab];
              if (draft === null || !(draft.isDirty() || live.current.dirtyTabs[tab])) continue;
              draft.reset();
              // Only the discarded page's kept copy goes; another page's kept Design draft stays.
              clearDraft(appId, tab, draft.scope);
            }
            clearDirty();
            live.current = { ...live.current, dirtyTabs: { data: false, design: false } };
            finish(to, state, undefined, pop);
          }}
          onCancel={() => setStuck(null)}
        />
      )}
      {leave && (
        <StudioConfirm
          title={leave.kind === 'waiting' ? "Leave without using the helper's design?" : 'Stop the helper and leave?'}
          message={
            leave.kind === 'waiting'
              ? "The helper's design is not used yet. If you leave the app now, it is thrown away. To keep it, go to Prompt and press Use this."
              : 'The helper is still working on your app. If you leave the app now, it stops.'
          }
          confirmLabel={leave.kind === 'waiting' ? 'Leave without it' : 'Stop and leave'}
          busyLabel="Leaving..."
          cancelLabel="Stay"
          finalFocusRef={triggerRef}
          onConfirm={() => {
            const { to, state, pop } = leave;
            setLeave(null);
            const words = readPrompt(appId) || (live.current.instruction ?? '');
            describe.discard();
            if (live.current.removeIfStopped) void leaveRemoving(to, state, words);
            else settleMove(to, state, pop);
          }}
          onCancel={() => setLeave(null)}
        />
      )}
    </StepChromeContext.Provider>
  );
}
