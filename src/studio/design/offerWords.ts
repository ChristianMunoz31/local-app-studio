// The offer sentence of a part that no table fits. In the Feature builder a table is a slot, so the words say slot.
import { offerWords } from '../lib/bindOnDrop';
import type { ConnectOffer } from '../lib/bindOnDrop';

/** The refusal of a feature that already holds the most table slots. */
export const BUILDER_FULL = 'This feature already has the most table slots. Remove one first.';

export function offerWordsFor(offer: ConnectOffer, builder: boolean): string {
  if (builder && offer.kind === 'no_table') return 'This feature has no table slot yet.';
  if (builder && offer.kind === 'full') return BUILDER_FULL;
  return offerWords(offer);
}
