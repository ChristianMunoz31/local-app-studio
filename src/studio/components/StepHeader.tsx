// The five step rail with Back and Next at its right end (DESIGN-phase12.md 2.1). Links carry STEP_FOCUS; the workspace
// shell intercepts their clicks while there is something to save, so the rail has no click handlers of its own.
import { useId } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { btnPrimary, btnSecondary } from '@/components/shared/formStyles.js';
import { STEP_FOCUS, STEPS, backLabel, nextLabel, stepPath } from '../lib/steps';
import type { StepId, StepState } from '../lib/steps';
import { HINT_CLASS, SELECTED_CLASS } from './ui';

export interface StepNav {
  back: StepId | null;
  forward: StepId | null;
  /** True where the step body has no primary of its own (Design, Data, Preview). */
  forwardPrimary: boolean;
  /** Why Next is off on this step, or null. */
  forwardBlocked: string | null;
  busy: boolean;
  /** Both buttons stay focusable while busy or blocked (aria-disabled), so these are called anyway and must check. */
  onBack(): void;
  onNext(): void;
}

interface Props {
  appId: string;
  states: Record<StepId, StepState>;
  current: StepId | null;
  /** The step marked "(next)", or null. */
  next: StepId | null;
  nav: StepNav;
  /** Max width of the rail, so it lines up with the page body under it. */
  widthClass?: string;
}

const OFF = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-50';
const FOCUS = 'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-brandLight';
const STATE_CLASS: Record<StepState, string> = {
  current: SELECTED_CLASS,
  done: 'text-slate-slate200 hover:bg-slate-slate700/60',
  todo: 'text-slate-slate300 hover:bg-slate-slate700/60',
};

export default function StepHeader({ appId, states, current, next, nav, widthClass = 'max-w-5xl' }: Props) {
  const reasonId = useId();
  const blocked = nav.forwardBlocked;
  return (
    <div className={`mx-auto flex w-full ${widthClass} flex-wrap items-center justify-between gap-3 px-4 sm:px-6`}>
      <nav aria-label="Steps">
        <ol className="flex flex-wrap items-center gap-1">
          {STEPS.map((step, index) => {
            const state = states[step.id];
            const isNext = next === step.id && current !== step.id;
            return (
              <li key={step.id}>
                <Link
                  to={stepPath(appId, step.id)}
                  state={STEP_FOCUS}
                  aria-current={current === step.id ? 'step' : undefined}
                  className={`inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold ${FOCUS} ${STATE_CLASS[state]}`}
                >
                  <span
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full border border-current text-xs ${isNext ? 'ring-2 ring-accent-indigo' : ''}`}
                  >
                    {state === 'done' ? <Check size={14} className="text-accent-green" aria-hidden="true" /> : index + 1}
                  </span>
                  {step.label}
                  {state === 'done' && <span className="sr-only"> (done)</span>}
                  {isNext && <span className="sr-only"> (next)</span>}
                </Link>
              </li>
            );
          })}
        </ol>
      </nav>
      {(nav.back !== null || nav.forward !== null) && (
        <div role="group" aria-label="Move between steps" className="flex items-center gap-2">
          {nav.back !== null && (
            <button
              type="button"
              className={`${btnSecondary} ${OFF} inline-flex items-center gap-1.5`}
              onClick={nav.onBack}
              aria-disabled={nav.busy ? true : undefined}
            >
              <ArrowLeft size={14} aria-hidden="true" />
              {backLabel(nav.back)}
            </button>
          )}
          {nav.forward !== null && (
            <button
              type="button"
              className={`${nav.forwardPrimary ? btnPrimary : btnSecondary} ${OFF} inline-flex items-center gap-1.5`}
              onClick={nav.onNext}
              aria-disabled={nav.busy || blocked !== null ? true : undefined}
              aria-describedby={blocked !== null ? reasonId : undefined}
            >
              {nav.busy ? 'Saving...' : nextLabel(nav.forward)}
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      {/* The reason's row is held while Next is there, so a block that comes and goes does not move the page. */}
      {nav.forward !== null && (
        <div className="min-h-4 w-full text-right">
          {blocked !== null && (
            <p id={reasonId} className={HINT_CLASS}>
              {blocked}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
