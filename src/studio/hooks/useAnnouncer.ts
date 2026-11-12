import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * announce(text) clears the region, then sets it on the next frame so a repeated message is spoken again. `n` counts the calls:
 * LiveAnnouncer keys its inner node by it, so every message is a fresh node inside a live region that already exists.
 */
export function useAnnouncer(): { text: string; n: number; announce(text: string): void } {
  const [text, setText] = useState('');
  const [n, setN] = useState(0);
  const frame = useRef<number | null>(null);
  const cancel = useCallback((): void => {
    if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);
  const announce = useCallback(
    (next: string): void => {
      cancel();
      setText('');
      setN((count) => count + 1);
      frame.current = window.requestAnimationFrame(() => {
        frame.current = null;
        setText(next);
      });
    },
    [cancel],
  );
  return { text, n, announce };
}
