import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import type { StepId } from '../lib/steps';
import CatchBoundary from './CatchBoundary';
import ErrorFallback from './ErrorFallback';

interface Props {
  /** The step on screen, or null while the workspace is redirecting to one. */
  step: StepId | null;
  appId: string;
  children: ReactNode;
}

/** One per step: a step that throws shows the fallback while the rail, header and Back and Next stay usable. Mount it with key={step}. */
export default function StepBoundary({ step, appId, children }: Props) {
  const { pathname } = useLocation();
  return (
    <CatchBoundary
      resetKey={`${appId}/${step ?? ''}`}
      fallback={({ error, componentStack, attempt, retry }) => (
        <ErrorFallback key={attempt} variant="step" error={error} componentStack={componentStack} step={step ?? undefined} path={pathname} onRetry={retry} />
      )}
    >
      {children}
    </CatchBoundary>
  );
}
