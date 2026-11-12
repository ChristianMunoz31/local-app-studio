import { useEffect, useRef } from 'react';
import { CheckSquare } from 'lucide-react';
import { toolLabel } from '../../hooks/useAssistant';
import { RECORD_TEXT_NOTICE, readsLikeInstruction } from './recordTextNotice';

// The generic write of a built app carries `args.display`: one { label, value } string pair per changed field to show under the summary.
const displayRows = (args) =>
  Array.isArray(args?.display)
    ? args.display.filter((r) => r && typeof r.label === 'string' && typeof r.value === 'string')
    : [];

const BTN_BASE =
  'rounded-md px-3 py-1.5 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:var(--focus-ring)] aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

/**
 * Inline card for a write Assistant wants to make (`confirm.required`). Nothing is changed until
 * the user approves. `action`: { token, name, args, summary, status, result?, error? }.
 */
export default function ConfirmActionCard({ action, onRespond }) {
  const { token, name, summary, status, error } = action;
  const rows = displayRows(action.args);
  const working = status === 'working';
  const settled = status === 'approved' || status === 'declined' || status === 'expired';
  const checkText = readsLikeInstruction([summary, ...rows.map((r) => r.value)]);
  const cardRef = useRef(null);

  // Never take focus on mount. When the status changes, pull focus to the card only if it
  // was inside the card or fell to <body> (the focused button was replaced by the result);
  // focus the user moved elsewhere (for example the composer) is left alone.
  const seenStatus = useRef(status);
  useEffect(() => {
    if (seenStatus.current === status) return;
    seenStatus.current = status;
    const card = cardRef.current;
    const active = document.activeElement;
    if (card && (active === document.body || active === null || card.contains(active))) {
      card.focus();
    }
  }, [status]);

  const respond = (approve) => {
    if (working) return;
    onRespond(token, approve);
  };

  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      role="group"
      aria-label={`Confirm: ${summary || toolLabel(name)}`}
      className="glass-subtle rounded-lg outline-hidden focus-visible:outline focus-visible:outline-2 focus-visible:[outline-color:var(--focus-ring)] border border-accent-purple/30 px-3 py-2 text-sm text-slate-slate200"
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-slate400">
        Assistant wants to make a change
      </p>
      <p className="mt-0.5 break-words">{summary || toolLabel(name)}</p>
      {rows.length > 0 && (
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {rows.map((r, i) => (
            <div key={`${r.label}-${i}`} className="contents">
              <dt className="text-slate-slate400">{r.label}</dt>
              <dd className="break-words text-slate-slate200">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {checkText && !settled && (
        <p className="mt-1.5 text-xs text-accent-amber">{RECORD_TEXT_NOTICE}</p>
      )}
      {settled ? (
        <p role="status" className="mt-1.5 flex items-center gap-1 text-xs text-slate-slate300">
          {status === 'approved' && <CheckSquare size={12} className="text-accent-green" aria-hidden="true" />}
          {status === 'approved' && 'Done. The change was made.'}
          {status === 'declined' && 'Declined. Nothing was changed.'}
          {status === 'expired' && 'That request expired or was already handled. Ask Assistant again.'}
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-disabled={working || undefined}
            onClick={() => respond(true)}
            className={`${BTN_BASE} bg-accent-purple/20 text-accent-purple hover:bg-accent-purple/30`}
          >
            Approve
          </button>
          <button
            type="button"
            aria-disabled={working || undefined}
            onClick={() => respond(false)}
            className={`${BTN_BASE} border border-slate-slate700 text-slate-slate300 hover:text-slate-slate100`}
          >
            Decline
          </button>
          {working && (
            <span className="text-xs text-slate-slate400">Working…</span>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-accent-amber">
          {error}
        </p>
      )}
    </div>
  );
}
