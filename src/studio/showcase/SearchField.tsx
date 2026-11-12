// The one search field of the Features page and the Design shelf: same label, same hint, same Escape.
import { useId } from 'react';
import type { RefObject } from 'react';
import { Search } from 'lucide-react';
import { inputClass } from '@/components/shared/formStyles.js';

export const SEARCH_LABEL = 'Search parts and features';
export const SEARCH_PLACEHOLDER = 'For example: form, table or button';

export interface SearchFieldProps {
  value: string;
  onChange(next: string): void;
  inputRef?: RefObject<HTMLInputElement | null>;
  id?: string;
}

export default function SearchField({ value, onChange, inputRef, id }: SearchFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div>
      <label htmlFor={inputId} className="mb-1.5 block text-sm font-semibold text-slate-slate100">
        {SEARCH_LABEL}
      </label>
      <div className="relative">
        <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-slate400" />
        <input
          id={inputId}
          ref={inputRef}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            // Escape clears a typed search first; with nothing typed it keeps its usual job (cancel Add here).
            if (e.key === 'Escape' && value !== '') {
              e.preventDefault();
              e.stopPropagation();
              onChange('');
            }
          }}
          placeholder={SEARCH_PLACEHOLDER}
          autoComplete="off"
          className={`${inputClass} pl-8`}
        />
      </div>
    </div>
  );
}
