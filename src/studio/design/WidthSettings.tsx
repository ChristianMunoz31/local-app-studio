// The width of a part in its row, at the end of its settings (docs/DESIGN.md "Parts side by side"): a Width choice, Grow to
// fill, and one plain line that says how much of the row it takes. Each change applies at once, with Undo in the status line.
import { useId, useState } from 'react';
import { formErrorClass, inputClass, labelClass } from '@/components/shared/formStyles.js';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { HINT_CLASS } from '../components/ui';
import { LAYER_WIDTHS, readSizing } from '@local-app-studio/runtime/spec/sizing';
import type { LayerSizing } from '@local-app-studio/runtime/spec/sizing';
import { setSizing } from '../lib/layoutTree';
import { WIDTH_LABELS, sizingChange, sizingLine } from '../lib/sizingWords';
import { useDesign } from './DesignContext';

export default function WidthSettings({ layer, name }: { layer: LayoutLayer; name: string }) {
  const uid = useId();
  const { root, apply, tell } = useDesign();
  const [problem, setProblem] = useState<string | null>(null);
  const current = readSizing(layer.sizing);
  const whole = current.width === 'full';

  const change = (next: LayerSizing): void => {
    setProblem(null);
    const result = setSizing(root, layer.id, next);
    const message = apply(result);
    if (message !== null) return setProblem(message);
    if (result.ok && result.root !== root) tell(sizingChange(name, next), true);
  };

  return (
    <div className="space-y-2 border-t border-slate-slate700 pt-3">
      <div>
        <label htmlFor={`${uid}-width`} className={labelClass}>
          Width
        </label>
        <select
          id={`${uid}-width`}
          className={inputClass}
          value={current.width}
          onChange={(e) => change({ width: readSizing({ width: e.target.value }).width, grow: current.grow })}
        >
          {LAYER_WIDTHS.map((w) => (
            <option key={w} value={w}>
              {WIDTH_LABELS[w]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="flex items-center gap-2 text-sm text-slate-slate100">
          <input type="checkbox" checked={!whole && current.grow} disabled={whole} aria-describedby={`${uid}-grow`} onChange={(e) => change({ width: current.width, grow: e.target.checked })} />
          Grow to fill
        </label>
        <p id={`${uid}-grow`} className={HINT_CLASS}>
          Fills any room left in the row.
        </p>
      </div>
      <p className="text-xs text-slate-slate300">{sizingLine(current)}</p>
      <p className={HINT_CLASS}>Width changes right away.</p>
      {problem !== null && (
        <p role="alert" className={formErrorClass}>
          {problem}
        </p>
      )}
    </div>
  );
}
