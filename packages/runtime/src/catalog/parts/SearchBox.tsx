import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { inputClass } from '../../../../../src/components/shared/formStyles.js';
import { useSourceFilters } from '../../../../../src/catalog/context.tsx';
import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import { cx } from './styles.ts';

export interface SearchBoxProps extends EditorProps {
  source?: string;
  fields?: string[];
  placeholder?: string;
}

const DEBOUNCE_MS = 250;

/** A search box over text fields of a list source. The last SearchBox of a page wins. */
export function SearchBox({ source = '', fields = [], placeholder = 'Search', ...rest }: SearchBoxProps) {
  const { className, ...dom } = editorDomProps(rest);
  const { search, setSearch } = useSourceFilters(source);
  const applied = search?.term ?? '';
  const [term, setTerm] = useState(applied);
  const fieldsKey = fields.join(',');
  const list = useMemo(() => (fieldsKey === '' ? [] : fieldsKey.split(',')), [fieldsKey]);
  useEffect(() => {
    if (term === applied) return undefined;
    const timer = setTimeout(() => setSearch(term, list), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term, applied, list, setSearch]);

  return (
    <div {...dom} className={cx('relative', className)}>
      <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-slate400" />
      <input
        type="search"
        aria-label={placeholder}
        placeholder={placeholder}
        maxLength={200}
        className={cx(inputClass, 'pl-9')}
        value={term}
        onChange={(e) => setTerm(e.target.value)}
      />
    </div>
  );
}
