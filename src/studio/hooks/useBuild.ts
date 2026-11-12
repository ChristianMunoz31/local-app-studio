// Builds of one app: the history, the live build and its event stream (DESIGN-phase4.md section 6).
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { BuildEvent, BuildLogLine, BuildRecord, BuildStepState } from '../buildTypes';
import { cancelBuild, getBuild, listBuilds, startBuild, streamBuild } from '../services/buildApi';
import { StudioApiError } from '../services/studioApi';

export const MAX_LOG_LINES = 2000;
const TICK_MS = 1000;
const FRAME_FALLBACK_MS = 16;
export const REATTACH_TRIES = 3;
export const REATTACH_BASE_MS = 1000;
const FAILED = 'Could not reach the build. Your design is safe. Try again.';

export interface LiveBuild {
  build: BuildRecord;
  steps: BuildStepState[];
  lines: BuildLogLine[];
  truncated: boolean;
}

export interface UseBuild {
  builds: BuildRecord[];
  live: LiveBuild | null;
  elapsedMs: number;
  starting: boolean;
  error: string | null;
  /** The start was refused because the "App builds" network feature is off. */
  optInRequired: boolean;
  start(baseRevision: number): Promise<void>;
  cancel(): Promise<void>;
  reload(): Promise<void>;
}

type Action =
  | { type: 'reset' }
  | { type: 'begin'; build: BuildRecord }
  | { type: 'event'; event: BuildEvent }
  | { type: 'logs'; lines: BuildLogLine[] }
  | { type: 'settle'; build: BuildRecord };

const capLines = (lines: BuildLogLine[]): BuildLogLine[] => (lines.length > MAX_LOG_LINES ? lines.slice(lines.length - MAX_LOG_LINES) : lines);
const fresh = (build: BuildRecord): LiveBuild => ({ build, steps: [], lines: [], truncated: false });

function reduce(state: LiveBuild | null, action: Action): LiveBuild | null {
  switch (action.type) {
    case 'reset':
      return null;
    case 'begin':
      return fresh(action.build);
    case 'logs': {
      if (state === null) return state;
      let last = state.lines.length > 0 ? state.lines[state.lines.length - 1].seq : 0;
      const added = action.lines.filter((l) => {
        if (l.seq <= last) return false;
        last = l.seq;
        return true;
      });
      if (added.length === 0) return state;
      const lines = [...state.lines, ...added];
      return { ...state, lines: capLines(lines), truncated: state.truncated || lines.length > MAX_LOG_LINES };
    }
    case 'settle':
      return state && state.build.id === action.build.id ? { ...state, build: action.build } : fresh(action.build);
    case 'event': {
      const e = action.event;
      if (e.type === 'snapshot') {
        return { build: e.build, steps: e.steps, lines: capLines(e.lines), truncated: e.truncated || e.lines.length > MAX_LOG_LINES };
      }
      if (state === null) return state;
      if (e.type === 'step') {
        return {
          ...state,
          steps: state.steps.map((s) => (s.id === e.step ? { ...s, status: e.status, ...(e.status === 'running' ? { startedAt: e.at } : { finishedAt: e.at }) } : s)),
        };
      }
      if (e.type === 'log') return reduce(state, { type: 'logs', lines: [{ seq: e.seq, step: e.step, line: e.line }] });
      return { ...state, build: e.build };
    }
  }
}

const messageOf = (err: unknown): string => (err instanceof Error && err.message ? err.message : FAILED);

