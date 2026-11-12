// Public stub of the store config check (docs/ARCHITECTURE.md, 'The pro seam'). `npm run check:store-config` runs scripts/lib/proRun.js, which
// runs pro/scripts/checks/storeConfig.js in a pro build and this file in a public build. The export names are the same as the twin's
// (the export-surface test keeps them in step); the values are inert and the functions refuse.
import { pathToFileURL } from 'node:url';
import { FeatureUnavailableError } from '../../server/buildFeatures.js';

const refuse = () => {
  throw new FeatureUnavailableError('installer');
};

export const describeStores = refuse;
export const requiredFrom = refuse;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.error('The store config check is not in this build.');
  process.exit(1);
}
