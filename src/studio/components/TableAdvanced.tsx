import { useId, useState } from 'react';
import { autoNumberExample, readAutoNumber } from '@local-app-studio/runtime/spec/autoNumber';
import type { Field, SpecIssue, Table } from '@local-app-studio/runtime/spec/schema';
import { btnSecondary, inputClass, labelClass } from '@/components/shared/formStyles.js';
import type { ChangeMeta } from '../lib/tableChange';
import { isoToLocal, localToIso } from '@local-app-studio/runtime/catalog/parts/format';
import { setAutoNumber } from '../lib/automationEdit';
import type { NumberingChoice } from '../lib/automationEdit';
import { errorProps } from '../lib/errorProps';
import { issuesAt } from '../lib/validate';
import { Errors } from './FieldRow';
import { HINT_CLASS } from './ui';

interface Props {
  table: Table;
  index: number;
  issues: SpecIssue[];
  usedByPages: string[];
  onChange(next: Table, meta?: ChangeMeta): void;
}

/** Beside the Inside name boxes. */
export const INSIDE_NAMES_NOTE =
  "Inside names are used in your app's data. A new table or field takes its inside name from its name until you first save; after that it stays as it is. Do not change them after you build an installer.";

const TITLE_TYPES: ReadonlySet<string> = new Set(['text', 'longtext', 'select']);

const omitDefault = (field: Field): Field =>
  Object.fromEntries(Object.entries(field).filter(([key]) => key !== 'default')) as unknown as Field;

interface DefaultProps {
  field: Field;
  id: string;
  invalid?: ReturnType<typeof errorProps>;
  onChange(next: Field): void;
}

