import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import { GAP_CLASS, pickClass } from './layoutClasses.ts';
import { cx } from './styles.ts';

const JUSTIFY_CLASS = { start: 'justify-start', between: 'justify-between', end: 'justify-end' } as const;
const WRAP_CLASS = { wrap: 'flex-wrap', 'one-line': 'flex-nowrap' } as const;

export interface RowProps extends EditorProps {
  gap?: string;
  justify?: string;
  wrap?: string;
}

/** Small parts in one line. Defaults equal the zod defaults of Row.def.ts. */
export function Row({ gap = 'sm', justify = 'start', wrap = 'wrap', ...rest }: RowProps) {
  const { className, ...dom } = editorDomProps(rest);
  return (
    <div
      {...dom}
      className={cx('flex items-center', pickClass(GAP_CLASS, gap, 'sm'), pickClass(JUSTIFY_CLASS, justify, 'start'), pickClass(WRAP_CLASS, wrap, 'wrap'), className)}
    >
      {rest.children}
    </div>
  );
}
