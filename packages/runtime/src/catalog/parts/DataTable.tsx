import { useState } from 'react';
import type { Action } from '../../../../../src/catalog/actions.ts';
import { fieldInfo, useIsLive, useSource, useSourceInfo, useTableDef } from '../../../../../src/catalog/context.tsx';
import { isNumbered } from '../../spec/autoNumber.ts';
import { useCellText } from './cells.ts';
import { EditableCell } from './EditableCell.tsx';
import { titleFieldOf } from './format.ts';
import { EmptyLine, ErrorLine, LoadingLines, Notice } from './DataState.tsx';
import { Pager } from './Pager.tsx';
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
  /** Design only (ADR-017): `cells` lets a person click a cell to edit it. Absent means off. */
  edit?: 'off' | 'cells';
}

/** The rows of a list source as a table: up to 8 columns, paged, with an optional action when a row is clicked. */
export function DataTable({ source = '', columns, rowAction, pageSize = 25, emptyText, edit, ...rest }: DataTableProps) {
  const { className, ...dom } = editorDomProps(rest);
  const info = useSourceInfo(source);
  const table = useTableDef(info?.table ?? null);
  const { rows, total, loading, error, offset, setOffset } = useSource(source, { limit: pageSize });
  const { run, notice } = useNoticeAction();
  const ids = (columns ?? table?.fields.slice(0, 5).map((f) => f.id) ?? []).filter((id) => fieldInfo(table, id) !== null);
  const live = useIsLive();
  const editOn = edit === 'cells' && live;
  const titleId = table ? titleFieldOf(table) : 'id';
  const cellText = useCellText(table, rows, editOn && !ids.includes(titleId) ? [...ids, titleId] : ids);
  // The line under the table is the most recent message: a row action's refusal or a finished save. Opening a cell drops the last
  // "Saved." so an identical next one changes the text and is announced again.
  const [saved, setSaved] = useState<string | null>(null);
  const [latest, setLatest] = useState<'notice' | 'saved'>('notice');
  const runRow = (action: Action, current: { table: string; id: string }): void => {
    setSaved(null);
    setLatest('notice');
    run(action, current);
  };

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
                onClick={rowAction ? () => runRow(rowAction, { table: info.table, id: String(row.id) }) : undefined}
              >
                {ids.map((id, c) => {
                  const text = cellText(row, id) || '-';
                  // A real, typed, non-numbered field; not the first column of a clickable row (that button runs the row action).
                  const editable = editOn && info && !(rowAction && c === 0) ? table.fields.find((f) => f.id === id && !isNumbered(f)) : undefined;
                  return (
                    <td key={id} className="py-2 pr-3 text-slate-slate100">
                      {editable && info ? (
                        <EditableCell table={info.table} field={editable} row={row} text={text} rowName={cellText(row, titleId) || String(row.id)} onSaved={(words) => { setSaved(words); setLatest('saved'); }} onOpen={() => setSaved(null)} />
                      ) : rowAction && c === 0 ? (
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
      {info && table && <Pager label={table.label} offset={offset} count={rows.length} total={total} pageSize={pageSize} loading={loading} setOffset={setOffset} />}
      <Notice text={latest === 'saved' ? saved : notice} />
    </div>
  );
}
