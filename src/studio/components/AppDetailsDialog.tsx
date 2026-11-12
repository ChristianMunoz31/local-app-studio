import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { ICONS } from '@local-app-studio/runtime/spec/schema';
import type { AppSpec, SpecIssue } from '@local-app-studio/runtime/spec/schema';
import Modal from '@/components/shared/Modal.jsx';
import { btnPrimary, btnSecondary, formErrorClass, inputClass, labelClass } from '@/components/shared/formStyles.js';
import { appNameProblem, deriveSlug } from '../lib/ids';
import { validateSpec } from '../lib/validate';
import type { SaveResult } from '../types';
import IssueList from './IssueList';
import { HINT_CLASS, SUMMARY_CLASS } from './ui';

interface Props {
  spec: AppSpec;
  onSave(next: AppSpec): Promise<SaveResult>;
  /** Why Save settings waits now (another save is still on its way), or null. */
  blockedReason?: string | null;
  onCancel(): void;
}

const capitalize = (word: string): string => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

export default function AppDetailsDialog({ spec, onSave, onCancel, blockedReason = null }: Props) {
  const ids = { name: useId(), desc: useId(), icon: useId(), version: useId(), identifier: useId(), wait: useId() };
  const [name, setName] = useState(spec.app.name);
  const [description, setDescription] = useState(spec.app.description);
  const [icon, setIcon] = useState<string>(spec.app.icon ?? '');
  const [version, setVersion] = useState(spec.app.version);
  const [identifier, setIdentifier] = useState(spec.app.identifier);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [issues, setIssues] = useState<SpecIssue[]>([]);

  const moreHasIssue = issues.some((i) => i.path === 'app.identifier' || i.path === 'app.version');

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (blockedReason !== null) return;
    const trimmed = name.trim();
    const nameProblem = appNameProblem(trimmed);
    if (nameProblem) {
      setError(nameProblem);
      setIssues([]);
      return;
    }
    const next = {
      ...spec,
      app: {
        ...spec.app,
        name: trimmed,
        slug: deriveSlug(trimmed),
        description,
        icon: icon === '' ? null : (icon as (typeof ICONS)[number]),
        version: version.trim(),
        identifier: identifier.trim(),
      },
    };
    const checked = validateSpec(next);
    if (!checked.ok) {
      setError('');
      setIssues(checked.issues.filter((i) => i.path.startsWith('app')));
      if (checked.issues.every((i) => !i.path.startsWith('app'))) setError(checked.issues[0]?.message ?? 'This app has a problem.');
      return;
    }
    setBusy(true);
    setError('');
    setIssues([]);
    try {
      const result = await onSave(next);
      if (!result.ok) {
        setError(result.message);
        setIssues(result.issues.filter((i) => i.path.startsWith('app')));
        setBusy(false);
      }
    } catch {
      setError('Could not save. Your changes are still here. Try again.');
      setBusy(false);
    }
  };

  return (
    <Modal title="App settings" onClose={onCancel} dismissible={!busy}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <div>
          <label htmlFor={ids.name} className={labelClass}>
            Name
          </label>
          <input id={ids.name} className={inputClass} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          <p className={`mt-1 ${HINT_CLASS}`}>{`File name: ${deriveSlug(name) || '(none)'}`}</p>
        </div>
        <div>
          <label htmlFor={ids.desc} className={labelClass}>
            Description
          </label>
          <textarea id={ids.desc} className={inputClass} rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <label htmlFor={ids.icon} className={labelClass}>
            Icon
          </label>
          <select id={ids.icon} className={inputClass} value={icon} onChange={(e) => setIcon(e.target.value)}>
            <option value="">None</option>
            {ICONS.map((i) => (
              <option key={i} value={i}>
                {capitalize(i)}
              </option>
            ))}
          </select>
        </div>
        <details open={moreHasIssue ? true : undefined}>
          <summary className={SUMMARY_CLASS}>More options</summary>
          <div className="mt-3 space-y-3">
            <div>
              <label htmlFor={ids.identifier} className={labelClass}>
                Windows app name
              </label>
              <input id={ids.identifier} className={inputClass} value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
              <p className={`mt-1 ${HINT_CLASS}`}>Windows uses it to tell your app apart. Keep it after the first installer.</p>
            </div>
            <div>
              <label htmlFor={ids.version} className={labelClass}>
                Version
              </label>
              <input id={ids.version} className={inputClass} value={version} onChange={(e) => setVersion(e.target.value)} />
              <p className={`mt-1 ${HINT_CLASS}`}>The installer shows it. Raise it when you share a new installer.</p>
            </div>
          </div>
        </details>
        {error && (
          <p role="alert" className={formErrorClass}>
            {error}
          </p>
        )}
        <IssueList issues={issues} spec={spec} />
        {blockedReason !== null && (
          <p id={ids.wait} role="status" className={HINT_CLASS}>
            {blockedReason}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} disabled={busy} aria-disabled={blockedReason !== null ? true : undefined} aria-describedby={blockedReason !== null ? ids.wait : undefined}>
            {busy ? 'Saving...' : 'Save settings'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
