import { useEffect, useId, useRef, useState } from 'react';
import type { DragEvent, FocusEvent, KeyboardEvent } from 'react';
import { fieldInfo, useIsLive, useMutations, useSource, useSourceInfo, useTableDef } from '../../../../../src/catalog/context.tsx';
import type { DataRow } from '../../../../../src/catalog/context.tsx';
import { ERROR_TEXT, errorText } from '../../../../../src/catalog/errorText.ts';
import { titleFieldOf } from './format.ts';
import { useCellText } from './cells.ts';
import { EmptyLine, ErrorLine, LoadingLines } from './DataState.tsx';
import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import { appliedText } from './fieldValue.ts';
import { cx } from './styles.ts';

export interface KanbanProps extends EditorProps {
  source?: string;
  field?: string;
  titleField?: string;
  subtitleField?: string;
  emptyText?: string;
}

/** The value of the column for a record with no value (or one that is no longer an option). */
const EMPTY = '';
/** React key of a column or menu entry: an option value is always prefixed, so no option (even one named none) can equal the key of the empty column. */
const columnKey = (value: string): string => (value === EMPTY ? 'empty' : `option:${value}`);
const NO_MOVES: Record<string, string> = {};

interface Column {
  value: string;
  label: string;
  cards: DataRow[];
}

interface Overlay {
  rows: DataRow[];
  moves: Record<string, string>;
}

const without = (moves: Record<string, string>, id: string): Record<string, string> => Object.fromEntries(Object.entries(moves).filter(([key]) => key !== id));

/**
 * Rows of a list source as cards in columns, one column for each option of a choice field and one for no value. A card moves
 * by a drag (native drag and drop, no library) or by its Move button (a menu of the other columns, or Arrow Left and Right).
 * A move saves exactly that one field through the data layer's update, so the server's validation and rules run; the rules'
 * words and "Moved X to Y." go to one polite status line. Where the page is not live the cards show and nothing moves.
 */
