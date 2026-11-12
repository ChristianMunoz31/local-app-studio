// "What it does" for a Button: goes to a page, or opens a form to add a record. Applied at once (like Width), with an Undo in the status
// line, in both scopes (the page and the menu bar). Shown only for a button whose action is one of those two; a button that deletes
// the record, or opens a form that edits, keeps its own settings. The change is made by setButtonAction (lib/actionKind.ts).
import { useId, useState } from 'react';
import { formErrorClass, inputClass, labelClass } from '@/components/shared/formStyles.js';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { BUTTON_KIND_LABELS, buttonKindOf, setButtonAction } from '../lib/actionKind';
import type { ButtonKind } from '../lib/actionKind';
import { useDesign } from './DesignContext';

const KINDS: readonly ButtonKind[] = ['navigate', 'open-form'];

const ANNOUNCE: Readonly<Record<ButtonKind, string>> = {
  navigate: 'This button now goes to a page.',
  'open-form': 'This button now opens a form to add a record.',
};

export default function ActionSettings({ layer }: { layer: LayoutLayer }) {
  const id = useId();
  const { root, ctx, spec, apply, tell } = useDesign();
  const [problem, setProblem] = useState<string | null>(null);
  const kind = buttonKindOf(layer);
  if (kind === null) return null;

  const change = (next: string): void => {
    if (!KINDS.includes(next as ButtonKind)) return;
    const message = apply(setButtonAction(root, layer.id, next as ButtonKind, ctx, spec.tables));
    setProblem(message);
    if (message === null) tell(ANNOUNCE[next as ButtonKind], true);
  };

  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        What it does
      </label>
      <select id={id} className={inputClass} value={kind} onChange={(e) => change(e.target.value)}>
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {BUTTON_KIND_LABELS[k]}
          </option>
        ))}
      </select>
      {problem !== null && (
        <p role="alert" className={`mt-1 ${formErrorClass}`}>
          {problem}
        </p>
      )}
    </div>
  );
}
