import type { NavigateAction } from '../../../../../src/catalog/actions.ts';
import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import { Notice } from './DataState.tsx';
import { useNoticeAction } from './useNoticeAction.ts';
import { cx } from './styles.ts';

export interface LinkProps extends EditorProps {
  action?: NavigateAction;
}

/** A text link to another page of the app. It runs a navigate action; there are no web addresses. */
export function Link({ action, ...rest }: LinkProps) {
  const { run, notice } = useNoticeAction();
  const { className, ...dom } = editorDomProps(rest);
  return (
    <span {...dom} className={cx('inline-flex items-center gap-2', className)}>
      <button
        type="button"
        className="rounded-sm text-sm text-accent-indigo underline underline-offset-2 hover:opacity-80 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-brandLight"
        onClick={() => action && run(action)}
      >
        {rest.children}
      </button>
      <Notice text={notice} />
    </span>
  );
}
