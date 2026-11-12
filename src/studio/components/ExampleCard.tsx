// One example in the gallery: the look, name, description, what it shows and one Use this example button (the AppCard structure, no link).
import { useId } from 'react';
import { THEMES } from '@local-app-studio/runtime/theme/themes.ts';
import { btnPrimary } from '@/components/shared/formStyles.js';
import type { ExampleMeta } from '@/studio/examples';
import { USE_EXAMPLE, USE_EXAMPLE_BUSY, countsLine, lookLine, showsLine } from '../lib/examples';
import ThemeSwatch from '../theme/ThemeSwatch';
import { HINT_CLASS } from './ui';

export interface ExampleCardProps {
  meta: ExampleMeta;
  /** True while any example is being made: a press is ignored, but the button stays focusable. */
  busy: boolean;
  /** True for the card that was pressed. */
  pressed: boolean;
  onUse(meta: ExampleMeta): void;
  buttonRef?(id: ExampleMeta['id'], el: HTMLButtonElement | null): void;
}

export default function ExampleCard({ meta, busy, pressed, onUse, buttonRef }: ExampleCardProps) {
  const nameId = useId();
  const descId = useId();
  const def = THEMES[meta.theme];
  return (
    <li className="glass-subtle relative rounded-lg">
      <div className="flex h-full flex-col rounded-lg p-4">
        <ThemeSwatch theme={{ preset: def.background, radius: def.radius, id: meta.theme }} mode={meta.mode} size="sm" />
        <h4 id={nameId} className="mt-3 min-h-7 break-words line-clamp-2 text-sm font-semibold text-slate-slate100">
          {meta.name}
        </h4>
        <p id={descId} className="mt-1 break-words line-clamp-2 text-sm text-slate-slate300">
          {meta.description}
        </p>
        <p className={`mt-1 ${HINT_CLASS}`}>{showsLine(meta.shows)}</p>
        <p className={`mt-auto pt-1 ${HINT_CLASS}`}>{`${countsLine(meta.tables, meta.pages)} · ${lookLine(meta.theme, meta.mode)}`}</p>
        <button
          type="button"
          ref={(el) => buttonRef?.(meta.id, el)}
          className={`${btnPrimary} forced-colors:focus-visible:outline forced-colors:focus-visible:outline-2 mt-3 self-start aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-slate-brand`}
          aria-label={pressed ? undefined : `${USE_EXAMPLE} ${meta.name}`}
          aria-describedby={descId}
          aria-disabled={busy ? true : undefined}
          aria-busy={pressed ? true : undefined}
          onClick={() => {
            if (!busy) onUse(meta);
          }}
        >
          {pressed ? USE_EXAMPLE_BUSY : USE_EXAMPLE}
        </button>
      </div>
    </li>
  );
}
