// The column to field editor of the Import rows panel (built app only; Preview leaves it out).
import { useId } from 'react';
import { inputClass, labelClass } from '../../../../../src/components/shared/formStyles';

const TYPE_WORDS = {
  text: 'text',
  longtext: 'long text',
  integer: 'whole number',
  real: 'number',
  date: 'date',
  datetime: 'date and time',
  select: 'choice',
  boolean: 'yes or no',
  reference: 'link',
};

export default function ImportMapping({ headers, fields, mapping, onChange }) {
  const uid = useId();
  const choices = fields.filter((f) => !f.numbered);
  return (
    <fieldset className="space-y-2">
      <legend className={labelClass}>Match each column to a field</legend>
      {headers.map((header, i) => (
        <div key={`${header}-${i}`} className="flex flex-wrap items-center gap-2">
          <label htmlFor={`${uid}-${i}`} className="min-w-0 flex-1 truncate text-sm text-slate-slate100">
            {header || `Column ${i + 1}`}
          </label>
          <select
            id={`${uid}-${i}`}
            className={`${inputClass} max-w-56`}
            value={mapping[header] ?? ''}
            onChange={(e) => onChange({ ...mapping, [header]: e.target.value || null })}
          >
            <option value="">Leave out</option>
            {choices.map((f) => (
              <option key={f.id} value={f.id}>{`${f.label} (${TYPE_WORDS[f.type] ?? f.type})`}</option>
            ))}
          </select>
        </div>
      ))}
    </fieldset>
  );
}
