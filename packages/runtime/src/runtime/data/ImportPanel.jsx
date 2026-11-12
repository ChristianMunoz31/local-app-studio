// Import rows: pick a file (or paste rows in a built app), check the rows, then import them. The words of the counts
// and of every row problem come from the server (`lines`, `errors[].message`). Built app: renderMapping, renderPaste and
// renderBackup are passed in. Preview: none of the three, a table picker, and the size limits of the proxy.
import { useEffect, useId, useRef, useState } from 'react';
import { btnPrimary, btnSecondary, formErrorClass, inputClass, labelClass } from '../../../../../src/components/shared/formStyles';
import { ERROR_TEXT, errorText } from '@/catalog/errorText.ts';
import { importRows } from '../dataClient.js';
import {
  IMPORT_DEFAULT_MAX_BYTES,
  IMPORT_DEFAULT_MAX_ROWS,
  IMPORT_WORDS,
  importLabel,
  resumeLabel,
  sizeProblem,
} from './importModel.js';

/**
 * @param {{
 *   spec: import('../../spec/schema.ts').AppSpec,
 *   table?: string,
 *   apiBase?: string,
 *   renderBackup?: (p: { onBusy(busy: boolean): void }) => import('react').ReactNode,
 *   maxBytes?: number,
 *   maxRows?: number,
 *   renderMapping?: (p: { headers: string[], fields: object[], mapping: Record<string, string | null>, onChange(next: Record<string, string | null>): void }) => import('react').ReactNode,
 *   renderPaste?: (p: { text: string, onText(text: string): void }) => import('react').ReactNode,
 *   onDone?: (result: object) => void,
 *   onBusy?: (busy: boolean) => void,
 * }} props
 */
