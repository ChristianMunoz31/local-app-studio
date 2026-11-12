// Public stub of the sidecar smoke test (docs/ARCHITECTURE.md, 'The pro seam'). The release workflows run scripts/lib/proRun.js, which
// runs pro/scripts/release/smokeSidecar.js in a pro build and this file in a public build. The export names are the same as the twin's
// (the export-surface test keeps them in step); the values are inert and the functions refuse.
import { pathToFileURL } from 'node:url';
import { FeatureUnavailableError } from '../../server/buildFeatures.js';

const refuse = () => {
  throw new FeatureUnavailableError('installer');
};

export const READY_PREFIX = '';
export const BOOTSTRAP_LABEL = '';
export const COOKIE_NAME = '';
export const READY_TIMEOUT_MS = 0;
export const EXIT_TIMEOUT_MS = 0;
export const TEMPLATE_FILE = '';
export const parseReadyLine = refuse;
export const findReady = refuse;
export const templateProblem = refuse;
export const newSecretHex = refuse;
export const bootstrapTokenFor = refuse;
export const extractCookie = refuse;
export const buildSidecarEnv = refuse;
export const isJsonType = refuse;
export const looksLikeAppHtml = refuse;
export const runSmoke = async () => refuse();

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.error('The sidecar smoke test is not in this build.');
  process.exit(1);
}
