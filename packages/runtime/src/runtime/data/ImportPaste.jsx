// The paste box of the Import rows panel (built app only; Preview takes a file).
import { useId } from 'react';
import { inputClass, labelClass } from '../../../../../src/components/shared/formStyles';

export default function ImportPaste({ text, onText }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        Or paste rows, with the column names on the first line
      </label>
      <textarea id={id} rows={4} className={inputClass} value={text} onChange={(e) => onText(e.target.value)} />
    </div>
  );
}
