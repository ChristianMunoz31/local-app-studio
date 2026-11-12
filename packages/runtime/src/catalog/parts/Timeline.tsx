import type { TIME_ORDERS } from '../../../../../src/catalog/enums.ts';
import { fieldInfo, useSource, useSourceInfo, useTableDef } from '../../../../../src/catalog/context.tsx';
import type { DataRow } from '../../../../../src/catalog/context.tsx';
import { NO_DATE, dayOf } from './chartModel.ts';
import { titleFieldOf } from './format.ts';
import { useCellText } from './cells.ts';
import { EmptyLine, ErrorLine, LoadingLines } from './DataState.tsx';
import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import { cx } from './styles.ts';

type TimeOrder = (typeof TIME_ORDERS)[number];

export interface TimelineProps extends EditorProps {
  source?: string;
  dateField?: string;
  titleField?: string;
  subtitleField?: string;
  order?: TimeOrder;
  emptyText?: string;
}

function dayLabel(day: string): string {
  if (day === NO_DATE) return 'No date';
  const [y, m, d] = day.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(y, m - 1, d));
}

/** Rows of a list source in date order, one heading for each day. */
export function Timeline({ source = '', dateField = '', titleField, subtitleField, order = 'newest', emptyText, ...rest }: TimelineProps) {
  const { className, ...dom } = editorDomProps(rest);
  const info = useSourceInfo(source);
  const table = useTableDef(info?.table ?? null);
  const { rows, total, loading, error } = useSource(source, { sort: [{ field: dateField, dir: order === 'oldest' ? 'asc' : 'desc' }] });
  const title = titleField ?? (table ? titleFieldOf(table) : 'id');
  const cellText = useCellText(table, rows, [title, ...(subtitleField ? [subtitleField] : [])]);
  const dateType = fieldInfo(table, dateField)?.type;

  let body;
  if (!info || !table || !fieldInfo(table, dateField)) {
    body = <p className="text-sm text-slate-slate400">Timeline of the rows of &quot;{source}&quot;</p>;
  } else if (error && rows.length === 0) {
    body = <ErrorLine message={error} />;
  } else if (loading && rows.length === 0) {
    body = <LoadingLines />;
  } else if (rows.length === 0) {
    body = <EmptyLine text={emptyText ?? 'Nothing on the timeline yet.'} />;
  } else {
    const days: Array<{ day: string; rows: DataRow[] }> = [];
    for (const row of rows) {
      const day = dayOf(dateType, row[dateField]);
      const same = days.find((d) => d.day === day);
      if (same) same.rows.push(row);
      else days.push({ day, rows: [row] });
    }
    // Rows with no date come last whichever way the dates run.
    days.sort((a, b) => Number(a.day === NO_DATE) - Number(b.day === NO_DATE));
    body = (
      <>
        {days.map((group) => (
          <section key={group.day || 'none'} className="space-y-1">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-slate400">{dayLabel(group.day)}</h3>
            <ul className="divide-y divide-[color:var(--glass-border)] border-l-2 border-slate-slate600 pl-3">
              {group.rows.map((row, i) => (
                <li key={String(row.id ?? i)} className="py-2">
                  <span className="block truncate text-sm font-semibold text-slate-slate100">{cellText(row, title) || '-'}</span>
                  {subtitleField && <span className="block truncate text-xs text-slate-slate400">{cellText(row, subtitleField)}</span>}
                </li>
              ))}
            </ul>
          </section>
        ))}
        {rows.length < total && <p className="text-xs text-slate-slate400">{`Showing ${rows.length} of ${total}.`}</p>}
      </>
    );
  }
  return (
    <div {...dom} className={cx('space-y-3', className)}>
      {body}
    </div>
  );
}
