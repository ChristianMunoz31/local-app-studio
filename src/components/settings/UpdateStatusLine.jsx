import { useState } from 'react';
import { BTN } from './pillStyles';
import { useUpdateCheck } from '../../hooks/useUpdateCheck';

const LINE = 'mt-1.5 text-xs text-slate-slate300';
const SAFE_LINK_PREFIX = 'https://github.com/';

/** One status line for the opt-in update check. Never downloads or installs anything. */
export default function UpdateStatusLine({ enabled }) {
  const { status, isLoading, recheck } = useUpdateCheck({ enabled });
  const [rechecking, setRechecking] = useState(false);

  if (!enabled) return null;

  const again = async () => {
    if (rechecking) return;
    setRechecking(true);
    try {
      await recheck();
    } catch {
      // The line keeps showing the last result.
    } finally {
      setRechecking(false);
    }
  };

  if (isLoading || rechecking) {
    return (
      <p role="status" className={LINE}>
        Checking for updates...
      </p>
    );
  }

  if (status?.status === 'current') {
    return (
      <p role="status" className={LINE}>
        You have the latest version ({status.current}).
      </p>
    );
  }

  if (status?.status === 'available') {
    return (
      <p role="status" className={LINE}>
        Update available: version {status.latest}. You have {status.current}.{' '}
        {typeof status.url === 'string' && status.url.startsWith(SAFE_LINK_PREFIX) && (
          <a
            href={status.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            See what&apos;s new
          </a>
        )}
      </p>
    );
  }

  if (status?.status === 'unavailable' && status.reason === 'not_configured') {
    return (
      <p role="status" className={LINE}>
        Updates are not set up for this build.
      </p>
    );
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-3">
      <p role="status" className="text-xs text-slate-slate300">
        Couldn&apos;t check for updates right now.
      </p>
      <button type="button" onClick={again} className={BTN}>
        Check again
      </button>
    </div>
  );
}
