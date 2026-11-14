import { inputClass } from '../../../../../src/components/shared/formStyles.js';
import type { Field } from '../../spec/schema.ts';
import { ReferenceSelect } from './ReferenceSelect.tsx';

export interface FieldInputProps {
  field: Field;
  value: string | boolean;
  onChange: (value: string | boolean) => void;
  id: string;
  /** The id of the problem text beside the input. */
  describedBy?: string;
  invalid?: boolean;
  disabled?: boolean;
}

/** The input for one field type: shared by the record form and the inline edit of a table cell. */
export function FieldInput({ field: f, value, onChange, id, describedBy, invalid, disabled }: FieldInputProps) {
  const aria = { id, 'aria-required': f.required || undefined, 'aria-invalid': invalid ? true : undefined, 'aria-describedby': describedBy, disabled };
  const text = typeof value === 'string' ? value : '';
  switch (f.type) {
    case 'longtext':
      return <textarea {...aria} rows={4} maxLength={20000} className={inputClass} value={text} onChange={(e) => onChange(e.target.value)} />;
    case 'integer':
      return <input {...aria} type="number" step={1} className={inputClass} value={text} onChange={(e) => onChange(e.target.value)} />;
    case 'real':
      return <input {...aria} type="number" step="any" className={inputClass} value={text} onChange={(e) => onChange(e.target.value)} />;
    case 'date':
      return <input {...aria} type="date" className={inputClass} value={text} onChange={(e) => onChange(e.target.value)} />;
    case 'datetime':
      return <input {...aria} type="datetime-local" className={inputClass} value={text} onChange={(e) => onChange(e.target.value)} />;
    case 'select':
      return (
        <select {...aria} className={inputClass} value={text} onChange={(e) => onChange(e.target.value)}>
          <option value="">{f.required ? 'Choose one' : 'None'}</option>
          {f.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case 'reference':
      return (
        <ReferenceSelect
          table={f.table}
          value={text}
          onChange={onChange}
          emptyLabel={f.required ? 'Choose one' : 'None'}
          id={aria.id}
          aria-describedby={aria['aria-describedby']}
          aria-invalid={aria['aria-invalid']}
          disabled={disabled}
        />
      );
    case 'boolean':
      return <input {...aria} type="checkbox" className="h-4 w-4 rounded-sm" checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
    default:
      return <input {...aria} type="text" maxLength={500} className={inputClass} value={text} onChange={(e) => onChange(e.target.value)} />;
  }
}
