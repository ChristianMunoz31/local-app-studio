import type { AppSpec, SpecIssue } from '@local-app-studio/runtime/spec/schema';
import { plainIssue } from '../lib/issueWords';
import { HINT_CLASS } from './ui';

interface Props {
  issues: SpecIssue[];
  title?: string;
  /** How many issues to list before "and N more". */
  max?: number;
  /** The design the problems are about, so a place reads "Table Crews" instead of "Table 1". */
  spec?: AppSpec | null;
  /** The saved design, so a table, field or page the design no longer has is still named by its label. */
  before?: AppSpec | null;
  /**
   * Announce the list as an alert (default). Pass false where the caller already announces the failure, or where the list
   * changes while the person types (live checks), so a screen reader does not read it again and again.
   */
  alert?: boolean;
}

/** Problems with a design, in plain words, each with its place and never a code path. */
export default function IssueList({ issues, title, max = 5, spec, before, alert = true }: Props) {
  if (issues.length === 0) return null;
  const shown = issues.slice(0, max);
  const more = issues.length - shown.length;
  return (
    <div role={alert ? 'alert' : undefined} className="space-y-1.5 text-sm text-accent-red">
      {title && <p className="font-semibold">{title}</p>}
      <ul className="list-disc space-y-0.5 pl-5">
        {shown.map((issue, i) => (
          <li key={`${issue.path}:${issue.code}:${i}`}>{plainIssue(issue, spec, before)}</li>
        ))}
      </ul>
      {more > 0 && <p className={HINT_CLASS}>{`and ${more} more`}</p>}
    </div>
  );
}
