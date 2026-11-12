import { PILL, TONE_CLASS as PILL_TONE } from '../../../../../src/components/settings/pillStyles.js';
import { titleFieldOf } from './format.ts';
import type { Action } from '../../../../../src/catalog/actions.ts';
import { useSource, useSourceInfo, useTableDef } from '../../../../../src/catalog/context.tsx';
import { useCellText } from './cells.ts';
import { EmptyLine, ErrorLine, LoadingLines, Notice } from './DataState.tsx';
import { useNoticeAction } from './useNoticeAction.ts';
import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import { cx } from './styles.ts';

export interface RecordListProps extends EditorProps {
  source?: string;
  titleField?: string;
  subtitleField?: string;
  badgeField?: string;
  rowAction?: Action;
  emptyText?: string;
}

/** The rows of a list source as a list: a title, an optional subtitle and a badge, with an optional row action. */
export function RecordList({ source = '', titleField, subtitleField, badgeField, rowAction, emptyText, ...rest }: RecordListProps) {
  const { className, ...dom } = editorDomProps(rest);
  const info = useSourceInfo(source);
  const table = useTableDef(info?.table ?? null);
  const { rows, loading, error } = useSource(source);
  const { run, notice } = useNoticeAction();
  const title = titleField ?? (table ? titleFieldOf(table) : 'id');
  const shown = [title, subtitleField, badgeField].filter((id): id is string => typeof id === 'string');
  const cellText = useCellText(table, rows, shown);

  let body;
  if (!info || !table) {
    body = <p className="text-sm text-slate-slate400">List of the rows of &quot;{source}&quot;</p>;
  } else if (error && rows.length === 0) {
    body = <ErrorLine message={error} />;
  } else if (loading && rows.length === 0) {
    body = <LoadingLines />;
  } else if (rows.length === 0) {
    body = <EmptyLine text={emptyText ?? 'Nothing here yet.'} />;
  } else {
    body = (
      <ul className="divide-y divide-[color:var(--glass-border)]">
        {rows.map((row, r) => {
          const content = (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-slate100">{cellText(row, title) || '-'}</span>
                {subtitleField && <span className="block truncate text-xs text-slate-slate400">{cellText(row, subtitleField)}</span>}
              </span>
              {badgeField && cellText(row, badgeField) && <span className={cx(PILL, PILL_TONE.muted)}>{cellText(row, badgeField)}</span>}
            </>
          );
          return (
            <li key={String(row.id ?? r)}>
              {rowAction ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-3 py-2 text-left hover:bg-slate-slate700/30 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-brandLight"
                  onClick={() => run(rowAction, { table: info.table, id: String(row.id) })}
                >
                  {content}
                </button>
              ) : (
                <div className="flex items-center gap-3 py-2">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <div {...dom} className={cx('space-y-2', className)}>
      {body}
      <Notice text={notice} />
    </div>
  );
}
