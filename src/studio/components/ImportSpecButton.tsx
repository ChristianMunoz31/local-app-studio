import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Upload } from 'lucide-react';
import type { SpecIssue } from '@local-app-studio/runtime/spec/schema';
import Modal from '@/components/shared/Modal.jsx';
import { btnPrimary, btnSecondary } from '@/components/shared/formStyles.js';
import { validateSpec } from '../lib/validate';
import IssueList from './IssueList';
import { SUMMARY_CLASS } from './ui';

const MAX_BYTES = 600 * 1024;

interface Props {
  onImport(spec: unknown): Promise<void>;
  /** Where a problem with the file is shown (the page shows it in the Apps card). An empty text clears it. */
  onError(message: string): void;
  /** Called when a new import begins, so the page can drop the message of the earlier one. */
  onStart?(): void;
  /** True while something else is being made: the button is off, so a picked file is never dropped silently. */
  disabled?: boolean;
}

/** The lead sentence of the refusal: a file that is not from Studio, or one with problems inside. */
const isNotAnAppFile = (issues: readonly SpecIssue[]): boolean =>
  issues.some((i) => i.path === 'specVersion' || i.path === 'app' || i.path.startsWith('app.') || i.path === '(root)');

/** Picks an app file, checks it here and sends it only when it is valid. */
export default function ImportSpecButton({ onImport, onError, onStart, disabled = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [issues, setIssues] = useState<SpecIssue[] | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = (text: string): void => {
    setIssues(null);
    onError(text);
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    onStart?.();
    onError('');
    if (file.size > MAX_BYTES) {
      fail('That file is too large. An app file can be up to 600 KB. Pick a smaller file.');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      fail('That file is not an app file. Pick a file exported from Local App Studio.');
      return;
    }
    const result = validateSpec(parsed);
    if (!result.ok) {
      setIssues(result.issues);
      return;
    }
    setBusy(true);
    try {
      await onImport(parsed);
    } catch (err) {
      fail(err instanceof Error && err.message ? err.message : 'Could not import the app. Nothing was imported. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input ref={inputRef} type="file" accept=".json,application/json" className="hidden" aria-label="App file" onChange={onFile} data-testid="import-file" />
      <button type="button" className={btnSecondary} disabled={busy || disabled} onClick={() => inputRef.current?.click()}>
        <span className="inline-flex items-center gap-1.5">
          <Upload size={14} aria-hidden="true" />
          Import an app
        </span>
      </button>
      {issues && (
        <Modal title="This file cannot be imported" onClose={() => setIssues(null)}>
          <div className="space-y-3">
            <p className="text-sm text-slate-slate300">
              {isNotAnAppFile(issues)
                ? 'This is not an app file from Local App Studio, or it was changed by hand. Nothing was imported. Pick a file you made with Export.'
                : 'This file has problems, so nothing was imported. Ask the person who sent it for a new export.'}
            </p>
            <details>
              <summary className={SUMMARY_CLASS}>Show what is wrong</summary>
              <div className="mt-2">
                <IssueList issues={issues} max={8} />
              </div>
            </details>
            <div className="flex justify-end">
              <button type="button" className={btnPrimary} onClick={() => setIssues(null)}>
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
