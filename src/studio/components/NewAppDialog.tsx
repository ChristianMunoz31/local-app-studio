import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import Modal from '@/components/shared/Modal.jsx';
import { btnPrimary, btnSecondary, formErrorClass, inputClass, labelClass } from '@/components/shared/formStyles.js';
import { appNameProblem } from '../lib/ids';
import { HINT_CLASS } from './ui';

interface Props {
  /** The name the box starts with, for example one made from the person's description. */
  initialName?: string;
  onCreate(name: string): Promise<void>;
  onCancel(): void;
}

export default function NewAppDialog({ initialName = '', onCreate, onCancel }: Props) {
  const inputId = useId();
  const hintId = useId();
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
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
      await onCreate(trimmed);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not start a new app. Try again.');
      setBusy(false);
    }
  };

  return (
    <Modal title="Start a blank app" onClose={onCancel} dismissible={!busy}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <p className="text-sm text-slate-slate300">You set up its pages and tables yourself in Design and Data.</p>
        <div>
          <label htmlFor={inputId} className={labelClass}>
            App name
          </label>
          <input
            id={inputId}
            className={inputClass}
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            aria-describedby={hintId}
            aria-invalid={error ? true : undefined}
            autoComplete="off"
          />
          <p id={hintId} className={`mt-1 ${HINT_CLASS}`}>
            Use 2 to 40 letters, digits and single spaces, starting with a letter.
          </p>
        </div>
        {error && (
          <p role="alert" className={formErrorClass}>
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} disabled={busy}>
            {busy ? 'Creating...' : 'Create app'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
