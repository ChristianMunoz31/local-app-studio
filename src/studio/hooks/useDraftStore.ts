// Writes the unsaved draft of one step to browser storage (debounced) and offers a stored one back when the step opens.
import { useEffect, useRef, useState } from 'react';
import { clearDraft, draftNotice, markKept, readDraft, takeKept, writeDraft } from '../lib/draftStore';
import type { DraftStep, StoredDraft } from '../lib/draftStore';

const WRITE_DELAY_MS = 400;

export interface DraftOffer {
  text: string;
  /** The stored payload; the step puts it on screen. */
  payload: unknown;
  /** The revision the stored draft was made from; when it is not the current one, Restore must not overwrite newer work. */
  baseRevision: number;
  /** Throws the stored draft away. */
  discard(): void;
  /** Hands the payload out and closes the offer; the step's own writes keep the draft stored from then on. */
  take(): unknown;
}

interface Options {
  appId: string;
  step: DraftStep;
  /** One draft per scope (Design: the page id), so a draft of another page is left alone. */
  scope?: string;
  revision: number;
  /** The revision the draft is made from (moves only with the draft's own saves). */
  baseRevision(): number;
  dirty: boolean;
  /** Read from refs: current at once, also while the step is going. */
  isDirty(): boolean;
  /** What to store; read when the write runs. */
  payload(): unknown;
  /** True when a stored payload is what is already saved (so there is nothing to offer). */
  isSaved(payload: unknown): boolean;
}

/**
 * While the draft is dirty it is written 400 ms after the last render with a change (and once more when the step goes); once
 * clean the stored copy is removed. A stored draft found when the step opens is offered, not applied: the result is null when there
 * was none or after Restore or Discard. New edits while an offer shows are written anyway and replace the offer.
 */
export function useDraftStore(opts: Options): DraftOffer | null {
  const { appId, step, scope, revision, dirty } = opts;
  const latest = useRef(opts);
  useEffect(() => {
    latest.current = opts;
  });
  // True when this step went away with the draft in this same visit (not a draft of an earlier visit): the notice then says it is still here.
  const [kept] = useState(() => takeKept(appId, step, scope));
  const [stored, setStored] = useState<StoredDraft | null>(() => {
    const found = readDraft(appId, step, scope);
    if (found === null) return null;
    if (opts.isSaved(found.payload)) {
      clearDraft(appId, step, scope);
      return null;
    }
    return found;
  });
  const written = useRef(false);

  useEffect(() => {
    if (!dirty) {
      if (written.current) {
        written.current = false;
        clearDraft(appId, step, scope);
      }
      return undefined;
    }
    const write = (): void => {
      written.current = true;
      writeDraft(appId, step, latest.current.baseRevision(), latest.current.payload(), Date.now(), scope);
    };
    const timer = setTimeout(() => {
      write();
      setStored(null);
    }, WRITE_DELAY_MS);
    // A reload or a closed tab inside the delay still keeps the edit.
    window.addEventListener('pagehide', write);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pagehide', write);
    };
  });

  // The step goes with edits still unsaved: keep them (the shell clears the copy when it manages to save them).
  useEffect(
    () => () => {
      const now = latest.current;
      if (!now.isDirty()) return;
      writeDraft(appId, step, now.baseRevision(), now.payload(), Date.now(), scope);
      markKept(appId, step, scope);
    },
    [appId, step, scope],
  );

  if (stored === null) return null;
  return {
    text: draftNotice(step, stored, revision, new Date(), kept),
    payload: stored.payload,
    baseRevision: stored.baseRevision,
    discard: () => {
      clearDraft(appId, step, scope);
      setStored(null);
    },
    take: () => {
      setStored(null);
      return stored.payload;
    },
  };
}
