import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { btnPrimary, btnSecondary } from '@/components/shared/formStyles.js';
import { SURFACE_COPY, fillCopy } from '@/errors/surfaceCopy.js';
import { HINT_CLASS, WARN_BOX_CLASS } from '../components/ui';
import { errorWords } from '../lib/errorWords';
import { STEPS } from '../lib/steps';
import type { StepId } from '../lib/steps';
import { buildDetails, envelopeFor, fetchLogLines } from './copyDetails';

export type FallbackVariant = 'step' | 'workspace' | 'page';

interface Props {
  variant: FallbackVariant;
  error: unknown;
  /** React's component stack, when the boundary has it. */
  componentStack?: string | null;
  /** The step that failed (step variant). */
  step?: StepId;
  /** The address shown in Copy details; the Back to apps link is left out on /apps itself. */
  path: string;
  onRetry(): void;
}

const TITLE: Record<FallbackVariant, string> = {
  step: SURFACE_COPY.stepTitle,
  workspace: SURFACE_COPY.workspaceTitle,
  page: SURFACE_COPY.pageTitle,
};

/** Plain-words fallback of the Studio error boundaries: what happened, that saved work is safe, and what to do next. */
export default function ErrorFallback({ variant, error, componentStack = null, step, path, onRetry }: Props) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [busy, setBusy] = useState(false);
  const [copy, setCopy] = useState<{ status: 'idle' | 'copied' | 'refused'; text: string }>({ status: 'idle', text: '' });
  const words = errorWords(error, { boundary: true });
  const stepLabel = step !== undefined ? (STEPS.find((s) => s.id === step)?.label ?? null) : null;

  // A keyboard or screen reader person lands on the explanation, not on a page that no longer exists.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // A lazy import that failed stays failed (React.lazy keeps the rejection), so only a reload can help.
  const chunkFailed = words.code === 'chunk_load_failed';

  const copyDetails = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const logLines = await fetchLogLines();
      const text = buildDetails({ envelope: envelopeFor(error, componentStack), stepLabel, path, logLines, now: new Date() });
      try {
        await navigator.clipboard.writeText(text);
        setCopy({ status: 'copied', text });
      } catch {
        setCopy({ status: 'refused', text });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="alert" aria-labelledby={headingId} className="mx-auto w-full max-w-2xl space-y-4 p-4 sm:p-6">
      <div className={`${WARN_BOX_CLASS} space-y-3`}>
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-base font-semibold text-slate-slate100 focus-visible:outline-hidden">
          {TITLE[variant]}
        </h2>
        <p className="text-sm text-slate-slate100">
          {words.sentence}
          {stepLabel !== null ? ` ${fillCopy(SURFACE_COPY.stepWhere, { step: stepLabel })}` : ''}
        </p>
        <p className="text-sm text-slate-slate100">{variant === 'step' ? SURFACE_COPY.stepSaved : SURFACE_COPY.workspaceSaved}</p>
        <p className="text-sm font-medium text-slate-slate100">{words.action}</p>
        <div className="flex flex-wrap items-center gap-2">
          {!chunkFailed && (
            <button type="button" className={btnPrimary} onClick={onRetry}>
              {SURFACE_COPY.tryAgain}
            </button>
          )}
          <button type="button" className={chunkFailed ? btnPrimary : btnSecondary} onClick={() => window.location.reload()}>
            {SURFACE_COPY.reload}
          </button>
          <button type="button" className={btnSecondary} onClick={() => void copyDetails()} disabled={busy} aria-busy={busy}>
            {SURFACE_COPY.copyDetails}
          </button>
          {variant !== 'step' && path !== '/apps' && (
            <Link to="/apps" className="text-sm font-medium text-slate-slate200 underline underline-offset-2 hover:text-slate-slate100">
              {SURFACE_COPY.backToApps}
            </Link>
          )}
        </div>
        <p role="status" className={HINT_CLASS}>
          {copy.status === 'copied' ? SURFACE_COPY.detailsCopied : copy.status === 'refused' ? SURFACE_COPY.detailsCopyFailed : ''}
        </p>
        {copy.status === 'refused' && (
          <textarea
            readOnly
            aria-label={SURFACE_COPY.detailsLabel}
            value={copy.text}
            rows={8}
            onFocus={(e) => e.currentTarget.select()}
            className="glass-input w-full rounded-md p-2 font-mono text-xs text-slate-slate300"
          />
        )}
      </div>
    </div>
  );
}
