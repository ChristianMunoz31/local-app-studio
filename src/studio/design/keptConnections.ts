// "Keep it this way" choices of the Data connections list, kept per app in this browser (localStorage), never in the spec.
// A missing, broken or non-array value reads as nothing kept; a storage error is swallowed.
import { lsKey } from '@/utils/storageKeys.js';

export const KEPT_MAX = 200;

const keyFor = (appId: string): string => lsKey(`studio.keptConnections.${appId}`);

export function readKept(appId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(keyFor(appId));
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === 'string').slice(-KEPT_MAX));
  } catch {
    return new Set();
  }
}

/** Stores at most KEPT_MAX keys, the newest (last added) kept. */
export function writeKept(appId: string, keys: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(keyFor(appId), JSON.stringify([...keys].slice(-KEPT_MAX)));
  } catch {
    // Storage full or blocked: the choice is lost on reload, nothing else.
  }
}
