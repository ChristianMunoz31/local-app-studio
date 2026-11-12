import { useEffect, useId, useRef } from 'react';
import { IconButton } from '@/components/shared/ItemActions.jsx';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import type { Field, FieldType, SpecIssue } from '@local-app-studio/runtime/spec/schema';
import { formErrorClass, inputClass, labelClass } from '@/components/shared/formStyles.js';
import { errorProps, errorWords } from '../lib/errorProps';
import { changeFieldType, FIELD_TYPE_CHOICES, FIELD_TYPE_HINT, fieldName } from '../lib/fields';
import { issuesAt } from '../lib/validate';
import OptionsEditor from './OptionsEditor';
import { HINT_CLASS } from './ui';

interface Props {
  field: Field;
  path: string;
  otherTables: Array<{ id: string; label: string }>;
  issues: SpecIssue[];
  onChange(next: Field): void;
  onMove(delta: -1 | 1): void;
  onDelete(): void;
  /** The first field cannot move up, the last cannot move down. */
  first?: boolean;
  last?: boolean;
  /** Enter in the name box asks for the next field. */
  onEnter?(): void;
  /** Move the focus into the name box with its text selected (the field was just added). */
  focusName?: boolean;
  /** Called once the focus has moved, so it does not move again. */
  onFocused?(): void;
  /** After this row moved: the Move button that takes the focus. */
  focusAction?: 'up' | 'down' | null;
  /** Called once the Move button has the focus. */
  onActionFocused?(): void;
  /** The id of a FieldTypeHint the parent shows once for all rows; the Type picker points at it. Without it the row shows its own. */
  typeHintId?: string;
  /** The row's place in its table, from 1; names an unnamed field "Field <n>" for a screen reader. */
  position?: number;
}

/** What an empty name says, in place of the validator's two sentences about length and shape. */
export const EMPTY_TABLE_NAME = 'Give the table a name.';

/** The words under the Type pickers, shown once for a table or dialog (give the same id to each row's typeHintId). */
export function FieldTypeHint({ id }: { id: string }) {
  return (
    <p id={id} className={HINT_CLASS}>
      {FIELD_TYPE_HINT}
    </p>
  );
}

/** The problems of one input in plain words (plainMessage), the same sentence once, each with an id so the input can point at them. */
export function Errors({ issues, id, empty }: { issues: SpecIssue[]; id: string; empty?: string }) {
  // The same list errorProps points at, so an input's aria-describedby names paragraphs that exist.
  const words = errorWords(issues, empty);
  return (
    <>
      {words.map((text, i) => (
        <p key={text} id={`${id}-${i}`} className={formErrorClass}>
          {text}
        </p>
      ))}
    </>
  );
}

