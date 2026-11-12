import { Children } from 'react';
import { useCatalogData } from '../../../../../src/catalog/context.tsx';
import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import { EmptyLine, Notice } from './DataState.tsx';
import { menuEntries, navIcon, pageEntries } from './navItems.ts';
import { useNoticeAction } from './useNoticeAction.ts';
import { cx } from './styles.ts';

export interface NavLinksProps extends EditorProps {
  show?: 'menu' | 'pages';
  pages?: string[];
  direction?: 'horizontal' | 'vertical';
  icons?: 'show' | 'hide';
}

const LINK =
  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-brandLight';
const CURRENT = 'bg-accent-indigo/15 text-accent-indigo';
const OTHER = 'text-slate-slate300 hover:bg-slate-slate700/40 hover:text-slate-slate100';

/**
 * Links to the pages of the app: the menu pages, or the pages named in `pages`. Never a page that needs a record. Up to three
 * Button or Link children follow the page links as list items.
 */
export function NavLinks({ show = 'menu', pages, direction = 'horizontal', icons = 'show', ...rest }: NavLinksProps) {
  const { spec, pageId } = useCatalogData();
  const { run, notice } = useNoticeAction();
  const { className, ...dom } = editorDomProps(rest);
  const entries = show === 'pages' ? pageEntries(spec, pages) : menuEntries(spec);
  const extras = Children.toArray(rest.children);
  if (entries.length === 0 && extras.length === 0) {
    return (
      <div {...dom} className={className}>
        <EmptyLine text="No pages to show yet." />
      </div>
    );
  }
  return (
    <nav {...dom} aria-label="Page links" className={className}>
      <ul className={cx('flex gap-1', direction === 'vertical' ? 'flex-col items-start' : 'flex-row flex-wrap items-center')}>
        {entries.map((entry) => {
          const Icon = icons === 'hide' ? undefined : navIcon(entry.icon);
          const current = entry.pageId === pageId;
          return (
            <li key={entry.pageId}>
              <button
                type="button"
                aria-current={current ? 'page' : undefined}
                className={cx(LINK, current ? CURRENT : OTHER)}
                onClick={() => run({ action: 'navigate', pageId: entry.pageId, withRecord: false })}
              >
                {Icon && <Icon size={16} aria-hidden="true" />}
                {entry.label}
              </button>
            </li>
          );
        })}
        {extras.map((child, i) => (
          <li key={i}>{child}</li>
        ))}
      </ul>
      <Notice text={notice} />
    </nav>
  );
}
