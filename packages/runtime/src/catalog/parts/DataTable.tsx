import { btnSecondary } from '../../../../../src/components/shared/formStyles.js';
import type { Action } from '../../../../../src/catalog/actions.ts';
import { fieldInfo, useSource, useSourceInfo, useTableDef } from '../../../../../src/catalog/context.tsx';
import { useCellText } from './cells.ts';
import { EmptyLine, ErrorLine, LoadingLines, Notice } from './DataState.tsx';
import { useNoticeAction } from './useNoticeAction.ts';
import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import { cx } from './styles.ts';

export interface DataTableProps extends EditorProps {
  source?: string;
  columns?: string[];
  rowAction?: Action;
  pageSize?: 10 | 25 | 50;
  emptyText?: string;
}

/** The rows of a list source as a table: up to 8 columns, paged, with an optional action when a row is clicked. */
export function DataTable({ source = '', columns, rowAction, pageSize = 25, emptyText, ...rest }: DataTableProps) {
  const { className, ...dom } = editorDomProps(rest);
  const info = useSourceInfo(source);
  const table = useTableDef(info?.table ?? null);
  const { rows, total, loading, error, offset, setOffset } = useSource(source, { limit: pageSize });
  const { run, notice } = useNoticeAction();
  const ids = (columns ?? table?.fields.slice(0, 5).map((f) => f.id) ?? []).filter((id) => fieldInfo(table, id) !== null);
  const cellText = useCellText(table, rows, ids);

  let body;
  if (!info || !table) {
    body = <p className="text-sm text-slate-slate400">Table of the rows of &quot;{source}&quot;</p>;
  } else if (error && rows.length === 0) {
    body = <ErrorLine message={error} />;
  } else if (loading && rows.length === 0) {
    body = <LoadingLines />;
  } else {
    body = (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{table.label}</caption>
          {ids.length > 0 && (
            <thead>
              <tr className="text-xs text-slate-slate400">
                {ids.map((id) => (
                  <th key={id} scope="col" className="py-1 pr-3 font-semibold">
                    {fieldInfo(table, id)?.label}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {rows.length === 0 && (
              <tr className="border-t border-[color:var(--glass-border)]">
                <td colSpan={Math.max(ids.length, 1)} className="py-2 pr-3">
                  <EmptyLine text={emptyText ?? 'Nothing here yet.'} />
                </td>
              </tr>
            )}
            {rows.map((row, r) => (
              <tr
                key={String(row.id ?? r)}
                className={cx('border-t border-[color:var(--glass-border)]', rowAction && 'cursor-pointer hover:bg-slate-slate700/30')}
                onClick={rowAction ? () => run(rowAction, { table: info.table, id: String(row.id) }) : undefined}
              >
                {ids.map((id, c) => {
                  const text = cellText(row, id) || '-';
                  return (
                    <td key={id} className="py-2 pr-3 text-slate-slate100">
                      {rowAction && c === 0 ? (
                        <button type="button" className="text-left font-semibold focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-brandLight">
                          {text}
                        </button>
                      ) : (
                        text
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div {...dom} className={cx('space-y-2', className)}>
      {body}
      {info && total > pageSize && (
        <div className="flex items-center justify-between gap-2 text-xs text-slate-slate400">
          <span>
            {offset + 1} to {offset + rows.length} of {total}
          </span>
          <span className="flex gap-2">
            <button type="button" className={btnSecondary} disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - pageSize))}>
              Previous
            </button>
            <button type="button" className={btnSecondary} disabled={offset + pageSize >= total || loading} onClick={() => setOffset(offset + pageSize)}>
              Next
            </button>
          </span>
        </div>
      )}
      <Notice text={notice} />
    </div>
  );
}
