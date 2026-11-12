// "Change name and line" for a saved feature the builder cannot open (it shows one record): only the name and the one line change. The
// stored feature is sent back as it is (parts, settings and their places byte for byte), through the same checks and the same update
// as a save from the builder, so it becomes a new version (DESIGN-phase16.md 4.5).
import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { FEATURE_LIMITS, validateFeatureInput } from '@/catalog/features';
import type { FeatureLibrary } from '@/catalog/features';
import Modal from '@/components/shared/Modal.jsx';
import { btnPrimary, btnSecondary, formErrorClass, inputClass, labelClass } from '@/components/shared/formStyles.js';
import { HINT_CLASS } from '../components/ui';
import { errorLine } from '../lib/errorWords';
import { StudioApiError, featuresApi } from '../services/studioApi';
import type { FeatureInput, FeatureRecord } from '../types';
import { builderRefusal, refusalWords } from './featureRefusal';
import type { BuilderRefusalCode } from './featureRefusal';
import { RENAME_WORDS, SAVE_WORDS } from './words';

interface Props {
  /** The stored feature as it is. */
  stored: FeatureInput;
  /** The version the change starts from. */
  version: number;
  library: FeatureLibrary;
  onSaved(record: FeatureRecord): void;
  onCancel(): void;
}

const wordsOf = (code: BuilderRefusalCode): string => {
  const { sentence, action } = refusalWords(code);
  return `${sentence} ${action}`;
};

export default function FeatureRenameDialog({ stored, version, library, onSaved, onCancel }: Props) {
  const lineId = useId();
  const [name, setName] = useState(stored.label);
  const [line, setLine] = useState(stored.description);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setMessage('');
    const label = name.trim();
    const description = line.replace(/\s+/g, ' ').trim();
    if (label === '') return setMessage(wordsOf('feature_name_needed'));
    if (description === '') return setMessage(wordsOf('feature_line_needed'));
    const input: FeatureInput = { ...stored, label, description };
    const checked = validateFeatureInput(input, library, { replacingId: stored.id });
    if (!checked.ok) return setMessage(wordsOf(builderRefusal(checked.issues)));
    setBusy(true);
    let record: FeatureRecord;
    try {
      record = await featuresApi.update(stored.id, input, version);
    } catch (err) {
      setMessage(err instanceof StudioApiError && err.code === 'invalid_feature' && err.issues.length > 0 ? wordsOf(builderRefusal(err.issues)) : errorLine(err));
      setBusy(false);
      return;
    }
    onSaved(record);
  };

  return (
    <Modal title={RENAME_WORDS.title} onClose={onCancel} dismissible={!busy}>
      <form className="space-y-4" onSubmit={(e) => void submit(e)} noValidate>
        <label className="block">
          <span className={labelClass}>{SAVE_WORDS.name}</span>
          <input className={inputClass} value={name} maxLength={FEATURE_LIMITS.labelChars} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <div>
          <label htmlFor={lineId} className={labelClass}>
            {SAVE_WORDS.line}
          </label>
          <input id={lineId} aria-describedby={`${lineId}-hint`} className={inputClass} value={line} maxLength={FEATURE_LIMITS.descriptionChars} onChange={(e) => setLine(e.target.value.replace(/\s+/g, ' '))} />
          <p id={`${lineId}-hint`} className={`mt-1 flex justify-between ${HINT_CLASS}`}>
            <span>{SAVE_WORDS.hint}</span>
            <span>{SAVE_WORDS.count(line.length)}</span>
          </p>
        </div>
        {message !== '' && (
          <p role="alert" className={formErrorClass}>
            {message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onCancel} disabled={busy}>
            {SAVE_WORDS.cancel}
          </button>
          <button type="submit" className={btnPrimary} disabled={busy}>
            {busy ? SAVE_WORDS.busy : RENAME_WORDS.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}
