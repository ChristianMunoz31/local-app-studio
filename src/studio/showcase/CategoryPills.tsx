// The one category choice of the Features page and the Design shelf: pill radios with counts. Native radios, so the arrow
// keys and screen readers work, and the selected pill is told apart by more than color (forced colors outline).
import { useId } from 'react';
import { categoryChoices } from './search';
import type { CategoryChoice } from './search';

export interface CategoryPillsProps {
  value: CategoryChoice;
  /** Matches per category for the current query. */
  counts: Record<CategoryChoice, number>;
  onChange(next: CategoryChoice): void;
}

const PILL_CLASS =
  'block cursor-pointer rounded-full border border-slate-slate600 px-2.5 py-1 text-xs font-semibold text-slate-slate300 hover:text-slate-slate100 peer-checked:bg-slate-brand peer-checked:text-white peer-checked:forced-colors:outline peer-checked:forced-colors:outline-2 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:[outline-color:var(--focus-ring)]';

export default function CategoryPills({ value, counts, onChange }: CategoryPillsProps) {
  const name = useId();
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-sm font-semibold text-slate-slate100">Show</legend>
      <div className="flex flex-wrap gap-1">
        {categoryChoices(counts).map((c) => (
          <label key={c.value}>
            <input type="radio" name={name} className="peer sr-only" value={c.value} checked={value === c.value} onChange={() => onChange(c.value)} />
            <span className={PILL_CLASS}>{c.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
