// Public stub of the release publisher (docs/ARCHITECTURE.md, 'The pro seam'). The release workflows run scripts/lib/proRun.js, which
// runs pro/scripts/release/publishPublic.js in a pro build and this file in a public build. The export names are the same as the twin's
// (the export-surface test keeps them in step); the values are inert and the functions refuse.
import { pathToFileURL } from 'node:url';
import { FeatureUnavailableError } from '../../server/buildFeatures.js';

const refuse = () => {
  throw new FeatureUnavailableError('installer');
};

export const PUBLIC_REPO = '';
export const PRIVATE_LINK_RE = /(?!)/g;
export const INSTALLER_X64 = '';
export const INSTALLER_ARM64 = '';
export const SUMS_FILE = '';
export const ALLOWED_ASSETS = Object.freeze([]);
export const MAX_ASSET_BYTES = 0;
export const allowlistAssets = refuse;
export const extractChangelogSection = refuse;
export const cleanChangelog = refuse;
export const renderReleaseNotes = refuse;
export const verifySums = refuse;
export const buildGhArgs = refuse;
export const missingAssets = refuse;
export const describeFiles = refuse;
export const publish = async () => refuse();

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.error('Publishing a release is not in this build.');
  process.exit(1);
}
