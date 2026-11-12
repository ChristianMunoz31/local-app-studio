import { useId, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import Modal from './Modal';
import { btnDanger, btnSecondary, formErrorClass } from './formStyles';

/**
 * Destructive-action confirmation built on Modal (role="alertdialog").
 * Rendered conditionally by the parent, which closes it after onConfirm resolves.
 */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Remove',
  onConfirm,
  onCancel,
  finalFocusRef,
}) {
  const messageId = useId();
  const cancelRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      await onConfirm();
    } catch (e) {
      setError(e?.message || 'Something went wrong');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={onCancel}
      size="sm"
      role="alertdialog"
      dismissible={!busy}
      initialFocusRef={cancelRef}
      finalFocusRef={finalFocusRef}
      describedBy={messageId}
    >
      <p id={messageId} className="text-sm text-slate-slate300">
        {message}
      </p>
      {error && (
        <p role="alert" className={`${formErrorClass} mt-3`}>
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 mt-4">
        <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy} className={btnSecondary}>
          Cancel
        </button>
        <button type="button" onClick={confirm} disabled={busy} className={btnDanger}>
          <Trash2 size={14} />
          {busy ? 'Removing…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
