import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { btnPrimary, btnSecondary, formErrorClass, labelClass } from '../../../../../src/components/shared/formStyles.js';
import type { Field } from '../../spec/schema.ts';
import { useCatalogData, useMutations, useTableDef } from '../../../../../src/catalog/context.tsx';
import type { DataRow } from '../../../../../src/catalog/context.tsx';
import { ERROR_TEXT, errorText } from '../../../../../src/catalog/errorText.ts';
import { isNumbered } from '../../spec/autoNumber.ts';
import { FieldInput } from './FieldInput.tsx';
import { appliedText, toInput, toPayload } from './fieldValue.ts';

type FormValues = Record<string, string | boolean>;

export interface RecordFormViewProps {
  table: string;
  /** The record to change; null or absent adds a new one. */
  record?: DataRow | null;
  /** Field ids to show, in order. Default: every field of the table. */
  fields?: string[];
  submitLabel?: string;
  /** Leave the submit button out (the designer canvas, where the toolbar's Save is the only one). */
  hideSubmit?: boolean;
  onSaved?: (row: DataRow) => void;
  onCancel?: () => void;
}

/** The page's own record (the :id of a record page): its table and id, for a new record's link to it. */
interface PageRecord {
  table: string;
  id: string;
}

function initialValues(fields: Field[], record: DataRow | null | undefined, pageRecord: PageRecord | null): FormValues {
  const out: FormValues = {};
  for (const f of fields) {
    let stored = record ? record[f.id] : 'default' in f ? f.default : undefined;
    // A new record's link to the page's record points at it, unless the field has a default of its own.
    if (!record && f.type === 'reference' && pageRecord && f.table === pageRecord.table && (stored === undefined || stored === null || stored === '')) stored = pageRecord.id;
    out[f.id] = toInput(f, stored);
  }
  return out;
}

const messageOf = (e: unknown): string => errorText(e, ERROR_TEXT.saveFailed);
const fieldOf = (e: unknown): string | undefined => {
  const field = typeof e === 'object' && e !== null && 'field' in e ? (e as { field?: unknown }).field : undefined;
  return typeof field === 'string' ? field : undefined;
};

/**
 * A form for one record of a table, built from the spec: an input per field type, the select options, a picker for
 * references. A problem the server reports for one field shows beside that field.
 */
