import { useId } from 'react';
import { ArrowDownUp } from 'lucide-react';
import { inputClass, labelClass } from '../../../../../src/components/shared/formStyles.js';
import type { FieldType } from '../../spec/schema.ts';
import { fieldInfo, useSourceInfo, useSourceSort, useTableDef } from '../../../../../src/catalog/context.tsx';
import type { FieldInfo } from '../../../../../src/catalog/context.tsx';
import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import { cx } from './styles.ts';

export interface SortControlProps extends EditorProps {
  source?: string;
  fields?: string[];
  label?: string;
}

/** The two direction words for a field type: first is ascending. */
function wordsFor(type: FieldType | undefined): [string, string] {
  if (type === 'integer' || type === 'real') return ['Lowest first', 'Highest first'];
  if (type === 'date' || type === 'datetime') return ['Oldest first', 'Newest first'];
  return ['A to Z', 'Z to A'];
}

/** Lets people choose how a list source is sorted: a field and a direction. Page view only. */
export function SortControl({ source = '', fields = [], label = 'Sort by', ...rest }: SortControlProps) {
  const { className, ...dom } = editorDomProps(rest);
  const uid = useId();
  const info = useSourceInfo(source);
  const table = useTableDef(info?.table ?? null);
  const { sort, setSort } = useSourceSort(source);
  const shown = fields.map((id) => fieldInfo(table, id)).filter((f): f is FieldInfo => f !== null);
  if (!info || !table) return <p {...dom} className={cx('text-sm text-slate-slate400', className)}>Sort choice for &quot;{source}&quot;</p>;

  const current = shown.find((f) => f.id === sort?.field);
  const words = wordsFor(current?.type);
  const direction = sort?.dir === 'desc' ? words[1] : words[0];
  return (
    <div {...dom} className={cx('flex flex-wrap items-end gap-3', className)}>
      <div className="min-w-40">
        <label htmlFor={`${uid}-field`} className={labelClass}>
          {label}
        </label>
        <select
          id={`${uid}-field`}
          className={inputClass}
          value={current?.id ?? ''}
          onChange={(e) => setSort(e.target.value === '' ? null : { field: e.target.value, dir: 'asc' })}
        >
          <option value="">Default order</option>
          {shown.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        disabled={!current}
        aria-label={`Order: ${direction}. Change order`}
        onClick={() => current && setSort({ field: current.id, dir: sort?.dir === 'asc' ? 'desc' : 'asc' })}
        className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-slate-slate300 hover:bg-slate-slate700/60 hover:text-slate-slate100 disabled:opacity-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-brandLight"
      >
        <ArrowDownUp size={14} aria-hidden="true" />
        {direction}
      </button>
    </div>
  );
}
