// What the canvas draws for a data part that has no table yet (a drop that needs a choice). The part itself is not drawn.
// The box starts with the indicator pill ("Needs a table", "Needs a yes or no field"), then the one-click offers: Connect when a
// table fits, New table when the app has none, Add a field when a table could take the field the part needs. In the Feature
// builder the same offers say slot (the host swaps the dialogs behind the same three callbacks).
import { btnSecondary } from '@/components/shared/formStyles.js';
import { MSG, OFFER } from '../lib/bindOnDrop';
import { offerWordsFor } from './offerWords';
import ConnectionBadge from './ConnectionBadge';
import type { PartIndicator } from './indicator';

interface Props {
  partName: string;
  /** A needs_table or needs_field indicator. */
  indicator: Extract<PartIndicator, { state: 'needs_table' | 'needs_field' }>;
  /** True in the Feature builder: the offers say slot. */
  builder?: boolean;
  onConnect(): void;
  onNewTable(): void;
  onAddField(): void;
}

function hintOf(indicator: Props['indicator'], builder: boolean): string | null {
  if (indicator.state !== 'needs_table' || indicator.offer === null) return null;
  if (indicator.offer.kind === 'full') return builder ? offerWordsFor(indicator.offer, true) : MSG.full;
  return builder ? 'This feature has no table slot yet.' : OFFER.noTable;
}

export default function NotConnected({ partName, indicator, builder = false, onConnect, onNewTable, onAddField }: Props) {
  const stop =
    (act: () => void) =>
    (e: { stopPropagation(): void }): void => {
      e.stopPropagation();
      act();
    };
  const hint = hintOf(indicator, builder);
  const full = indicator.state === 'needs_table' && indicator.offer !== null && indicator.offer.kind === 'full';
  const connect = indicator.state === 'needs_table' && indicator.offer === null;
  const tables = indicator.state === 'needs_field' ? indicator.tables : [];
  return (
    <div data-not-connected="" className="flex flex-wrap items-center gap-3 rounded-md border border-dashed border-slate-slate500 p-4 text-sm text-slate-slate300">
      <ConnectionBadge indicator={indicator} />
      {hint !== null && <span>{hint}</span>}
      {connect && (
        <button type="button" className={btnSecondary} aria-label={`Connect ${partName} to a table`} onClick={stop(onConnect)}>
          Connect
        </button>
      )}
      {!connect && !full && (
        <>
          {tables.length > 0 && (
            <button type="button" className={btnSecondary} aria-label={builder ? `Add a field slot for ${partName}` : `Add a field for ${partName}`} onClick={stop(onAddField)}>
              {builder ? 'Add a field slot' : 'Add a field'}
            </button>
          )}
          <button type="button" className={btnSecondary} aria-label={builder ? `Add a table slot for ${partName}` : `Make a new table for ${partName}`} onClick={stop(onNewTable)}>
            {builder ? 'Add a table slot' : 'New table'}
          </button>
        </>
      )}
    </div>
  );
}
