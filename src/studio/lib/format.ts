// Small display helpers for the Build tab.

/** mm:ss, or h:mm:ss from one hour. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

/** Size in MB with one decimal. */
export const formatMb = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
