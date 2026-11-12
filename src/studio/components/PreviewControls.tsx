// The Studio preview's plain-words state line, with Restart and Stop tucked into a small "Preview options" menu.
// Start is automatic (PreviewTab); Try again and Start preview appear only after a failure or a Stop.
import { Loader2 } from 'lucide-react';
import { btnSecondary } from '@/components/shared/formStyles.js';
import type { PreviewStatus } from '../types';
import { HINT_CLASS } from './ui';

export interface PreviewControlsProps {
  /** Null when Studio could not read the preview status. */
  status: PreviewStatus | null;
  /** The app this tab belongs to. */
  appId: string;
  busy?: boolean;
  onStart(): void;
  onRestart(): void;
  onStop(): void;
  /** Opens the Reset preview data question (offered after a failed start). */
  onReset(): void;
}

const COULD_NOT_START = 'The preview could not start.';

/** The server's words after the lead sentence, or null when the message only repeats it ("The preview could not start. Try again."). */
function reasonOf(message: string | null): string | null {
  const text = message?.trim() ?? '';
  if (text === '' || text.startsWith(COULD_NOT_START)) return null;
  return text;
}

export default function PreviewControls({ status, appId, busy = false, onStart, onRestart, onStop, onReset }: PreviewControlsProps) {
  if (status === null) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p role="status" className="text-sm font-medium text-slate-slate100">
          Studio could not check the preview. Press Try again.
        </p>
        <button type="button" className={btnSecondary} onClick={onStart} disabled={busy}>
          Try again
        </button>
      </div>
    );
  }

  const mine = status.appId === appId;
  const activeMine = mine && (status.state === 'running' || status.state === 'starting');
  const failedMine = mine && status.state === 'failed';
  const startingNow = status.state === 'starting' || (busy && !activeMine) || (status.state === 'running' && !mine);

  if (failedMine && !startingNow) {
    const reason = reasonOf(status.message);
    return (
      <div className="space-y-2">
        <p role="status" className="text-sm font-medium text-slate-slate100">
          <span>{COULD_NOT_START}</span>
          {reason !== null && <span>{` ${reason}`}</span>}
        </p>
        <p className={HINT_CLASS}>Try again. If it fails again, reset the preview data: it deletes the records you added in Preview. Your design is not changed.</p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={btnSecondary} onClick={onStart} disabled={busy}>
            Try again
          </button>
          <button type="button" className={btnSecondary} onClick={onReset} disabled={busy}>
            Reset preview data
          </button>
        </div>
      </div>
    );
  }

  let line: string;
  if (startingNow) line = 'Starting your app...';
  else if (activeMine) line = 'Your app is running.';
  else line = 'The preview is stopped.';

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span role="status" className="flex items-center gap-2 text-sm font-medium text-slate-slate100">
        {startingNow && <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
        {line}
      </span>
      {!startingNow && !activeMine && (
        <button type="button" className={btnSecondary} onClick={onStart} disabled={busy}>
          Start preview
        </button>
      )}
      {activeMine && (
        <details className="ml-auto">
          <summary className={`${btnSecondary} cursor-pointer`}>Preview options</summary>
          <div className="mt-2 flex items-center gap-2">
            <button type="button" className={btnSecondary} onClick={onRestart} disabled={busy}>
              Restart
            </button>
            <button type="button" className={btnSecondary} onClick={onStop} disabled={busy}>
              Stop
            </button>
          </div>
        </details>
      )}
    </div>
  );
}
