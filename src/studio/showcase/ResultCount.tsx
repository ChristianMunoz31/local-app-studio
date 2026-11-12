// The count line and the empty state of the Features page and the Design shelf. The number on screen follows at once; the
// polite spoken text follows 500 ms after the last change, so typing does not chatter.
import { useEffect, useState } from 'react';
import { btnSecondary } from '@/components/shared/formStyles.js';
import { HINT_CLASS } from '../components/ui';

const SPEAK_DELAY_MS = 500;

export const NO_OWN_FEATURES = 'No features of your own yet. Press New feature, or in Design select a part and choose Save as feature.';

const countText = (n: number): string => `${n} shown`;

export default function ResultCount({ count }: { count: number }) {
  const [spoken, setSpoken] = useState(count);
  useEffect(() => {
    const timer = setTimeout(() => setSpoken(count), SPEAK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [count]);
  return (
    <>
      <p aria-hidden="true" data-testid="features-count" className={HINT_CLASS}>
        {countText(count)}
      </p>
      <p aria-live="polite" className="sr-only">
        {countText(spoken)}
      </p>
    </>
  );
}

export interface NoResultsProps {
  query: string;
  /** True when no feature of your own is saved yet (the Your features category is what is empty). */
  noOwn: boolean;
  onClear(): void;
}

/** The one empty state: a search that found nothing, or Your features with nothing saved. */
export function NoResults({ query, noOwn, onClear }: NoResultsProps) {
  const q = query.trim();
  if (q !== '') {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-slate400">{`Nothing matches "${q}". Try another word.`}</p>
        <button type="button" className={btnSecondary} onClick={onClear}>
          Clear search
        </button>
      </div>
    );
  }
  return <p className="text-sm text-slate-slate400">{noOwn ? NO_OWN_FEATURES : 'Nothing to show here yet.'}</p>;
}
