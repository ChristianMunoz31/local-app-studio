// Inline switch for the "App builds" network feature. Same route and state as Settings, Network.
import { useState } from 'react';
import SwitchToggle from '@/components/settings/SwitchToggle.jsx';
import { btnSecondary } from '@/components/shared/formStyles.js';
import { useNetworkSettings } from '@/hooks/useNetworkSettings.js';
import { HINT_CLASS, SUMMARY_CLASS } from './ui';

const DETAILS_LABEL = 'Details';
/** Read out after the visible word, so two Details on one step can be told apart. */
const DETAILS_HIDDEN = ' about the sites a build contacts';
const FEATURE_ID = 'build';
const LABEL_ID = 'build-optin-label';
const DESC_ID = 'build-optin-desc';

/** "a", "a and b", "a, b and c". */
const joinList = (parts: string[]): string => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

export default function BuildOptInSwitch() {
  const { features, isLoading, refetch, setEnabled } = useNetworkSettings();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (isLoading) return null;
  if (features === null) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p role="alert" className="text-sm text-accent-amber">
          Could not load the internet settings.
        </p>
        <button type="button" className={btnSecondary} onClick={() => void refetch()}>
          Try again
        </button>
      </div>
    );
  }
  const feature = features.find((f) => f.id === FEATURE_ID);
  if (feature === undefined || feature.available === false) return null;

  const hosts = feature.hosts ?? [];

  const change = async (next: boolean): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await setEnabled(FEATURE_ID, next);
    } catch {
      setError('Could not save that change. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p id={LABEL_ID} className="text-sm font-semibold text-slate-slate100">
            {feature.label}
          </p>
          <p id={DESC_ID} className={HINT_CLASS}>
            {feature.description}
          </p>
        </div>
        <SwitchToggle checked={feature.enabled === true} disabled={busy} labelledBy={LABEL_ID} describedBy={DESC_ID} onChange={(next) => void change(next)} />
      </div>
      {hosts.length > 0 && (
        <details>
          <summary className={SUMMARY_CLASS}>
            {DETAILS_LABEL}
            <span className="sr-only">{DETAILS_HIDDEN}</span>
          </summary>
          <p className="mt-1 text-sm text-slate-slate300">{`It contacts: ${joinList(hosts)}.`}</p>
        </details>
      )}
      <p className={HINT_CLASS}>You can also change this in Settings, Network.</p>
      {error !== '' && (
        <p role="alert" className="text-xs text-accent-amber">
          {error}
        </p>
      )}
    </div>
  );
}