/** The default value input for the field's type (none for links). */
export function DefaultEditor({ field, id, invalid = {}, onChange }: DefaultProps) {
  const set = (value: string | number | boolean | undefined): void => {
    if (value === undefined) onChange(omitDefault(field));
    else onChange({ ...field, default: value } as Field);
  };
  switch (field.type) {
    case 'reference':
      return null;
    case 'longtext':
      return <textarea id={id} {...invalid} className={inputClass} rows={2} value={field.default ?? ''} onChange={(e) => set(e.target.value === '' ? undefined : e.target.value)} />;
    case 'text':
      return <input id={id} {...invalid} className={inputClass} value={field.default ?? ''} onChange={(e) => set(e.target.value === '' ? undefined : e.target.value)} />;
    case 'integer':
    case 'real':
      return (
        <input
          id={id}
          {...invalid}
          type="number"
          step={field.type === 'integer' ? 1 : 'any'}
          className={inputClass}
          value={field.default ?? ''}
          onChange={(e) => set(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      );
    case 'boolean':
      return (
        <select
          id={id}
          {...invalid}
          className={inputClass}
          value={field.default === undefined ? '' : String(field.default)}
          onChange={(e) => set(e.target.value === '' ? undefined : e.target.value === 'true')}
        >
          <option value="">None</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
    case 'date':
      return <input id={id} {...invalid} type="date" className={inputClass} value={field.default ?? ''} onChange={(e) => set(e.target.value === '' ? undefined : e.target.value)} />;
    case 'datetime':
      return (
        <input
          id={id}
          {...invalid}
          type="datetime-local"
          className={inputClass}
          value={field.default ? isoToLocal(field.default) : ''}
          onChange={(e) => set(localToIso(e.target.value))}
        />
      );
    case 'select':
      return (
        <select id={id} {...invalid} className={inputClass} value={field.default ?? ''} onChange={(e) => set(e.target.value === '' ? undefined : e.target.value)}>
          <option value="">None</option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
  }
}

interface NumberingProps {
  field: Field;
  id: string;
  /** The label of the other field that is already numbered, or null. */
  other: string | null;
  /** "INV-0001, INV-0002, INV-0003" while this field is numbered, else null. */
  example: string | null;
  issues: SpecIssue[];
  onChange(choice: NumberingChoice | null): void;
}

/** "Numbered automatically" for a text or whole number field: the app fills it in when a record is added. */
function NumberingBlock({ field, id, other, example, issues, onChange }: NumberingProps) {
  if (field.type !== 'text' && field.type !== 'integer') return null;
  const block: NumberingChoice | undefined = field.autoNumber;
  const on = block !== undefined;
  const part = (key: keyof NumberingChoice, text: string, props: { numeric: boolean; min: number; max?: number }) => (
    <div>
      <label htmlFor={`${id}-${key}`} className={labelClass}>
        {text}
      </label>
      <input
        id={`${id}-${key}`}
        className={inputClass}
        type={props.numeric ? 'number' : 'text'}
        min={props.numeric ? props.min : undefined}
        max={props.max}
        step={props.numeric ? 1 : undefined}
        value={block?.[key] ?? ''}
        onChange={(e) => {
          const rest = Object.fromEntries(Object.entries(block ?? {}).filter(([k]) => k !== key));
          const v = e.target.value;
          onChange(v === '' ? rest : { ...rest, [key]: props.numeric ? Number(v) : v });
        }}
      />
    </div>
  );
  return (
    <div className="space-y-2 sm:col-span-2">
      <label className="flex items-center gap-2 text-sm text-slate-slate200">
        <input type="checkbox" checked={on} disabled={other !== null} onChange={(e) => onChange(e.target.checked ? {} : null)} />
        <span>
          Numbered automatically<span className="sr-only">{`: ${field.label}`}</span>
        </span>
      </label>
      {other !== null && <p className={HINT_CLASS}>{`Only one field of a table can be numbered. ${other} already is.`}</p>}
      {on && (
        <>
          <p className={HINT_CLASS}>A numbered field has no default.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {part('start', 'Starts at', { numeric: true, min: 0 })}
            {field.type === 'text' && part('prefix', 'Before the number', { numeric: false, min: 0 })}
            {field.type === 'text' && part('width', 'Digits', { numeric: true, min: 1, max: 12 })}
          </div>
          {example !== null && <p className={HINT_CLASS}>{`For example: ${example}`}</p>}
        </>
      )}
      <Errors issues={issues} id={`${id}-err`} />
    </div>
  );
}

/** Inside names, defaults, the field that names a record and the pages that read the table, kept out of the way. */
export default function TableAdvanced({ table, index, issues, usedByPages, onChange }: Props) {
  const uid = useId();
  const base = `tables.${index}`;
  const hasIssue =
    issuesAt(issues, `${base}.id`).length > 0 ||
    issuesAt(issues, `${base}.titleField`).length > 0 ||
    table.fields.some((_, k) => issuesAt(issues, `${base}.fields.${k}.id`).length > 0 || issuesAt(issues, `${base}.fields.${k}.default`).length > 0 || issuesAt(issues, `${base}.fields.${k}.autoNumber`).length > 0);
  const [open, setOpen] = useState(hasIssue);
  const [sawIssue, setSawIssue] = useState(hasIssue);
  if (hasIssue !== sawIssue) {
    // An issue appearing opens the section; it never closes it again by itself.
    setSawIssue(hasIssue);
    if (hasIssue) setOpen(true);
  }

  const setField = (k: number, next: Field, key: string): void => {
    const old = table.fields[k];
    const fields = table.fields.map((f, i) => (i === k ? next : f));
    const titleField = old && table.titleField === old.id && next.id !== old.id ? next.id : table.titleField;
    onChange({ ...table, fields, ...(titleField === undefined ? {} : { titleField }) }, { label: 'More options', coalesceKey: key });
  };

  const numbered = readAutoNumber(table);

  /** Turns numbering on or off for field k, or changes one of its choices (an empty box goes back to the default). */
  const setNumbering = (k: number, choice: NumberingChoice | null): void => {
    const hadDefault = table.fields[k] !== undefined && 'default' in table.fields[k];
    onChange(setAutoNumber(table, table.fields[k].id, choice), {
      label: 'More options',
      coalesceKey: `numbering:${k}`,
      ...(choice !== null && hadDefault ? { notice: 'A numbered field has no default.' } : {}),
    });
  };

  const setTitleField = (value: string): void => {
    const next: Table = { ...table };
    if (value === '') delete next.titleField;
    else next.titleField = value;
    onChange(next, { label: 'More options' });
  };

  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className={`${btnSecondary} cursor-pointer`}>More options</summary>
      <div className="mt-3 space-y-4">
        <p className="text-xs text-slate-slate400">{INSIDE_NAMES_NOTE}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${uid}-id`} className={labelClass}>
              Inside name
            </label>
            <input
              id={`${uid}-id`}
              className={inputClass}
              value={table.id}
              onChange={(e) => onChange({ ...table, id: e.target.value }, { label: 'More options', coalesceKey: `table-id:${index}` })}
              {...errorProps(`${uid}-id-err`, issuesAt(issues, `${base}.id`))}
            />
            <Errors issues={issuesAt(issues, `${base}.id`)} id={`${uid}-id-err`} />
          </div>
          <div>
            <label htmlFor={`${uid}-title`} className={labelClass}>
              Field that names a record
            </label>
            <select
              id={`${uid}-title`}
              className={inputClass}
              value={table.titleField ?? ''}
              onChange={(e) => setTitleField(e.target.value)}
              {...errorProps(`${uid}-title-err`, issuesAt(issues, `${base}.titleField`))}
            >
              <option value="">None</option>
              {table.fields
                .filter((f) => TITLE_TYPES.has(f.type))
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
            </select>
            <Errors issues={issuesAt(issues, `${base}.titleField`)} id={`${uid}-title-err`} />
          </div>
        </div>
        {table.fields.map((field, k) => {
          const path = `${base}.fields.${k}`;
          return (
            <div key={k} className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={`${uid}-fid-${k}`} className={labelClass}>
                  {`Inside name of ${field.label}`}
                </label>
                <input
                  id={`${uid}-fid-${k}`}
                  className={inputClass}
                  value={field.id}
                  onChange={(e) => setField(k, { ...field, id: e.target.value }, `field-id:${k}`)}
                  {...errorProps(`${uid}-fid-err-${k}`, issuesAt(issues, `${path}.id`))}
                />
                <Errors issues={issuesAt(issues, `${path}.id`)} id={`${uid}-fid-err-${k}`} />
              </div>
              {field.type !== 'reference' && !(numbered?.field === field.id) && (
                <div>
                  <label htmlFor={`${uid}-def-${k}`} className={labelClass}>
                    {`Default for ${field.label}`}
                  </label>
                  <DefaultEditor
                    field={field}
                    id={`${uid}-def-${k}`}
                    invalid={errorProps(`${uid}-def-err-${k}`, issuesAt(issues, `${path}.default`))}
                    onChange={(next) => setField(k, next, `field-default:${k}`)}
                  />
                  <Errors issues={issuesAt(issues, `${path}.default`)} id={`${uid}-def-err-${k}`} />
                </div>
              )}
              {(field.type === 'text' || field.type === 'integer') && (
                <NumberingBlock
                  field={field}
                  id={`${uid}-num-${k}`}
                  other={numbered !== null && numbered.field !== field.id ? (table.fields.find((f) => f.id === numbered.field)?.label ?? '') : null}
                  example={numbered?.field === field.id ? autoNumberExample(numbered) : null}
                  issues={issuesAt(issues, `${path}.autoNumber`)}
                  onChange={(choice) => setNumbering(k, choice)}
                />
              )}
            </div>
          );
        })}
        <p className="text-sm text-slate-slate300">
          {usedByPages.length > 0 ? `Pages that read this table: ${usedByPages.join(', ')}. Change page data in Design.` : 'No page reads this table yet.'}
        </p>
      </div>
    </details>
  );
}
