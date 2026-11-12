import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import CatchBoundary from './CatchBoundary';
import ErrorFallback from './ErrorFallback';
import type { FallbackVariant } from './ErrorFallback';

interface Props {
  /** `workspace` around one app, `page` around the Apps and Features routes. */
  variant?: Exclude<FallbackVariant, 'step'>;
  children: ReactNode;
}

/** Around a whole Studio route: when the page itself cannot be drawn, the person still gets words, a way back and Copy details. */
export default function WorkspaceBoundary({ variant = 'workspace', children }: Props) {
  const { pathname } = useLocation();
  return (
    <CatchBoundary
      resetKey={pathname}
      fallback={({ error, componentStack, attempt, retry }) => (
        <ErrorFallback key={attempt} variant={variant} error={error} componentStack={componentStack} path={pathname} onRetry={retry} />
      )}
    >
      {children}
    </CatchBoundary>
  );
}
