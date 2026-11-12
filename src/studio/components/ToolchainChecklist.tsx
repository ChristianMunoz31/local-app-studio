// Build tools check with per-item status and a short how-to-install hint for each missing item, in plain tool names.
import { PILL, TONE_CLASS } from '@/components/settings/pillStyles.js';
import { btnSecondary, formErrorClass } from '@/components/shared/formStyles.js';
import { ListSkeleton } from '@/components/shared/Skeleton.jsx';
import type { ToolchainReport } from '../buildTypes';
import { toolName } from '../lib/toolWords';
import { SUMMARY_CLASS } from './ui';

/** Short names for the one-line summary (the long ones above carry a parenthetical). */
const SUMMARY_WORDS: Readonly<Record<string, string>> = { cargo: 'Cargo' };
const DETAILS_LABEL = 'Details';
/** Read out after the visible word, so two Details on one step can be told apart. */
const DETAILS_HIDDEN = ' about the build tools';

/** "a", "a and b", "a, b and c". */
const joinList = (parts: string[]): string => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

/** "This computer needs Rust before it can make an installer." from the required tools that are missing; null when none. */
const missingSummary = (report: ToolchainReport): string | null => {
  const names = report.items.filter((i) => i.required && i.status !== 'found').map((i) => SUMMARY_WORDS[i.id] ?? toolName(i));
  return names.length === 0 ? null : `This computer needs ${joinList(names)} before it can make an installer.`;
};

interface Props {
  report: ToolchainReport | null;
  loading: boolean;
  error: string | null;
  onRefresh(): void;
  /** When every required tool is found, show one "ready" line and fold the list. */
  collapseWhenReady?: boolean;
  /** Heading text; null leaves it out when the parent card already has a title. */
  heading?: string | null;
}

function ItemList({ report, loading }: { report: ToolchainReport; loading: boolean }) {
  const found = report.items.filter((item) => item.status === 'found' && (item.version || item.path));
  return (
    <div className="space-y-3">
      <ul className="space-y-3" aria-busy={loading}>
        {report.items.map((item) => (
          <li key={item.id} className="text-sm text-slate-slate300">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-slate-slate100">{toolName(item)}</span>
              <span className={`${PILL} ${item.status === 'found' ? TONE_CLASS.ok : TONE_CLASS.warn}`}>{item.status === 'found' ? 'Found' : 'Missing'}</span>
              <span className="text-xs text-slate-slate400">{item.required ? 'Required for builds' : 'Optional'}</span>
            </div>
            {item.status !== 'found' && <p className="mt-0.5 break-all text-xs text-slate-slate400">{`How to install: ${item.hint}`}</p>}
          </li>
        ))}
      </ul>
      {found.length > 0 && (
        <details>
          <summary className={SUMMARY_CLASS}>Show where each tool was found</summary>
          <ul className="mt-2 space-y-1">
            {found.map((item) => (
              <li key={item.id} className="break-all text-xs text-slate-slate400">
                {`${toolName(item)}: ${[item.version, item.path].filter(Boolean).join(' at ')}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default function ToolchainChecklist({ report, loading, error, onRefresh, collapseWhenReady = false, heading = 'Build tools' }: Props) {
  const folded = collapseWhenReady && report !== null && report.ok;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {folded ? (
          <p role="status" className="text-sm text-slate-slate300">
            Build tools: ready
          </p>
        ) : (
          heading !== null && <h3 className="text-sm font-semibold text-slate-slate100">{heading}</h3>
        )}
        <button type="button" className={btnSecondary} onClick={onRefresh} disabled={loading}>
          {loading && report !== null ? 'Checking...' : 'Check again'}
        </button>
      </div>
      {error !== null && (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p className={formErrorClass}>{error}</p>
          <button type="button" className={btnSecondary} onClick={onRefresh}>
            Try again
          </button>
        </div>
      )}
      {report === null ? (
        loading && <ListSkeleton rows={5} />
      ) : folded ? (
        <details>
          <summary className={SUMMARY_CLASS}>Show tools</summary>
          <div className="mt-3">
            <ItemList report={report} loading={loading} />
          </div>
        </details>
      ) : collapseWhenReady && missingSummary(report) !== null ? (
        <div className="space-y-2">
          <p className="text-sm text-slate-slate300">{missingSummary(report)}</p>
          <details>
            <summary className={SUMMARY_CLASS}>
              {DETAILS_LABEL}
              <span className="sr-only">{DETAILS_HIDDEN}</span>
            </summary>
            <div className="mt-3">
              <ItemList report={report} loading={loading} />
            </div>
          </details>
        </div>
      ) : (
        <ItemList report={report} loading={loading} />
      )}
    </div>
  );
}
