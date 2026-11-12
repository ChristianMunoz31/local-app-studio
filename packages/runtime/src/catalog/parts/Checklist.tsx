import { useId, useState } from 'react';
import { fieldInfo, useIsLive, useMutations, useSource, useSourceInfo, useTableDef } from '../../../../../src/catalog/context.tsx';
import type { DataRow } from '../../../../../src/catalog/context.tsx';
import { titleFieldOf } from './format.ts';
import { useCellText } from './cells.ts';
import { EmptyLine, ErrorLine, LoadingLines } from './DataState.tsx';
import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import { ERROR_TEXT, errorText } from '../../../../../src/catalog/errorText.ts';
import { cx } from './styles.ts';

export interface ChecklistProps extends EditorProps {
  source?: string;
  field?: string;
  titleField?: string;
  emptyText?: string;
}

const messageOf = (e: unknown): string => errorText(e, ERROR_TEXT.saveFailed);

/** Rows of a list source with a box to tick. Ticking saves the yes/no field of that record (the same PATCH a form edit makes). */
export function Checklist({ source = '', field = '', titleField, emptyText, ...rest }: ChecklistProps) {
  const { className, ...dom } = editorDomProps(rest);
  const uid = useId();
  const live = useIsLive();
  const info = useSourceInfo(source);
  const table = useTableDef(info?.table ?? null);
  const { rows, loading, error } = useSource(source);
  const { update } = useMutations();
  // Ticks shown before the server answers; they only count for the rows they were made on.
  const [optimistic, setOptimistic] = useState<{ rows: DataRow[]; ticks: Record<string, boolean> }>({ rows, ticks: {} });
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const title = titleField ?? (table ? titleFieldOf(table) : 'id');
  const cellText = useCellText(table, rows, [title]);
  const ticks = optimistic.rows === rows ? optimistic.ticks : {};
  const checkable = fieldInfo(table, field)?.type === 'boolean' && field !== 'id';

  const toggle = async (row: DataRow, next: boolean): Promise<void> => {
    if (!info || !live || saving) return;
    const id = String(row.id);
    setFailure(null);
    setSaving(true);
    setOptimistic({ rows, ticks: { ...ticks, [id]: next } });
    try {
      await update(info.table, id, { [field]: next });
    } catch (e) {
      setOptimistic({ rows, ticks: Object.fromEntries(Object.entries(ticks).filter(([k]) => k !== id)) });
      setFailure(messageOf(e));
    } finally {
      setSaving(false);
    }
  };

  let body;
  if (!info || !table) {
    body = <p className="text-sm text-slate-slate400">Checklist of the rows of &quot;{source}&quot;</p>;
  } else if (info.mode !== 'list' || !checkable) {
    body = <EmptyLine text={ERROR_TEXT.checklistCannot} />;
  } else if (error && rows.length === 0) {
    body = <ErrorLine message={error} />;
  } else if (loading && rows.length === 0) {
    body = <LoadingLines />;
  } else if (rows.length === 0) {
    body = <EmptyLine text={emptyText ?? 'Nothing to check off.'} />;
  } else {
    body = (
      <ul className="divide-y divide-[color:var(--glass-border)]">
        {rows.map((row, i) => {
          const id = String(row.id ?? i);
          const checked = Object.hasOwn(ticks, id) ? ticks[id] : row[field] === true || row[field] === 1;
          return (
            <li key={id} className="py-2">
              <label className="flex items-center gap-3 text-sm text-slate-slate100">
                <input type="checkbox" checked={checked} disabled={!live || saving} onChange={(e) => void toggle(row, e.target.checked)} className="h-4 w-4 rounded-sm" />
                <span className={cx('min-w-0 flex-1 truncate', checked && 'text-slate-slate400 line-through')}>{cellText(row, title) || '-'}</span>
              </label>
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <div {...dom} className={cx('space-y-2', className)}>
      {body}
      {failure && (
        <p id={`${uid}-error`} role="alert" className="text-xs text-accent-red">
          {failure}
        </p>
      )}
    </div>
  );
}
