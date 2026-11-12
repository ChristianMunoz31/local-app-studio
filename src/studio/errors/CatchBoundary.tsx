import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  /** When this changes while the fallback is showing, the boundary tries its children again. */
  resetKey: string;
  /** `attempt` counts the Try again presses, so a fallback that fails again can start fresh (focus, status). */
  fallback(failure: { error: unknown; componentStack: string | null; attempt: number; retry(): void }): ReactNode;
  children: ReactNode;
}

interface State {
  failed: boolean;
  error: unknown;
  componentStack: string | null;
  attempt: number;
}

const CLEAN = { failed: false, error: null, componentStack: null } as const;

/** The one error boundary class behind StepBoundary, WorkspaceBoundary and the page boundaries. */
export default class CatchBoundary extends Component<Props, State> {
  state: State = { ...CLEAN, attempt: 0 };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { failed: true, error, componentStack: null };
  }

  componentDidCatch(_error: unknown, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null });
  }

  componentDidUpdate(previous: Props): void {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState((s) => ({ ...CLEAN, attempt: s.attempt }));
  }

  private retry = (): void => {
    this.setState((s) => ({ ...CLEAN, attempt: s.attempt + 1 }));
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return this.props.fallback({ error: this.state.error, componentStack: this.state.componentStack, attempt: this.state.attempt, retry: this.retry });
  }
}
