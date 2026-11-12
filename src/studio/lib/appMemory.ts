// Browser memory kept per app next to the progress marks (lib/progress.ts): the prompt words, whether a helper design was used,
// and the made-from-words marker. None of it is kept in the spec. Everything about one app goes with forgetApp().
import { lsKey } from '@/utils/storageKeys.js';
import { clearDraft } from './draftStore';
import { clearProgress } from './progress';

const promptKey = (appId: string): string => lsKey(`studio.prompt.${appId}`);
const helperKey = (appId: string): string => lsKey(`studio.helperUsed.${appId}`);
const freshKey = (appId: string): string => lsKey(`studio.fresh.${appId}`);
/** Words waiting in the Apps start box. Not tied to an app, because the app they came from is gone. */
const START_KEY = lsKey('studio.startWords');

const read = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string | null): void => {
  try {
    if (value === null || value === '') window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage can be full or blocked; this memory is a convenience only.
  }
};

/** The prompt words of an app, or '' when none are kept. */
export const readPrompt = (appId: string): string => read(promptKey(appId)) ?? '';
/** Keeps the prompt words; empty words clear the key. */
export const writePrompt = (appId: string, text: string): void => write(promptKey(appId), text.trim() === '' ? null : text);

/** True once a helper design was used (Use this) for the app. */
export const readHelperUsed = (appId: string): boolean => read(helperKey(appId)) === '1';
export const markHelperUsed = (appId: string): void => write(helperKey(appId), '1');

/** An app made from words by Make my app: the revision it had right after creation (see removableEmptyApp). */
export const markFresh = (appId: string, revision: number): void => write(freshKey(appId), String(revision));
export function readFresh(appId: string): number | null {
  const raw = read(freshKey(appId));
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export const readStartWords = (): string => read(START_KEY) ?? '';
export const writeStartWords = (text: string): void => write(START_KEY, text.trim() === '' ? null : text);

/** Removes everything kept for one app (it was deleted). */
export function forgetApp(appId: string): void {
  write(promptKey(appId), null);
  write(helperKey(appId), null);
  write(freshKey(appId), null);
  clearProgress(appId);
  clearDraft(appId, 'data');
  clearDraft(appId, 'design');
}

/**
 * True for an app that is still the untouched starter and was made by Make my app: no saved revision beyond creation, so
 * removing it loses nothing. Anything else is never removed.
 */
export function removableEmptyApp(appId: string, revision: number, starter: boolean): boolean {
  const fresh = readFresh(appId);
  return starter && fresh !== null && revision === fresh;
}

/** Router state the workspace leaves for the Apps page after it removed an empty app, and the notice line it becomes. */
export const removedAppState = (name: string): { removedApp: string } => ({ removedApp: name });
export function readRemovedApp(state: unknown): string | null {
  if (typeof state !== 'object' || state === null) return null;
  const name: unknown = (state as { removedApp?: unknown }).removedApp;
  return typeof name === 'string' && name !== '' ? name : null;
}
export const removedAppNotice = (name: string): string => `Removed the empty app ${name}. Your words are back in the box.`;
