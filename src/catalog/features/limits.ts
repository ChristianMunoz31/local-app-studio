// Feature library limits (docs/FEATURES.md, "Rules the checks enforce"). Pure.
export const FEATURE_LIMITS = Object.freeze({
  library: 100,
  params: 6,
  paramNameChars: 24,
  labelChars: 40,
  descriptionChars: 160,
  bindings: 24,
  fragmentLayers: 60,
  fragmentDepth: 8,
  fragmentJsonChars: 16384,
  nestDepth: 3,
  textValueChars: 2000,
  modelFeatures: 6,
  modelDescriptionChars: 100,
} as const);

/** The layer type of a placeholder that Describe and Design expand before anything is stored. */
export const FEATURE_TYPE = 'Feature';
