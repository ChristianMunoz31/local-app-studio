import { useId, useState } from 'react';
import type { SpecIssue } from '@local-app-studio/runtime/spec/schema';
import StudioSectionCard from './StudioSectionCard';
import { btnDanger, btnPrimary, btnSecondary, formErrorClass, inputClass, labelClass } from '@/components/shared/formStyles.js';
import { downloadJson } from '../lib/download';
import { validateSpec } from '../lib/validate';
import { StudioApiError } from '../services/studioApi';
import type { AppRecord } from '../types';
import IssueList from './IssueList';
import StudioConfirm from './StudioConfirm';
import { HINT_CLASS, SUMMARY_CLASS } from './ui';

interface Props {
  record: AppRecord;
  onRepair(spec: unknown): Promise<void>;
  onDelete(): Promise<void>;
}

/** Shown instead of the tabs when the stored design fails the checks. The raw value is only ever shown as text. */
export default function BrokenAppView({ record, onRepair, onDelete }: Props) {
  const areaId = useId();
  const noCopyId = useId();
  const hasRaw = record.raw !== undefined;
  const [text, setText] = useState(() => (hasRaw ? JSON.stringify(record.raw, null, 2) : ''));
  const [error, setError] = useState('');
  const [issues, setIssues] = useState<SpecIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const saveRepair = async (): Promise<void> => {
    setError('');
    setIssues([]);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setError('That text has a typing mistake. Undo your last edit and try again.');
      return;
    }
    const checked = validateSpec(parsed);
    if (!checked.ok) {
      setIssues(checked.issues);
      return;
    }
    setBusy(true);
    try {
      await onRepair(parsed);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not save the fixed text. Nothing was changed. Try again.');
      if (err instanceof StudioApiError) setIssues(err.issues);
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6">
      <StudioSectionCard title={record.name}>
        <div className="space-y-4">
          <p role="alert" className="text-sm font-semibold text-accent-red">
            This app cannot open because part of it is damaged. Export a copy first, then try a repair.
          </p>
          <IssueList issues={record.issues} alert={false} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} disabled={!hasRaw} aria-describedby={hasRaw ? undefined : noCopyId} onClick={() => downloadJson(`${record.slug}.raw.json`, record.raw)}>
              Export a copy
            </button>
            <button type="button" className={btnDanger} onClick={() => setConfirmDelete(true)}>
              Delete app
            </button>
          </div>
          {!hasRaw && (
            <p id={noCopyId} className={HINT_CLASS}>
              This damaged app is too large to copy here. Delete it if you do not need it.
            </p>
          )}
          <details>
            <summary className={SUMMARY_CLASS}>Advanced repair</summary>
            <div className="mt-3 space-y-2">
              <label htmlFor={areaId} className={labelClass}>
                App file text
              </label>
              <textarea id={areaId} className={`${inputClass} font-mono text-xs`} rows={14} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
              {error && (
                <p role="alert" className={formErrorClass}>
                  {error}
                </p>
              )}
              <IssueList issues={issues} max={8} alert={error === ''} />
              <button type="button" className={btnSecondary} onClick={saveRepair} disabled={busy}>
                {busy ? 'Saving...' : 'Save the fixed text'}
              </button>
            </div>
          </details>
        </div>
      </StudioSectionCard>
      {confirmDelete && (
        <StudioConfirm
          title="Delete this app?"
          message="Its design and build history are removed from Local App Studio. Apps you already installed are not affected."
          confirmLabel="Delete app"
          busyLabel="Deleting..."
          cancelLabel="Keep app"
          onConfirm={onDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