export default function ImportPanel({
  spec,
  table,
  apiBase = '/api',
  maxBytes = IMPORT_DEFAULT_MAX_BYTES,
  maxRows = IMPORT_DEFAULT_MAX_ROWS,
  renderMapping,
  renderPaste,
  renderBackup,
  onDone,
  onBusy,
}) {
  const uid = useId();
  const [tableId, setTableId] = useState(table ?? spec.tables[0]?.id ?? '');
  const [text, setText] = useState('');
  const [mapping, setMapping] = useState(null);
  const [shape, setShape] = useState(null);
  const [checked, setChecked] = useState(null);
  const [result, setResult] = useState(null);
  const [apply, setApply] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [backing, setBacking] = useState(false);
  const latest = useRef(0);
  const limited = maxBytes < IMPORT_DEFAULT_MAX_BYTES || maxRows < IMPORT_DEFAULT_MAX_ROWS;
  const effectiveTable = table ?? tableId;

  // The host keeps its dialog open while a check or an import runs.
  useEffect(() => {
    onBusy?.(busy || backing);
    return () => onBusy?.(false);
  }, [busy, backing, onBusy]);

  const invalidate = () => {
    setChecked(null);
    setResult(null);
    setError(null);
  };
  const newText = (value) => {
    setText(value);
    setMapping(null);
    setShape(null);
    invalidate();
  };
  const readFile = async (file) => {
    if (!file) return;
    try {
      newText(await file.text());
    } catch {
      setError('That file could not be read.');
    }
  };

  const run = async (dryRun, startAt) => {
    const body = { csv: text, dryRun, applyAutomations: apply };
    if (renderMapping && mapping) body.mapping = mapping;
    if (startAt) body.startAt = startAt;
    const tooBig = sizeProblem(body, maxBytes);
    if (tooBig) {
      setError(tooBig);
      return;
    }
    // Only the latest request may show its answer.
    const mine = ++latest.current;
    setBusy(true);
    setError(null);
    try {
      const r = await importRows(effectiveTable, body, apiBase);
      if (mine !== latest.current) return;
      if (dryRun) {
        setResult(null);
        setChecked(r);
        setShape({ headers: r.headers, fields: r.fields });
        setMapping(r.mapping);
      } else {
        setChecked(null);
        setResult(r);
        onDone?.(r);
      }
    } catch (e) {
      if (mine !== latest.current) return;
      if (e?.code === 'preview_timeout') setError(IMPORT_WORDS.timeout);
      else if (e?.code === 'import_too_large' && maxRows < IMPORT_DEFAULT_MAX_ROWS) setError(IMPORT_WORDS.tooManyRowsPreview);
      else setError(errorText(e, ERROR_TEXT.genericSentence));
    } finally {
      if (mine === latest.current) setBusy(false);
    }
  };

  const shown = result ?? checked;
  const noText = text === '';
  const hint = noText ? 'Choose a file or paste some rows first.' : !checked ? 'Check the rows first.' : checked.valid === 0 ? 'No rows can be imported. Fix the problems listed, then check again.' : null;
  const hintId = hint && !busy ? `${uid}-hint` : undefined;
  const timeoutId = limited ? `${uid}-timeout` : undefined;

  return (
    <div className="space-y-4">
      <fieldset disabled={busy} className="min-w-0 space-y-4">
      {!table && (
        <div>
          <label htmlFor={`${uid}-table`} className={labelClass}>
            Table
          </label>
          <select
            id={`${uid}-table`}
            className={inputClass}
            value={tableId}
            onChange={(e) => {
              setTableId(e.target.value);
              newText('');
            }}
          >
            {spec.tables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label htmlFor={`${uid}-file`} className={labelClass}>
          Choose a CSV file
        </label>
        <input
          id={`${uid}-file`}
          type="file"
          accept=".csv,text/csv"
          className="block w-full text-sm text-slate-slate100"
          onChange={(e) => void readFile(e.target.files?.[0])}
        />
      </div>
      {renderPaste?.({ text, onText: newText })}
      {shape && renderMapping?.({ ...shape, mapping: mapping ?? {}, onChange: (next) => (setMapping(next), invalidate()) })}
      <div className="flex items-start gap-2">
        <input id={`${uid}-apply`} type="checkbox" className="mt-0.5 h-4 w-4 rounded-sm" checked={apply} aria-describedby={`${uid}-apply-note`} onChange={(e) => (setApply(e.target.checked), invalidate())} />
        <div>
          <label htmlFor={`${uid}-apply`} className="text-sm text-slate-slate100">
            Apply automations
          </label>
          <p id={`${uid}-apply-note`} className="text-xs text-slate-slate400">
            {IMPORT_WORDS.automations}
          </p>
        </div>
      </div>
      </fieldset>
      {renderBackup?.({ onBusy: setBacking })}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btnSecondary} disabled={busy || noText} aria-describedby={noText ? hintId : undefined} onClick={() => void run(true)}>
          Check rows
        </button>
        <button type="button" className={btnPrimary} disabled={busy || hint !== null} aria-describedby={[hintId, timeoutId].filter(Boolean).join(' ') || undefined} onClick={() => void run(false)}>
          {checked?.valid > 0 ? importLabel(checked.valid) : 'Import rows'}
        </button>
        {result?.stoppedAt ? (
          <button type="button" className={btnSecondary} disabled={busy} onClick={() => void run(false, result.stoppedAt)}>
            {resumeLabel(result.stoppedAt)}
          </button>
        ) : null}
      </div>
      {hintId && (
        <p id={hintId} className="text-xs text-slate-slate400">
          {hint}
        </p>
      )}
      {limited && (
        <p id={timeoutId} className="text-xs text-slate-slate400">
          {IMPORT_WORDS.timeout}
        </p>
      )}
      {limited && !renderBackup && <p className="text-xs text-slate-slate400">{IMPORT_WORDS.practice}</p>}
      <div role="status" aria-live="polite" className="space-y-1 text-sm text-slate-slate100">
        {busy && <p>Working...</p>}
        {shown?.lines.map((line, i) => (
          <p key={`${i}-${line}`}>{line}</p>
        ))}
        {shown?.errors.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-slate400">
            {shown.errors.map((e, i) => (
              <li key={`${i}-${e.message}`}>{e.message}</li>
            ))}
          </ul>
        )}
      </div>
      {error && (
        <p role="alert" className={formErrorClass}>
          {error}
        </p>
      )}
    </div>
  );
}
