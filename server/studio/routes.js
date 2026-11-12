// Mounts every Studio route. Called from the studio module's register, after the kit's guards and parsers.
import { registerAppsRoutes } from './appsRoutes.js';
import { registerBuildRoutes } from './buildRoutes.js';
import { registerDiagnosticsRoutes } from '../diagnostics/routes.js';
import { registerDescribeRoute } from './describeRoute.js';
import { registerFeatureRoutes } from './features/routes.js';
import { studioGuard } from './http.js';
import { registerPreviewRoutes } from './previewRoutes.js';

/** @param {import('express').Express} app */
export function registerStudioRoutes(app) {
  app.use('/api/studio', studioGuard);
  registerAppsRoutes(app);
  registerFeatureRoutes(app);
  registerDescribeRoute(app);
  registerPreviewRoutes(app);
  registerBuildRoutes(app);
  registerDiagnosticsRoutes(app);
}
