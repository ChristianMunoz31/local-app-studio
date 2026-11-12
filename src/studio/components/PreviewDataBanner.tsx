// What happened to the Preview's records at the last start, and Reset preview data (with a confirm).
import { useState } from 'react';
import { btnSecondary } from '@/components/shared/formStyles.js';
import type { PreviewData, PreviewStatus } from '../types';
import StudioConfirm from './StudioConfirm';
import { HINT_CLASS } from './ui';

export interface PreviewDataBannerProps {
  status: PreviewStatus | null;
  appId: string;
  busy?: boolean;
  /** Resets the data; the hook shows a failure as the tab's alert. */
  onReset(): Promise<PreviewStatus | null | void>;
  /** The Reset preview data button, shown while the app runs. Default true. */
  showButton?: boolean;
  /** Controls the confirm from outside (the failed state opens it from its own button). */
  open?: boolean;
  onOpenChange?(open: boolean): void;
  /** The page already says what the note says (the made-from-example line carries it), so the note is not shown twice. */
  suppressNote?: boolean;
}

export const SAMPLE_ADDED = 'Sample records were added so you can try the app.';
const NOTES: Partial<Record<PreviewData['reason'], string>> = {
  tables_updated: 'Your table changes were applied. The records you added are kept.',
  tables_replaced: 'Preview data was cleared: a table change removed or changed fields in a way that cannot keep the records.',
  repaired: 'Preview data was cleared: the table update could not be applied.',
  reset: 'Preview data was reset.',
};
const SAMPLE_BACK = ' The sample records are back.';
const SEEDED_NOTES: Record<PreviewData['reason'], string> = {
  first_start: SAMPLE_ADDED,
  unchanged: '',
  tables_updated: '',
  tables_replaced: `${NOTES.tables_replaced}${SAMPLE_BACK}`,
  repaired: `${NOTES.repaired}${SAMPLE_BACK}`,
  reset: `${NOTES.reset}${SAMPLE_BACK}`,
};

export default function PreviewDataBanner({ status, appId, busy = false, onReset, showButton = true, open, onOpenChange, suppressNote = false }: PreviewDataBannerProps) {
  const [ownOpen, setOwnOpen] = useState(false);
  const confirming = open ?? ownOpen;
  const setConfirming = (next: boolean): void => {
    setOwnOpen(next);
    onOpenChange?.(next);
  };
  // A reset while this app is not the running one comes back as a status for another app (or none), so the note is kept here.
  const [resetDone, setResetDone] = useState(false);
  const data = status !== null && status.appId === appId ? status.data : null;
  const seeded = data !== null && (data.seeded ?? 0) > 0;
  const seededNote = data !== null && seeded ? SEEDED_NOTES[data.reason] : '';
  const shown = seededNote !== '' ? seededNote : data ? NOTES[data.reason] : undefined;
  const note = shown ?? (resetDone ? NOTES.reset : undefined);

  return (
    <div className="space-y-2" data-testid="preview-data-banner">
      <p className={HINT_CLASS}>Preview data stays on this computer, apart from any app you build.</p>
      {note && !suppressNote && (
        <p role="status" className="text-sm text-slate-slate300" data-testid="preview-data-note">
          {note}
        </p>
      )}
      {/* The ghost button keeps its padding (px-4), so -ml-4 lines its text up with the hint above it. */}
      {showButton && (
        <button type="button" className={`${btnSecondary} -ml-4`} disabled={busy} onClick={() => setConfirming(true)}>
          Reset preview data
        </button>
      )}
      {confirming && (
        <StudioConfirm
          title="Reset preview data?"
          message="Every record you added in Preview for this app is deleted. Your design and any app you built are not changed."
          confirmLabel="Reset preview data"
          busyLabel="Resetting..."
          cancelLabel="Keep the records"
          onConfirm={async () => {
            const answer = await onReset();
            // null is a failed reset (the tab shows the alert); anything else, the answer, means the data was cleared.
            if (answer !== null) setResetDone(true);
            setConfirming(false);
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
