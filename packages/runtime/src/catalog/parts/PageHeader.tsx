import { Children } from 'react';
import type { IconName } from '../../../../../src/catalog/enums.ts';
import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import { PART_ICONS } from './icons.ts';
import { cx } from './styles.ts';

export interface PageHeaderProps extends EditorProps {
  title?: string;
  subtitle?: string;
  icon?: IconName;
}

/** A page title with an optional subtitle, and up to three Buttons beside it (stacked under it on a narrow screen). */
export function PageHeader({ title, subtitle, icon, ...rest }: PageHeaderProps) {
  const { className, ...dom } = editorDomProps(rest);
  const Icon = icon ? PART_ICONS[icon] : undefined;
  const hasButtons = Children.toArray(rest.children).length > 0;
  return (
    <div {...dom} className={cx('flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="flex min-w-0 items-start gap-2">
        {Icon && <Icon size={22} className="mt-1 shrink-0 text-slate-slate400" aria-hidden="true" />}
        <div className="min-w-0">
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-slate-slate100">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-slate-slate400">{subtitle}</p>}
        </div>
      </div>
      {hasButtons && <div className="flex flex-wrap items-center gap-2">{rest.children}</div>}
    </div>
  );
}
