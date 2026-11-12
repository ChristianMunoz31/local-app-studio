// The one-line "Ask for a change" form of the review pane (DESIGN-phase16.md 1.5, phase 17 P17-05). It is the only box on the Prompt
// step to ask for a change in, for a saved app and for a design that waits. It only hands the words to its owner.
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { btnSecondary, inputClass, labelClass } from '@/components/shared/formStyles.js';

export const ASK_MAX = 2000;

export interface AskForChangeProps {
  /** True while the helper is down or a run is on. */
  disabled: boolean;
  /** Puts the cursor in the box when it shows (Try again on a change). */
  takeFocus?: boolean;
  onAsk(words: string): void;
}

export default function AskForChange({ disabled, takeFocus = false, onAsk }: AskForChangeProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [words, setWords] = useState('');
  const trimmed = words.trim();
  useEffect(() => {
    if (takeFocus) inputRef.current?.focus();
  }, [takeFocus]);
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (trimmed === '' || disabled) return;
    onAsk(trimmed);
    setWords('');
  };
  return (
    <form onSubmit={submit} className="space-y-1">
      <label htmlFor={id} className={labelClass}>
        Ask for a change
      </label>
      <div className="flex gap-2">
        <input id={id} ref={inputRef} type="text" className={inputClass} maxLength={ASK_MAX} value={words} onChange={(e) => setWords(e.target.value)} />
        <button type="submit" className={`${btnSecondary} shrink-0`} disabled={trimmed === '' || disabled}>
          Ask
        </button>
      </div>
    </form>
  );
}
