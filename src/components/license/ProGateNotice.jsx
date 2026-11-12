import { useEntitlements } from '../../hooks/useEntitlements';
import ProTrialPrompt from './ProTrialPrompt';
import BuyProLink from './BuyProLink';

/**
 * The prompt for a Pro action the user just tried without Pro. Renders nothing while the status
 * is unknown or Pro is on. When the trial prompt has nothing to offer (for example a clock
 * issue), a plain sentence keeps the attempt from failing silently.
 */
export default function ProGateNotice({ capability, className = '' }) {
  const { known, pro, trial } = useEntitlements();
  if (!known || pro) return null;
  if (trial?.state === 'available' || trial?.state === 'ended') {
    return <ProTrialPrompt capability={capability} className={className} />;
  }
  return (
    <div data-capability={capability} className={`glass-subtle rounded-lg p-3 text-sm text-slate-slate300 ${className}`.trim()}>
      <p>
        This is a Local App Studio Pro feature. Activate a license in Settings &gt; License. Your data and everything in Local App Studio
        Free keep working.
      </p>
      <div className="mt-2 flex">
        <BuyProLink />
      </div>
    </div>
  );
}
