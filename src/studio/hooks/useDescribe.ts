// Describe state machine (DESIGN-phase3.md 7.6). A proposal waits for the user to apply it. The server keeps the waiting
// design with the app (phase 17, P17-01), so on mount the hook asks for it and the review comes back in any window.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { PRO_PARTS } from '@/proParts.js';
import { runDescribeStream } from '../services/describeStream';
import { diffSpecs } from '../lib/specDiff';
import { StudioApiError, deleteWaiting, getWaiting } from '../services/studioApi';
import type { WaitingEntry, DescribeEvent, DescribeFallback, DescribeProgress } from '../types';
import { useWorkspace } from './useWorkspace';

export interface DescribeError {
  code: string | null;
  message: string;
  reason: string | null;
}

export interface UseDescribe {
  /** 'unchanged': the helper answered with a design that changes nothing, so nothing waits to be used. */
  phase: 'idle' | 'running' | 'proposal' | 'unchanged' | 'error';
  progress: DescribeProgress[];
  proposal: AppSpec | null;
  fallbacks: DescribeFallback[];
  baseRevision: number | null;
  error: DescribeError | null;
  /** Where the model runs, from the first stream event. */
  ai: { kind: string; host: string | null } | null;
  /** The words of the last run (set by run, cleared by discard unless kept). */
  instruction: string | null;
  /** The mode of the last run, kept with the instruction. */
  mode: 'create' | 'edit' | null;
  /** The asks made on the waiting design, newest last (empty for a design that was not changed by an ask). */
  asks: string[];
  /** The waiting design the newest ask replaced, or null. */
  replaced: AppSpec | null;
  /** True once the waiting design kept on the server has been asked for (found or not). */
  hydrated: boolean;
  /** The version (`at`) of the server's entry this design came from, or null. Use this clears only that version. */
  waitingAt: string | null;
  /** The waiting design was made on an older revision than the app now has (the app was saved since): it can no longer be used. */
  stale: boolean;
  /** The helper was stopped in this window (cancelled or failed). Not set by words that were only found on the server. */
  stopped: boolean;
  /** The ask of a refine that failed (the design is shown again with `error` as a note), else null. Try again is `refine(lastAsk)`. */
  lastAsk: string | null;
  /** How the newest design landed: a plain first design, one that took the place of a waiting design, or a change to it. Null for a restored one. */
  landed: 'new' | 'replaced' | 'refined' | null;
  run(mode: 'create' | 'edit', instruction: string): void;
  /** An ask on the waiting design: runs mode 'edit' onto the design the server keeps; the first words stay, the ask is added to `asks`. */
  refine(words: string): void;
  cancel(): void;
  /**
   * Throws the run and its design away (the server copy too, only the version this window holds); keepInstruction leaves the
   * words for the Describe box; keepServerCopy skips the server delete (Use this already cleared it in the save).
   */
  discard(opts?: { keepInstruction?: boolean; keepServerCopy?: boolean }): void;
}

interface State {
  phase: UseDescribe['phase'];
  progress: DescribeProgress[];
  proposal: AppSpec | null;
  fallbacks: DescribeFallback[];
  baseRevision: number | null;
  error: DescribeError | null;
  ai: UseDescribe['ai'];
  instruction: string | null;
  mode: UseDescribe['mode'];
  asks: string[];
  replaced: AppSpec | null;
  waitingAt: string | null;
  stopped: boolean;
  lastAsk: string | null;
  landed: UseDescribe['landed'];
  /** A change to the waiting design was refused because the app was saved since: the design can no longer be used. */
  outdated: boolean;
}

const IDLE: State = {
  phase: 'idle',
  progress: [],
  proposal: null,
  fallbacks: [],
  baseRevision: null,
  error: null,
  ai: null,
  instruction: null,
  mode: null,
  asks: [],
  replaced: null,
  waitingAt: null,
  stopped: false,
  lastAsk: null,
  landed: null,
  outdated: false,
};
/** Said when a change to the waiting design is refused because the app was saved in another window. */
export const REFINE_CONFLICT = 'This app was saved in another window, so the waiting design is out of date.';
const GENERIC = 'The helper stopped before it finished. Your text is kept. Try again.';

