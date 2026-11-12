import { useEffect, useId, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { isReservedFieldId, isReservedTableId } from '@local-app-studio/runtime/spec/schema';
import type { Field, SpecIssue, Table } from '@local-app-studio/runtime/spec/schema';
import { btnDanger, btnSecondary, inputClass, labelClass } from '@/components/shared/formStyles.js';
import { DATA_COPY } from '../lib/dataCopy';
import type { ChangeMeta } from '../lib/tableChange';
import { blankField, followedId } from '../lib/tableDraft';
import { errorProps } from '../lib/errorProps';
import { issuesAt } from '../lib/validate';
import { HINT_CLASS } from './ui';
import FieldRow, { EMPTY_TABLE_NAME, Errors, FieldTypeHint } from './FieldRow';
import TableAdvanced from './TableAdvanced';
import TableAutomations from './TableAutomations';

interface Props {
  table: Table;
  index: number;
  tables: Table[];
  issues: SpecIssue[];
  onChange(next: Table, meta?: ChangeMeta): void;
  /** Removes this table from the draft; the Data step shows the notice with Undo. */
  onDelete(): void;
  /** Adds a table to the draft (the link hint offers it while there is only one). */
  onAddTable(): void;
  /** Titles of pages whose lists read this table, shown under More options. */
  usedByPages?: string[];
  /** The tables as last saved: a table or field that is in them keeps its inside name; a new one's follows its name. */
  savedTables?: readonly Table[];
  /** Move the focus into the table name box with its text selected (a table was just added). */
  focusName?: boolean;
  /** Called once the focus has moved, so it does not move again. */
  onFocused?(): void;
}

let rowKeyCount = 0;
/** A key for one field row that stays with the row when it moves, when others go, and while its inside name follows its label. */
const nextRowKey = (): string => {
  rowKeyCount += 1;
  return `field-row-${rowKeyCount}`;
};

export default function TableEditor({ table, index, tables, issues, onChange, onDelete, onAddTable, usedByPages = [], savedTables, focusName = false, onFocused }: Props) {
  const uid = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const focused = useRef(onFocused);
  useEffect(() => {
    focused.current = onFocused;
  });
  useEffect(() => {
    if (!focusName) return;
    nameRef.current?.focus();
    nameRef.current?.select();
    focused.current?.();
  }, [focusName]);
  // The field that was just added: its name box takes the focus once, with its text selected.
  const [focusField, setFocusField] = useState<number | null>(null);
  // A row's key cannot be its id: the id follows the name while the field is new, so each keystroke would make a new row and drop the focus.
  const [rowKeys, setRowKeys] = useState<string[]>(() => table.fields.map(() => nextRowKey()));
  if (rowKeys.length !== table.fields.length) setRowKeys(table.fields.map((_, i) => rowKeys[i] ?? nextRowKey()));
  // The Move button that takes the focus after a move (the pressed one may have become disabled at the end of the list).
  const [focusMove, setFocusMove] = useState<{ key: string; button: 'up' | 'down' } | null>(null);
  const addFieldRef = useRef<HTMLButtonElement>(null);
  const savedTable = savedTables?.find((t) => t.id === table.id);
  // Every saved id stays taken, also one the draft has taken out: a new table or field must not be matched to it.
  const savedFieldIds = savedTable?.fields.map((f) => f.id) ?? [];
  const base = `tables.${index}`;
  const otherTables = tables.filter((t) => t.id !== table.id).map((t) => ({ id: t.id, label: t.label }));
  const at = (key: string): SpecIssue[] => issuesAt(issues, `${base}.${key}`);
  const startingField = table.fields.length === 1 && table.fields[0].id === 'name';

  const setField = (k: number, change: Field): void => {
    const old = table.fields[k];
    // The inside name follows the field name until the field is saved (the same rule as Design's New table).
    const next =
      old !== undefined && old.label !== change.label && old.id === change.id
        ? {
            ...change,
            id: followedId(old, change.label, new Set([...table.fields.filter((_, i) => i !== k).map((f) => f.id), ...savedFieldIds]), savedTable?.fields.some((f) => f.id === old.id) === true, isReservedFieldId),
          }
        : change;
    const fields = table.fields.map((f, i) => (i === k ? next : f));
    const titleField = old && table.titleField === old.id && next.id !== old.id ? next.id : table.titleField;
    const typing = old !== undefined && old.label !== next.label;
    onChange({ ...table, fields, ...(titleField === undefined ? {} : { titleField }) }, typing ? { label: 'Field name', coalesceKey: `field-label:${index}:${k}` } : { label: 'Field' });
  };

  const addField = (): void => {
    const added = blankField({ fields: [...table.fields, ...(savedTable?.fields ?? [])] });
    setRowKeys([...rowKeys, nextRowKey()]);
    onChange({ ...table, fields: [...table.fields, added] }, { label: 'Add field', notice: `Added the field ${added.label}.` });
    setFocusField(table.fields.length);
  };

  const setLabel = (label: string): void => {
    const taken = new Set([...tables.filter((t) => t.id !== table.id).map((t) => t.id), ...(savedTables ?? []).map((t) => t.id)]);
    const id = followedId(table, label, taken, savedTable !== undefined, isReservedTableId);
    onChange({ ...table, label, id }, { label: 'Table name', coalesceKey: `table-name:${index}` });
  };

  const moveField = (k: number, delta: -1 | 1): void => {
    const target = k + delta;
    if (target < 0 || target >= table.fields.length) return;
    const fields = [...table.fields];
    [fields[k], fields[target]] = [fields[target], fields[k]];
    const keys = [...rowKeys];
    [keys[k], keys[target]] = [keys[target], keys[k]];
    setRowKeys(keys);
    // The moved row keeps the focus on the button that was pressed, or on the other one when this one cannot go further.
    const atEnd = delta === -1 ? target === 0 : target === table.fields.length - 1;
    setFocusMove({ key: keys[target], button: atEnd ? (delta === -1 ? 'down' : 'up') : delta === -1 ? 'up' : 'down' });
    onChange({ ...table, fields }, { label: 'Move field', notice: DATA_COPY.movedField(table.fields[k].label, delta === -1 ? 'up' : 'down') });
  };

  const deleteField = (k: number): void => {
    const removed = table.fields[k];
    const fields = table.fields.filter((_, i) => i !== k);
    const next: Table = { ...table, fields };
    setRowKeys(rowKeys.filter((_, i) => i !== k));
    // The row that was pressed is gone: the focus goes to the field now in its place, or to Add field when none is left.
    if (fields.length > 0) setFocusField(Math.min(k, fields.length - 1));
    else addFieldRef.current?.focus();
    if (removed && table.titleField === removed.id) delete next.titleField;
    onChange(next, { label: 'Remove field', ...(removed ? { notice: `Removed the field ${removed.label}.` } : {}) });
  };

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={`${uid}-label`} className={labelClass}>
          Table name
        </label>
        <input
          id={`${uid}-label`}
          ref={nameRef}
          className={inputClass}
          value={table.label}
          onChange={(e) => setLabel(e.target.value)}
          {...errorProps(`${uid}-label-err`, at('label'), EMPTY_TABLE_NAME)}
        />
        <Errors issues={at('label')} id={`${uid}-label-err`} empty={EMPTY_TABLE_NAME} />
        {startingField && <p className={`${HINT_CLASS} mt-1`}>Every table starts with a Name field that names each record. Rename it or add more fields.</p>}
      </div>
      <Errors issues={issues.filter((i) => i.path === base || i.path === `${base}.fields`)} id={`${uid}-table-err`} />
      <h3 className="text-sm font-semibold text-slate-slate100">Fields</h3>
      {tables.length === 1 && (
        <div className="flex flex-wrap items-center gap-3">
          <p className={HINT_CLASS}>To link records between tables, add a second table first.</p>
          <button type="button" className={btnSecondary} onClick={onAddTable}>
            Add table
          </button>
        </div>
      )}
      <FieldTypeHint id={`${uid}-type-hint`} />
      <div className="space-y-3">
        {table.fields.map((field, k) => (
          <FieldRow
            key={rowKeys[k] ?? `field-row-${k}`}
            typeHintId={`${uid}-type-hint`}
            field={field}
            position={k + 1}
            path={`${base}.fields.${k}`}
            otherTables={otherTables}
            issues={issues}
            first={k === 0}
            last={k === table.fields.length - 1}
            onChange={(next) => setField(k, next)}
            onEnter={addField}
            focusName={focusField === k}
            onFocused={() => setFocusField(null)}
            onMove={(delta) => moveField(k, delta)}
            focusAction={focusMove !== null && focusMove.key === rowKeys[k] ? focusMove.button : null}
            onActionFocused={() => setFocusMove(null)}
            onDelete={() => deleteField(k)}
          />
        ))}
        <button ref={addFieldRef} type="button" className={`${btnSecondary} w-full`} onClick={addField}>
          <span className="inline-flex items-center gap-1.5">
            <Plus size={14} aria-hidden="true" />
            Add field
          </span>
        </button>
      </div>
      <TableAutomations table={table} index={index} issues={issues} onChange={onChange} />
      <TableAdvanced table={table} index={index} issues={issues} usedByPages={usedByPages} onChange={onChange} />
      <div>
        <button type="button" className={btnDanger} onClick={onDelete}>
          <Trash2 size={14} aria-hidden="true" />
          Delete table
        </button>
      </div>
    </div>
  );
}
