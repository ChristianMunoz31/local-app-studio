// "New table for <part>": a table made without leaving Design. The part's fields come pre-filled (newTableDraft); the rules, limits and
// messages are the Data step's (validateSpec through tableIssues, FieldRow and Errors). Make table hands the table to the session.
import { Plus } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { AppSpec, Table } from '@local-app-studio/runtime/spec/schema';
import Modal from '@/components/shared/Modal.jsx';
import { btnPrimary, btnSecondary, formErrorClass, inputClass, labelClass } from '@/components/shared/formStyles.js';
import FieldRow, { EMPTY_TABLE_NAME, Errors, FieldTypeHint } from '../components/FieldRow';
import { HINT_CLASS } from '../components/ui';
import { errorProps } from '../lib/errorProps';
import { blankField, tableFromDraft, tableIssues } from '../lib/tableDraft';
import type { TableDraft } from '../lib/tableDraft';
import { issuesAt } from '../lib/validate';

export interface NewTableDialogProps {
  /** Plain name of the part ("Table of records"), or of the feature when a feature asked for the table. */
  partName: string;
  /** The part type the table is for (the Feature builder picks the sample rows by it); absent when a feature asked. */
  partType?: string;
  /** The session's draftSpec (draft tables): the table is checked against it. */
  spec: AppSpec;
  initial: TableDraft;
  /** The part needs a link to another table and the app has none: the dialog says to make a second table after this one. */
  needsLink?: boolean;
  /** Make table: applies and returns a refusal in plain words (shown, the dialog stays) or null (the session closes it). */
  onMake(table: Table): string | null;
  onCancel(): void;
}

const LINK_HINT = 'A linked record picker needs a link to another table. Make a second table after this one.';

export default function NewTableDialog({ partName, spec, initial, needsLink = false, onMake, onCancel }: NewTableDialogProps) {
  const uid = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState<TableDraft>(initial);
  const [shown, setShown] = useState(false);
  // `n` counts the refusals: a new one remounts the alert, so the same words are announced again.
  const [refusal, setRefusal] = useState<{ text: string; n: number } | null>(null);
  const refusals = useRef(0);
  const [focusTick, setFocusTick] = useState(0);

  const n = spec.tables.length;
  const candidate = tableFromDraft(draft, spec.tables);
  const issues = tableIssues(spec, [...spec.tables, candidate], n);
  const visible = shown ? issues : [];
  const nameIssues = issuesAt(visible, `tables.${n}.label`);
  const general = visible.filter((i) => !i.path.startsWith(`tables.${n}.fields.`) && i.path !== `tables.${n}.label`);
  const nameErr = errorProps(`${uid}-name-err`, nameIssues, EMPTY_TABLE_NAME);
  const nameProps = { ...nameErr, 'aria-describedby': [nameErr['aria-describedby'], `${uid}-name-hint`].filter((x) => x !== undefined).join(' ') };
  const otherTables = spec.tables.map((t) => ({ id: t.id, label: t.label }));

  // After a Make table with problems the focus goes to the first control that is marked.
  useEffect(() => {
    if (focusTick > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusTick]);

  const edit = (next: TableDraft): void => {
    setRefusal(null);
    setDraft(next);
  };

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    setShown(true);
    setRefusal(null);
    if (issues.length > 0) {
      setFocusTick((t) => t + 1);
      return;
    }
    const text = onMake(candidate);
    if (text === null) return;
    refusals.current += 1;
    setRefusal({ text, n: refusals.current });
  };

  const move = (k: number, delta: -1 | 1): void => {
    const fields = [...draft.fields];
    const to = k + delta;
    if (to < 0 || to >= fields.length) return;
    [fields[k], fields[to]] = [fields[to], fields[k]];
    edit({ ...draft, fields });
  };

  return (
    <Modal title={`New table for ${partName}`} onClose={onCancel} size="lg" initialFocusRef={nameRef}>
      <form ref={formRef} className="space-y-4" onSubmit={submit} noValidate>
        <div>
          <label htmlFor={`${uid}-name`} className={labelClass}>
            Table name
          </label>
          <input
            id={`${uid}-name`}
            ref={nameRef}
            className={inputClass}
            placeholder="For example: Crews"
            value={draft.label}
            onChange={(e) => edit({ ...draft, label: e.target.value })}
            {...nameProps}
          />
          <Errors issues={nameIssues} id={`${uid}-name-err`} empty={EMPTY_TABLE_NAME} />
          <p id={`${uid}-name-hint`} className={`mt-1 ${HINT_CLASS}`}>
            The first field names each record.
          </p>
        </div>
        <h3 className="text-sm font-semibold text-slate-slate100">Fields</h3>
        <FieldTypeHint id={`${uid}-type-hint`} />
        <div className="space-y-3">
          {draft.fields.map((field, k) => (
            <FieldRow
              key={k}
              typeHintId={`${uid}-type-hint`}
              field={field}
              position={k + 1}
              path={`tables.${n}.fields.${k}`}
              otherTables={otherTables}
              issues={visible}
              first={k === 0}
              last={k === draft.fields.length - 1}
              onChange={(next) => edit({ ...draft, fields: draft.fields.map((f, i) => (i === k ? next : f)) })}
              onMove={(delta) => move(k, delta)}
              onDelete={() => edit({ ...draft, fields: draft.fields.filter((_, i) => i !== k) })}
            />
          ))}
        </div>
        <div>
          <button type="button" className={`${btnSecondary} inline-flex items-center gap-1.5`} onClick={() => edit({ ...draft, fields: [...draft.fields, blankField(candidate)] })}>
            <Plus size={14} aria-hidden="true" />
            Add field
          </button>
        </div>
        {needsLink && <p className={HINT_CLASS}>{LINK_HINT}</p>}
        {general.length > 0 && (
          // Problems of the table as a whole (no control is marked for them) are announced here.
          <div role="alert">
            <Errors issues={general} id={`${uid}-general-err`} />
          </div>
        )}
        {refusal !== null && (
          <p key={refusal.n} role="alert" className={formErrorClass}>
            {refusal.text}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary}>
            Make table
          </button>
        </div>
      </form>
    </Modal>
  );
}
