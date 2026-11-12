import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import { cx } from './styles.ts';

const WIDTH_CLASS = { narrow: 'max-w-2xl', normal: 'max-w-4xl', wide: 'max-w-6xl' } as const;

export interface PageProps extends EditorProps {
  width?: keyof typeof WIDTH_CLASS;
}

/** The top of a page: a centered column of parts. */
export function Page({ width = 'normal', ...rest }: PageProps) {
  const { className, ...dom } = editorDomProps(rest);
  return (
    <div {...dom} className={cx('mx-auto w-full space-y-5 p-4 sm:p-6', WIDTH_CLASS[width], className)}>
      {rest.children}
    </div>
  );
}
