import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { copyFromStable, getStableCopyStatus } from '../../services/backupService';
import { formatBackupDate } from '../../utils/backupFormat';
import BackupRestoreConfirm from './BackupRestoreConfirm';
import { BTN } from './pillStyles';

const INTRO =
  'Local App Studio Dev keeps its own data, separate from Local App Studio. You can copy your Local App Studio data into Local App Studio Dev to test with it. This is one-way: Local App Studio Dev never changes your Local App Studio data, and changes you make here stay in Local App Studio Dev.';
const NOT_FOUND = 'No Local App Studio data was found on this computer, so there is nothing to copy.';
const BUSY = 'Local App Studio is restoring a backup right now. Try again when it finishes.';
const SAME_FOLDER = 'Local App Studio Dev is using the same data folder as Local App Studio, so there is nothing to copy.';
const QUESTION =
  'Replace the data in Local App Studio Dev with a copy of your Local App Studio data? Local App Studio Dev makes a safety backup of its current data first. Your Local App Studio data is not changed. Saved API keys are not copied, for your safety. Re-enter them in Local App Studio Dev if you need them.';
const UNSURE = 'Local App Studio Dev may have copied your data. Reload Local App Studio Dev to check.';
const FAILED = 'The copy did not work. Local App Studio Dev was not changed, and your Local App Studio data was not touched.';
const STATUS_KEY = ['backups', 'stable-copy'];

function foundText({ dataDir, lastChangedAt, overridden }) {
  const changed = formatBackupDate(lastChangedAt);
  return `Local App Studio data found in ${dataDir}.${changed ? ` Last changed ${changed}.` : ''}${overridden ? ' (custom test folder)' : ''}`;
}

/** Local App Studio Dev only: copy the Local App Studio data into this Dev app, after a confirmation. */
export default function CopyFromStableControl() {
  const headingId = useId();
  const [confirming, setConfirming] = useState(false);
  const triggerRef = useRef(null);
  const wasConfirming = useRef(false);
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => getStableCopyStatus(),
    retry: false,
    refetchOnWindowFocus: false,
    gcTime: 0,
  });

  // Return focus to the trigger once the confirmation closes (not on first mount).
  useEffect(() => {
    if (wasConfirming.current && !confirming) triggerRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  const open = () => {
    setConfirming(true);
    refetch();
  };
  const cancel = () => setConfirming(false);
  const onFailed = (e) => {
    if (e?.code === 'stable_busy') refetch();
  };

  let body = null;
  if (isLoading) {
    body = <p className="mt-3 text-xs text-slate-slate400">Looking for your Local App Studio data…</p>;
  } else if (error && !data) {
    body = (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <p role="alert" className="text-xs text-accent-amber">
          {error.message || 'Could not check for your Local App Studio data.'}
        </p>
        <button
          type="button"
          onClick={() => {
            if (!isRefetching) refetch();
          }}
          aria-disabled={isRefetching}
          className={BTN}
        >
          Try again
        </button>
      </div>
    );
  } else if (data?.sameFolder) {
    body = <p className="mt-3 text-xs text-slate-slate400">{SAME_FOLDER}</p>;
  } else if (data?.busy) {
    body = <p className="mt-3 text-xs text-slate-slate400">{BUSY}</p>;
  } else if (data && !data.found) {
    body = <p className="mt-3 text-xs text-slate-slate400">{NOT_FOUND}</p>;
  } else if (data) {
    body = (
      <>
        <p className="mt-3 text-xs text-slate-slate300">{foundText(data)}</p>
        <div className="mt-3">
          {confirming ? (
            <BackupRestoreConfirm
              question={QUESTION}
              run={copyFromStable}
              confirmLabel="Copy and replace"
              busyLabel="Copying…"
              groupLabel="Confirm copy"
              busyStatus="Copying your Local App Studio data."
              doneStatus="Copied. Reloading Local App Studio Dev."
              onCancel={cancel}
              unsureMessage={UNSURE}
              failedMessage={FAILED}
              onFailed={onFailed}
            />
          ) : (
            <button
              ref={triggerRef}
              type="button"
              onClick={open}
              className={BTN}
            >
              Copy my data from Local App Studio
            </button>
          )}
        </div>
      </>
    );
  }

  return (
    <section aria-labelledby={headingId}>
      <h4 id={headingId} className="text-sm font-semibold text-slate-slate100">
        Copy my data from Local App Studio
      </h4>
      <p className="mt-1 text-xs text-slate-slate400">{INTRO}</p>
      {body}
    </section>
  );
}
