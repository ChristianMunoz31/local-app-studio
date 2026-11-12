// The Studio module (the product). Replaced by studio.disabled.js in a runtime build (scripts/desktop/modeBuild.js),
// so nothing it imports ships in a built app.
import { STUDIO_ERROR_COPY } from '../../src/errors/copy.studio.js';
import { registerErrorCopy } from '../errors.js';
import { markInterruptedBuilds } from '../studio/apps.js';
import { getBuildService } from '../studio/build/service.js';
import { getPreviewManager } from '../studio/preview/manager.js';
import { registerStudioRoutes } from '../studio/routes.js';

// The Studio-only error words; a runtime build swaps this file for studio.disabled.js, so they never ship in a built app.
registerErrorCopy(STUDIO_ERROR_COPY);

const WINDOW = 15 * 60 * 1000;

/** @type {import('./index.js').ServerModule} */
const studioModule = {
  id: 'studio',
  modes: ['studio'],
  noStorePaths: ['/api/studio', '/api/preview'],
  // Design and Data saves plus preview polling would exhaust the global budget; Describe also spends the strict AI budget.
  limiters: [
    { path: '/api/studio', windowMs: WINDOW, max: 1200 },
    { path: '/api/preview', windowMs: WINDOW, max: 3000 },
  ],
  aiPostPaths: ['/api/studio/apps/:id/describe'],
  ownBody: [],
  register(app) {
    registerStudioRoutes(app);
  },
  onStart() {
    markInterruptedBuilds();
  },
  async onStop() {
    await getPreviewManager().stop();
    await getBuildService().shutdown();
  },
};

export default studioModule;
