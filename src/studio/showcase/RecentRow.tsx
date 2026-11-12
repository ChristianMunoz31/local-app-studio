// "Recently used": the last parts and features placed in Design, as small buttons. Shown by the page or the shelf only
// when nothing is searched and the category is All. Keys that no longer have an entry are skipped.
import { useEffect, useMemo, useState } from 'react';
import { readRecent, subscribeRecent } from './recent';
import { resolveRecent } from './search';
import type { ShowcaseEntry } from './entries';

/** The stored recent keys, refreshed when the list changes in this tab. */
function useRecentKeys(): string[] {
  const [keys, setKeys] = useState<string[]>(() => readRecent());
  useEffect(() => {
    return subscribeRecent(() => setKeys(readRecent()));
  }, []);
  return keys;
}

export interface RecentRowProps {
  entries: readonly ShowcaseEntry[];
  onPick(entry: ShowcaseEntry): void;
  /** Accessible name of the button for an entry. */
  labelFor(entry: ShowcaseEntry): string;
}

export default function RecentRow({ entries, onPick, labelFor }: RecentRowProps) {
  const keys = useRecentKeys();
  const recent = useMemo(() => resolveRecent(keys, entries), [keys, entries]);
  if (recent.length === 0) return null;
  return (
    <section aria-label="Recently used" data-testid="recent-row">
      <h3 className="mb-2 text-[10px] uppercase tracking-widest text-slate-slate400">{`Recently used (${recent.length})`}</h3>
      <ul className="flex flex-wrap gap-1.5">
        {recent.map((e) => (
          <li key={e.key}>
            <button
              type="button"
              aria-label={labelFor(e)}
              onClick={() => onPick(e)}
              className="rounded-full border border-slate-slate600 px-2.5 py-1 text-xs font-semibold text-slate-slate300 hover:text-slate-slate100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-brandLight"
            >
              {e.name}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
