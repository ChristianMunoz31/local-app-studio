// Text hygiene shared by the format parsers (child process only).

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Drops control characters except tab, newline and carriage return. */
export const cleanText = (s) => s.replace(CONTROL_RE, '');

/** Cut at `max` UTF-16 units without leaving half of a surrogate pair. */
export function cutAt(text, max) {
  if (text.length <= max) return text;
  const end = text.charCodeAt(max - 1);
  return text.slice(0, end >= 0xd800 && end <= 0xdbff ? max - 1 : max);
}

/** Rounds to 2 decimals (positions in PDF user space units). */
export const round2 = (n) => Math.round(n * 100) / 100;