export function Kanban({ source = '', field = '', titleField, subtitleField, emptyText, ...rest }: KanbanProps) {
  const { className, ...dom } = editorDomProps(rest);
  const uid = useId();
  const live = useIsLive();
  const info = useSourceInfo(source);
  const table = useTableDef(info?.table ?? null);
  const { rows, total, loading, error } = useSource(source);
  const { update } = useMutations();
  const rootRef = useRef<HTMLDivElement>(null);
  // The card whose Move button gets focus after the next render (a keyboard move re-mounts the card in its new column).
  const refocus = useRef<string | null>(null);
  // Moves shown before the server answers; they only count for the rows they were made on.
  const [overlay, setOverlay] = useState<Overlay>({ rows, moves: NO_MOVES });
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const title = titleField ?? (table ? titleFieldOf(table) : 'id');
  const cellText = useCellText(table, rows, [title, ...(subtitleField ? [subtitleField] : [])]);
  const found = fieldInfo(table, field);
  const choice = found !== null && found.type === 'select' && field !== 'id' ? found : null;
  const declared = table?.fields.find((f) => f.id === field);
  const optional = declared === undefined || declared.required !== true;
  const moves = overlay.rows === rows ? overlay.moves : NO_MOVES;

  useEffect(() => {
    const id = refocus.current;
    if (id === null) return;
    const button = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('[data-move]') ?? []).find((el) => el.getAttribute('data-move') === id);
    if (button === undefined) return;
    refocus.current = null;
    button.focus();
  });

  useEffect(() => {
    if (menuFor === null) return;
    rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [menuFor]);

  const columns: Column[] = [];
  if (choice !== null) {
    const options = choice.options ?? [];
    const valueOf = (row: DataRow): string => {
      const id = String(row.id);
      const value = Object.hasOwn(moves, id) ? moves[id] : row[field];
      return typeof value === 'string' && options.includes(value) ? value : EMPTY;
    };
    for (const option of options) columns.push({ value: option, label: option, cards: rows.filter((r) => valueOf(r) === option) });
    const none = rows.filter((r) => valueOf(r) === EMPTY);
    if (none.length > 0 || optional) columns.push({ value: EMPTY, label: `No ${choice.label}`, cards: none });
  }
  const columnOf = (id: string): Column | undefined => columns.find((c) => c.cards.some((r) => String(r.id) === id));
  // A card can go to any other column, except the empty one when the field must be filled in.
  const droppable = (target: Column, from: Column | undefined): boolean => target !== from && (target.value !== EMPTY || optional);
  const canMove = live && info !== null && choice !== null;

  const move = async (row: DataRow, target: Column, byKeyboard: boolean): Promise<void> => {
    if (!canMove || saving || info === null) return;
    const id = String(row.id);
    const from = columnOf(id);
    if (!droppable(target, from)) return;
    const name = cellText(row, title) || 'this card';
    if (byKeyboard) refocus.current = id;
    setFailure(null);
    setStatus('');
    setSaving(true);
    setOverlay((prev) => ({ rows, moves: { ...(prev.rows === rows ? prev.moves : NO_MOVES), [id]: target.value } }));
    try {
      const saved = await update(info.table, id, { [field]: target.value === EMPTY ? null : target.value });
      setStatus([`Moved ${name} to ${target.label}.`, appliedText(saved)].filter(Boolean).join(' '));
    } catch (e) {
      // The card goes back where it was and the server's sentence says why.
      setOverlay((prev) => ({ rows: prev.rows, moves: without(prev.moves, id) }));
      setFailure(errorText(e, ERROR_TEXT.saveFailed));
      if (byKeyboard) refocus.current = id;
    } finally {
      setSaving(false);
    }
  };

  const step = (row: DataRow, direction: 1 | -1): void => {
    const from = columnOf(String(row.id));
    const at = columns.findIndex((c) => c === from);
    for (let i = at + direction; i >= 0 && i < columns.length; i += direction) {
      if (droppable(columns[i], from)) {
        void move(row, columns[i], true);
        return;
      }
    }
  };

  const onMoveKey = (e: KeyboardEvent<HTMLButtonElement>, row: DataRow): void => {
    if (menuFor !== null || !canMove) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      step(row, e.key === 'ArrowRight' ? 1 : -1);
    }
  };

  const onMenuKey = (e: KeyboardEvent<HTMLUListElement>, id: string): void => {
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    const at = items.findIndex((el) => el === document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? (at + 1) % items.length : at <= 0 ? items.length - 1 : at - 1;
      items[next]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      items[e.key === 'Home' ? 0 : items.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      refocus.current = id;
      setMenuFor(null);
    } else if (e.key === 'Tab') {
      setMenuFor(null);
    }
  };

  const onCardBlur = (e: FocusEvent<HTMLLIElement>): void => {
    if (menuFor !== null && !e.currentTarget.contains(e.relatedTarget)) setMenuFor(null);
  };

  const dropOn = (e: DragEvent<HTMLElement>, target: Column): void => {
    e.preventDefault();
    const row = rows.find((r) => String(r.id) === dragging);
    setOver(null);
    setDragging(null);
    if (row !== undefined && !saving) void move(row, target, false);
  };

  const allowsDrop = (target: Column): boolean => dragging !== null && canMove && !saving && droppable(target, columnOf(dragging));

  let body;
  if (!info || !table) {
    body = <p className="text-sm text-slate-slate400">Board of the rows of &quot;{source}&quot;</p>;
  } else if (info.mode !== 'list' || choice === null) {
    body = <EmptyLine text={ERROR_TEXT.kanbanCannot} />;
  } else if (error && rows.length === 0) {
    body = <ErrorLine message={error} />;
  } else if (loading && rows.length === 0) {
    body = <LoadingLines />;
  } else if (rows.length === 0) {
    body = <EmptyLine text={emptyText ?? 'Nothing on the board yet.'} />;
  } else {
    const hintId = `${uid}-hint`;
    body = (
      <>
        <p id={hintId} className="sr-only">
          Press Enter for a menu of columns, or Arrow Left and Right to move the card.
        </p>
        <div role="region" aria-label={`${choice.label} board`} tabIndex={0} className="flex items-start gap-3 overflow-x-auto pb-2">
          {columns.map((column, ci) => {
            const headId = `${uid}-col-${ci}`;
            const dropTarget = over === column.value && allowsDrop(column);
            return (
              <section
                key={columnKey(column.value)}
                aria-labelledby={headId}
                onDragOver={(e) => {
                  if (!allowsDrop(column)) return;
                  e.preventDefault();
                  const transfer = e.dataTransfer as DataTransfer | undefined;
                  if (transfer !== undefined) transfer.dropEffect = 'move';
                  setOver(column.value);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
                }}
                onDrop={(e) => {
                  if (allowsDrop(column)) dropOn(e, column);
                }}
                className={cx('w-64 shrink-0 space-y-2 rounded-lg border border-slate-slate700/60 p-2', dropTarget && 'ring-2 ring-slate-brandLight')}
              >
                <div className="flex items-center justify-between gap-2 px-1">
                  <h3 id={headId} className="truncate text-xs font-semibold uppercase tracking-wide text-slate-slate400">
                    {column.label}
                  </h3>
                  <span className="text-xs text-slate-slate400">{column.cards.length}</span>
                </div>
                <ul className="space-y-2">
                  {column.cards.map((row, i) => {
                    const id = String(row.id ?? i);
                    const name = cellText(row, title) || '-';
                    const others = columns.filter((c) => droppable(c, column));
                    return (
                      <li
                        key={id}
                        draggable={canMove && !saving}
                        onDragStart={(e) => {
                          setDragging(id);
                          // Firefox starts a drag only when something is set; a test or an odd browser may give no transfer.
                          const transfer = e.dataTransfer as DataTransfer | undefined;
                          if (transfer === undefined) return;
                          transfer.effectAllowed = 'move';
                          transfer.setData('text/plain', name);
                        }}
                        onDragEnd={() => {
                          setDragging(null);
                          setOver(null);
                        }}
                        onBlur={onCardBlur}
                        className={cx('relative rounded-md p-3 glass-subtle', canMove && 'cursor-grab', dragging === id && 'opacity-50')}
                      >
                        <span className="block truncate text-sm font-semibold text-slate-slate100">{name}</span>
                        {subtitleField && <span className="block truncate text-xs text-slate-slate400">{cellText(row, subtitleField)}</span>}
                        <button
                          type="button"
                          data-move={id}
                          aria-label={`Move ${name}`}
                          aria-describedby={hintId}
                          aria-haspopup="menu"
                          aria-expanded={menuFor === id}
                          aria-controls={menuFor === id ? `${uid}-menu-${id}` : undefined}
                          aria-disabled={saving || undefined}
                          disabled={!canMove}
                          onClick={() => {
                            if (!saving) setMenuFor((open) => (open === id ? null : id));
                          }}
                          onKeyDown={(e) => onMoveKey(e, row)}
                          className="mt-2 rounded-md px-2 py-1 text-xs font-medium text-slate-slate300 hover:bg-slate-slate700/60 hover:text-slate-slate100 disabled:opacity-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-brandLight"
                        >
                          Move
                        </button>
                        {menuFor === id && (
                          <ul
                            id={`${uid}-menu-${id}`}
                            role="menu"
                            aria-label={`Move ${name} to`}
                            onKeyDown={(e) => onMenuKey(e, id)}
                            className="absolute left-3 z-20 mt-1 min-w-40 rounded-md py-1 glass-flat"
                          >
                            {others.map((target) => (
                              <li key={columnKey(target.value)} role="none">
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setMenuFor(null);
                                    void move(row, target, true);
                                  }}
                                  className="block w-full px-3 py-2 text-left text-sm text-slate-slate100 hover:bg-slate-slate700/60 focus-visible:bg-slate-slate700/60 focus-visible:outline-hidden"
                                >
                                  {target.label}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
        {rows.length < total && <p className="text-xs text-slate-slate400">{`Showing ${rows.length} of ${total}.`}</p>}
      </>
    );
  }
  return (
    <div {...dom} ref={rootRef} className={cx('space-y-2', className)}>
      {body}
      <p role="status" className="text-xs text-slate-slate400">
        {status}
      </p>
      {failure && <ErrorLine message={failure} />}
    </div>
  );
}
