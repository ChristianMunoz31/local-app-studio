import { SEED_FEATURES } from '@/catalog/features';
import type { FeatureDefinition } from '@/catalog/features';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import type { FeatureRecord } from '../../types';

export const recordOf = (def: FeatureDefinition, extra: Partial<FeatureRecord> = {}): FeatureRecord => ({
  id: def.id,
  label: def.label,
  description: def.description,
  version: def.version,
  updatedAt: def.updatedAt,
  createdAt: def.updatedAt,
  params: def.params,
  fragment: def.fragment,
  bindings: def.bindings,
  ok: true,
  issues: [],
  usedBy: { apps: [], features: [] },
  ...extra,
});

export const seedRecords = (): FeatureRecord[] => SEED_FEATURES.map((d) => recordOf(d));

export const node = (id: string, type: string, children: LayoutLayer['children'] = [], props: LayoutLayer['props'] = {}): LayoutLayer => ({
  id,
  type,
  props,
  children,
});
