// The plain review of the helper's design (DESIGN-phase16.md 1.3): the person's words, removal warnings out in the open, the
// bullets, the choices, and everything behind "Show everything" after the buttons. The pane's heading and its Ask box belong to
// ReviewPane. Nothing is saved until Use this.
import { useEffect, useMemo, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { AppSpec, SpecIssue } from '@local-app-studio/runtime/spec/schema';
import { btnPrimary, btnSecondary, formErrorClass } from '@/components/shared/formStyles.js';
import type { PartNeed } from '../design/indicator';
import type { DescribeFallback } from '../types';
import { askOutcome } from '../lib/askOutcome';
import type { AskExitKind } from '../lib/askOutcome';
import { notMade } from '../lib/notMade';
import { changeBullets, placeBullets, promptBullets, shortQuote } from '../lib/promptBullets';
import { diffSpecs } from '../lib/specDiff';
import IssueList from './IssueList';
import PromptBullets, { AskResult, PlaceLines, ShowEverything } from './PromptBullets';
import { WARN_BOX_CLASS } from './ui';

export { SummaryLines } from './PromptBullets';

const FALLBACK_COPY = 'The helper could not make this part. After you press Use this, add it yourself in Design.';
export const NO_CHANGES = 'The helper suggested no changes. Try other words.';
export const ASKED_FOR = 'You asked for: ';
export const ASKED_BEFORE = 'Asked before: ';
const ASKED_MAX = 300;
const NO_ASKS: readonly string[] = [];
const OFF = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

export interface ProposalReviewProps {
  mode: 'create' | 'edit';
  before: AppSpec;
  proposal: AppSpec;
  fallbacks: DescribeFallback[];
  /** The person's words for this design (the prompt of a first design, the ask of an edit), or null. */
  instruction: string | null;
  /** The asks made on this waiting design, newest last. Only the newest is shown as "You asked for". */
  asks?: readonly string[];
  /** The waiting design the newest ask replaced (what that ask is judged against), or null. */
  replaced?: AppSpec | null;
  /** Parts of the proposal that cannot connect (specNeeds), for the bullets. */
  needs: readonly PartNeed[];
  applying: boolean;
  applyError: { message: string; issues: SpecIssue[] } | null;
  onUse(): void;
  onUseAndTry(): void;
  onRetry(): void;
  /** The person chose to do a not done ask by hand. */
  onExit(kind: AskExitKind): void;
}

export default function ProposalReview({
  mode,
  before,
  proposal,
  fallbacks,
  instruction,
  asks = NO_ASKS,
  replaced = null,
  needs,
  applying,
  applyError,
  onUse,
  onUseAndTry,
  onRetry,
  onExit,
}: ProposalReviewProps) {
  const errorRef = useRef<HTMLParagraphElement>(null);
  const changes = useMemo(() => diffSpecs(before, proposal), [before, proposal]);
  // The ask to judge and the design it was made on: the newest ask on a waiting design (against the design it replaced), or the
  // words of an edit of the saved app (against the saved app). A first design has no ask to judge.
  const newest = asks.length > 0 ? asks[asks.length - 1] : null;
  const words = instruction?.trim() ?? '';
  const judged = useMemo((): { ask: string; base: AppSpec } | null => {
    if (newest !== null) return replaced === null ? null : { ask: newest, base: replaced };
    return mode === 'edit' && words !== '' ? { ask: words, base: before } : null;
  }, [newest, replaced, mode, words, before]);
  // What the ask changed: the diff against the design it was made on (the saved app, or the waiting design it replaced).
  const asked = useMemo(
    () => (judged === null ? null : judged.base === before ? changes : diffSpecs(judged.base, proposal)),
    [judged, before, changes, proposal],
  );
  const outcome = useMemo(() => {
    if (judged === null || asked === null) return null;
    return askOutcome({ ask: judged.ask, changes: asked, before: judged.base, after: proposal });
  }, [judged, asked, proposal]);
  const places = useMemo(() => placeBullets(judged?.base ?? before, proposal, asked ?? changes), [judged, before, proposal, asked, changes]);
  const bullets = useMemo(
    () =>
      promptBullets({
        spec: proposal,
        before: mode === 'edit' ? before : null,
        // An ask lists its own changes under "It also changed"; without one the bullets list the changes.
        changes: mode === 'edit' && judged === null ? changes : [],
        needs,
      }),
    [proposal, before, mode, judged, changes, needs],
  );
  const also = useMemo(() => (outcome === null ? { shown: [], more: 0 } : changeBullets(proposal, outcome.alsoChanged)), [outcome, proposal]);
  const missing = useMemo(() => (mode === 'create' && words !== '' ? notMade(words, proposal) : null), [mode, words, proposal]);
  const risky = changes.filter((c) => c.destructive);

  // A failed Use this: the buttons were busy and lost focus, so the error takes it and is read in full.
  useEffect(() => {
    if (applyError !== null) errorRef.current?.focus();
  }, [applyError]);

  const pageTitle = (pageId: string | undefined): string | null => {
    if (!pageId) return null;
    return proposal.pages.find((p) => p.id === pageId)?.title ?? before.pages.find((p) => p.id === pageId)?.title ?? null;
  };

  const earlier = asks.slice(0, -1);
  const quoted = newest ?? words;
  const askedFor =
    quoted !== '' ? (
      <div className="space-y-1">
        <p className="text-sm text-slate-slate300">
          <span className="font-semibold text-slate-slate100">{ASKED_FOR}</span>
          <q>{shortQuote(quoted, ASKED_MAX)}</q>
        </p>
        {earlier.length > 0 && (
          <p className="text-xs text-slate-slate400">
            <span className="font-semibold">{ASKED_BEFORE}</span>
            {earlier.map((a, i) => (
              <span key={`${i}:${a}`}>
                {i > 0 ? ' ' : ''}
                <q>{shortQuote(a, ASKED_MAX)}</q>
              </span>
            ))}
          </p>
        )}
      </div>
    ) : null;
  const result = outcome === null ? null : <AskResult outcome={outcome} also={also} onExit={onExit} />;

  if (changes.length === 0) {
    return (
      <div className="space-y-4">
        {askedFor}
        {result ?? <p className="text-sm text-slate-slate300">{NO_CHANGES}</p>}
        <PlaceLines lines={places} />
        <div className="flex gap-2">
          <button type="button" className={btnSecondary} onClick={onRetry}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {askedFor}
      {result}
      {risky.length > 0 && (
        <section aria-label="Removal warning" className={WARN_BOX_CLASS}>
          <h4 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-accent-red">
            <AlertTriangle size={14} aria-hidden="true" />
            These changes remove or reshape data
          </h4>
          <ul className="space-y-1 text-sm text-slate-slate100">
            {risky.map((c) => (
              <li key={`${c.path}:${c.sentence}`}>{c.sentence}</li>
            ))}
          </ul>
        </section>
      )}
      <PlaceLines lines={places} />

      <PromptBullets bullets={bullets} />

      {missing !== null && missing.line !== null && <p className="text-sm text-slate-slate100">{missing.line}</p>}

      {fallbacks.length > 0 && (
        <ul className="space-y-2" aria-label="Parts the helper could not make">
          {fallbacks.map((f, i) => {
            const page = pageTitle(f.pageId);
            return (
              <li key={i} className="flex gap-1.5 rounded-lg border border-accent-amber/40 bg-accent-amber/10 p-3 text-sm text-slate-slate100">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-accent-amber" aria-hidden="true" />
                <span>
                  {page !== null ? `Page ${page}: ` : ''}
                  {`${f.message} ${FALLBACK_COPY}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {applyError && (
        <div className="space-y-2">
          <p ref={errorRef} tabIndex={-1} role="alert" className={`${formErrorClass} focus-visible:outline-hidden`}>
            {applyError.message}
          </p>
          <IssueList issues={applyError.issues} spec={proposal} alert={false} />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {/* aria-disabled, not disabled: the pressed button keeps focus while the save runs (a disabled one drops it). */}
        <button type="button" className={`${btnPrimary} ${OFF}`} onClick={() => !applying && onUse()} aria-disabled={applying ? true : undefined}>
          {applying ? 'Saving...' : 'Use this'}
        </button>
        <button type="button" className={`${btnSecondary} ${OFF}`} onClick={() => !applying && onUseAndTry()} aria-disabled={applying ? true : undefined}>
          Use this and try it
        </button>
        <button type="button" className={`${btnSecondary} ${OFF}`} onClick={() => !applying && onRetry()} aria-disabled={applying ? true : undefined}>
          Try again
        </button>
      </div>

      <ShowEverything spec={proposal} before={before} edit={mode === 'edit'} bullets={bullets} />
    </div>
  );
}
