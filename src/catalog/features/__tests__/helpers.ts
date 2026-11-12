// Shared test data for the feature library tests.
import type { FeatureBody, FeatureDefinition, FeatureLibrary } from '../types.ts';
import { SEED_FEATURES } from '../seeds.ts';

export const seedLib = (): Map<string, FeatureDefinition> => new Map(SEED_FEATURES.map((d) => [d.id, d]));

export const defOf = (id: string, body: FeatureBody, extra: Partial<FeatureDefinition> = {}): FeatureDefinition => ({
  id,
  label: id,
  description: `The ${id} feature.`,
  version: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...body,
  ...extra,
});

export const libOf = (...defs: FeatureDefinition[]): FeatureLibrary => new Map(defs.map((d) => [d.id, d]));

/** A one-text-param feature: Heading with its text bound. */
export const headingBody = (): FeatureBody => ({
  params: [{ name: 'title', label: 'Title', type: 'text' }],
  fragment: { id: 'h', type: 'Heading', props: {}, children: 'Placeholder' },
  bindings: [{ param: 'title', layer: 'h', target: 'children' }],
});

/** A feature that places another feature (Section holding a Feature node). */
export const wrapperBody = (innerId: string): FeatureBody => ({
  params: [{ name: 'title', label: 'Title', type: 'text' }],
  fragment: {
    id: 'w',
    type: 'Section',
    props: {},
    children: [{ id: 'n', type: 'Feature', props: { featureId: innerId, params: { title: 'x' } }, children: [] }],
  },
  bindings: [{ param: 'title', layer: 'n', target: 'props.params.title' }],
});
