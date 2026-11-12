import { inputClass, labelClass } from '../../../../../src/components/shared/formStyles.js';
import { fieldInfo, useSourceFilters, useSourceInfo, useTableDef } from '../../../../../src/catalog/context.tsx';
import type { FieldInfo } from '../../../../../src/catalog/context.tsx';
import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import { ReferenceSelect } from './ReferenceSelect.tsx';
import { cx } from './styles.ts';

export interface FilterBarProps extends EditorProps {
  source?: string;
  fields?: string[];
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** The local calendar day of a stored ISO timestamp, for a date input. */
function localDay(iso: unknown): string {
  const d = new Date(String(iso));
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Filter controls for a list source: one per field (select, yes/no, date range, reference). Page view only. */
export function FilterBar({ source = '', fields = [], ...rest }: FilterBarProps) {
  const { className, ...dom } = editorDomProps(rest);
  const info = useSourceInfo(source);
  const table = useTableDef(info?.table ?? null);
  const { filters, setCondition } = useSourceFilters(source);
  const valueOf = (field: string, op: string): unknown => filters.find((c) => c.field === field && c.op === op)?.value;
  const text = (field: string, op: string): string => {
    const v = valueOf(field, op);
    return typeof v === 'string' ? v : '';
  };

  const control = (f: FieldInfo) => {
    const name = f.label;
    switch (f.type) {
      case 'select':
        return (
          <select aria-label={name} className={inputClass} value={text(f.id, 'eq')} onChange={(e) => setCondition(f.id, 'eq', e.target.value || undefined)}>
            <option value="">All</option>
            {(f.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        );
      case 'boolean': {
        const v = valueOf(f.id, 'eq');
        return (
          <select
            aria-label={name}
            className={inputClass}
            value={typeof v === 'boolean' ? String(v) : ''}
            onChange={(e) => setCondition(f.id, 'eq', e.target.value === '' ? undefined : e.target.value === 'true')}
          >
            <option value="">All</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        );
      }
      case 'reference':
        return f.table ? (
          <ReferenceSelect aria-label={name} table={f.table} value={text(f.id, 'eq')} onChange={(id) => setCondition(f.id, 'eq', id || undefined)} emptyLabel="All" />
        ) : null;
      case 'date':
        return (
          <span className="flex items-center gap-2">
            <input aria-label={`${name} from`} type="date" className={inputClass} value={text(f.id, 'gte')} onChange={(e) => setCondition(f.id, 'gte', e.target.value || undefined)} />
            <input aria-label={`${name} to`} type="date" className={inputClass} value={text(f.id, 'lte')} onChange={(e) => setCondition(f.id, 'lte', e.target.value || undefined)} />
          </span>
        );
      case 'datetime':
        return (
          <span className="flex items-center gap-2">
            <input
              aria-label={`${name} from`}
              type="date"
              className={inputClass}
              value={localDay(valueOf(f.id, 'gte'))}
              onChange={(e) => setCondition(f.id, 'gte', e.target.value ? new Date(`${e.target.value}T00:00:00`).toISOString() : undefined)}
            />
            <input
              aria-label={`${name} to`}
              type="date"
              className={inputClass}
              value={localDay(valueOf(f.id, 'lte'))}
              onChange={(e) => setCondition(f.id, 'lte', e.target.value ? new Date(`${e.target.value}T23:59:59.999`).toISOString() : undefined)}
            />
          </span>
        );
      default:
        return null;
    }
  };

  const shown = fields.map((id) => fieldInfo(table, id)).filter((f): f is FieldInfo => f !== null);
  if (!info || !table) return <p {...dom} className={cx('text-sm text-slate-slate400', className)}>Filters for &quot;{source}&quot;</p>;
  return (
    <div {...dom} className={cx('flex flex-wrap items-end gap-3', className)}>
      {shown.map((f) => (
        <div key={f.id} className="min-w-36">
          <span className={labelClass}>{f.label}</span>
          {control(f)}
        </div>
      ))}
    </div>
  );
}
