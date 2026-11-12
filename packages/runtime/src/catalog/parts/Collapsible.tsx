import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useIsLive } from '../../../../../src/catalog/context.tsx';
import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import { cx } from './styles.ts';

export interface CollapsibleProps extends EditorProps {
  title?: string;
  start?: 'closed' | 'open';
}

/** A titled block that opens and closes. Where the page is not live (the canvas, previews) it is always open. */
export function Collapsible({ title = '', start = 'closed', ...rest }: CollapsibleProps) {
  const { className, ...dom } = editorDomProps(rest);
  const live = useIsLive();
  const uid = useId();
  const [openNow, setOpenNow] = useState(start === 'open');
  const open = !live || openNow;
  return (
    <div {...dom} className={cx('rounded-lg border border-slate-slate700/60', className)}>
      <button
        type="button"
        id={`${uid}-button`}
        aria-expanded={open}
        aria-controls={`${uid}-region`}
        onClick={() => live && setOpenNow((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-semibold text-slate-slate100 hover:bg-slate-slate700/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-brandLight"
      >
        <span className="min-w-0 font-[family-name:var(--font-display)] tracking-tight">{title}</span>
        <ChevronDown size={16} aria-hidden="true" className={cx('shrink-0 text-slate-slate400 transition-transform', open && 'rotate-180')} />
      </button>
      <div id={`${uid}-region`} role="region" aria-labelledby={`${uid}-button`} hidden={!open} className="space-y-3 px-4 pb-4">
        {rest.children}
      </div>
    </div>
  );
}
