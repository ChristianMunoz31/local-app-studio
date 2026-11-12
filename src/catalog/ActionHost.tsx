// The dialogs behind the open-form and delete-record actions (docs/CATALOG.md, "Declarative actions"). Rendered by
// CatalogPageProvider. Delete always asks first through the kit ConfirmDialog; open-form shows a RecordFormView in a
// kit Modal. UI only.
import { useCallback } from 'react';
import { useCatalogData, useMutations, useRecordById, useTableDef } from './context.tsx';
import { ConfirmDialog, Modal, Skeleton } from '@local-app-studio/runtime/catalog/parts/kit.ts';
import { RecordFormView } from '@local-app-studio/runtime/catalog/parts/RecordFormView.tsx';

export type HostRequest =
  | { kind: 'form'; table: string; recordId: string | null }
  | { kind: 'delete'; table: string; recordId: string; thenPageId?: string };

function FormDialog({ table, recordId, onClose }: { table: string; recordId: string | null; onClose: () => void }) {
  const def = useTableDef(table);
  const { record, loading, error } = useRecordById(table, recordId);
  const label = def?.label ?? 'this table';
  const title = recordId === null ? `Add to ${label}` : `Edit record in ${label}`;
  return (
    <Modal title={title} onClose={onClose}>
      {recordId !== null && loading ? (
        <Skeleton className="h-24 w-full" />
      ) : recordId !== null && !record ? (
        <p role="alert" className="text-sm text-slate-slate300">
          {error ?? 'This record was not found. It may have been deleted.'}
        </p>
      ) : (
        <RecordFormView table={table} record={record} onSaved={onClose} onCancel={onClose} />
      )}
    </Modal>
  );
}

function DeleteDialog({ table, recordId, thenPageId, onClose }: { table: string; recordId: string; thenPageId?: string; onClose: () => void }) {
  const def = useTableDef(table);
  const { remove } = useMutations();
  const { navigate } = useCatalogData();
  const confirm = useCallback(async () => {
    await remove(table, recordId);
    onClose();
    if (thenPageId) navigate?.(thenPageId, { withRecord: false });
  }, [remove, table, recordId, thenPageId, navigate, onClose]);
  return (
    <ConfirmDialog
      title="Delete record"
      message={`Delete this record from ${def?.label ?? 'the table'}? This cannot be undone.`}
      confirmLabel="Delete"
      onConfirm={confirm}
      onCancel={onClose}
    />
  );
}

/** Shows the dialog for one open-form or delete-record request. */
export function ActionHost({ request, onClose }: { request: HostRequest; onClose: () => void }) {
  return request.kind === 'form' ? (
    <FormDialog table={request.table} recordId={request.recordId} onClose={onClose} />
  ) : (
    <DeleteDialog table={request.table} recordId={request.recordId} thenPageId={request.thenPageId} onClose={onClose} />
  );
}
