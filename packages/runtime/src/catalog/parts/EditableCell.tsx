import { useEffect, useId, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent } from 'react';
import { formErrorClass } from '../../../../../src/components/shared/formStyles.js';
import type { Field } from '../../spec/schema.ts';
import { useMutations } from '../../../../../src/catalog/context.tsx';
import type { DataRow } from '../../../../../src/catalog/context.tsx';
import { ERROR_TEXT, errorText } from '../../../../../src/catalog/errorText.ts';
import { FieldInput } from './FieldInput.tsx';
import { appliedText, toInput, toPayload } from './fieldValue.ts';

export interface EditableCellProps {
  table: string;
  field: Field;
  row: DataRow;
  /** The cell as the table shows it. */
  text: string;
  /** What names the row to a screen reader (its title). */
  rowName: string;
  /** The words of a finished save, with the rules' words after them. */
  onSaved: (words: string) => void;
  /** Called when the cell opens for editing (the table drops the last "Saved." so the next one is announced again). */
  onOpen?: () => void;
}

/**
 * One cell of a DataTable that can be edited in place: a button that swaps for the input the form uses for the field.
 * Enter or leaving the cell saves one field through the same update the form makes; Escape puts the cell back.
 */
export function EditableCell({ table, field, row, text, rowName, onSaved, onOpen }: EditableCellProps) {
  const { update } = useMutations();
  const uid = useId();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string | boolean>('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLSpanElement>(null);
  const start = useRef<string | boolean>('');
  // A save in flight, and a close the person asked for: the blur that follows must not save again.
  const working = useRef(false);
  const closing = useRef(false);
  // Put focus on the cell button once the input is gone (after Enter or Escape, not after a click elsewhere).
  const returnFocus = useRef(false);
  // Put focus on the input: when it opens, and after a failed save made by Enter.
  const focusInput = useRef(false);
  const inputId = `${uid}-input`;
  const problemId = `${uid}-problem`;

  useEffect(() => {
    if (editing && !busy && focusInput.current) {
      focusInput.current = false;
      box.current?.querySelector<HTMLElement>('input,select,textarea')?.focus();
    }
  }, [editing, busy]);

  useEffect(() => {
    if (!editing && returnFocus.current) {
      returnFocus.current = false;
      button.current?.focus();
    }
  }, [editing]);

  const open = (): void => {
    const initial = toInput(field, row[field.id]);
    start.current = initial;
    closing.current = false;
    focusInput.current = true;
    setValue(initial);
    setProblem(null);
    setEditing(true);
    onOpen?.();
  };

  const close = (focusCell: boolean): void => {
    closing.current = true;
    returnFocus.current = focusCell;
    setProblem(null);
    setEditing(false);
  };

  const save = async (focusCell: boolean): Promise<void> => {
    if (working.current || closing.current) return;
    if (field.required && field.type !== 'boolean' && (typeof value !== 'string' || value.trim() === '')) {
      setProblem(`${field.label} is required.`);
      return;
    }
    // Nothing changed: no request, and updated_at stays as it is.
    if (value === start.current) {
      close(focusCell);
      return;
    }
    working.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const saved = await update(table, String(row.id), { [field.id]: toPayload(field, value, true) });
      onSaved(['Saved.', appliedText(saved)].filter(Boolean).join(' '));
      close(focusCell);
    } catch (e) {
      setProblem(errorText(e, ERROR_TEXT.saveFailed));
      focusInput.current = focusCell;
    } finally {
      working.current = false;
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (!working.current) close(true);
    } else if (e.key === 'Enter' && !(e.shiftKey && e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault();
      void save(true);
    }
  };

  const onBlur = (e: FocusEvent<HTMLSpanElement>): void => {
    if (e.relatedTarget instanceof Node && box.current?.contains(e.relatedTarget)) return;
    void save(false);
  };

  if (!editing) {
    return (
      <button
        ref={button}
        type="button"
        aria-label={`Edit ${field.label} of ${rowName}`}
        aria-describedby={`${uid}-text`}
        className="w-full text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-brandLight"
        onClick={(e) => {
          e.stopPropagation();
          open();
        }}
      >
        <span id={`${uid}-text`}>{text}</span>
      </button>
    );
  }
  return (
    <span ref={box} className="block" onKeyDown={onKeyDown} onBlur={onBlur} onClick={(e) => e.stopPropagation()}>
      <label htmlFor={inputId} className="sr-only">{`${field.label} of ${rowName}`}</label>
      <FieldInput field={field} value={value} onChange={setValue} id={inputId} invalid={problem !== null} describedBy={problem === null ? undefined : problemId} disabled={busy} />
      {problem !== null && (
        <p id={problemId} role="alert" className={`${formErrorClass} mt-1`}>
          {problem}
        </p>
      )}
    </span>
  );
}
