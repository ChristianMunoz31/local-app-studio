import { useEffect, useRef, useState } from 'react';
import { btnSecondary } from '../../../../../src/components/shared/formStyles.js';

export interface PagerProps {
  /** Names the pager for a screen reader, for example the table label. */
  label: string;
  offset: number;
  /** Rows on the current page. */
  count: number;
  total: number;
  pageSize: number;
  loading: boolean;
  setOffset: (n: number) => void;
}

/**
 * Range text and Previous and Next buttons, shared by the table and the list. Nothing when everything fits on one page.
 * The range is a polite live region, so a page change is spoken. A button that becomes disabled because its end was reached
 * hands focus to the other one, so a keyboard user is not dropped on the page. Loading never disables a button (that would
 * drop focus too); a click while loading is ignored, and the group says aria-busy meanwhile. The range text comes from the last
 * settled page, so a page in flight never shows (or speaks) a range that mixes the new offset with the old rows. A page left
 * empty by a delete (rows gone, offset past the end, records still there) moves back to the last page that has rows.
 */
export function Pager({ label, offset, count, total, pageSize, loading, setOffset }: PagerProps) {
  const prev = useRef<HTMLButtonElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const handOff = useRef<'prev' | 'next' | null>(null);
  useEffect(() => {
    const target = handOff.current;
    handOff.current = null;
    if (target === 'prev') prev.current?.focus();
    else if (target === 'next') next.current?.focus();
  }, [offset]);
  const [settled, setSettled] = useState({ offset, count, total });
  if (!loading && (settled.offset !== offset || settled.count !== count || settled.total !== total)) setSettled({ offset, count, total });
  const stranded = !loading && count === 0 && offset > 0 && total > 0;
  useEffect(() => {
    if (stranded) setOffset(Math.max(0, Math.floor((total - 1) / pageSize) * pageSize));
  }, [stranded, total, pageSize, setOffset]);
  if (total <= pageSize) return null;
  const first = offset === 0;
  const last = offset + pageSize >= total;
  const go = (to: number, from: 'prev' | 'next'): void => {
    if (loading) return;
    const atStart = to === 0;
    const atEnd = to + pageSize >= total;
    if (from === 'prev' && atStart) handOff.current = 'next';
    else if (from === 'next' && atEnd) handOff.current = 'prev';
    setOffset(to);
  };
  return (
    <div role="group" aria-label={`${label.trim() || 'Rows'} pages`} aria-busy={loading} className="flex items-center justify-between gap-2 text-xs text-slate-slate400">
      <span role="status">
        {settled.offset + 1} to {settled.offset + settled.count} of {settled.total}
      </span>
      <span className="flex gap-2">
        <button ref={prev} type="button" className={btnSecondary} disabled={first} onClick={() => go(Math.max(0, offset - pageSize), 'prev')}>
          Previous
        </button>
        <button ref={next} type="button" className={btnSecondary} disabled={last} onClick={() => go(offset + pageSize, 'next')}>
          Next
        </button>
      </span>
    </div>
  );
}
