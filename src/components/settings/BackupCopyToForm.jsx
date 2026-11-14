import { useId, useRef, useState } from 'react';
import { secondCopySentence } from './backupStatusText';
import { BTN } from './pillStyles';

const INPUT =
  'mt-1 block w-full max-w-md rounded-md border border-[color:var(--glass-border)] bg-transparent px-2 py-1.5 text-sm text-slate-slate100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:var(--focus-ring)] aria-[invalid=true]:border-accent-amber';
const HINT =
  'Use a folder on another drive, a network share or a synced folder such as OneDrive. A network or synced folder means the copies leave this PC. Saved API keys are never in a backup.';
const EMPTY = 'Type the full path of a folder, or use Turn off copies.';

/**
 * The second backup location: a typed folder path. Props: secondCopy (the server's status object),
 * onSave(folder | null) (async, rejects with a plain message), saving, locked (a restore runs).
 */
export default function BackupCopyToForm({ secondCopy, onSave, saving = false, locked = false }) {
  const baseId = useId();
  const hintId = `${baseId}-hint`;
  const errorId = `${baseId}-error`;
  const inputRef = useRef(null);
  const folder = secondCopy?.folder ?? '';
  const [draft, setDraft] = useState(folder);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState('');

  // Refill the field when the saved folder changes (adjusting state during render, not in an effect).
  const [seen, setSeen] = useState(folder);
  if (seen !== folder) {
    setSeen(folder);
    setDraft(folder);
  }

  const run = async (value) => {
    if (saving || locked) return;
    setSaved('');
    setError(null);
    try {
      await onSave(value);
      setSaved(value === null ? 'The second folder is off.' : 'Second folder saved.');
    } catch (e) {
      setError(e?.message || 'Could not save. Try again.');
      inputRef.current?.focus();
    }
  };

  // Nothing to turn off while it is already off (the button is aria-disabled, not disabled).
  const turnOff = () => {
    if (!secondCopy?.enabled) return undefined;
    return run(null);
  };

  const submit = async (event) => {
    event.preventDefault();
    const value = draft.trim();
    if (value === '') {
      setSaved('');
      setError(EMPTY);
      inputRef.current?.focus();
      return;
    }
    await run(value);
  };

  return (
    <form onSubmit={submit} noValidate>
      <label htmlFor={`${baseId}-folder`} className="block text-xs font-semibold text-slate-slate300">
        Also copy each new backup to
      </label>
      <p id={hintId} className="mt-1 text-xs text-slate-slate400">
        {HINT}
      </p>
      <input
        ref={inputRef}
        id={`${baseId}-folder`}
        type="text"
        value={draft}
        onChange={(event) => {
          setSaved('');
          setError(null);
          setDraft(event.target.value);
        }}
        autoComplete="off"
        spellCheck={false}
        placeholder="D:\Backups"
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${hintId} ${errorId}` : hintId}
        className={INPUT}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="submit"
          aria-disabled={saving || locked}
          aria-busy={saving}
          className={BTN}
        >
          {saving ? 'Saving folder…' : 'Save folder'}
        </button>
        <button
          type="button"
          onClick={turnOff}
          aria-disabled={saving || locked || !secondCopy?.enabled}
          className={BTN}
        >
          Turn off copies
        </button>
      </div>
      <p role="status" className="mt-2 text-xs text-slate-slate300">
        {secondCopySentence(secondCopy)}
      </p>
      <p role="status" className="sr-only">
        {saved}
      </p>
      {error && (
        <p id={errorId} role="alert" className="mt-2 text-xs text-accent-amber">
          {error}
        </p>
      )}
    </form>
  );
}
