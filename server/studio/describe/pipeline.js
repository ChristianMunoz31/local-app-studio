// Public stub of the Describe pipeline (docs/ARCHITECTURE.md, 'The pro seam'): the helper is not in this build. A pro build
// swaps this file for pro/server/studio/describe/pipeline.js. The export names are the same (the export-surface test keeps
// them in step); the values are inert and runDescribe refuses. describeRoute.js answers 403 feature_unavailable
// (requireInBuild('helper')) before it can get here.
import { FeatureUnavailableError } from '../../buildFeatures.js';

export const REPAIR_ROUNDS = 0;
export const MAX_OUTPUT_CHARS = 0;
export const MAX_INSTRUCTION_CHARS = 0;
export const FALLBACK_MESSAGE = '';
export const MENU_SLOT_DROPPED_MESSAGE = '';

/** The error type describeRoute.js tells apart from a model failure. This build never raises it. */
export class DescribeError extends Error {
  /** @param {string} code */
  constructor(code) {
    super('The helper is not in this build. Build it yourself in Design.');
    this.name = 'DescribeError';
    this.code = code;
    this.publicMessage = this.message;
  }
}

/** @param {unknown} value @returns {unknown} */
export const stripForbiddenKeys = (value) => value;

/** @returns {Record<string, never>} */
export const outlineJsonSchema = () => ({});

/** @param {unknown} spec @returns {unknown} */
export const withRunnableDefaults = (spec) => spec;

// Phase 26 repair helpers the pro tests import directly. Same names as the twin (the export-surface test keeps them in
// step); each hands back its first argument unchanged because the public build has no helper to repair.
/** @param {unknown} spec @returns {unknown} */
export const withWaysIn = (spec) => spec;

/** @param {unknown} spec @returns {unknown} */
export const keepCreateForms = (spec) => spec;

/** @param {unknown} pages @returns {unknown} */
export const withStripFence = (pages) => pages;

/** @param {unknown} block @returns {unknown} */
export const keepBaseTables = (block) => block;

/** @param {unknown} block @returns {unknown} */
export const repairChoiceFields = (block) => block;

/** @param {unknown} block @returns {unknown} */
export const referencesToText = (block) => block;

/** @param {unknown} block @returns {unknown} */
export const idCaseTables = (block) => block;

/** @param {unknown} block @returns {unknown} */
export const fixTitleFields = (block) => block;

/** @param {unknown} layout @returns {unknown} */
export const checkPageNumbers = (layout) => layout;

/** @param {unknown} pages @returns {unknown} */
export const keepBasePageIds = (pages) => pages;

/** @returns {Promise<never>} */
export async function runDescribe() {
  throw new FeatureUnavailableError('helper');
}
