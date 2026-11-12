// Preview process status for the Preview tab. Loads once on mount (and again when the saved revision changes, because the
// server restarts the preview on save), and polls only while the preview is starting or still shows an older revision of
// this app (a stale running status), every second at first and then slower, for a bounded number of tries.
import { useCallback, useEffect, useRef, useState } from 'react';
import { previewReset, previewStart, previewStatus, previewStop } from '../services/studioApi';
import type { PreviewStatus } from '../types';

const POLL_MS = 1000;
const POLL_MAX_MS = 5000;
const POLL_MAX_TRIES = 60;
const FAILED_FETCH = 'Studio could not reach the preview. Press Try again, or Restart in Preview options.';

export interface UsePreviewStatus {
  status: PreviewStatus | null;
  loading: boolean;
  error: string | null;
  busy: boolean;
  start(): Promise<void>;
  restart(): Promise<void>;
  stop(): Promise<void>;
  /** Resolves with the server's answer, or null when the reset failed (the error is set). */
  reset(): Promise<PreviewStatus | null>;
}

const messageOf = (err: unknown): string => (err instanceof Error && err.message ? err.message : FAILED_FETCH);

/** True while the preview is starting, or runs an older revision of this app (a restart after a save is on its way). */
function isWaiting(status: PreviewStatus | null, appId: string, revision: number): boolean {
  if (status === null) return false;
  if (status.state === 'starting') return true;
  return status.state === 'running' && status.appId === appId && status.revision !== revision;
}

export function usePreviewStatus(appId: string, revision: number): UsePreviewStatus {
  const [status, setStatus] = useState<PreviewStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    previewStatus().then(
      (next) => {
        if (!alive.current) return;
        setStatus(next);
        setError(null);
        setLoading(false);
      },
      (err: unknown) => {
        if (!alive.current) return;
        setError(messageOf(err));
        setLoading(false);
      },
    );
  }, [revision]);

  const waiting = isWaiting(status, appId, revision);
  useEffect(() => {
    if (!waiting) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let tries = 0;
    const schedule = (): void => {
      tries += 1;
      if (tries > POLL_MAX_TRIES) return;
      timer = setTimeout(tick, Math.min(POLL_MAX_MS, POLL_MS * (1 + Math.floor((tries - 1) / 10))));
    };
    const tick = (): void => {
      previewStatus().then(
        (next) => {
          if (stopped) return;
          setStatus(next);
          if (isWaiting(next, appId, revision)) schedule();
        },
        (err: unknown) => {
          if (stopped) return;
          setError(messageOf(err));
          schedule();
        },
      );
    };
    schedule();
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [waiting, appId, revision]);

  const run = useCallback(async (action: () => Promise<PreviewStatus>): Promise<PreviewStatus | null> => {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      if (alive.current) setStatus(next);
      return next;
    } catch (err) {
      // A start that the server could not carry out answers an error, but the server also remembers it as a failed preview.
      // Read that status back: the failed state (with Reset preview data) then says it once, so the error line stays empty.
      let refreshed: PreviewStatus | null = null;
      try {
        refreshed = await previewStatus();
      } catch {
        refreshed = null;
      }
      if (alive.current) {
        if (refreshed !== null) setStatus(refreshed);
        setError(refreshed !== null && refreshed.state === 'failed' ? null : messageOf(err));
      }
      return null;
    } finally {
      if (alive.current) setBusy(false);
    }
  }, []);

  const start = useCallback(async (): Promise<void> => {
    await run(() => previewStart(appId));
  }, [run, appId]);
  const stop = useCallback(async (): Promise<void> => {
    await run(previewStop);
  }, [run]);
  const reset = useCallback(() => run(() => previewReset(appId)), [run, appId]);

  return { status, loading, error, busy, start, restart: start, stop, reset };
}
