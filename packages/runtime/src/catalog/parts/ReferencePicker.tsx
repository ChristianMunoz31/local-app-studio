import { labelClass } from '../../../../../src/components/shared/formStyles.js';
import { fieldInfo, useSourceFilters, useSourceInfo, useTableDef } from '../../../../../src/catalog/context.tsx';
import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import { ReferenceSelect } from './ReferenceSelect.tsx';
import { cx } from './styles.ts';

export interface ReferencePickerProps extends EditorProps {
  source?: string;
  field?: string;
  label?: string;
}

/** A drop-down of the records a reference field points to; choosing one narrows the list source to it. */
export function ReferencePicker({ source = '', field = '', label, ...rest }: ReferencePickerProps) {
  const { className, ...dom } = editorDomProps(rest);
  const info = useSourceInfo(source);
  const table = useTableDef(info?.table ?? null);
  const { filters, setCondition } = useSourceFilters(source);
  const f = fieldInfo(table, field);
  const current = filters.find((c) => c.field === field && c.op === 'eq')?.value;
  if (!info || !f?.table) return <p {...dom} className={cx('text-sm text-slate-slate400', className)}>Picker for &quot;{field}&quot;</p>;
  const name = label ?? f.label;
  return (
    <div {...dom} className={cx('min-w-36', className)}>
      <span className={labelClass}>{name}</span>
      <ReferenceSelect
        aria-label={name}
        table={f.table}
        value={typeof current === 'string' ? current : ''}
        onChange={(id) => setCondition(field, 'eq', id || undefined)}
        emptyLabel="All"
      />
    </div>
  );
}
