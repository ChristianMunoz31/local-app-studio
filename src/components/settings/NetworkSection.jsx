import { useState } from 'react';
import { Globe } from 'lucide-react';
import SectionCard from '../shared/SectionCard';
import { sectionProps } from './settingsSections';
import { ListSkeleton } from '../shared/Skeleton';
import { BTN } from './pillStyles';
import { useNetworkSettings } from '../../hooks/useNetworkSettings';
import SwitchToggle from './SwitchToggle';
import UpdateStatusLine from './UpdateStatusLine';
import { PRODUCT_NAME_START, useHiddenNetworkFeatures } from '../../hooks/useHiddenNetworkFeatures';

function FeatureRow({ feature, onToggle }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const labelId = `network-${feature.id}-label`;
  const descId = `network-${feature.id}-desc`;

  const change = async (enabled) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onToggle(feature.id, enabled);
    } catch {
      setError("Couldn't save that change. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (feature.available === false) {
    return (
      <li className="py-3">
        <p id={labelId} className="text-sm font-semibold text-slate-slate100">
          {feature.label}
        </p>
        <p className="text-xs text-slate-slate400">
          Not in this build. This copy of the app contains no cloud provider.
        </p>
      </li>
    );
  }

  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p id={labelId} className="text-sm font-semibold text-slate-slate100">
            {feature.label}
          </p>
          <p id={descId} className="text-xs text-slate-slate400">
            {feature.description}
          </p>
          <p className="mt-0.5 text-xs text-slate-slate300">
            This calls the internet:{' '}
            <span className="font-mono">{(feature.hosts ?? []).join(', ')}</span>
          </p>
        </div>
        <SwitchToggle
          checked={feature.enabled === true}
          disabled={busy}
          labelledBy={labelId}
          describedBy={descId}
          onChange={change}
        />
      </div>
      {feature.id === 'updates' && feature.enabled === true && <UpdateStatusLine enabled />}
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-accent-amber">
          {error}
        </p>
      )}
    </li>
  );
}

export default function NetworkSection() {
  const { features, isLoading, refetch, setEnabled } = useNetworkSettings();
  // A built app leaves out the features it does not have (license activation, update checks) unless one is on; Studio shows them all.
  const hidden = useHiddenNetworkFeatures();

  return (
    <SectionCard
      {...sectionProps('network')}
      title="Network"
      subtitle={`${PRODUCT_NAME_START} makes no internet calls on its own. Each feature below is off until you turn it on.`}
      icon={Globe}
    >
      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : !features ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="text-sm text-accent-amber">
            Couldn&apos;t load network settings.
          </p>
          <button type="button" onClick={() => refetch()} className={BTN}>
            Retry
          </button>
        </div>
      ) : (
        <ul role="list" aria-label="Network features" className="divide-y divide-white/10">
          {features.filter((feature) => !hidden.includes(feature.id)).map((feature) => (
            <FeatureRow key={feature.id} feature={feature} onToggle={setEnabled} />
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
