import { useId } from 'react';
import { Check } from 'lucide-react';

// Selected state carries a non-color cue (check icon) and a forced-colors outline,
// so it survives high-contrast modes and low-contrast color pairs. min-h keeps a
// ~36px touch target on small screens.
const OPTION_CLASS =
  'flex min-h-9 cursor-pointer select-none items-center gap-1 rounded px-3 py-1 text-sm font-semibold text-slate-slate300 transition hover:text-slate-slate100 sm:min-h-0 peer-checked:bg-slate-brand peer-checked:text-white forced-colors:peer-checked:outline forced-colors:peer-checked:outline-2 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:[outline-color:var(--focus-ring)]';

/**
 * Segmented single-choice control built on native radios (arrow keys, form
 * semantics and screen reader grouping come for free).
 *
 * Props: legend (visible group label), value, onChange(value), options
 * ([{ value, label }]), hint (optional muted helper text), name (optional), disabled (optional).
 */
export default function SegmentedRadio({ legend, value, onChange, options, hint, name, disabled = false }) {
  const autoName = useId();
  const groupName = name ?? autoName;
  return (
    <fieldset className="min-w-0" disabled={disabled}>
      <legend className="mb-1.5 text-sm font-semibold text-slate-slate100">{legend}</legend>
      <div className="glass-subtle inline-flex rounded-lg p-0.5">
        {options.map((opt) => (
          <label key={opt.value}>
            <input
              type="radio"
              name={groupName}
              value={opt.value}
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
              className="peer sr-only"
            />
            <span className={OPTION_CLASS}>
              {value === opt.value && <Check size={14} className="shrink-0" aria-hidden="true" />}
              {opt.label}
            </span>
          </label>
        ))}
      </div>
      {hint && <p className="mt-1.5 text-xs text-slate-slate400">{hint}</p>}
    </fieldset>
  );
}
