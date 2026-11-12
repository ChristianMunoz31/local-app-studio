import type { Tone } from '../../../../../src/catalog/enums.ts';
import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import { TONE_CLASS, cx } from './styles.ts';

// glass-subtle is the kit's tile inside a card; the outline variant is a plain border on the glass edge token.
const VARIANT_CLASS = { subtle: 'glass-subtle', outline: 'border border-[color:var(--glass-border)]' } as const;

export interface CardProps extends EditorProps {
  title?: string;
  tone?: Tone;
  variant?: keyof typeof VARIANT_CLASS;
}

/** A small tile with an optional title. */
export function Card({ title, tone = 'neutral', variant = 'subtle', ...rest }: CardProps) {
  const { className, ...dom } = editorDomProps(rest);
  return (
    <div {...dom} className={cx('space-y-2 rounded-xl p-4', VARIANT_CLASS[variant] ?? VARIANT_CLASS.subtle, className)}>
      {title && <h4 className={cx('font-[family-name:var(--font-display)] text-sm font-bold tracking-tight', TONE_CLASS[tone] ?? TONE_CLASS.neutral)}>{title}</h4>}
      {rest.children}
    </div>
  );
}
