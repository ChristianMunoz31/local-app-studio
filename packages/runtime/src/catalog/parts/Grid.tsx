import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import { FREE_GRID_CLASS } from './gridClasses.ts';
import { cx } from './styles.ts';

const COLUMNS_CLASS = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
} as const;
const GAP_CLASS = { sm: 'gap-2', md: 'gap-4', lg: 'gap-6' } as const;

export interface GridProps extends EditorProps {
  columns?: keyof typeof COLUMNS_CLASS | 12;
  gap?: keyof typeof GAP_CLASS;
  placement?: 'flow' | 'free';
  rows?: number;
}

/** Parts side by side in 1 to 4 columns, or placed freely on 12 columns from md (one column on a narrow screen). */
// `rows` is stored for readers and the canvas overlay; editorDomProps forwards nothing but the editor's own attributes, so it never reaches the DOM.
export function Grid({ columns = 2, gap = 'md', placement = 'flow', rows: _rows, ...rest }: GridProps) {
  void _rows;
  const { className, ...dom } = editorDomProps(rest);
  if (placement === 'free') {
    return (
      <div {...dom} className={cx(FREE_GRID_CLASS, GAP_CLASS[gap] ?? GAP_CLASS.md, className)}>
        {rest.children}
      </div>
    );
  }
  return (
    <div {...dom} className={cx('grid', (columns === 12 ? undefined : COLUMNS_CLASS[columns]) ?? COLUMNS_CLASS[2], GAP_CLASS[gap] ?? GAP_CLASS.md, className)}>
      {rest.children}
    </div>
  );
}
