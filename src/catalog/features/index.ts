// The feature library (docs/FEATURES.md). Pure. Studio only: nothing under src/runtime/ may import this folder
// (enforced by scripts/desktop/modeBuild.js and a test).
export { FEATURE_LIMITS, FEATURE_TYPE } from './limits.ts';
export { PARAM_TYPES } from './types.ts';
export type {
  FeatureBinding,
  FeatureBody,
  FeatureDefinition,
  FeatureLibrary,
  FeatureMarker,
  FeatureNodeProps,
  FeatureParam,
  ParamType,
} from './types.ts';
export { TEXT_PROPS, slotsOf, valueAtPath } from './slots.ts';
export type { Slot, SlotKind } from './slots.ts';
export { checkParamValues, expandFeature, expandLayout, expandSpecFeatures, featureMarkers, hasFeatureNodes, readFeatureNode } from './expand.ts';
export type { ExpandOptions, ExpandResult } from './expand.ts';
export { findCycle, isReservedFeatureId, validateFeatureInput } from './validate.ts';
export { SAMPLE_TABLE, builtInPreviewSpec, sampleParams, sampleRows, sampleSpecFor } from './sample.ts';
export type { SampleRow } from './sample.ts';
export { modelFeaturesFor } from './model.ts';
export type { ModelFeature } from './model.ts';
export { SEED_FEATURES } from './seeds.ts';
