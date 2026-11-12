// The line under the Data connections list: tables nothing adds to, and one press that adds a way in (menu button or Form).
import { btnSecondary } from '@/components/shared/formStyles.js';
import { HINT_CLASS } from '../components/ui';
import { ADD_WAY_IN, noWayInLine } from '../lib/waysIn';
import type { WayInGap } from '../lib/waysIn';

interface Props {
  gaps: readonly WayInGap[];
  onAdd(): void;
}

export default function WaysInLine({ gaps, onAdd }: Props) {
  if (gaps.length === 0) return null;
  return (
    <div data-ways-in className="flex flex-wrap items-center gap-3">
      <p className={HINT_CLASS}>{noWayInLine(gaps)}</p>
      <button type="button" className={btnSecondary} onClick={onAdd}>
        {ADD_WAY_IN}
      </button>
    </div>
  );
}
