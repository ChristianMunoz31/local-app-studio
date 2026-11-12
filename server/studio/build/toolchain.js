// Public stub of the build toolchain check (docs/ARCHITECTURE.md, 'The pro seam'): making an installer is not in this build.
// A pro build swaps this file for pro/server/studio/build/toolchain.js. The export names are the same (the export-surface test
// keeps them in step). The two version floors are plain numbers the doctor still words; the functions refuse.
import { FeatureUnavailableError } from '../../buildFeatures.js';

export const MIN_NODE_MAJOR = 24;
export const MIN_RUSTC = '1.77.2';

const refuse = () => {
  throw new FeatureUnavailableError('installer');
};

/** @returns {never} */
export const windowsDirs = refuse;

/** @returns {never} */
export const defaultFacade = refuse;

/** @returns {Promise<never>} */
export const detectToolchain = async () => refuse();
