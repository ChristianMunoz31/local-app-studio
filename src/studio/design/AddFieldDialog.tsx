// "Add a field for <part>": the one field a part needs (its type is fixed by the part), added to a table of the draft. The rules and
// messages are the Data step's (validateSpec through tableIssues). Add field hands the field to the session, which also connects the part.
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { AppSpec, Field, FieldType } from '@local-app-studio/runtime/spec/schema';
import Modal from '@/components/shared/Modal.jsx';
import { btnPrimary, btnSecondary, formErrorClass, inputClass, labelClass } from '@/components/shared/formStyles.js';
import { Errors } from '../components/FieldRow';
import OptionsEditor from '../components/OptionsEditor';
import { errorProps } from '../lib/errorProps';
import { FIELD_TYPE_CHOICES } from '../lib/fields';
import { suggestedLabel } from '../lib/partFields';
import { EXAMPLE_OPTIONS, tableIssues, withField } from '../lib/tableDraft';
import { issuesAt } from '../lib/validate';

interface Props {
  /** Plain name of the part ("Checklist"). */
  partName: string;
  /** The session's draftSpec (draft tables). */
  spec: AppSpec;
  /** Tables the field may go to; a "Table" select shows when there are two or more. */
  tables: readonly string[];
  initialTable: string;
  /** Fixed by the part. */
  type: FieldType;
  /** Add field: applies and returns a refusal in plain words (shown, the dialog stays) or null (the session closes it). */
  onAdd(table: string, field: Field): string | null;
  onCancel(): void;
  /** The title and the button of the dialog where it is not "Add a field for <part>" and "Add field" (the Feature builder says slot). */
  words?: { title: string; submit: string };
}

export default function AddFieldDialog({ partName, spec, tables, initialTable, type, onAdd, onCancel, words }: Props) {
  const uid = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [tableId, setTableId] = useState(initialTable);
  // null while the name is untouched: it then follows the suggestion for the chosen table and link.
  const [typed, setTyped] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [options, setOptions] = useState<string[]>([...EXAMPLE_OPTIONS]);
  const [linkTo, setLinkTo] = useState('');
  // `n` counts the refusals: a new one remounts the alert, so the same words are announced again.
  const [refusal, setRefusal] = useState<{ text: string; n: number } | null>(null);
  const refusals = useRef(0);
  const [focusTick, setFocusTick] = useState(0);

  const index = spec.tables.findIndex((t) => t.id === tableId);
  const target = index < 0 ? undefined : spec.tables[index];
  const others = spec.tables.filter((t) => t.id !== tableId).map((t) => ({ id: t.id, label: t.label }));
  // A link chosen for another Table may point at this one now: it only counts while it is one of the other tables.
  const linkId = others.some((t) => t.id === linkTo) ? linkTo : (others[0]?.id ?? '');
  const label = typed ?? suggestedLabel(type, spec.tables, linkId);
  const made = target === undefined ? null : withField(target, label, type, others, type === 'select' ? options : undefined);
  const field: Field | null = made === null ? null : made.field.type === 'reference' && linkId !== '' ? { ...made.field, table: linkId } : made.field;
  const nextTables = field === null ? spec.tables : spec.tables.map((t, i) => (i === index ? { ...t, fields: [...t.fields, field] } : t));
  const at = target === undefined ? 0 : target.fields.length;
  const found = target === undefined ? [] : tableIssues(spec, nextTables, index).filter((i) => i.path === `tables.${index}.fields` || issuesAt([i], `tables.${index}.fields.${at}`).length > 0);
  // Problems show from the first Add field press on, like the New table dialog.
  const issues = shown ? found : [];
  const labelIssues = issuesAt(issues, `tables.${index}.fields.${at}.label`);
  const optionIssues = issuesAt(issues, `tables.${index}.fields.${at}.options`);
  const linkIssues = issuesAt(issues, `tables.${index}.fields.${at}.table`);
  const general = issues.filter((i) => ![labelIssues, optionIssues, linkIssues].some((g) => g.includes(i)));
  const typeLabel = FIELD_TYPE_CHOICES.find((c) => c.type === type)?.label ?? '';

  useEffect(() => {
    if (focusTick > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusTick]);

  const refuse = (text: string): void => {
    refusals.current += 1;
    setRefusal({ text, n: refusals.current });
  };

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    setShown(true);
    setRefusal(null);
    if (field === null || target === undefined) {
      refuse('Pick a table of this app.');
      return;
    }
    if (found.length > 0) {
      setFocusTick((t) => t + 1);
      return;
    }
    const text = onAdd(tableId, field);
    if (text !== null) refuse(text);
  };

  return (
    <Modal title={words?.title ?? `Add a field for ${partName}`} onClose={onCancel} size="md" initialFocusRef={nameRef}>
      <form ref={formRef} className="space-y-4" onSubmit={submit} noValidate>
        {tables.length >= 2 && (
          <div>
            <label htmlFor={`${uid}-table`} className={labelClass}>
              Table
            </label>
            <select
              id={`${uid}-table`}
              className={inputClass}
              value={tableId}
              onChange={(e) => {
                setRefusal(null);
                setTableId(e.target.value);
              }}
            >
              {tables.map((id) => (
                <option key={id} value={id}>
                  {spec.tables.find((t) => t.id === id)?.label ?? id}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label htmlFor={`${uid}-name`} className={labelClass}>
            Field name
          </label>
          <input
            id={`${uid}-name`}
            ref={nameRef}
            className={inputClass}
            value={label}
            onChange={(e) => {
              setRefusal(null);
              setTyped(e.target.value);
            }}
            {...errorProps(`${uid}-name-err`, labelIssues)}
          />
          <Errors issues={labelIssues} id={`${uid}-name-err`} />
        </div>
        <p className="text-sm text-slate-slate300">{`Type: ${typeLabel}`}</p>
        {type === 'select' && (
          <OptionsEditor
            options={options}
            onChange={(next) => {
              setRefusal(null);
              setOptions(next);
            }}
            issues={optionIssues}
          />
        )}
        {type === 'reference' && (
          <div>
            <label htmlFor={`${uid}-link`} className={labelClass}>
              Links to
            </label>
            <select
              id={`${uid}-link`}
              className={inputClass}
              value={field !== null && field.type === 'reference' ? field.table : ''}
              onChange={(e) => {
                setRefusal(null);
                setLinkTo(e.target.value);
              }}
              {...errorProps(`${uid}-link-err`, linkIssues)}
            >
              {others.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <Errors issues={linkIssues} id={`${uid}-link-err`} />
          </div>
        )}
        {general.length > 0 && (
          // Problems of the table as a whole (a full table) have no marked control: they are announced here.
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
            {words?.submit ?? 'Add field'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
