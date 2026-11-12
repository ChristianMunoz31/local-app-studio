// The runtime's error boundary for one page. It wraps the page body inside the menu frame, so the side or top menu
// stays usable; SpecApp keys it by pathname, so a menu click starts a fresh page. No Copy details here: a built app has
// no diagnostics endpoint (DESIGN-phase15 7.2). Theme tokens only.
import { Component, createElement } from 'react';
import { Link } from 'react-router-dom';
import { ERROR_TEXT } from '@/catalog/errorText.ts';

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:var(--focus-ring)]';
const BUTTON = `rounded-lg border border-[color:var(--glass-border)] px-3 py-1.5 text-sm text-slate-slate100 ${FOCUS}`;

function Fallback({ homeTo, atHome, hasMenu }) {
  return createElement(
    'div',
    { className: 'p-4 sm:p-6 max-w-7xl mx-auto' },
    createElement(
      'div',
      { role: 'alert', className: 'glass rounded-2xl p-5 space-y-3' },
      createElement('h2', { className: 'text-sm font-bold text-slate-slate100' }, ERROR_TEXT.boundaryTitle),
      createElement('p', { className: 'text-sm text-slate-slate400' }, ERROR_TEXT.boundarySafe),
      createElement('p', { className: 'text-sm text-slate-slate400' }, hasMenu ? ERROR_TEXT.boundaryAction : ERROR_TEXT.boundaryActionNoMenu),
      createElement(
        'div',
        { className: 'flex flex-wrap items-center gap-3' },
        createElement(
          'button',
          { type: 'button', className: BUTTON, onClick: () => window.location.reload() },
          ERROR_TEXT.reload,
        ),
        !atHome && createElement(Link, { to: homeTo, className: `text-sm text-accent-indigo underline rounded-md ${FOCUS}` }, ERROR_TEXT.goHome),
      ),
    ),
  );
}

/**
 * Catches a render error of the page body and shows what to do next. Reset it by changing its `key`.
 * @extends {Component<{ homeTo?: string, atHome?: boolean, hasMenu?: boolean, children?: import('react').ReactNode }, { failed: boolean }>}
 */
export class PageBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return createElement(Fallback, { homeTo: this.props.homeTo ?? '/', atHome: this.props.atHome === true, hasMenu: this.props.hasMenu !== false });
    return this.props.children;
  }
}
