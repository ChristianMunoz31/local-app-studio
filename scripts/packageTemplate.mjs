// Public stub of the runtime template packaging (docs/ARCHITECTURE.md, 'The pro seam'). `npm run template:package` runs scripts/lib/proRun.js, which
// runs pro/scripts/packageTemplate.mjs in a pro build and this file in a public build. The export names are the same as the twin's
// (the export-surface test keeps them in step); the values are inert and the functions refuse.
import { pathToFileURL } from 'node:url';
import { FeatureUnavailableError } from '../server/buildFeatures.js';

const refuse = () => {
  throw new FeatureUnavailableError('installer');
};

export class TemplateError extends Error {}
export const TEMPLATE_SEAMS = Object.freeze([]);
export const TEMPLATE_REQUIRED_FILES = Object.freeze([]);
export const TEMPLATE_PRO_FILES = Object.freeze([]);
export const TEMPLATE_PRO_PREFIXES = Object.freeze([]);
export const templateExcludeRule = refuse;
export const blankStoreConfig = refuse;
export const packageTemplate = refuse;
export const main = () => 1;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.error('The runtime template is not made in this build.');
  process.exit(1);
}
