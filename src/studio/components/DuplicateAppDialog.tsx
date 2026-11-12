import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import Modal from '@/components/shared/Modal.jsx';
import { btnPrimary, btnSecondary, formErrorClass, inputClass, labelClass } from '@/components/shared/formStyles.js';
import { DUPLICATE_BUSY, DUPLICATE_CONFIRM, DUPLICATE_FAILED, DUPLICATE_KEEP_RECORDS, DUPLICATE_NAME_LABEL, DUPLICATE_NO_RECORDS, DUPLICATE_TITLE_PREFIX, DUPLICATE_WITH_SAMPLE } from '../lib/appFiles';
import { appNameProblem } from '../lib/ids';
import { HINT_CLASS } from './ui';

interface Props {
  /** The app being copied. */
  sourceName: string;
  /** The name the box starts with (the default copy name). */
  initialName: string;
  /** True when the app keeps sample records (made from an example): the copy gets them too. */
  withSample?: boolean;
  /** `withRecords` is given (true) only when the box is ticked. */
  onDuplicate(name: string, withRecords?: boolean): Promise<void>;
  onCancel(): void;
}

/** Asks for the copy's name before an app is duplicated. */
export default function DuplicateAppDialog({ sourceName, initialName, withSample = false, onDuplicate, onCancel }: Props) {
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [keepRecords, setKeepRecords] = useState(false);
  const keepId = useId();
  const [error, setError] = useState('');

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const trimmed = name.trim();
    const problem = appNameProblem(trimmed);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await (keepRecords ? onDuplicate(trimmed, true) : onDuplicate(trimmed));
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : DUPLICATE_FAILED);
      setBusy(false);
    }
  };

  return (
    <Modal title={`${DUPLICATE_TITLE_PREFIX} ${sourceName}`} onClose={onCancel} dismissible={!busy}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <div>
          <label htmlFor={inputId} className={labelClass}>
            {DUPLICATE_NAME_LABEL}
          </label>
          <input
            id={inputId}
            className={inputClass}
            value={name}
            disabled={busy}
            maxLength={40}
            onChange={(e) => {
              setName(e.target.value);
              setError('');
            }}
            aria-describedby={error ? `${hintId} ${errorId}` : hintId}
            aria-invalid={error ? true : undefined}
            autoComplete="off"
          />
          <p id={hintId} className={`mt-1 ${HINT_CLASS}`}>
            {withSample ? DUPLICATE_WITH_SAMPLE : DUPLICATE_NO_RECORDS}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input id={keepId} type="checkbox" checked={keepRecords} disabled={busy} aria-describedby={hintId} onChange={(e) => setKeepRecords(e.target.checked)} />
          <label htmlFor={keepId} className="text-sm text-slate-slate200">
            {DUPLICATE_KEEP_RECORDS}
          </label>
        </div>
        {error && (
          <p id={errorId} role="alert" className={formErrorClass}>
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} disabled={busy}>
            {busy ? DUPLICATE_BUSY : DUPLICATE_CONFIRM}
          </button>
        </div>
      </form>
    </Modal>
  );
}
