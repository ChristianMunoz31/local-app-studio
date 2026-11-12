// Public stub of the installer smoke test (docs/ARCHITECTURE.md, 'The pro seam'). The release workflows run scripts/lib/proRun.js, which
// runs pro/scripts/release/smokeInstaller.js in a pro build and this file in a public build. The export names are the same as the twin's
// (the export-surface test keeps them in step); the values are inert and the functions refuse.
import { pathToFileURL } from 'node:url';
import { FeatureUnavailableError } from '../../server/buildFeatures.js';

const refuse = () => {
  throw new FeatureUnavailableError('installer');
};

export const APP_EXE = '';
export const SIDECAR_EXE = '';
export const UNINSTALLER = '';
export const LOG_IDENTIFIER = '';
export const serverLogPath = refuse;
export const readyFromServerLog = refuse;
export const installArgs = refuse;
export const uninstallArgs = refuse;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.error('The installer smoke test is not in this build.');
  process.exit(1);
}
