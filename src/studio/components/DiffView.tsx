import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { diffSpecs, summarizeChanges } from '../lib/specDiff';
import type { ChangeKind, SpecChange } from '../lib/specDiff';
import { HINT_CLASS, WARN_BOX_CLASS } from './ui';

interface Props {
  before: AppSpec;
  after: AppSpec;
}

const GROUPS: ReadonlyArray<{ kind: ChangeKind; heading: string }> = [
  { kind: 'added', heading: 'Added' },
  { kind: 'changed', heading: 'Changed' },
  { kind: 'removed', heading: 'Removed' },
];

/** The changes under the headings Added, Changed and Removed (a heading only when it has changes). */
function ChangeGroups({ changes }: { changes: readonly SpecChange[] }) {
  return (
    <div className="space-y-2">
      {GROUPS.map(({ kind, heading }) => {
        const inGroup = changes.filter((c) => c.kind === kind);
        if (inGroup.length === 0) return null;
        return (
          <div key={kind}>
            <h5 className="mb-1 text-xs font-semibold text-slate-slate300">{heading}</h5>
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-slate100">
              {inGroup.map((c) => (
                <li key={`${c.path}:${c.sentence}`}>{c.sentence}</li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** What a design change would do, as sentences. Changes that remove or reshape data come first and stand out. */
export default function DiffView({ before, after }: Props) {
  const changes = useMemo(() => diffSpecs(before, after), [before, after]);
  if (changes.length === 0) return <p className="text-sm text-slate-slate300">No changes.</p>;
  const risky = changes.filter((c) => c.destructive);
  const others = changes.filter((c) => !c.destructive);
  return (
    <div className="space-y-4">
      <p className={HINT_CLASS}>{summarizeChanges(changes)}</p>
      {risky.length > 0 && (
        <section aria-label="Changes that remove or reshape data" className={WARN_BOX_CLASS}>
          <h4 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-accent-red">
            <AlertTriangle size={14} aria-hidden="true" />
            These changes remove or reshape data
          </h4>
          <ChangeGroups changes={risky} />
        </section>
      )}
      {others.length > 0 && (
        <section aria-label="Other changes">
          {risky.length > 0 && <h4 className="mb-2 text-sm font-semibold text-slate-slate100">Other changes</h4>}
          <ChangeGroups changes={others} />
        </section>
      )}
    </div>
  );
}
