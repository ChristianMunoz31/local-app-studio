// Public stub of the build service (docs/ARCHITECTURE.md, 'The pro seam'): making an installer is not in this build. A pro
// build swaps this file for pro/server/studio/build/service.js. The export names are the same (the export-surface test keeps
// them in step); the values are inert. buildRoutes.js answers 403 feature_unavailable (requireInBuild('installer')) before a
// route can get here, and the Apps routes and the module's stop hook only ask whether a build is running, which is never.
import { FeatureUnavailableError } from '../../buildFeatures.js';

/** No steps: there is no build to run. */
export const STEPS = Object.freeze([]);

/** No build sentences: no build can fail. */
export const FIXED_MESSAGE = Object.freeze({});

/** @returns {Array<object>} */
export const stepsForFinished = () => [];

const refuse = () => {
  throw new FeatureUnavailableError('installer');
};

/**
 * A service that builds nothing: no build is running, there is no history, a live build or stored build is never found,
 * and starting or stopping one refuses.
 * @returns {{ isBuilding: (appId: string) => boolean, shutdown: () => Promise<void>, list: () => object[], get: () => null,
 *   subscribe: () => null, storedSnapshot: () => null, start: () => never, cancel: () => never }}
 */
export function createBuildService() {
  return {
    isBuilding: () => false,
    shutdown: async () => {},
    list: () => [],
    get: () => null,
    subscribe: () => null,
    storedSnapshot: () => null,
    start: refuse,
    cancel: refuse,
  };
}

/** @type {ReturnType<typeof createBuildService> | null} */
let singleton = null;

/** @returns {ReturnType<typeof createBuildService>} the process-wide service, as in a pro build (a test can spy on it) */
export function getBuildService() {
  singleton ??= createBuildService();
  return singleton;
}