export function useDescribe(appId: string): UseDescribe {
  const { revision, spec, reload } = useWorkspace();
  const [state, setState] = useState<State>(IDLE);
  // The app whose waiting design has been asked for: `hydrated` is false again as soon as another app is open.
  const [hydratedId, setHydratedId] = useState<string | null>(null);
  // A build without the helper keeps no waiting design on the server and asks for none: nothing waits, so it is hydrated at once.
  const hydrated = !PRO_PARTS.helper || hydratedId === appId;
  // Set once a run, cancel or discard has happened: a late answer from the server then no longer replaces what the person did.
  const touchedRef = useRef(false);
  const proposalRef = useRef<AppSpec | null>(null);
  // The state a run started from: a refine that fails or is cancelled goes back to it.
  const stateRef = useRef<State>(IDLE);
  // The last run: a refine (onto waiting) is told apart from a plain run when it ends.
  const lastRunRef = useRef<{ mode: 'create' | 'edit'; words: string; onto: 'waiting' | undefined; before: State } | null>(null);
  const waitingAtRef = useRef<string | null>(null);
  useEffect(() => {
    proposalRef.current = state.proposal;
    stateRef.current = state;
    waitingAtRef.current = state.waitingAt;
  }, [state]);
  const controllerRef = useRef<AbortController | null>(null);
  const revisionRef = useRef(revision);
  const titlesRef = useRef<Record<string, string>>({});
  const specRef = useRef(spec);
  useEffect(() => {
    revisionRef.current = revision;
    specRef.current = spec;
    titlesRef.current = Object.fromEntries((spec?.pages ?? []).map((p) => [p.id, p.title]));
  }, [revision, spec]);

  const abort = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  useEffect(() => abort, [abort]);

  useEffect(() => {
    if (!PRO_PARTS.helper) return undefined;
    touchedRef.current = false;
    const controller = new AbortController();
    const finish = (entry: WaitingEntry | null): void => {
      if (controller.signal.aborted) return;
      if (entry != null && !touchedRef.current) {
        const current = specRef.current;
        const proposal = entry.proposal;
        const unchanged = proposal !== null && current !== undefined && current !== null && diffSpecs(current, proposal).length === 0;
        setState({
          ...IDLE,
          phase: proposal === null ? 'idle' : unchanged ? 'unchanged' : 'proposal',
          proposal,
          fallbacks: proposal === null ? [] : entry.fallbacks,
          baseRevision: proposal === null ? null : entry.baseRevision,
          instruction: entry.instruction === '' ? null : entry.instruction,
          mode: entry.mode,
          asks: entry.asks,
          replaced: entry.replaced,
          waitingAt: entry.at,
        });
      }
      setHydratedId(appId);
    };
    // A failing request (offline, no such app, an old server) means no waiting design.
    getWaiting(appId, controller.signal).then(finish, () => finish(null));
    return () => controller.abort();
  }, [appId]);

  const start = useCallback(
    (mode: 'create' | 'edit', instruction: string, onto: 'waiting' | undefined) => {
      abort();
      touchedRef.current = true;
      const controller = new AbortController();
      controllerRef.current = controller;
      const before = stateRef.current;
      // A refine that was already running keeps the design it started from.
      const restoreTo = lastRunRef.current?.onto === 'waiting' && before.phase === 'running' ? lastRunRef.current.before : before;
      lastRunRef.current = { mode, words: instruction, onto, before: restoreTo };
      const refining = onto === 'waiting';
      // An ask keeps the first words and the asks made so far; a plain run starts clean.
      setState((prev) =>
        refining
          ? { ...IDLE, phase: 'running', instruction: prev.instruction, mode: prev.mode, asks: prev.asks, proposal: prev.proposal, replaced: prev.replaced, baseRevision: prev.baseRevision, fallbacks: prev.fallbacks, waitingAt: prev.waitingAt }
          : { ...IDLE, phase: 'running', instruction, mode },
      );
      // A refine that fails goes back to the design it was asked on, the reason kept as a note; a plain run shows the failure.
      const failed = (prev: State, error: DescribeError, outdated = false): State =>
        refining
          ? { ...restoreTo, phase: 'proposal', error, lastAsk: instruction, ai: prev.ai, outdated }
          : { ...prev, phase: 'error', error, stopped: true };
      const onEvent = (event: DescribeEvent): void => {
        if (controller.signal.aborted) return;
        setState((prev) => {
          switch (event.type) {
            case 'meta':
              return { ...prev, ai: event.ai };
            case 'progress': {
              const { type: _type, ...progress } = event;
              void _type;
              // One row per step (and page): later events for it replace its status.
              const at = prev.progress.findIndex((r) => r.step === progress.step && r.pageId === progress.pageId);
              if (at === -1) return { ...prev, progress: [...prev.progress, progress] };
              return { ...prev, progress: prev.progress.map((r, i) => (i === at ? progress : r)) };
            }
            case 'proposal': {
              // An answer that changes nothing is not a waiting design: nothing can be used, so nothing is held back.
              const current = specRef.current;
              const unchanged = current !== undefined && current !== null && diffSpecs(current, event.proposal).length === 0;
              return {
                ...prev,
                phase: unchanged ? 'unchanged' : 'proposal',
                proposal: event.proposal,
                fallbacks: event.fallbacks,
                baseRevision: event.baseRevision,
                asks: refining ? [...prev.asks, instruction] : [],
                replaced: refining ? (event.replaced ?? prev.proposal) : null,
                waitingAt: event.at ?? null,
                landed: refining ? 'refined' : restoreTo.phase === 'proposal' ? 'replaced' : 'new',
              };
            }
            case 'error':
              return failed(prev, { code: event.code, message: event.message, reason: null });
            default:
              return prev;
          }
        });
      };
      runDescribeStream({ appId, mode, instruction, baseRevision: revisionRef.current, ...(onto !== undefined ? { onto } : {}), pageTitles: titlesRef.current, signal: controller.signal, onEvent }).then(
        () => {
          if (controller.signal.aborted) return;
          setState((prev) => (prev.phase === 'running' ? failed(prev, { code: null, message: GENERIC, reason: null }) : prev));
        },
        (err: unknown) => {
          if (controller.signal.aborted) return;
          // Refused before streaming because the app was saved since (another window): the design cannot be used any more, so
          // the record is read again and the stale pane takes over instead of Try again looping on the old revision.
          const conflict = refining && err instanceof StudioApiError && err.code === 'revision_conflict';
          const outdated = conflict || (refining && err instanceof StudioApiError && err.code === 'waiting_stale');
          if (conflict) Promise.resolve(reload()).catch(() => undefined);
          const error: DescribeError =
            err instanceof StudioApiError
              ? { code: err.code, message: conflict ? REFINE_CONFLICT : err.message, reason: err.reason }
              : { code: null, message: err instanceof Error && err.message ? err.message : GENERIC, reason: null };
          setState((prev) => failed(prev, error, outdated));
        },
      );
    },
    [abort, appId, reload],
  );

  const run = useCallback((mode: 'create' | 'edit', instruction: string) => start(mode, instruction, undefined), [start]);
  const refine = useCallback(
    (words: string) => {
      // Without a design that waits there is nothing to change: the server would refuse, so nothing is sent.
      if (proposalRef.current === null) return;
      start('edit', words, 'waiting');
    },
    [start],
  );

  // Cancel keeps the words: the person stopped the helper, not their text.
  const cancel = useCallback(() => {
    abort();
    touchedRef.current = true;
    const last = lastRunRef.current;
    // Stopping a change to a waiting design leaves that design as it was.
    if (last?.onto === 'waiting') {
      lastRunRef.current = null;
      // landed is cleared: the design is as it was, so nothing is announced and nothing takes focus.
      setState((prev) => (prev.phase === 'running' ? { ...last.before, ai: prev.ai, landed: null } : prev));
      return;
    }
    setState((prev) => ({ ...IDLE, instruction: prev.instruction, mode: prev.mode, stopped: true }));
  }, [abort]);

  const discard = useCallback(
    (opts?: { keepInstruction?: boolean; keepServerCopy?: boolean }) => {
      // A plain run in flight: the server entry may be another window's design (this window holds no version of it, or an older
      // one) and the aborted run writes nothing, so nothing is deleted there.
      const plainRunInFlight = lastRunRef.current?.onto === undefined && lastRunRef.current !== null && stateRef.current.phase === 'running';
      abort();
      touchedRef.current = true;
      lastRunRef.current = null;
      // The server copy goes too, so the design does not come back in another window; only the version this window holds, so a
      // newer design from another window stays. A failure changes nothing here.
      if (opts?.keepServerCopy !== true && !plainRunInFlight) deleteWaiting(appId, waitingAtRef.current).catch(() => undefined);
      setState((prev) => (opts?.keepInstruction ? { ...IDLE, instruction: prev.instruction, mode: prev.mode, stopped: prev.stopped } : IDLE));
    },
    [abort, appId],
  );

  // The design was made on an older revision than the app has now (hydrated after a save in Design, or the app was saved since).
  const stale = state.phase === 'proposal' && (state.outdated || (state.baseRevision !== null && state.baseRevision !== revision));

  return { ...state, hydrated, stale, run, refine, cancel, discard };
}
