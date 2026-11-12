// The features and parts a person used last in Design, newest first, kept in this browser (localStorage). Pure apart
// from the storage and one window event. A bad or missing value reads as an empty list; a storage error is swallowed.
import { lsKey } from '@/utils/storageKeys.js';

export const RECENT_KEY = lsKey('studio.recentFeatures');
export const RECENT_MAX = 8;
/** Fired on window after the list changes, so another view of it can refresh. */
export const RECENT_EVENT = 'studio:recent';

const KEY_RE = /^(part|feature):[A-Za-z0-9_]{1,64}$/;

/** The stored keys, newest first: only well-formed, unique keys, at most RECENT_MAX. */
export function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    for (const item of parsed) {
      if (typeof item === 'string' && KEY_RE.test(item) && !out.includes(item)) out.push(item);
      if (out.length === RECENT_MAX) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** Puts a key at the front, drops its older copy and keeps RECENT_MAX. A key that is not well formed is ignored. */
export function recordRecent(key: string): void {
  if (!KEY_RE.test(key)) return;
  const next = [key, ...readRecent().filter((k) => k !== key)].slice(0, RECENT_MAX);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Private mode or a full disk: the list just is not kept.
  }
  window.dispatchEvent(new Event(RECENT_EVENT));
}

/** Calls `cb` after the list changes in this tab. Returns the unsubscribe function. */
export function subscribeRecent(cb: () => void): () => void {
  window.addEventListener(RECENT_EVENT, cb);
  return () => window.removeEventListener(RECENT_EVENT, cb);
}
