import { Children } from 'react';
import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import { GAP_CLASS, pickClass } from './layoutClasses.ts';
import { cx } from './styles.ts';

// Below md everything stacks in one column. From md the template depends on the layout and on how many columns there are
// (2 to 4; a fifth or later column wraps into the next row of the four-column template).
const TEMPLATE = {
  equal: {
    1: 'grid-cols-1',
    2: 'grid-cols-1 md:grid-cols-2',
    3: 'grid-cols-1 md:grid-cols-3',
    4: 'grid-cols-1 md:grid-cols-4',
  },
  'wide-left': {
    1: 'grid-cols-1',
    2: 'grid-cols-1 md:grid-cols-[2fr_1fr]',
    3: 'grid-cols-1 md:grid-cols-[2fr_1fr_1fr]',
    4: 'grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr]',
  },
  'wide-right': {
    1: 'grid-cols-1',
    2: 'grid-cols-1 md:grid-cols-[1fr_2fr]',
    3: 'grid-cols-1 md:grid-cols-[1fr_1fr_2fr]',
    4: 'grid-cols-1 md:grid-cols-[1fr_1fr_1fr_2fr]',
  },
  'sidebar-left': {
    1: 'grid-cols-1',
    2: 'grid-cols-1 md:grid-cols-[minmax(12rem,1fr)_3fr]',
    3: 'grid-cols-1 md:grid-cols-[minmax(12rem,1fr)_3fr_3fr]',
    4: 'grid-cols-1 md:grid-cols-[minmax(12rem,1fr)_3fr_3fr_3fr]',
  },
  'sidebar-right': {
    1: 'grid-cols-1',
    2: 'grid-cols-1 md:grid-cols-[3fr_minmax(12rem,1fr)]',
    3: 'grid-cols-1 md:grid-cols-[3fr_3fr_minmax(12rem,1fr)]',
    4: 'grid-cols-1 md:grid-cols-[3fr_3fr_3fr_minmax(12rem,1fr)]',
  },
} as const;

const ALIGN_CLASS = { top: 'items-start', center: 'items-center', stretch: 'items-stretch' } as const;

export interface ColumnsProps extends EditorProps {
  layout?: string;
  gap?: string;
  align?: string;
}

/** The grid template for a layout and a column count (fewer than 2 is one column, more than 4 wraps the four-column template). */
function template(layout: string, count: number): string {
  const row = Object.hasOwn(TEMPLATE, layout) ? TEMPLATE[layout as keyof typeof TEMPLATE] : TEMPLATE.equal;
  return row[Math.min(4, Math.max(1, count)) as 1 | 2 | 3 | 4];
}

/** Column parts side by side on a grid. Defaults equal the zod defaults of Columns.def.ts. */
export function Columns({ layout = 'equal', gap = 'md', align = 'top', ...rest }: ColumnsProps) {
  const { className, ...dom } = editorDomProps(rest);
  const count = Children.toArray(rest.children).length;
  return (
    <div {...dom} className={cx('grid', template(layout, count), pickClass(GAP_CLASS, gap, 'md'), pickClass(ALIGN_CLASS, align, 'top'), className)}>
      {rest.children}
    </div>
  );
}
