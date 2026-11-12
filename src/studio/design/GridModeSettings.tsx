// The "Place parts freely" switch of a Grid (docs/DESIGN.md "Parts placed freely on a grid"). On: each part gets a cell and the
// layout looks the same. Off: asks first when any part has a place, because the places are forgotten (Ctrl+Z brings them back).
import { useId, useRef, useState } from 'react';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { formErrorClass } from '@/components/shared/formStyles.js';
import { HINT_CLASS } from '../components/ui';
import StudioConfirm from '../components/StudioConfirm';
import { isFreeGrid, placesIn, toFlow, toFree } from '../lib/gridLayout';
import { FREE_WORDS } from '../lib/gridWords';
import { useDesign } from './DesignContext';

export default function GridModeSettings({ layer, name }: { layer: LayoutLayer; name: string }) {
  const uid = useId();
  const { root, apply, tell } = useDesign();
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<{ text: string; n: number } | null>(null);
  const switchRef = useRef<HTMLInputElement>(null);
  const free = isFreeGrid(layer);
  const hintId = `${uid}-hint`;
  const problemId = `${uid}-problem`;
  // Bumped on every refusal, so the alert line remounts and the same words are spoken again.
  const fail = (text: string): void => setProblem((prev) => ({ text, n: (prev?.n ?? 0) + 1 }));

  const turnOn = (): void => {
    const message = apply(toFree(root, layer.id));
    if (message !== null) return fail(message);
    setProblem(null);
    tell(FREE_WORDS.on(name), true);
  };

  const turnOff = (): void => {
    const message = apply(toFlow(root, layer.id));
    if (message !== null) return fail(message);
    setProblem(null);
    tell(FREE_WORDS.off(name), true);
  };

  const onChange = (): void => {
    if (!free) return turnOn();
    if (placesIn(layer).length > 0) {
      // The confirm gives the focus back to what had it when it opened (a click does not always focus a checkbox).
      switchRef.current?.focus();
      return setAsking(true);
    }
    turnOff();
  };

  return (
    <div className="space-y-1 border-t border-slate-slate700 pt-3">
      <label className="flex items-center gap-2 text-sm text-slate-slate100">
        <input ref={switchRef} type="checkbox" role="switch" checked={free} aria-describedby={problem === null ? hintId : `${hintId} ${problemId}`}
          aria-invalid={problem === null ? undefined : 'true'}
          onChange={onChange}
        />
        {FREE_WORDS.label}
      </label>
      <p id={hintId} className={HINT_CLASS}>
        {FREE_WORDS.hint}
      </p>
      {problem !== null && (
        <p key={problem.n} id={problemId} role="alert" className={formErrorClass}>
          {problem.text}
        </p>
      )}
      {asking && (
        <StudioConfirm
          title={FREE_WORDS.confirmTitle}
          message={FREE_WORDS.confirmBody}
          confirmLabel={FREE_WORDS.confirmYes}
          busyLabel={FREE_WORDS.confirmBusy}
          cancelLabel={FREE_WORDS.confirmNo}
          tone="danger"
          initialFocus="cancel"
          finalFocusRef={switchRef}
          onConfirm={() => {
            setAsking(false);
            turnOff();
          }}
          onCancel={() => setAsking(false)}
        />
      )}
    </div>
  );
}
