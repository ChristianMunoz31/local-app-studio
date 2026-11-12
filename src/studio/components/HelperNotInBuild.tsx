// What stands in the helper's place in a build that does not contain it (docs/ARCHITECTURE.md, 'The pro seam'): one plain line and
// one button to the way that works without it. The Prompt step and the Apps start card use it; each says where the button goes.
import StudioSectionCard from './StudioSectionCard';
import { btnPrimary } from '@/components/shared/formStyles.js';

export const HELPER_NOT_IN_BUILD = 'The helper is not in this build. Build it yourself in Design.';
export const BUILD_IT_YOURSELF = 'Build it yourself';
export const START_BLANK_INSTEAD = 'Start a blank app instead';

interface Props {
  /** The button's words. */
  actionLabel: string;
  onAction(): void;
  /** A region name: wraps the card in a section with this aria-label (where the page has no heading of its own for it). */
  label?: string;
}

export default function HelperNotInBuild({ actionLabel, onAction, label }: Props) {
  const card = (
    <StudioSectionCard>
      <div className="space-y-3">
        <p className="text-sm text-slate-slate200">{HELPER_NOT_IN_BUILD}</p>
        <div>
          <button type="button" className={btnPrimary} onClick={onAction}>
            {actionLabel}
          </button>
        </div>
      </div>
    </StudioSectionCard>
  );
  return label === undefined ? card : <section aria-label={label}>{card}</section>;
}
