import { ArrowLeft } from 'lucide-react';
import type { NavigateAction } from '../../../../../src/catalog/actions.ts';
import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import { Notice } from './DataState.tsx';
import { useNoticeAction } from './useNoticeAction.ts';
import { cx } from './styles.ts';

export interface BackLinkProps extends EditorProps {
  action?: NavigateAction;
}

/** One link with an arrow that goes to another page of the app. A refusal ("Open a record first.") shows beside it. */
export function BackLink({ action, ...rest }: BackLinkProps) {
  const { run, notice } = useNoticeAction();
  const { className, ...dom } = editorDomProps(rest);
  return (
    <span {...dom} className={cx('inline-flex items-center gap-2', className)}>
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-sm text-sm text-accent-indigo underline underline-offset-2 hover:opacity-80 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-brandLight"
        onClick={() => action && run(action)}
      >
        <ArrowLeft size={14} aria-hidden="true" />
        {rest.children}
      </button>
      <Notice text={notice} />
    </span>
  );
}
