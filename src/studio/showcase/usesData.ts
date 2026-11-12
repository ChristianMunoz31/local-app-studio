// Whether a showcase entry draws rows from a table, so its tile can say "Sample data". Pure.
import { getPartDefinition } from '@/catalog/definitions';
import type { FeatureLibrary } from '@/catalog/features';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { dataBindOf } from '../lib/bindChoice';
import type { ShowcaseEntry } from './entries';

function holdsData(root: LayoutLayer): boolean {
  const stack: LayoutLayer[] = [root];
  for (let l = stack.pop(); l !== undefined; l = stack.pop()) {
    const def = getPartDefinition(l.type);
    if (def !== undefined && dataBindOf(def) !== null) return true;
    if (Array.isArray(l.children)) stack.push(...l.children);
  }
  return false;
}

/** A part entry whose definition has a data bind, or a feature whose fragment holds such a part anywhere. */
export function entryShowsData(entry: ShowcaseEntry, library: FeatureLibrary): boolean {
  if (entry.kind === 'part') {
    const def = getPartDefinition(entry.id);
    return def !== undefined && dataBindOf(def) !== null;
  }
  const feature = library.get(entry.id);
  return feature !== undefined && holdsData(feature.fragment);
}
