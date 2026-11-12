// "Save feature" / "Save a new version" in the Feature builder: a name and one line, then the checks in a fixed order, each refused in
// plain words from a code of src/errors/copy.studio.js. The feature id is derived and never shown (DESIGN-phase16.md 4.5).
import { useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { FEATURE_LIMITS, validateFeatureInput } from '@/catalog/features';
import type { FeatureLibrary } from '@/catalog/features';
import Modal from '@/components/shared/Modal.jsx';
import { btnPrimary, btnSecondary, formErrorClass, inputClass, labelClass } from '@/components/shared/formStyles.js';
import type { HostDoc } from '../design/DesignSession';
import { HINT_CLASS } from '../components/ui';
import { featureIdFor } from '../lib/featureFromSelection';
import { errorLine } from '../lib/errorWords';
import { StudioApiError, featuresApi } from '../services/studioApi';
import type { FeatureRecord } from '../types';
import type { PanelState } from './bench';
import { builderRefusal, refusalWords } from './featureRefusal';
import type { BuilderRefusalCode } from './featureRefusal';
import { featureInputOf, paramCount } from './slotModel';
import { SAVE_WORDS } from './words';


interface Props {
  /** The saved feature being edited (a save then stores a new version), or null for a new one. */
  editing: FeatureRecord | null;
  /** A sentence above the boxes (Try it in an app asks for a save first). */
  lead?: string;
  doc: HostDoc;
  library: FeatureLibrary;
  state: PanelState;
  /** A part on the canvas still needs a table slot. */
  needsSlots: boolean;
  onSaved(record: FeatureRecord): void;
  onCancel(): void;
}

const wordsOf = (code: BuilderRefusalCode): string => {
  const { sentence, action } = refusalWords(code);
  return `${sentence} ${action}`;
};

/** The box a refusal is about: the name or the line. */
type Culprit = 'name' | 'line';

export default function BuilderSaveDialog({ editing, lead, doc, library, state, needsSlots, onSaved, onCancel }: Props) {
  const lineId = useId();
  const messageId = `${lineId}-message`;
  const nameRef = useRef<HTMLInputElement>(null);
  const lineRef = useRef<HTMLInputElement>(null);
  const [culprit, setCulprit] = useState<Culprit | null>(null);
  const [name, setName] = useState(editing?.label ?? '');
  const [line, setLine] = useState(editing?.description ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setMessage('');
    setCulprit(null);
    const label = name.trim();
    const description = line.replace(/\s+/g, ' ').trim();
    const refuse = (code: BuilderRefusalCode): void => setMessage(wordsOf(code));
    // A refusal about a box marks that box, points it at the message and moves the focus there.
    const refuseAt = (box: Culprit, code: BuilderRefusalCode): void => {
      refuse(code);
      setCulprit(box);
      (box === 'name' ? nameRef : lineRef).current?.focus();
    };
    if (label === '') return refuseAt('name', 'feature_name_needed');
    if (description === '') return refuseAt('line', 'feature_line_needed');
    if (!Array.isArray(doc.root.children) || doc.root.children.length === 0) return refuse('feature_is_empty');
    if (needsSlots) return refuse('feature_needs_slots');
    if (paramCount(doc, library, state) > FEATURE_LIMITS.params) return refuse('feature_too_many_settings');
    const id = editing === null ? featureIdFor(label, library) : editing.id;
    const input = featureInputOf({ doc, library, state, id, name: label, line: description });
    const checked = validateFeatureInput(input, library, editing === null ? {} : { replacingId: id });
    if (!checked.ok) return refuse(builderRefusal(checked.issues));
    setBusy(true);
    let record: FeatureRecord;
    try {
      record = editing === null ? await featuresApi.create(input) : await featuresApi.update(id, input, editing.version);
    } catch (err) {
      setMessage(err instanceof StudioApiError && err.code === 'invalid_feature' && err.issues.length > 0 ? wordsOf(builderRefusal(err.issues)) : errorLine(err));
      setBusy(false);
      return;
    }
    // After the try: a throw while the screen takes the result in never shows "not saved" for a feature that is saved.
    onSaved(record);
  };

  return (
    <Modal title={editing === null ? SAVE_WORDS.titleNew : SAVE_WORDS.titleEdit} onClose={onCancel} dismissible={!busy}>
      <form className="space-y-4" onSubmit={(e) => void submit(e)} noValidate>
        {lead !== undefined && <p className="text-sm text-slate-slate300">{lead}</p>}
        <label className="block">
          <span className={labelClass}>{SAVE_WORDS.name}</span>
          <input
            ref={nameRef}
            className={inputClass}
            value={name}
            maxLength={FEATURE_LIMITS.labelChars}
            onChange={(e) => {
              setName(e.target.value);
              setCulprit((c) => (c === 'name' ? null : c));
            }}
            {...(culprit === 'name' ? { 'aria-invalid': true, 'aria-describedby': messageId } : {})}
          />
        </label>
        <div>
          <label htmlFor={lineId} className={labelClass}>
            {SAVE_WORDS.line}
          </label>
          <input
            id={lineId}
            ref={lineRef}
            aria-describedby={culprit === 'line' ? `${lineId}-hint ${messageId}` : `${lineId}-hint`}
            aria-invalid={culprit === 'line' ? true : undefined}
            className={inputClass}
            value={line}
            maxLength={FEATURE_LIMITS.descriptionChars}
            onChange={(e) => {
              setLine(e.target.value.replace(/\s+/g, ' '));
              setCulprit((c) => (c === 'line' ? null : c));
            }}
          />
          <p id={`${lineId}-hint`} className={`mt-1 flex justify-between ${HINT_CLASS}`}>
            <span>{SAVE_WORDS.hint}</span>
            <span>{SAVE_WORDS.count(line.length)}</span>
          </p>
        </div>
        {message !== '' && (
          <p id={messageId} role="alert" className={formErrorClass}>
            {message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onCancel} disabled={busy}>
            {SAVE_WORDS.cancel}
          </button>
          <button type="submit" className={btnPrimary} disabled={busy}>
            {busy ? SAVE_WORDS.busy : SAVE_WORDS.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}
