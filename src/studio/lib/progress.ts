// Browser memory of what was tried and built per app (revisions), never kept in the spec.
import { lsKey } from '@/utils/storageKeys.js';

export interface Progress {
  previewed?: number;
  built?: number;
}

const keyOf = (appId: string): string => lsKey(`studio.progress.${appId}`);
const isRevision = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

export function readProgress(appId: string): Progress {
  try {
    const raw = window.localStorage.getItem(keyOf(appId));
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const { previewed, built } = parsed as { previewed?: unknown; built?: unknown };
    const out: Progress = {};
    if (isRevision(previewed)) out.previewed = previewed;
    if (isRevision(built)) out.built = built;
    return out;
  } catch {
    return {};
  }
}

export function markProgress(appId: string, step: 'preview' | 'build', revision: number): void {
  try {
    const next: Progress = { ...readProgress(appId), [step === 'preview' ? 'previewed' : 'built']: revision };
    window.localStorage.setItem(keyOf(appId), JSON.stringify(next));
  } catch {
    // Storage can be full or blocked; the marks are a convenience only.
  }
}

/** Forgets the marks of an app (it was removed). */
export function clearProgress(appId: string): void {
  try {
    window.localStorage.removeItem(keyOf(appId));
  } catch {
    // Storage can be blocked; nothing to forget then.
  }
}
