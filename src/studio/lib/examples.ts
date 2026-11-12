// Words and router state around the examples gallery (phase 20). Pure.
import { THEMES } from '@local-app-studio/runtime/theme/themes.ts';
import type { ThemeId } from '@local-app-studio/runtime/theme/ids.ts';

export const EXAMPLES_TITLE = 'Examples';
export const EXAMPLES_SUBTITLE = 'Open one, try it with sample data, then change it as your own.';
export const USE_EXAMPLE = 'Use this example';
export const USE_EXAMPLE_BUSY = 'Making your app...';
export const EXAMPLE_FAILED = 'Could not make the app from the example. Nothing was changed. Try again.';
export const EMPTY_EXAMPLES_SUFFIX = 'Or open an example below.';
export const EXAMPLES_HELP =
  'To start from a working app, press Use this example under Examples on the Apps page. It comes with sample records to try in Preview, and you can change it as your own.';
export const MADE_FROM_EXAMPLE_KEY = 'madeFromExample';

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

/** "Shows: a filter bar, linked tables". */
export const showsLine = (shows: readonly string[]): string => `Shows: ${shows.join(', ')}`;
/** "2 tables, 3 pages". */
export const countsLine = (tables: number, pages: number): string => `${plural(tables, 'table')}, ${plural(pages, 'page')}`;
/** "Forest look, dark". */
export const lookLine = (theme: ThemeId, mode: 'light' | 'dark'): string => `${THEMES[theme].label} look, ${mode}`;
/** The status line on Preview after Use this example. */
export const madeFromExampleNotice = (name: string): string => `Made ${name} from the example. It is yours to change.`;
/** "Ideas to try: a; b; c." */
export const tryTheseLine = (list: readonly string[]): string => `Ideas to try: ${list.join('; ')}.`;

export interface MadeFromExample {
  name: string;
  tryThese: string[];
}

/** Router state that carries the made-from-example note to Preview. */
export const madeFromExampleState = (name: string, tryThese: readonly string[]): { madeFromExample: MadeFromExample } => ({
  [MADE_FROM_EXAMPLE_KEY]: { name, tryThese: [...tryThese] },
});

/** The note out of router state, or null when the state holds none or a malformed one. */
export function readMadeFromExample(state: unknown): MadeFromExample | null {
  if (typeof state !== 'object' || state === null) return null;
  const value: unknown = (state as Record<string, unknown>)[MADE_FROM_EXAMPLE_KEY];
  if (typeof value !== 'object' || value === null) return null;
  const { name, tryThese } = value as { name?: unknown; tryThese?: unknown };
  if (typeof name !== 'string' || name === '') return null;
  const list = Array.isArray(tryThese) ? tryThese.filter((t): t is string => typeof t === 'string' && t !== '') : [];
  return { name, tryThese: list };
}
