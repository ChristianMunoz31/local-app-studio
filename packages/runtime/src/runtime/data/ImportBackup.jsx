// "Back up first?" of the Import rows panel (built app only: Preview has no backups, so none of this is in the Studio build).
import { useState } from 'react';
import { btnSecondary, formErrorClass } from '../../../../../src/components/shared/formStyles';
import { ERROR_TEXT, errorText } from '@/catalog/errorText.ts';
import { backUpNow } from '../dataClient.js';

const pad = (n) => String(n).padStart(2, '0');

export default function ImportBackup({ apiBase, onBusy }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);
  const backUp = async () => {
    setNote(null);
    setError(null);
    setBusy(true);
    onBusy(true);
    try {
      const d = new Date((await backUpNow(apiBase)).at);
      setNote(Number.isNaN(d.getTime()) ? 'Backed up.' : `Backed up at ${pad(d.getHours())}:${pad(d.getMinutes())}.`);
    } catch (e) {
      setError(errorText(e, ERROR_TEXT.genericSentence));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  };
  return (
    <>
      <p className="text-sm text-slate-slate100">
        Back up first?{' '}
        <button type="button" className={btnSecondary} disabled={busy} onClick={() => void backUp()}>
          Back up now
        </button>
      </p>
      <div role="status" aria-live="polite" className="text-sm text-slate-slate100">
        {note}
      </div>
      {error && (
        <p role="alert" className={formErrorClass}>
          {error}
        </p>
      )}
    </>
  );
}
