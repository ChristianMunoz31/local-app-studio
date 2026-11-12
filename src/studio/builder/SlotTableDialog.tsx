// "Add a table slot": the feature shows rows from a table, and in an app people pick their own. The dialog names the slot and picks the
// sample rows the canvas shows meanwhile (Crews, Tasks or Items); the table behind it is made from that template (DESIGN-phase16.md 4.3).
// It takes the props of NewTableDialog, so the session opens it where New table would open.
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import Modal from '@/components/shared/Modal.jsx';
import { btnPrimary, btnSecondary, formErrorClass, inputClass, labelClass } from '@/components/shared/formStyles.js';
import type { NewTableDialogProps } from '../design/NewTableDialog';
import { EMPTY_TABLE_NAME, Errors } from '../components/FieldRow';
import { fieldNeedsOf } from '../lib/partFields';
import type { FieldNeed } from '../lib/partFields';
import { tableIssues } from '../lib/tableDraft';
import { issuesAt } from '../lib/validate';
import { SAMPLE_IDS, SAMPLE_TABLES, sampleCovering, slotTable } from './bench';
import type { SampleId } from './bench';
import { SLOT_TABLE_WORDS } from './words';


/** The label with " 2", " 3" added until no table of the bench has it. */
function freshLabel(base: string, taken: readonly string[]): string {
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  let label = base;
  for (let n = 2; lower.has(label.toLowerCase()); n += 1) label = `${base} ${n}`;
  return label;
}

export default function SlotTableDialog({ partType, spec, initial, onMake, onCancel }: NewTableDialogProps) {
  const uid = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [needs] = useState<FieldNeed[]>(() => (partType === undefined ? initial.fields.slice(1).map((f) => ({ prop: f.id, types: [f.type] })) : fieldNeedsOf(partType)));
  const [sample, setSample] = useState<SampleId>(() => sampleCovering(needs));
  // null while the name is untouched: it then follows the sample rows.
  const [typed, setTyped] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [refusal, setRefusal] = useState<{ text: string; n: number } | null>(null);
  const refusals = useRef(0);
  const [focusTick, setFocusTick] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  const label = typed ?? freshLabel(SAMPLE_TABLES[sample].label, spec.tables.map((t) => t.label));
  const n = spec.tables.length;
  const table = slotTable(label.trim(), sample, needs, new Set(spec.tables.map((t) => t.id)));
  const issues = shown ? tableIssues(spec, [...spec.tables, table], n) : [];
  const nameIssues = issuesAt(issues, `tables.${n}.label`);
  const general = issues.filter((i) => i.path !== `tables.${n}.label`);

  useEffect(() => {
    if (focusTick > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusTick]);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    setShown(true);
    setRefusal(null);
    if (tableIssues(spec, [...spec.tables, table], n).length > 0) {
      setFocusTick((t) => t + 1);
      return;
    }
    const text = onMake(table);
    if (text === null) return;
    refusals.current += 1;
    setRefusal({ text, n: refusals.current });
  };

  return (
    <Modal title={SLOT_TABLE_WORDS.title} onClose={onCancel} size="md" initialFocusRef={nameRef}>
      <form ref={formRef} className="space-y-4" onSubmit={submit} noValidate>
        <p className="text-sm text-slate-slate300">{SLOT_TABLE_WORDS.lead}</p>
        <div>
          <label htmlFor={`${uid}-name`} className={labelClass}>
            {SLOT_TABLE_WORDS.shownAs}
          </label>
          <input
            id={`${uid}-name`}
            ref={nameRef}
            className={inputClass}
            value={label}
            maxLength={40}
            aria-invalid={nameIssues.length > 0 ? true : undefined}
            aria-describedby={nameIssues.length > 0 ? `${uid}-name-err-0` : undefined}
            onChange={(e) => {
              setRefusal(null);
              setTyped(e.target.value);
            }}
          />
          <Errors issues={nameIssues} id={`${uid}-name-err`} empty={EMPTY_TABLE_NAME} />
        </div>
        <div>
          <label htmlFor={`${uid}-sample`} className={labelClass}>
            {SLOT_TABLE_WORDS.sample}
          </label>
          <select
            id={`${uid}-sample`}
            className={inputClass}
            value={sample}
            onChange={(e) => {
              setRefusal(null);
              setSample(e.target.value as SampleId);
            }}
          >
            {SAMPLE_IDS.map((id) => (
              <option key={id} value={id}>
                {SAMPLE_TABLES[id].label}
              </option>
            ))}
          </select>
        </div>
        {general.length > 0 && (
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
            {SLOT_TABLE_WORDS.cancel}
          </button>
          <button type="submit" className={btnPrimary}>
            {SLOT_TABLE_WORDS.add}
          </button>
        </div>
      </form>
    </Modal>
  );
}
