// The right pane of the merged Prompt step (DESIGN-phase16.md 1.3): nothing to check yet, the helper at work, the helper's design
// with the choices, an answer with no changes, a failed run, or the bullets of the saved app. It owns the save of a design
// (the one save rule, 1.2) and moves focus to its heading when a design lands (1.4).
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import type { AppSpec, SpecIssue } from '@local-app-studio/runtime/spec/schema';
import { btnPrimary, btnSecondary, formErrorClass } from '@/components/shared/formStyles.js';
import { specNeeds } from '../design/indicator';
import { useDescribeSession } from '../hooks/useDescribeSession';
import { useFeatures } from '../hooks/useFeatures';
import { useStepChrome } from '../hooks/useStepChrome';
import { useWorkspace } from '../hooks/useWorkspace';
import { markHelperUsed } from '../lib/appMemory';
import { buildYourselfLabel, buildYourselfStep } from '../lib/buildYourself';
import { promptBullets } from '../lib/promptBullets';
import { STEP_FOCUS, isStarterSpec, stepPath } from '../lib/steps';
import type { StepId } from '../lib/steps';
import type { AskExitKind } from '../lib/askOutcome';
import AskForChange from './AskForChange';
import ProposalReview from './ProposalReview';
import PromptBullets, { ShowEverything } from './PromptBullets';
import { FOCUS_RING, HINT_CLASS } from './ui';

const KEPT = 'Your text is kept.';
export const HELPER_FAILED_TITLE = 'The helper could not make a design.';
export const DESIGN_STALE = 'You saved the app after this design was made. Make a new design to use the helper again.';
export const THROW_AWAY = 'Throw it away';
export const STALE_HELPER_DOWN = 'The helper is not set up, so Try again is off. Set it up above, or throw this design away.';
export const CHANGE_NOT_MADE = 'Your change was not made. The design below is as it was.';

type Mode = 'create' | 'edit';

/** The button to press again: the left box's for a first design, the Ask button of this pane for a change. */
const againButton = (mode: Mode): string => (mode === 'create' ? 'Make my app' : 'Ask');
const conflictCopy = (mode: Mode): string => `This app changed while the helper worked. Press ${againButton(mode)} again.`;
const retryCopy = (mode: Mode): string => `Change your words, then press ${againButton(mode)}.`;

export interface ReviewPaneProps {
  /** The mode the left pane is in: a first prompt to write (create) or a saved app to change (edit). */
  mode: Mode;
  /** The helper is not set up: Ask is off. */
  helperDown: boolean;
  /** The run failed because the helper is not set up; the setup card says so, so this pane shows no failure. */
  setupError: boolean;
  /** Puts the cursor in the prompt box (Try again on a first design). */
  onFocusPrompt(): void;
  /** Counts up when the pane heading should take focus (the left pane flipped to a saved app's view). */
  headingFocusToken?: number;
}

