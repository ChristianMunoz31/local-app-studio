import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import type { Size, Tone } from '../../../../../src/catalog/enums.ts';
import { TONE_CLASS, cx } from './styles.ts';

// The theme's heading font (Classic: the same as the body font, since the variable is not set).
const DISPLAY = 'font-[family-name:var(--font-display)]';
const SIZE_CLASS: Record<Size, string> = { sm: 'text-xl', md: 'text-2xl', lg: 'text-3xl' };

export interface HeadingProps extends EditorProps {
  size?: Size;
  tone?: Tone;
}

/** A page heading in the kit type scale. */
export function Heading({ size = 'md', tone = 'neutral', ...rest }: HeadingProps) {
  const { className, ...dom } = editorDomProps(rest);
  return (
    <h2 {...dom} className={cx(DISPLAY, 'font-bold tracking-tight', SIZE_CLASS[size], TONE_CLASS[tone], className)}>
      {rest.children}
    </h2>
  );
}
