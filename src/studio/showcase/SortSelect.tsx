// The order choice for the Features page: Default order, A to Z, Recently added.
import { useId } from 'react';
import { inputClass } from '@/components/shared/formStyles.js';
import { SORT_CHOICES, SORT_LABELS, parseSort } from './search';
import type { SortChoice } from './search';

export interface SortSelectProps {
  value: SortChoice;
  onChange(next: SortChoice): void;
}

export default function SortSelect({ value, onChange }: SortSelectProps) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-slate-slate100">
        Order
      </label>
      <select id={id} value={value} onChange={(e) => onChange(parseSort(e.target.value))} className={inputClass}>
        {SORT_CHOICES.map((s) => (
          <option key={s} value={s}>
            {SORT_LABELS[s]}
          </option>
        ))}
      </select>
    </div>
  );
}
