import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import Modal from '@/components/shared/Modal.jsx';
import { btnDanger, btnPrimary, btnSecondary, formErrorClass } from '@/components/shared/formStyles.js';

export interface StudioConfirmProps {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  busyLabel: string;
  cancelLabel: string;
  /** Default danger. */
  tone?: 'danger' | 'primary';
  /** Default cancel. */
  initialFocus?: 'cancel' | 'confirm';
  /** A rejection shows its message, or the fallback line. */
  onConfirm(): Promise<void> | void;
  onCancel(): void;
  finalFocusRef?: RefObject<HTMLElement | null>;
}

const FALLBACK = 'That did not work. Nothing was changed. Try again.';

/** Studio's own confirm: the kit ConfirmDialog has no busy or cancel label. Rendered while open. */
export default function StudioConfirm({
  title,
  message,
  confirmLabel,
  busyLabel,
  cancelLabel,
  tone = 'danger',
  initialFocus = 'cancel',
  onConfirm,
  onCancel,
  finalFocusRef,
}: StudioConfirmProps) {
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The confirm button was disabled while busy, which dropped focus; a failure puts it back on the button to try again.
  useEffect(() => {
    if (error !== '') confirmRef.current?.focus();
  }, [error]);

  const confirm = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      await onConfirm();
    } catch (e) {
      if (mounted.current) setError(e instanceof Error && e.message !== '' ? e.message : FALLBACK);
    }
    if (mounted.current) setBusy(false);
  };

  return (
    <Modal
      title={title}
      onClose={onCancel}
      size="sm"
      role="alertdialog"
      dismissible={!busy}
      initialFocusRef={initialFocus === 'confirm' ? confirmRef : cancelRef}
      finalFocusRef={finalFocusRef}
      describedBy={messageId}
    >
      <p id={messageId} className="text-sm text-slate-slate300">
        {message}
      </p>
      {error !== '' && (
        <p role="alert" className={`${formErrorClass} mt-3`}>
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy} className={btnSecondary}>
          {cancelLabel}
        </button>
        <button ref={confirmRef} type="button" onClick={() => void confirm()} disabled={busy} className={tone === 'danger' ? btnDanger : btnPrimary}>
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
