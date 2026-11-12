// The settings of a feature on this page: one control per parameter. Texts are inputs; tables, lists, pages and fields
// are selects of what the page offers. Submitting hands the values back; the caller expands and reports problems.
import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import type { PartContext } from '@/catalog/types';
import { btnPrimary, btnSecondary, formErrorClass, inputClass, labelClass } from '@/components/shared/formStyles.js';
import type { Source } from '../lib/bindOnDrop';
import { missingLabels, optionWords, optionsFor, settleValues } from '../lib/featureFromSelection';
import type { AppWords } from '../lib/featureFromSelection';
import { pairedParams, shownParams } from '../lib/featureParams';
import type { FeatureShape } from '../lib/featureParams';
import { HINT_CLASS } from './ui';

interface Props {
  def: FeatureShape;
  ctx: PartContext;
  /** Values to start from (a block's own values). Those that no longer fit are replaced by the first choice. */
  initial?: Record<string, string>;
  submitLabel: string;
  cancelLabel?: string;
  /**
   * Returns the problems in plain words, or an empty list when the values were used. `made` are the lists the choice needs that the page
   * does not have yet (a table chosen for a slot whose list was on another table): the caller adds them to the page with the block.
   */
  onSubmit(values: Record<string, string>, made: Source[]): string[];
  onCancel(): void;
  /** True in the Feature builder: a missing table reads as a missing slot. */
  slotWords?: boolean;
  /** The app's own names for tables, fields and pages, so a choice reads "Tasks", never `tasks`. Without it the choices read as their ids. */
  words?: AppWords;
}

const NONE: Record<string, string> = {};
const EMPTY_HINT = {
  table: 'This app has no tables yet.',
  source: 'This page has no matching list or record yet. Add one in Page settings.',
  page: 'This app has no pages.',
  field: 'There is no matching field in that table.',
} as const;

const NO_SLOT = 'This feature has no table slot yet.';
/** Under a table choice whose table has no list on the page yet; the list is made when the settings are applied. */
const NEW_LIST_NOTE = (table: string): string => `This page gets a list of ${table}.`;

export default function FeatureValuesForm({ def, ctx, initial = NONE, submitLabel, cancelLabel = 'Cancel', onSubmit, onCancel, slotWords = false, words }: Props) {
  const uid = useId();
  const [settled, setSettled] = useState(() => settleValues(def, ctx, initial));
  const [problems, setProblems] = useState<string[]>([]);
  const { values, made } = settled;
  // The table settings whose own list was made: only these say the page gets a list (a lone table setting has none to make).
  const madeFor = new Set(pairedParams(def).filter((pair) => made.some((m) => m.id === values[pair.list.name])).map((pair) => pair.table.name));

  const change = (name: string, value: string): void => setSettled((prev) => settleValues(def, ctx, { ...prev.values, [name]: value }, name));

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const missing = missingLabels(def, values);
    if (missing.length > 0) {
      setProblems([`Fill in: ${missing.join(', ')}.`]);
      return;
    }
    setProblems(onSubmit(values, made));
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      {shownParams(def).map((p) => {
        const options = optionsFor(def, p, settled.ctx, values);
        const id = `${uid}-${p.name}`;
        const labels = options === null ? [] : optionWords(def, p, options, settled.ctx, values, words);
        const noteId = `${id}-note`;
        const emptyId = `${id}-empty`;
        const showNote = options !== null && madeFor.has(p.name);
        const showEmpty = options !== null && options.length === 0;
        const describedBy = [showNote ? noteId : null, showEmpty ? emptyId : null].filter((x) => x !== null).join(' ');
        return (
          <div key={p.name}>
            <label htmlFor={id} className={labelClass}>
              {p.label}
            </label>
            {options === null ? (
              <input id={id} className={inputClass} value={values[p.name] ?? ''} maxLength={2000} onChange={(e) => change(p.name, e.target.value)} />
            ) : (
              <>
                <select id={id} className={inputClass} value={values[p.name] ?? ''} disabled={options.length === 0} aria-describedby={describedBy === '' ? undefined : describedBy} onChange={(e) => change(p.name, e.target.value)}>
                  {options.map((o, i) => (
                    <option key={o} value={o}>
                      {labels[i]}
                    </option>
                  ))}
                </select>
                {showNote && <p id={noteId} className={`mt-1 ${HINT_CLASS}`}>{NEW_LIST_NOTE(labels[options.indexOf(values[p.name] ?? '')] ?? '')}</p>}
                {showEmpty && <p id={emptyId} className={`mt-1 ${HINT_CLASS}`}>{slotWords && p.type === 'table' ? NO_SLOT : EMPTY_HINT[p.type as keyof typeof EMPTY_HINT]}</p>}
              </>
            )}
          </div>
        );
      })}
      {problems.length > 0 && (
        <ul role="alert" className={`${formErrorClass} list-disc pl-4`}>
          {[...new Set(problems)].slice(0, 4).map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>
          {cancelLabel}
        </button>
        <button type="submit" className={btnPrimary}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