export function RecordFormView({ table, record, fields, submitLabel, hideSubmit = false, onSaved, onCancel }: RecordFormViewProps) {
  const def = useTableDef(table);
  const { recordId, spec, pageId } = useCatalogData();
  const pageTable = recordId ? spec?.pages.find((p) => p.id === pageId)?.sources?.find((s) => s.mode === 'record')?.table : undefined;
  const pageRecord: PageRecord | null = recordId && pageTable ? { table: pageTable, id: recordId } : null;
  const { create, update } = useMutations();
  const uid = useId();
  const shown: Field[] = def ? (fields ? fields.flatMap((id) => def.fields.filter((f) => f.id === id)) : def.fields) : [];
  const sent = shown.filter((f) => !isNumbered(f));
  const editing = Boolean(record);
  const [first] = useState<FormValues>(() => initialValues(shown, record, pageRecord));
  const [values, setValues] = useState<FormValues>(first);
  // What the server last gave us (the loaded or the saved row): an edit sends only what differs from it, so a field the
  // person did not change never overwrites what a rule wrote.
  const baseline = useRef<FormValues>(first);
  const lastRow = useRef<DataRow | null | undefined>(record);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The page's record id can arrive after mount (the canvas resolves it later): preset the link field, unless it was touched or filled.
  const touched = useRef(new Set<string>());
  const presetFor = useRef<string | null>(pageRecord?.id ?? null);
  const pageRecordId = pageRecord?.id ?? null;
  const pageRecordTable = pageRecord?.table ?? null;
  useEffect(() => {
    if (record || pageRecordId === null || pageRecordTable === null || presetFor.current === pageRecordId) return;
    presetFor.current = pageRecordId;
    const links = shown.filter((f) => f.type === 'reference' && f.table === pageRecordTable && !touched.current.has(f.id));
    if (links.length === 0) return;
    setValues((prev) => {
      const next = { ...prev };
      for (const f of links) if (next[f.id] === '' && !('default' in f && f.default)) next[f.id] = pageRecordId;
      return next;
    });
    // `shown` is derived from `def` and `fields` on every render; the preset keys off the record id arriving.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record, pageRecordId, pageRecordTable]);

  if (!def) return <p className="text-sm text-slate-slate400">This form is not available here.</p>;

  const set = (id: string, value: string | boolean): void => {
    touched.current.add(id);
    setValues((prev) => ({ ...prev, [id]: value }));
    setSaved(null);
  };

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    // With no button the form still submits on Enter in a one-field form (implicit submission): a preview must never write.
    if (hideSubmit) return;
    setSaved(null);
    setBanner(null);
    const missing: Record<string, string> = {};
    for (const f of sent) {
      const raw = values[f.id];
      if (f.required && f.type !== 'boolean' && (typeof raw !== 'string' || raw.trim() === '')) missing[f.id] = `${f.label} is required.`;
    }
    setErrors(missing);
    if (Object.keys(missing).length > 0) return;
    const payload: DataRow = {};
    for (const f of sent) {
      if (editing && values[f.id] === baseline.current[f.id]) continue;
      const value = toPayload(f, values[f.id], editing);
      if (value !== undefined) payload[f.id] = value;
    }
    // Nothing to send: no request, and updated_at stays as it is.
    if (editing && Object.keys(payload).length === 0) {
      setSaved('Nothing changed.');
      return;
    }
    setBusy(true);
    try {
      const row = record ? await update(table, String(record.id), payload) : await create(table, payload);
      const next = initialValues(shown, record ? (lastRow.current = { ...lastRow.current, ...row }) : null, pageRecord);
      baseline.current = next;
      setValues(next);
      setSaved(['Saved.', appliedText(row)].filter(Boolean).join(' '));
      onSaved?.(row);
    } catch (err) {
      const field = fieldOf(err);
      if (field && shown.some((f) => f.id === field)) setErrors({ [field]: messageOf(err) });
      else setBanner(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const control = (f: Field) => {
    const id = `${uid}-${f.id}`;
    const raw = values[f.id];
    return <FieldInput field={f} value={raw} onChange={(v) => set(f.id, v)} id={id} invalid={Boolean(errors[f.id])} describedBy={errors[f.id] ? `${id}-error` : undefined} />;
  };

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="space-y-4">
      {shown.map((f) =>
        isNumbered(f) ? (
          <p key={f.id} className="text-sm text-slate-slate100">
            <span className={labelClass}>{f.label}</span>
            {record ? String(record[f.id] ?? '') : 'Numbered when saved'}
          </p>
        ) : (
        <div key={f.id} className={f.type === 'boolean' ? 'flex items-center gap-2' : undefined}>
          {f.type === 'boolean' && control(f)}
          <label htmlFor={`${uid}-${f.id}`} className={f.type === 'boolean' ? 'text-sm text-slate-slate100' : labelClass}>
            {f.label}
            {f.required && f.type !== 'boolean' && <span aria-hidden="true"> *</span>}
          </label>
          {f.type !== 'boolean' && control(f)}
          {errors[f.id] && (
            <p id={`${uid}-${f.id}-error`} role="alert" className={`${formErrorClass} mt-1`}>
              {errors[f.id]}
            </p>
          )}
        </div>
        ),
      )}
      {banner && (
        <p role="alert" className={formErrorClass}>
          {banner}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <span role="status" className="mr-auto text-xs text-accent-green">
          {saved}
        </span>
        {onCancel && (
          <button type="button" className={btnSecondary} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
        {!hideSubmit && (
          <button type="submit" className={btnPrimary} disabled={busy}>
            {busy ? 'Saving...' : (submitLabel ?? (editing ? 'Save changes' : 'Add'))}
          </button>
        )}
      </div>
    </form>
  );
}