export default function ReviewPane({ mode, helperDown, setupError, onFocusPrompt, headingFocusToken = 0 }: ReviewPaneProps) {
  const { spec, record, save } = useWorkspace();
  const describe = useDescribeSession();
  const { go, announce } = useStepChrome();
  const { library } = useFeatures();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [applying, setApplying] = useState(false);
  // A failed save belongs to the design it was made on: another design shows none.
  const [failedSave, setFailedSave] = useState<{ message: string; issues: SpecIssue[]; design: AppSpec } | null>(null);
  // Try again on a change leaves the Ask box to take the cursor, as it does on a first design for the prompt box.
  const [focusAsk, setFocusAsk] = useState(false);
  const mounted = useRef(true);
  // True from the moment a run starts from this pane's Ask box until the run shows: the box unmounts then and focus must not fall to the page.
  const askedHere = useRef(false);
  const toStep = (step: StepId): void => go(stepPath(record.id, step));

  const { phase } = describe;
  const proposal = phase === 'proposal' || phase === 'unchanged' ? describe.proposal : null;
  const runMode: Mode = describe.mode ?? mode;
  const running = phase === 'running';
  const failed = phase === 'error' && describe.error !== null && !setupError;
  // A change to the waiting design that failed: the design is back, the reason is a note above it and Try again asks it again.
  const refineNote = phase === 'proposal' && describe.error !== null && describe.lastAsk !== null && !setupError ? describe.error.message : null;
  const stale = phase === 'proposal' && describe.stale;
  const applyError = failedSave !== null && failedSave.design === proposal ? failedSave : null;
  const starter = isStarterSpec(spec);

  // A design that lands while this step is shown takes focus. A design that was already waiting (a remount, or the one the server
  // kept coming back when the step opened) does not.
  const { hydrated, landed } = describe;
  const lastPhase = useRef(phase);
  const wasHydrated = useRef(hydrated);
  useEffect(() => {
    const before = lastPhase.current;
    const knew = wasHydrated.current;
    lastPhase.current = phase;
    wasHydrated.current = hydrated;
    // A change that was stopped puts the design back as it was (landed is null): nothing new landed, so focus stays where it is.
    const cancelledRefine = before === 'running' && phase === 'proposal' && landed === null;
    if (before !== phase && knew && !cancelledRefine && (phase === 'proposal' || phase === 'unchanged')) headingRef.current?.focus();
  }, [phase, hydrated, landed]);

  // The left pane moved to the saved app's view: the cursor goes to this pane's heading, not the page.
  const lastToken = useRef(headingFocusToken);
  useEffect(() => {
    if (lastToken.current === headingFocusToken) return;
    lastToken.current = headingFocusToken;
    headingRef.current?.focus();
  }, [headingFocusToken]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (running && askedHere.current) headingRef.current?.focus();
    if (!running) askedHere.current = false;
  }, [running]);

  const needs = useMemo(() => specNeeds(proposal ?? spec, library), [proposal, spec, library]);
  const savedBullets = useMemo(() => promptBullets({ spec, before: null, changes: [], needs }), [spec, needs]);

  const use = async (then: StepId): Promise<void> => {
    if (proposal === null || describe.baseRevision === null) return;
    setApplying(true);
    setFailedSave(null);
    const result = await save(proposal, { baseRevision: describe.baseRevision, clearWaiting: true, waitingAt: describe.waitingAt });
    setApplying(false);
    if (result.ok) {
      markHelperUsed(record.id);
      // The save already cleared the server's copy of this version: a second delete could remove another window's newer design.
      describe.discard({ keepServerCopy: true });
      announce("Saved the helper's design.");
      if (mounted.current) toStep(then);
    } else if (result.code === 'revision_conflict') {
      setFailedSave({ message: conflictCopy(runMode), issues: [], design: proposal });
    } else {
      setFailedSave({ message: result.message, issues: result.issues, design: proposal });
    }
  };

  const retryWords = (): void => {
    setFailedSave(null);
    describe.discard({ keepInstruction: true });
    if (runMode === 'create') onFocusPrompt();
    else setFocusAsk(true);
    announce(retryCopy(runMode));
  };

  // Try again on a design that was made before the app was saved: a plain run of the first words (the old design is replaced). The
  // mode follows the saved app now, not the old design: a starter makes a first design, a saved app is changed.
  const remake = (): void => {
    const words = describe.instruction?.trim() ?? '';
    if (words !== '') describe.run(starter ? 'create' : 'edit', words);
  };

  const runAgain = (): void => {
    const words = describe.instruction?.trim() ?? '';
    if (words !== '' && describe.mode !== null) describe.run(describe.mode, words);
  };

  // An ask on a design that waits changes that design (the server keeps it); an ask on the saved app is an edit run.
  const ask = (words: string): void => {
    askedHere.current = true;
    setFocusAsk(false);
    if (phase === 'proposal') {
      describe.refine(words);
      return;
    }
    describe.run('edit', words);
  };
  const exit = (kind: AskExitKind): void => {
    if (kind === 'data') go(stepPath(record.id, 'data'));
    else go(stepPath(record.id, 'design'), kind === 'look' ? { state: { ...STEP_FOCUS, shelfTab: 'look' } } : undefined);
  };
  // Once the box has the cursor the request is spent, so a box that mounts again later does not take it.
  const askBox = (
    <div onFocus={() => focusAsk && setFocusAsk(false)}>
      <AskForChange disabled={helperDown || running} takeFocus={focusAsk} onAsk={ask} />
    </div>
  );

  let heading: string;
  let body: ReactNode;
  if (running) {
    heading = 'The helper is working';
    body = (
      <div className="space-y-2">
        <p className={HINT_CLASS}>This can take a few minutes on this computer.</p>
        {describe.progress.length > 0 && (
          <ul className="space-y-1.5 text-sm text-slate-slate300" aria-label="Progress">
            {describe.progress.map((p, i) => (
              <li key={i} className="flex items-center gap-2">
                {p.status === 'running' ? (
                  <Loader2 size={14} className="animate-spin" role="img" aria-label="Working on" />
                ) : p.status === 'done' ? (
                  <Check size={14} className="text-accent-green" role="img" aria-label="Done" />
                ) : (
                  <X size={14} className="text-accent-red" role="img" aria-label="Could not finish" />
                )}
                <span>{p.message || 'Working on your app'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  } else if (stale) {
    heading = describe.instruction !== null && describe.mode === 'edit' ? 'Your changes' : 'What the helper made';
    body = (
      <div className="space-y-4">
        <p className="text-sm text-slate-slate100">{DESIGN_STALE}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnPrimary} onClick={remake} disabled={(describe.instruction?.trim() ?? '') === '' || helperDown}>
            Try again
          </button>
          <button type="button" className={btnSecondary} onClick={() => describe.discard()}>
            {THROW_AWAY}
          </button>
        </div>
        {helperDown && <p className={HINT_CLASS}>{STALE_HELPER_DOWN}</p>}
      </div>
    );
  } else if (proposal !== null) {
    const unchanged = phase === 'unchanged';
    heading = unchanged || runMode === 'edit' ? 'Your changes' : 'What the helper made';
    body = (
      <div className="space-y-4">
        {refineNote !== null && (
          <div className="space-y-1">
            <p className={formErrorClass}>{refineNote}</p>
            <p className="text-sm text-slate-slate300">{CHANGE_NOT_MADE}</p>
          </div>
        )}
        <ProposalReview
          mode={runMode}
          before={spec}
          proposal={proposal}
          fallbacks={describe.fallbacks}
          instruction={describe.instruction}
          asks={describe.asks}
          replaced={describe.replaced}
          needs={needs}
          applying={applying}
          applyError={applyError}
          onUse={() => void use('design')}
          onUseAndTry={() => void use('preview')}
          onRetry={refineNote !== null && describe.lastAsk !== null ? () => describe.refine(describe.lastAsk ?? '') : retryWords}
          onExit={exit}
        />
        {askBox}
      </div>
    );
  } else if (failed) {
    const message = describe.error?.message ?? '';
    heading = HELPER_FAILED_TITLE;
    body = (
      <div className="space-y-4">
        <p className={formErrorClass}>{message}</p>
        {!message.includes(KEPT) && <p className="text-sm text-slate-slate300">{KEPT}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnPrimary} onClick={runAgain}>
            Try again
          </button>
          <button type="button" className={btnSecondary} onClick={() => toStep(buildYourselfStep(spec))}>
            {buildYourselfLabel(spec)}
          </button>
        </div>
      </div>
    );
  } else if (starter) {
    heading = 'Nothing to check yet';
    body = <p className="text-sm text-slate-slate300">Write your prompt and the helper&apos;s design shows here.</p>;
  } else {
    heading = 'Your app';
    body = (
      <div className="space-y-4">
        <PromptBullets bullets={savedBullets} />
        <ShowEverything spec={spec} before={null} edit={false} bullets={savedBullets} />
        {askBox}
      </div>
    );
  }

  return (
    <section aria-labelledby={headingId} aria-busy={running || undefined} className="glass rounded-2xl p-5">
      <h3 id={headingId} ref={headingRef} tabIndex={-1} className={`mb-4 text-sm font-bold tracking-tight text-slate-slate100 ${FOCUS_RING}`}>
        {heading}
      </h3>
      {body}
    </section>
  );
}
