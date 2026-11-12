// The kit-level error boundary: around the route outlet (src/App.jsx) and around each Settings section. It catches what
// the Studio boundaries cannot: a lazy route or section whose chunk fails to load, and a section that throws while
// drawing. Initial chunk: it imports no copy table (words are in src/utils/routeFailureWords.js) and no Studio code.
import { Component, createElement } from 'react';
import { Link } from 'react-router-dom';
import { ROUTE_FAILURE, isChunkFailure } from '../../utils/routeFailureWords.js';
import { btnPrimary, btnSecondary } from './formStyles.js';

function Fallback({ variant, chunk, attempt, onRetry, homeTo }) {
  const section = variant === 'section';
  return createElement(
    'div',
    { className: section ? '' : 'p-4 sm:p-6 max-w-3xl mx-auto' },
    createElement(
      'div',
      { role: 'alert', 'data-attempt': attempt, className: 'glass rounded-2xl p-5 space-y-3' },
      createElement('h2', { className: 'text-sm font-bold text-slate-slate100' }, section ? ROUTE_FAILURE.sectionTitle : ROUTE_FAILURE.pageTitle),
      createElement('p', { className: 'text-sm text-slate-slate300' }, chunk ? ROUTE_FAILURE.chunkSentence : ROUTE_FAILURE.renderSentence),
      createElement('p', { className: 'text-sm text-slate-slate300' }, ROUTE_FAILURE.safe),
      createElement('p', { className: 'text-sm font-medium text-slate-slate100' }, chunk ? ROUTE_FAILURE.chunkAction : ROUTE_FAILURE.renderAction),
      createElement(
        'div',
        { className: 'flex flex-wrap items-center gap-3' },
        // A lazy import that failed stays failed until the page is reloaded, so Try again would only fail again.
        chunk
          ? createElement('button', { type: 'button', className: btnPrimary, onClick: () => window.location.reload() }, ROUTE_FAILURE.reload)
          : createElement('button', { type: 'button', className: btnPrimary, onClick: onRetry }, ROUTE_FAILURE.tryAgain),
        !chunk && createElement('button', { type: 'button', className: btnSecondary, onClick: () => window.location.reload() }, ROUTE_FAILURE.reload),
        !section && homeTo && createElement(Link, { to: homeTo, className: 'text-sm text-accent-indigo underline rounded-md' }, ROUTE_FAILURE.goHome),
      ),
    ),
  );
}

/**
 * Catches a render or lazy-load failure below it. `resetKey` changes (a new route) start a fresh try.
 * @extends {Component<{ variant?: 'page' | 'section', resetKey?: string, homeTo?: string | null, children?: import('react').ReactNode }, { failed: boolean, error: unknown, attempt: number }>}
 */
export default class RouteBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false, error: null, attempt: 0 };
  }

  static getDerivedStateFromError(error) {
    return { failed: true, error };
  }

  componentDidUpdate(previous) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false, error: null });
  }

  retry = () => {
    this.setState((s) => ({ failed: false, error: null, attempt: s.attempt + 1 }));
  };

  render() {
    if (!this.state.failed) return this.props.children;
    const { variant = 'page', homeTo = '/' } = this.props;
    return createElement(Fallback, {
      variant,
      chunk: isChunkFailure(this.state.error),
      attempt: this.state.attempt,
      onRetry: this.retry,
      homeTo,
    });
  }
}
