// What a step body can ask of the workspace shell: register a draft, move with the save rule, announce, mark progress.
import { createContext, useContext } from 'react';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';

export type DraftTab = 'data' | 'design';

export interface SaveOutcome {
  ok: boolean;
  reason?: string;
  cancelled?: boolean;
}

/**
 * A step's edits as the shell sees them. The draft owns its base (the revision of the spec it was loaded from, moved on only by its
 * own saves or by a newer record from elsewhere) and its dirty state, so the shell never has to wait for a render to know either.
 */
export interface StepDraft {
  /** Which stored draft this is when the step keeps one per scope (Design: the page id); none for Data. */
  scope?: string;
  /** True while the step holds edits its own saves have not sent. Read from refs: current at once, also after the step has gone. */
  isDirty(): boolean;
  /**
   * Saves the step's edits. Saves of one draft run one after the other, and each reads the draft's base when it runs, so a save
   * started while an earlier one is on its way sends the revision that one returned. The shell may also call it after the step
   * has unmounted (a move it could not intercept, such as the command palette), so it must not set state once the step is gone.
   */
  save(): Promise<SaveOutcome>;
  /** Why Save would be refused now (for example a part that is not connected), or null. */
  saveBlocked: string | null;
  /** Why Next is off on this step, or null. */
  nextBlocked: string | null;
  /** Throws the step's unsaved edits away (Discard), so isDirty() is false right away. */
  reset(): void;
  /** The whole app as the step has it on screen now (saved parts plus the unsaved edits), for "Export a copy". */
  exportSpec?(): AppSpec;
}

export interface StepChrome {
  setDraft(tab: DraftTab, draft: StepDraft | null): void;
  /** The save on move rule: saves dirty drafts, then navigates (STEP_FOCUS added for step paths). */
  go(to: string, opts?: { state?: Record<string, unknown> }): void;
  announce(text: string): void;
  /** Marks a step done for the revision the caller showed (not whatever revision is current when this runs). */
  markDone(step: 'preview' | 'build', revision: number): void;
}

const noop = (): void => undefined;

export const StepChromeContext = createContext<StepChrome>({ setDraft: noop, go: noop, announce: noop, markDone: noop });

export const useStepChrome = (): StepChrome => useContext(StepChromeContext);
