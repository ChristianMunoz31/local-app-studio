import type { NavigateAction } from '../../../../../src/catalog/actions.ts';
import { useIsLive, useRecord, useSourceInfo } from '../../../../../src/catalog/context.tsx';
import { EmptyLine, ErrorLine, LoadingLines, Notice } from './DataState.tsx';
import { useNoticeAction } from './useNoticeAction.ts';
import { editorDomProps } from './editorProps.ts';
import type { EditorProps } from './editorProps.ts';
import { RecordFormView } from './RecordFormView.tsx';
import { cx } from './styles.ts';

export interface RecordFormProps extends EditorProps {
  table?: string;
  mode?: 'create' | 'edit';
  source?: string;
  fields?: string[];
  submitLabel?: string;
  afterSave?: NavigateAction;
}

/** A form to add a record (create) or change the page's record (edit). afterSave can go to another page. */
export function RecordForm({ table = '', mode = 'create', source, fields, submitLabel, afterSave, ...rest }: RecordFormProps) {
  const { className, ...dom } = editorDomProps(rest);
  const info = useSourceInfo(source ?? '');
  // Where the page is not live (no navigate: the designer canvas, Features library tiles and drawer, Feature builder previews) the form shows no button and never writes; the toolbar's Save is the only one on the canvas.
  const hideSubmit = !useIsLive();
  const { record, loading, error } = useRecord(source ?? '');
  const { run, notice } = useNoticeAction();
  const onSaved = (row: Record<string, unknown>): void => {
    if (afterSave) run(afterSave, { table, id: String(row.id) });
  };

  let body;
  if (mode === 'edit') {
    if (!source) body = <EmptyLine text="This form needs a record to change." />;
    else if (!info) body = <p className="text-sm text-slate-slate400">Form to change the record of &quot;{source}&quot;</p>;
    else if (error && !record) body = <ErrorLine message={error} />;
    else if (loading && !record) body = <LoadingLines />;
    else if (!record) body = <EmptyLine text="This record was not found. It may have been deleted." />;
    else body = <RecordFormView key={String(record.id)} table={table} record={record} fields={fields} submitLabel={submitLabel} hideSubmit={hideSubmit} onSaved={onSaved} />;
  } else {
    body = <RecordFormView table={table} fields={fields} submitLabel={submitLabel} hideSubmit={hideSubmit} onSaved={onSaved} />;
  }
  return (
    <div {...dom} className={cx('space-y-2', className)}>
      {body}
      <Notice text={notice} />
    </div>
  );
}
