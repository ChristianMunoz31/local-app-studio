// Unsaved Data and Design drafts kept in browser storage per app and step, so a closed tab or a crash does not lose them. A stored
// draft carries the revision it was made from; reopening the step offers it back (Restore / Discard), never applies it silently.
import { lsKey } from '@/utils/storageKeys.js';
import { relativeTimeLabel } from './relativeTime';

export type DraftStep = 'data' | 'design';

export interface StoredDraft {
  baseRevision: number;
  savedAt: number;
  payload: unknown;
}

const STEP_LABEL: Record<DraftStep, string> = { data: 'Data', design: 'Design' };
export const DRAFT_CHANGED_NOTE = 'The app changed since, so check it before you save.';
export const DRAFT_RESTORE = 'Restore';
export const DRAFT_DISCARD = 'Discard';

/** The line for a Design draft this workspace kept when the person moved to another step, said when Design opens again in the same visit. */
export const draftKeptLine = (step: DraftStep): string => `Your unsaved changes on ${STEP_LABEL[step]} are still here.`;

/** Drafts kept by a move inside this page load; a reload empties it, so a draft found after one is "from an earlier visit". */
const keptThisVisit = new Set<string>();

/** A step went away with its draft unsaved and kept it (only Design says so when it comes back). */
export function markKept(appId: string, step: DraftStep, scope?: string): void {
  if (step === 'design') keptThisVisit.add(keyOf(appId, step, scope));
}

/** True once for a draft marked by markKept; the mark is then used up. */
export function takeKept(appId: string, step: DraftStep, scope?: string): boolean {
  return keptThisVisit.delete(keyOf(appId, step, scope));
}

/** A step may keep one draft per scope (Design: one per page), so a draft of one page is never taken for another's. */
const keyOf = (appId: string, step: DraftStep, scope?: string): string => lsKey(`studio.draft.${appId}.${step}${scope === undefined ? '' : `.${scope}`}`);

export function readDraft(appId: string, step: DraftStep, scope?: string): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(keyOf(appId, step, scope));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { baseRevision, savedAt, payload } = parsed as { baseRevision?: unknown; savedAt?: unknown; payload?: unknown };
    if (typeof baseRevision !== 'number' || typeof savedAt !== 'number' || payload === undefined || payload === null) return null;
    return { baseRevision, savedAt, payload };
  } catch {
    return null;
  }
}

export function writeDraft(appId: string, step: DraftStep, baseRevision: number, payload: unknown, now: number = Date.now(), scope?: string): void {
  try {
    window.localStorage.setItem(keyOf(appId, step, scope), JSON.stringify({ baseRevision, savedAt: now, payload }));
  } catch {
    // Storage can be full or blocked; the draft is a convenience on top of the normal save.
  }
}

/** Removes one scope's draft; without a scope, the step's draft and every scoped draft of that step (the app or the step is being reset). */
export function clearDraft(appId: string, step: DraftStep, scope?: string): void {
  // A draft that is gone is not "kept" any more.
  for (const key of [...keptThisVisit]) if (key === keyOf(appId, step, scope) || (scope === undefined && key.startsWith(`${keyOf(appId, step)}.`))) keptThisVisit.delete(key);
  try {
    window.localStorage.removeItem(keyOf(appId, step, scope));
    if (scope !== undefined) return;
    const prefix = `${keyOf(appId, step)}.`;
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key !== null && key.startsWith(prefix)) doomed.push(key);
    }
    for (const key of doomed) window.localStorage.removeItem(key);
  } catch {
    // Nothing to do: a leftover draft is offered again and can be discarded.
  }
}

/** The notice line for a stored draft; adds the note when the app is on a newer revision than the draft was made from. */
export function draftNotice(step: DraftStep, stored: StoredDraft, revision: number, now: Date = new Date(), kept = false): string {
  const line = kept ? draftKeptLine(step) : `You have unsaved changes on ${STEP_LABEL[step]} from ${relativeTimeLabel(new Date(stored.savedAt), now)}.`;
  return stored.baseRevision === revision ? line : `${line} ${DRAFT_CHANGED_NOTE}`;
}
