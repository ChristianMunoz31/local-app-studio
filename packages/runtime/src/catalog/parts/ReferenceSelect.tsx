import { inputClass } from '../../../../../src/components/shared/formStyles.js';
import { useReferenceOptions } from '../../../../../src/catalog/context.tsx';

export interface ReferenceSelectProps {
  /** The table the reference points to. */
  table: string;
  value: string;
  onChange: (id: string) => void;
  /** Text of the empty choice ("All" in a filter, "None" in a form). */
  emptyLabel: string;
  id?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

/** A drop-down of the records of a table, labelled by their title. Shared by RecordFormView, FilterBar and ReferencePicker. */
export function ReferenceSelect({ table, value, onChange, emptyLabel, ...aria }: ReferenceSelectProps) {
  const { options } = useReferenceOptions(table);
  const known = value === '' || options.some((o) => o.id === value);
  return (
    <select {...aria} className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{emptyLabel}</option>
      {!known && <option value={value}>{value}</option>}
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.title}
        </option>
      ))}
    </select>
  );
}
