// What the grid says (phase 21, section 6.5a): step words are spoken once, after the last step of a quick run; a refusal is
// spoken at once through a role="alert" line that remounts, so the same words are heard again.
import { useCallback, useEffect, useRef, useState } from 'react';

/** Quiet time after the last grid step before its words are spoken. */
export const GRID_SPEAK_DELAY_MS = 250;

export interface GridAlert {
  text: string;
  n: number;
}

/**
 * step(text): cancels a pending step and speaks `text` through `speak` GRID_SPEAK_DELAY_MS later.
 * refusal(text): cancels a pending step and sets `alert` to { text, n: previous n + 1 } (the alert line remounts).
 * cancel(): drops a pending step (any other notice calls it). The timer is cleared on unmount.
 */
export function useGridSpeech(speak: (text: string) => void): { alert: GridAlert | null; step(text: string): void; refusal(text: string): void; cancel(): void } {
  const [alert, setAlert] = useState<GridAlert | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const count = useRef(0);
  const speakRef = useRef(speak);
  useEffect(() => {
    speakRef.current = speak;
  });
  const cancel = useCallback((): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);
  const step = useCallback(
    (text: string): void => {
      cancel();
      timer.current = setTimeout(() => {
        timer.current = null;
        speakRef.current(text);
      }, GRID_SPEAK_DELAY_MS);
    },
    [cancel],
  );
  const refusal = useCallback(
    (text: string): void => {
      cancel();
      count.current += 1;
      setAlert({ text, n: count.current });
    },
    [cancel],
  );
  return { alert, step, refusal, cancel };
}
