import { fieldInfo, useRecord, useSourceInfo, useTableDef } from '../../../../../src/catalog/context.tsx';
import { useCellText } from './cells.ts';
import { EmptyLine, ErrorLine, LoadingLines } from './DataState.tsx';
import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import { cx } from './styles.ts';

export interface RecordDetailProps extends EditorProps {
  source?: string;
  fields?: string[];
}

/** The fields of the page's record (record source) as a list of label and value. */
export function RecordDetail({ source = '', fields, ...rest }: RecordDetailProps) {
  const { className, ...dom } = editorDomProps(rest);
  const info = useSourceInfo(source);
  const table = useTableDef(info?.table ?? null);
  const { record, loading, error } = useRecord(source);
  const ids = (fields ?? table?.fields.map((f) => f.id) ?? []).filter((id) => fieldInfo(table, id) !== null);
  const cellText = useCellText(table, record ? [record] : [], ids);

  let body;
  if (!info || !table) {
    body = <p className="text-sm text-slate-slate400">Details of the record of &quot;{source}&quot;</p>;
  } else if (error && !record) {
    body = <ErrorLine message={error} />;
  } else if (loading && !record) {
    body = <LoadingLines />;
  } else if (!record) {
    body = <EmptyLine text="This record was not found. It may have been deleted." />;
  } else {
    body = (
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {ids.map((id) => (
          <div key={id} className="min-w-0">
            <dt className="text-xs font-medium text-slate-slate400">{fieldInfo(table, id)?.label}</dt>
            <dd className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-slate100">{cellText(record, id) || '-'}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <div {...dom} className={cx('space-y-2', className)}>
      {body}
    </div>
  );
}
