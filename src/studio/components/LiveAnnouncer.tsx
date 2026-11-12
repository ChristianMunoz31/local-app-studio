/**
 * One polite status region for the whole workspace. Pair it with useAnnouncer (hooks/useAnnouncer). The region itself never
 * remounts (a live region inserted with its text is not reliably spoken); each message is a fresh inner node, keyed by `n`.
 */
export function LiveAnnouncer({ text, n = 0 }: { text: string; n?: number }) {
  return (
    <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      <span key={n}>{text}</span>
    </p>
  );
}
