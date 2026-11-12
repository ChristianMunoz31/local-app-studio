// Public stub of the installer build (docs/ARCHITECTURE.md, 'The pro seam'). `npm run desktop:build` runs
// scripts/lib/proRun.js, which runs pro/scripts/desktop/build.js in a pro build and this file in a public build. The export
// names are the same as the twin's (the export-surface test keeps them in step) because buildDev.js imports them; the
// functions that would build refuse. The overlay and the template step rule are open code (studioOverlay.js) that this
// file re-exports, so buildDev.js sees the same answer with or without the pro hook; templateStepFor is false in a public build.
import { pathToFileURL } from 'node:url';
import { FeatureUnavailableError } from '../../server/buildFeatures.js';

export const STABLE_ONLY_MESSAGE = '';
export { STUDIO_OVERLAY, TEMPLATE_RESOURCE, studioTauriOverlay, templateStepFor } from './studioOverlay.js';

const refuse = () => {
  throw new FeatureUnavailableError('installer');
};

export const assertStableBuildEnv = refuse;
export const stableChildEnv = refuse;
export const findUnrenamedSettings = refuse;
export const unrenamedWarning = refuse;
export const writeStudioOverlay = refuse;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.error('Making an installer is not in this build.');
  process.exit(1);
}
