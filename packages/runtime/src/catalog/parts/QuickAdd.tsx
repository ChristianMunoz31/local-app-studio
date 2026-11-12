import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { btnPrimary, formErrorClass, inputClass } from '../../../../../src/components/shared/formStyles.js';
import { fieldInfo, useIsLive, useMutations, useTableDef } from '../../../../../src/catalog/context.tsx';
import { isNumbered } from '../../spec/autoNumber.ts';
import { EmptyLine } from './DataState.tsx';
import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import { ERROR_TEXT, errorText } from '../../../../../src/catalog/errorText.ts';
import { cx } from './styles.ts';

export interface QuickAddProps extends EditorProps {
  table?: string;
  field?: string;
  placeholder?: string;
  buttonLabel?: string;
}

const NUMBERED = 'This field is numbered automatically. Use a form instead.';

const NEEDS_MORE = 'This list needs more than one field. Use a form instead.';

const messageOf = (e: unknown): string => errorText(e, ERROR_TEXT.addFailed);
const fieldOf = (e: unknown): string | undefined => {
  const field = typeof e === 'object' && e !== null && 'field' in e ? (e as { field?: unknown }).field : undefined;
  return typeof field === 'string' ? field : undefined;
};

/** One box and an Add button that adds a record, filling one text field. Disabled where the page is not live. */
export function QuickAdd({ table = '', field = '', placeholder = 'Add one', buttonLabel = 'Add', ...rest }: QuickAddProps) {
  const { className, ...dom } = editorDomProps(rest);
  const uid = useId();
  const live = useIsLive();
  const def = useTableDef(table);
  const { create } = useMutations();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!def) return <p {...dom} className={cx('text-sm text-slate-slate400', className)}>This quick add is not available here.</p>;

  // Only a text field of the table (never a system column) can be filled by the one box.
  const type = fieldInfo(def, field)?.type;
  if (type !== 'text' && type !== 'longtext') return <EmptyLine text={ERROR_TEXT.quickAddCannot} />;

  if (def.fields.some((f) => f.id === field && isNumbered(f))) return <EmptyLine text={NUMBERED} />;

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    setAdded(false);
    setError(null);
    const value = text.trim();
    if (value === '') {
      setError('Type something first.');
      return;
    }
    // The database fills defaults; another required field with none cannot be filled by one box.
    const otherNeeded = def.fields.some((f) => f.id !== field && !isNumbered(f) && f.required && f.type !== 'boolean' && !('default' in f && f.default !== undefined));
    if (otherNeeded) {
      setError(NEEDS_MORE);
      return;
    }
    setBusy(true);
    try {
      await create(table, { [field]: value });
      setText('');
      setAdded(true);
    } catch (err) {
      const bad = fieldOf(err);
      setError(bad !== undefined && bad !== field ? NEEDS_MORE : messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form {...dom} noValidate onSubmit={(e) => void submit(e)} className={cx('space-y-2', className)}>
      <div className="flex items-center gap-2">
        <input
          type="text"
          aria-label={placeholder}
          placeholder={placeholder}
          maxLength={500}
          disabled={!live}
          readOnly={busy}
          aria-busy={busy || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={[error ? `${uid}-error` : '', live ? '' : `${uid}-hint`].filter(Boolean).join(' ') || undefined}
          className={inputClass}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setAdded(false);
          }}
        />
        <button type="submit" className={cx(btnPrimary, 'shrink-0')} disabled={!live || busy}>
          {buttonLabel}
        </button>
      </div>
      {error && (
        <p id={`${uid}-error`} role="alert" className={formErrorClass}>
          {error}
        </p>
      )}
      {!live && (
        <p id={`${uid}-hint`} className="text-xs text-slate-slate400">
          Adding works in the running app.
        </p>
      )}
      <p role="status" className={added ? 'text-xs text-accent-green' : 'sr-only'}>
        {added ? 'Added.' : ''}
      </p>
    </form>
  );
}
