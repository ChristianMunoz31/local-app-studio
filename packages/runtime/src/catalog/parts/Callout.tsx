import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import { cx } from './styles.ts';

export interface CalloutProps extends EditorProps {
  tone?: 'note' | 'success' | 'warning' | 'danger';
  title?: string;
}

const TONES: Record<NonNullable<CalloutProps['tone']>, { word: string; box: string }> = {
  note: { word: 'Note:', box: 'border-accent-blue/40 bg-accent-blue/10' },
  success: { word: 'Good news:', box: 'border-accent-green/40 bg-accent-green/10' },
  warning: { word: 'Warning:', box: 'border-accent-amber/40 bg-accent-amber/10' },
  danger: { word: 'Problem:', box: 'border-accent-red/40 bg-accent-red/10' },
};

/** A colored box with a note, a success, a warning or a problem. The tone word is spoken first for screen readers. */
export function Callout({ tone = 'note', title, ...rest }: CalloutProps) {
  const { className, ...dom } = editorDomProps(rest);
  const style = typeof tone === 'string' && Object.hasOwn(TONES, tone) ? TONES[tone] : TONES.note;
  return (
    <div {...dom} role="note" className={cx('rounded-lg border px-4 py-3 text-sm text-slate-slate100', style.box, className)}>
      <span className="sr-only">{style.word} </span>
      {title && <p className="font-[family-name:var(--font-display)] font-bold tracking-tight">{title}</p>}
      <div className={cx(title && 'mt-1', 'text-slate-slate300')}>{rest.children}</div>
    </div>
  );
}
