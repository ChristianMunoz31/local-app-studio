// The "Data connections" list above the canvas: parts of the other pages that are not connected to a table, and write parts that
// add to a table their page does not show. The second kind can be kept on purpose ("Keep it this way"); the first cannot be saved.
// A part of the open page that is not connected is not listed: its own box, its settings and the Save reason already say it.
import { useId } from 'react';
import { btnSecondary } from '@/components/shared/formStyles.js';
import { HINT_CLASS } from '../components/ui';
import { plainMessage } from '../lib/issueWords';
import { FIX_ALL, canFixAll } from '../lib/fixAllConnections';
import type { ConnectionIssue } from './connections';

interface Props {
  issues: readonly ConnectionIssue[];
  kept: ReadonlySet<string>;
  /** The page being edited. */
  pageId: string;
  onFix(issue: ConnectionIssue): void;
  onOpenPage(pageId: string): void;
  onKeep(key: string): void;
  onShowAgain(key: string): void;
  /** Connects every part of the open page that can be connected by itself (one Undo step). */
  onFixAll?: () => void;
}

export default function ConnectionIssues({ issues: all, kept, pageId, onFix, onOpenPage, onKeep, onShowAgain, onFixAll }: Props) {
  const base = useId();
  const issues = all.filter((i) => !(i.code === 'not_connected' && i.pageId === pageId));
  const fixable = onFixAll !== undefined && canFixAll(all, pageId, kept);
  if (issues.length === 0 && !fixable) return null;
  const open = issues.filter((i) => !(i.dismissible && kept.has(i.key)));
  const keptOnes = issues.filter((i) => i.dismissible && kept.has(i.key));
  // Each button is described by its row's message, so "Open page" or "Keep it this way" is not heard alone.
  const row = (issue: ConnectionIssue, isKept: boolean, n: number) => {
    const messageId = `${base}-${isKept ? 'kept' : 'open'}-${n}`;
    return (
      <li key={issue.key} data-connection-issue={issue.code} className="flex flex-wrap items-center gap-2">
        <span id={messageId}>{plainMessage(issue.message)}</span>
        {isKept ? (
          <button type="button" className={btnSecondary} aria-describedby={messageId} onClick={() => onShowAgain(issue.key)}>
            Show again
          </button>
        ) : issue.pageId === pageId ? (
          <button type="button" className={btnSecondary} aria-describedby={messageId} onClick={() => onFix(issue)}>
            {issue.code === 'not_connected' ? 'Connect' : 'Change table'}
          </button>
        ) : (
          <button type="button" className={btnSecondary} aria-describedby={messageId} onClick={() => onOpenPage(issue.pageId)}>
            Open page
          </button>
        )}
        {!isKept && issue.dismissible && (
          <button type="button" className={btnSecondary} aria-describedby={messageId} onClick={() => onKeep(issue.key)}>
            Keep it this way
          </button>
        )}
      </li>
    );
  };
  return (
    <section aria-label="Data connections" className="space-y-1 rounded-md border border-accent-amber/40 bg-accent-amber/10 px-3 py-2 text-sm text-slate-slate100">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`${base}-h`} className="text-sm font-semibold">
          Data connections
        </h3>
        {fixable && (
          <button type="button" className={btnSecondary} aria-describedby={`${base}-h`} onClick={() => onFixAll?.()}>
            {FIX_ALL}
          </button>
        )}
      </div>
      {open.length > 0 && <ul className="space-y-1">{open.map((i, n) => row(i, false, n))}</ul>}
      {keptOnes.length > 0 && (
        <>
          <p className={HINT_CLASS}>Kept on purpose:</p>
          <ul className="space-y-1">{keptOnes.map((i, n) => row(i, true, n))}</ul>
        </>
      )}
    </section>
  );
}