export function useBuild(appId: string): UseBuild {
  const [builds, setBuilds] = useState<BuildRecord[]>([]);
  const [live, dispatch] = useReducer(reduce, null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [optInRequired, setOptInRequired] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);
  const streamRef = useRef<AbortController | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retries = useRef(0);
  const stopFlush = useRef<(() => void) | null>(null);
  const attachRef = useRef<(buildId: string, isRetry?: boolean) => void>(() => undefined);

  const clearTimers = useCallback((): void => {
    if (retryTimer.current !== null) clearTimeout(retryTimer.current);
    retryTimer.current = null;
    stopFlush.current?.();
    stopFlush.current = null;
  }, []);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const rows = await listBuilds(appId);
      if (alive.current) setBuilds(rows);
    } catch (err) {
      if (alive.current) setError(messageOf(err));
    }
  }, [appId]);

  const finish = useCallback(
    async (build: BuildRecord): Promise<void> => {
      if (!alive.current) return;
      dispatch({ type: 'settle', build });
      await reload();
    },
    [reload],
  );

  const attach = useCallback(
    (buildId: string, isRetry = false): void => {
      streamRef.current?.abort();
      clearTimers();
      if (!isRetry) retries.current = 0;
      const controller = new AbortController();
      streamRef.current = controller;
      let ended = false;
      // Log lines are batched: at most one dispatch per animation frame (a 16 ms timer where there is none).
      let pending: BuildLogLine[] = [];
      const flush = (): void => {
        stopFlush.current?.();
        stopFlush.current = null;
        if (pending.length === 0 || controller.signal.aborted) return;
        const lines = pending;
        pending = [];
        dispatch({ type: 'logs', lines });
      };
      const schedule = (): void => {
        if (stopFlush.current !== null) return;
        if (typeof requestAnimationFrame === 'function') {
          const handle = requestAnimationFrame(flush);
          stopFlush.current = () => cancelAnimationFrame(handle);
        } else {
          const handle = setTimeout(flush, FRAME_FALLBACK_MS);
          stopFlush.current = () => clearTimeout(handle);
        }
      };
      const onEvent = (event: BuildEvent): void => {
        if (controller.signal.aborted) return;
        retries.current = 0;
        if (event.type === 'log') {
          pending.push({ seq: event.seq, step: event.step, line: event.line });
          schedule();
          return;
        }
        flush();
        dispatch({ type: 'event', event });
        if (event.type === 'end') {
          ended = true;
          void finish(event.build);
        }
      };
      // A stream that drops without an end event is settled with one look at the build.
      const recover = async (): Promise<void> => {
        if (ended || controller.signal.aborted) return;
        try {
          const build = await getBuild(buildId);
          if (controller.signal.aborted) return;
          if (build.status === 'running') {
            dispatch({ type: 'settle', build });
            // The build is still going: reattach with a short backoff. The server replays the log, the reducer drops seen lines.
            if (retries.current < REATTACH_TRIES && alive.current) {
              const delay = REATTACH_BASE_MS * 2 ** retries.current;
              retries.current += 1;
              retryTimer.current = setTimeout(() => {
                retryTimer.current = null;
                if (alive.current) attachRef.current(buildId, true);
              }, delay);
            }
          } else await finish(build);
        } catch (err) {
          if (alive.current && !controller.signal.aborted) setError(messageOf(err));
        }
      };
      streamBuild(buildId, { signal: controller.signal, onEvent }).then(recover, recover);
    },
    [finish, clearTimers],
  );

  useEffect(() => {
    attachRef.current = attach;
  }, [attach]);

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    dispatch({ type: 'reset' });
    listBuilds(appId, controller.signal).then(
      (rows) => {
        if (controller.signal.aborted) return;
        setBuilds(rows);
        if (rows.length > 0 && rows[0].status === 'running') {
          dispatch({ type: 'begin', build: rows[0] });
          attach(rows[0].id);
        }
      },
      (err: unknown) => {
        if (!controller.signal.aborted) setError(messageOf(err));
      },
    );
    return () => {
      alive.current = false;
      controller.abort();
      streamRef.current?.abort();
      clearTimers();
    };
  }, [appId, attach, clearTimers]);

  const running = live?.build.status === 'running';
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [running]);

  const start = useCallback(
    async (baseRevision: number): Promise<void> => {
      setStarting(true);
      setError(null);
      setOptInRequired(false);
      try {
        const build = await startBuild(appId, baseRevision);
        if (!alive.current) return;
        dispatch({ type: 'begin', build });
        setBuilds((prev) => [build, ...prev.filter((b) => b.id !== build.id)]);
        attach(build.id);
      } catch (err) {
        if (!alive.current) return;
        if (err instanceof StudioApiError && err.code === 'network_opt_in_required') setOptInRequired(true);
        else setError(messageOf(err));
      } finally {
        if (alive.current) setStarting(false);
      }
    },
    [appId, attach],
  );

  const cancel = useCallback(async (): Promise<void> => {
    if (live === null) return;
    try {
      const build = await cancelBuild(live.build.id);
      if (alive.current) await finish(build);
    } catch (err) {
      if (alive.current) setError(messageOf(err));
    }
  }, [live, finish]);

  const startedMs = live ? Date.parse(live.build.startedAt) : Number.NaN;
  const elapsedMs = !live ? 0 : running ? Math.max(0, now - (Number.isNaN(startedMs) ? now : startedMs)) : (live.build.durationMs ?? 0);

  return { builds, live, elapsedMs, starting, error, optInRequired, start, cancel, reload };
}
