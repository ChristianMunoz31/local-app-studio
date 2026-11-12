// Shared helpers of the builder tests: a bench document from a start, and a layer builder.
import { SEED_FEATURES, validateFeatureInput } from '@/catalog/features';
import type { FeatureLibrary } from '@/catalog/features';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import type { HostDoc } from '../../design/DesignSession';
import type { FeatureInput } from '../../types';
import { benchFromFeature } from '../bench';
import type { BenchStart } from '../bench';

export const layer = (id: string, type: string, props: LayoutLayer['props'] = {}, children: LayoutLayer['children'] = []): LayoutLayer => ({ id, type, props, children });

export const seedLibrary = (): FeatureLibrary => new Map(SEED_FEATURES.map((d) => [d.id, d]));

export const seedInput = (id: string): FeatureInput => {
  const def = SEED_FEATURES.find((d) => d.id === id);
  if (def === undefined) throw new Error(`no seed ${id}`);
  return { id: def.id, label: def.label, description: def.description, params: def.params, fragment: def.fragment, bindings: def.bindings };
};

/** The document of a bench: the canvas page's layout, its lists and the tables. */
export const docOf = (start: BenchStart): HostDoc => ({ root: start.spec.pages[0].layout, sources: start.spec.pages[0].sources, tables: start.spec.tables });

export const benchOfSeed = (id: string): BenchStart => benchFromFeature(seedInput(id), seedLibrary());

export const passes = (input: FeatureInput, library: FeatureLibrary): boolean => validateFeatureInput(input, library).ok;
