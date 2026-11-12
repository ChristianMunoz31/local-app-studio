// "5 minutes ago" for the Apps list, from Intl.RelativeTimeFormat so the list does not pull date-fns (the editor-libs chunk).
const FORMAT = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** The largest whole unit between `date` and `now` as relative text ("2 hours ago", "in 3 days"), "just now" under a minute. */
export function relativeTimeLabel(date: Date, now: Date = new Date()): string {
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);
  for (const [unit, size] of UNITS) {
    if (abs >= size) return FORMAT.format(Math.trunc(seconds / size), unit);
  }
  return 'just now';
}
