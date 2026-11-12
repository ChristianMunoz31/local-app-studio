import { buildShowcaseEntries } from '../showcase/entries';
import type { ShowcaseEntry } from '../showcase/entries';
import type { FeatureRecord } from '../types';

/**
 * Everything the shelf offers: the built-in parts and all the saved features, the same list as the Features page. A damaged
 * feature is listed (with Needs repair) but cannot be added: the shelf refuses it, so what is wrong is never hidden.
 */
export function shelfEntries(features: readonly FeatureRecord[]): ShowcaseEntry[] {
  return buildShowcaseEntries(features);
}
