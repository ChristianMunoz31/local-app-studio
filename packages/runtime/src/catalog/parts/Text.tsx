import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import type { Tone } from '../../../../../src/catalog/enums.ts';
import { TONE_CLASS, cx } from './styles.ts';

const SIZE_CLASS = { sm: 'text-xs', md: 'text-sm' } as const;

export interface TextProps extends EditorProps {
  size?: keyof typeof SIZE_CLASS;
  tone?: Tone;
}

/** A paragraph of body text. */
export function Text({ size = 'md', tone = 'neutral', ...rest }: TextProps) {
  const { className, ...dom } = editorDomProps(rest);
  return (
    <p {...dom} className={cx(SIZE_CLASS[size], TONE_CLASS[tone], className)}>
      {rest.children}
    </p>
  );
}
