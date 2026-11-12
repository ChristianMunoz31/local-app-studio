// Plain words for an error shown inside a built app: the sentence, then the one next step. Pure, no imports, so the
// runtime sidecar carries nothing Studio-only (DESIGN-phase15 7.2).

/**
 * Every string a built app shows for an error, a wait or a refusal. They stay here, not in `src/errors/surfaceCopy.js`:
 * this file has no imports, so the built app (and the sidecar bundle) carries no Studio copy table. Each says what
 * happened and, where there is something to do, the next step.
 */
export const ERROR_TEXT = {
  networkSentence: 'The app did not answer.',
  networkAction: 'Check that it is still running, then try again.',
  genericSentence: 'Something went wrong.',
  genericAction: 'Try again.',
  loadRowsFailed: "Couldn't load these rows. Try again.",
  saveFailed: 'Could not save. Try again.',
  addFailed: 'Could not add. Try again.',
  exportFailed: 'Export failed. Try again.',
  removeFailed: 'Could not remove this row. Try again.',
  tryAgain: 'Try again',
  boundaryTitle: 'This page could not be shown',
  boundarySafe: 'Your records are safe.',
  boundaryAction: 'Open another page from the menu, or reload the app.',
  // The same step for an app with no menu bar.
  boundaryActionNoMenu: 'Reload the app.',
  reload: 'Reload',
  goHome: 'Go to the home page',
  exportPreparing: 'Preparing export...',
  exportReady: 'Export ready. Check your downloads.',
  exportRateLimited: 'Too many exports. Try again in a few minutes.',
  exportTooLarge: 'This table is too large to export in one file. Remove rows you no longer need, then try again.',
  noRowsMatch: 'No rows match. Change the search or the filters.',
  checklistCannot: 'This list cannot be checked off here. Open a record to change it.',
  quickAddCannot: 'This list cannot take quick entries here. Use a form to add to it.',
  noDataConnected: 'No data is connected here. Reload the app.',
} as const;

/**
 * `<sentence> <action>`, with the action left out when the sentence already ends with it (case-insensitive).
 */
export function joinSentence(sentence: string, action: string | null | undefined): string {
  const base = sentence.trim();
  const next = typeof action === 'string' ? action.trim() : '';
  if (next === '') return base;
  if (base === '') return next;
  if (base.toLowerCase().endsWith(next.toLowerCase())) return base;
  return `${base} ${next}`;
}

function actionOf(e: unknown): string | null {
  if (typeof e !== 'object' || e === null) return null;
  const action = (e as { action?: unknown }).action;
  return typeof action === 'string' && action.trim() !== '' ? action : null;
}

/**
 * The line to show for a failed call: the error's message, followed by its next action when it carries one.
 * An error with no message gets `fallback`, which already names what to do.
 */
export function errorText(e: unknown, fallback: string): string {
  const message = e instanceof Error && e.message ? e.message : typeof e === 'string' && e !== '' ? e : '';
  if (message === '') return fallback;
  return joinSentence(message, actionOf(e));
}
