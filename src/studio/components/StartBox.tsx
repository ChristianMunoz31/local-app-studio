import { useId, useState } from 'react';
import type { KeyboardEvent, Ref } from 'react';
import { Sparkles } from 'lucide-react';
import StudioSectionCard from './StudioSectionCard';
import { btnPrimary, btnSecondary, formErrorClass, inputClass, labelClass } from '@/components/shared/formStyles.js';
import { HINT_CLASS } from './ui';

const MAX_CHARS = 2000;

interface Props {
  busy: boolean;
  error: string;
  onStart(text: string): void;
  /** The Cancel button: closes the box. */
  onCancel(): void;
  /** Words to show in the box when it opens (for example the ones of an empty app that was removed). */
  initialText?: string;
  /** The SectionCard id. */
  id?: string;
  /** The textarea, so the page can put the cursor in it. */
  textRef?: Ref<HTMLTextAreaElement>;
}

export default function StartBox({ busy, error, onStart, onCancel, initialText = '', id, textRef }: Props) {
  const textId = useId();
  const [text, setText] = useState(initialText);
  const canStart = text.trim().length > 0 && !busy;

  const submit = (): void => {
    if (canStart) onStart(text.trim());
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <StudioSectionCard id={id} title="What do you want to build?" icon={Sparkles} subtitle="Say it in plain words. You check the design before it is used.">
      <label htmlFor={textId} className={labelClass}>
        Your prompt
      </label>
      <textarea
        id={textId}
        ref={textRef}
        className={inputClass}
        rows={4}
        maxLength={MAX_CHARS}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={busy}
        placeholder="For example: a crew roster for my painting business, with who leads each crew and which jobs they are on."
      />
      <p className={`mt-1 ${HINT_CLASS}`}>{`${text.length} of ${MAX_CHARS}`}</p>
      {error && (
        <p role="alert" className={`${formErrorClass} mt-2`}>
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className={btnPrimary} disabled={!canStart} onClick={submit}>
          {busy ? 'Making your app...' : 'Make my app'}
        </button>
        <button type="button" className={btnSecondary} disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <span className={`${HINT_CLASS} basis-full sm:basis-auto`}>The helper runs on this computer. No helper yet? Press Blank app and build it yourself.</span>
      </div>
    </StudioSectionCard>
  );
}
