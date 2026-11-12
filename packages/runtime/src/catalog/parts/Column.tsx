import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import { cx } from './styles.ts';

export type ColumnProps = EditorProps;

/** One side of Columns: its parts, stacked. `min-w-0` lets long content shrink instead of widening the grid. */
export function Column(props: ColumnProps) {
  const { className, ...dom } = editorDomProps(props);
  return (
    <div {...dom} className={cx('min-w-0 space-y-3', className)}>
      {props.children}
    </div>
  );
}
