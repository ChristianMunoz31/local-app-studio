import { useCatalogData, useRecord, useSourceInfo, useTableDef } from '../../../../../src/catalog/context.tsx';
import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import { titleFieldOf } from './format.ts';
import { pageEntries } from './navItems.ts';
import { useNoticeAction } from './useNoticeAction.ts';
import { Notice } from './DataState.tsx';

export interface BreadcrumbProps extends EditorProps {
  page?: string;
  source?: string;
}

const CRUMB = 'rounded-sm text-sm text-accent-indigo underline underline-offset-2 hover:opacity-80 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-brandLight';

/** Shows where you are: a link back to a list page, then the title of the record (or of the current page). */
export function Breadcrumb({ page, source, ...rest }: BreadcrumbProps) {
  const { spec, pageId } = useCatalogData();
  const { run, notice } = useNoticeAction();
  const sourceInfo = useSourceInfo(source ?? '');
  const table = useTableDef(sourceInfo?.table ?? null);
  const { record } = useRecord(source ?? '');
  const { className, ...dom } = editorDomProps(rest);
  const titleOf = (id: string | undefined): string | undefined => spec?.pages?.find((p) => p.id === id)?.title;
  const listTitle = titleOf(page) ?? page ?? '';
  const field = table === null ? null : titleFieldOf(table);
  const value = record !== null && field !== null ? record[field] : undefined;
  const recordTitle = typeof value === 'string' && value.trim() !== '' ? value : typeof value === 'number' ? String(value) : undefined;
  const currentTitle = recordTitle ?? titleOf(pageId) ?? '';
  // A list page that needs a record has no link (the schema refuses it; stored data may still hold one).
  const linkable = page !== undefined && pageEntries(spec, [page]).length > 0;
  const sameAsCurrent = page !== undefined && page === pageId && recordTitle === undefined;
  return (
    <nav {...dom} aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {!sameAsCurrent && listTitle !== '' && (
          <li className="flex items-center gap-2">
            {linkable ? (
              <button type="button" className={CRUMB} onClick={() => page && run({ action: 'navigate', pageId: page, withRecord: false })}>
                {listTitle}
              </button>
            ) : (
              <span className="text-slate-slate300">{listTitle}</span>
            )}
            <span aria-hidden="true" className="text-slate-slate500">
              /
            </span>
          </li>
        )}
        <li aria-current="page" className="font-medium text-slate-slate100">
          {sameAsCurrent ? listTitle : currentTitle}
        </li>
      </ol>
      <Notice text={notice} />
    </nav>
  );
}
