// Undo and Redo for a draft (the Data step). Pure: every function returns a new history. The present value is the entry at `index`.
export interface HistoryEntry<T> {
  value: T;
  label: string;
  coalesceKey?: string;
}

export interface History<T> {
  entries: ReadonlyArray<HistoryEntry<T>>;
  index: number;
  /** True right after an Undo or Redo, so the next push never merges into the entry the person just moved to. */
  sealed: boolean;
}

/** The most entries kept, the starting one included. The oldest drop first. */
export const MAX_HISTORY = 50;

export const createHistory = <T>(initial: T): History<T> => ({ entries: [{ value: initial, label: '' }], index: 0, sealed: true });

export const present = <T>(h: History<T>): T => h.entries[h.index].value;

export interface PushOptions {
  label: string;
  /** Same key as the last entry: it is replaced, so typing in one box is one step. */
  coalesceKey?: string;
}

export function push<T>(h: History<T>, next: T, options: PushOptions): History<T> {
  const kept = h.entries.slice(0, h.index + 1);
  const last = kept[kept.length - 1];
  if (!h.sealed && h.index > 0 && options.coalesceKey !== undefined && last.coalesceKey === options.coalesceKey) {
    const entries = [...kept.slice(0, -1), { value: next, label: options.label, coalesceKey: options.coalesceKey }];
    return { entries, index: entries.length - 1, sealed: false };
  }
  const entry: HistoryEntry<T> = options.coalesceKey === undefined ? { value: next, label: options.label } : { value: next, label: options.label, coalesceKey: options.coalesceKey };
  const entries = [...kept, entry].slice(-MAX_HISTORY);
  return { entries, index: entries.length - 1, sealed: false };
}

export const canUndo = <T>(h: History<T>): boolean => h.index > 0;
export const canRedo = <T>(h: History<T>): boolean => h.index < h.entries.length - 1;

export const undo = <T>(h: History<T>): History<T> => (canUndo(h) ? { ...h, index: h.index - 1, sealed: true } : h);
export const redo = <T>(h: History<T>): History<T> => (canRedo(h) ? { ...h, index: h.index + 1, sealed: true } : h);
