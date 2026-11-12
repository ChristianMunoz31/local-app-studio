import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import { cx } from './styles.ts';

const SPACING_CLASS = { sm: 'my-2', md: 'my-4', lg: 'my-6' } as const;

export interface DividerProps extends EditorProps {
  spacing?: keyof typeof SPACING_CLASS;
}

/** A thin line between two blocks. */
export function Divider({ spacing = 'md', ...rest }: DividerProps) {
  const { className, ...dom } = editorDomProps(rest);
  return <hr {...dom} className={cx('border-0 border-t border-[color:var(--glass-border)]', SPACING_CLASS[spacing] ?? SPACING_CLASS.md, className)} />;
}
