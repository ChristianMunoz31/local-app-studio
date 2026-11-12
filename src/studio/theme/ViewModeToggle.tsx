// "Show as: Light / Dark" for the app on screen. A two-option radio group (native radios, so arrow keys and screen readers work).
import { useId } from 'react';
import type { ThemeMode } from '@local-app-studio/runtime/theme/ids.ts';
import { SELECTED_CLASS } from '../components/ui';

const OPTIONS: ReadonlyArray<{ value: ThemeMode; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function ViewModeToggle({ mode, onChange }: { mode: ThemeMode; onChange(mode: ThemeMode): void }) {
  const name = useId();
  return (
    <fieldset className="m-0 flex min-w-0 items-center gap-2 border-0 p-0">
      <legend className="sr-only">Show as</legend>
      <span aria-hidden="true" className="text-xs font-medium text-slate-slate400">
        Show as
      </span>
      {OPTIONS.map((o) => (
        <label key={o.value} className="cursor-pointer">
          <input type="radio" name={name} value={o.value} checked={mode === o.value} onChange={() => onChange(o.value)} className="peer sr-only" />
          <span
            className={`block rounded-md border px-2.5 py-1 text-xs font-semibold peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:[outline-color:var(--focus-ring)] ${
              mode === o.value
                ? `border-[color:var(--focus-ring)] ${SELECTED_CLASS}`
                : 'border-[color:var(--glass-border-strong)] text-slate-slate300 hover:text-slate-slate100'
            }`}
          >
            {o.label}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