/** One field as a simple row: name, type, Required. Inside names and defaults live under More options. */
export default function FieldRow({ field, path, otherTables, issues, onChange, onMove, onDelete, first = false, last = false, onEnter, focusName = false, onFocused, focusAction = null, onActionFocused, typeHintId, position }: Props) {
  const uid = useId();
  const name = fieldName(field.label, position);
  const nameRef = useRef<HTMLInputElement>(null);
  const focused = useRef(onFocused);
  useEffect(() => {
    focused.current = onFocused;
  });
  useEffect(() => {
    if (!focusName) return;
    nameRef.current?.focus();
    nameRef.current?.select();
    focused.current?.();
  }, [focusName]);
  const rowRef = useRef<HTMLFieldSetElement>(null);
  const actionFocused = useRef(onActionFocused);
  useEffect(() => {
    actionFocused.current = onActionFocused;
  });
  useEffect(() => {
    if (focusAction === null) return;
    rowRef.current?.querySelector<HTMLButtonElement>(`[data-move="${focusAction}"]`)?.focus();
    actionFocused.current?.();
  }, [focusAction]);
  const at = (key: string): SpecIssue[] => issuesAt(issues, `${path}.${key}`);
  const own = issues.filter((i) => i.path === path);
  const ownHintId = `${uid}-type-hint`;
  const hintId = typeHintId ?? ownHintId;
  // The hint and the problems are both read with the picker: one aria-describedby, not two that overwrite each other.
  const typeErr = errorProps(`${uid}-type-err`, at('type'));
  const typeProps = { ...typeErr, 'aria-describedby': [hintId, typeErr['aria-describedby']].filter((x) => x !== undefined).join(' ') };
  const advancedIssue = at('id').length > 0 || at('default').length > 0;
  return (
    <fieldset ref={rowRef} className="glass-subtle space-y-3 rounded-lg p-3" aria-label={field.label.trim() !== '' ? `Field ${field.label}` : name}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor={`${uid}-label`} className={labelClass}>
            Field name
          </label>
          <input
            id={`${uid}-label`}
            ref={nameRef}
            className={inputClass}
            value={field.label}
            onChange={(e) => onChange({ ...field, label: e.target.value })}
            onKeyDown={(e) => {
              // Enter that closes an input method's composition is not a request for a new field.
              if (e.key !== 'Enter' || onEnter === undefined || e.nativeEvent.isComposing) return;
              e.preventDefault();
              onEnter();
            }}
            {...errorProps(`${uid}-label-err`, at('label'))}
          />
          <Errors issues={at('label')} id={`${uid}-label-err`} />
        </div>
        <div>
          <label htmlFor={`${uid}-type`} className={labelClass}>
            Type
          </label>
          <select
            id={`${uid}-type`}
            className={inputClass}
            value={field.type}
            onChange={(e) => onChange(changeFieldType(field, e.target.value as FieldType, otherTables))}
            {...typeProps}
          >
            {FIELD_TYPE_CHOICES.map((choice) => (
              <option key={choice.type} value={choice.type} disabled={choice.type === 'reference' && otherTables.length === 0 && field.type !== 'reference'}>
                {choice.label}
              </option>
            ))}
          </select>
          {typeHintId === undefined && (
            <div className="mt-1">
              <FieldTypeHint id={ownHintId} />
            </div>
          )}
          <Errors issues={at('type')} id={`${uid}-type-err`} />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-slate300">
          <input type="checkbox" checked={field.required} onChange={(e) => onChange({ ...field, required: e.target.checked })} />
          Required
        </label>
        <div className="flex gap-1">
          <IconButton label={`Move ${name} up`} icon={ArrowUp} onClick={() => onMove(-1)} disabled={first} data-move="up" className="disabled:cursor-not-allowed disabled:opacity-40" />
          <IconButton label={`Move ${name} down`} icon={ArrowDown} onClick={() => onMove(1)} disabled={last} data-move="down" className="disabled:cursor-not-allowed disabled:opacity-40" />
          <IconButton label={field.label.trim() !== '' ? `Delete field ${field.label}` : `Delete ${name}`} icon={Trash2} tone="danger" onClick={onDelete} />
        </div>
      </div>
      {field.type === 'select' && <OptionsEditor options={field.options} onChange={(options) => onChange({ ...field, options })} issues={at('options')} />}
      {field.type === 'reference' && (
        <div>
          <label htmlFor={`${uid}-table`} className={labelClass}>
            Links to
          </label>
          <select
            id={`${uid}-table`}
            className={inputClass}
            value={field.table}
            onChange={(e) => onChange({ ...field, table: e.target.value })}
            {...errorProps(`${uid}-table-err`, at('table'))}
          >
            {!otherTables.some((t) => t.id === field.table) && <option value={field.table}>{field.table || 'Pick a table'}</option>}
            {otherTables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <Errors issues={at('table')} id={`${uid}-table-err`} />
        </div>
      )}
      <Errors issues={own} id={`${uid}-own-err`} />
      <Errors issues={at('required')} id={`${uid}-required-err`} />
      {advancedIssue && <p className={formErrorClass}>Fix this under More options.</p>}
    </fieldset>
  );
}
