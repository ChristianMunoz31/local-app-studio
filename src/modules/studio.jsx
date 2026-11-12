// The Studio module (the product). Replaced by studio.disabled.jsx in a runtime build (scripts/desktop/modeBuild.js), so
// no Studio page is emitted there. Studio pages are lazy routes declared only here. Phase 3 owns this file after the merge.
import { lazy } from 'react';
import { LayoutGrid, Puzzle } from 'lucide-react';
import { PRO_PARTS } from '../proParts.js';

// The Apps and Features pages load together with the page error boundary (src/studio/pages/PageRoutes.tsx); the workspace route
// is WorkspaceRoute, the workspace inside its boundary. Each stays a lazy chunk.
const bounded = (loadPage) =>
  lazy(() => Promise.all([loadPage(), import('../studio/pages/PageRoutes')]).then(([page, { withPageBoundary }]) => ({ default: withPageBoundary(page.default) })));
const appsPage = bounded(() => import('../studio/pages/AppsPage'));
const featuresPage = bounded(() => import('../studio/pages/FeaturesPage'));
const featureBuilderPage = bounded(() => import('../studio/pages/FeatureBuilderPage'));
const appWorkspace = lazy(() => import('../studio/pages/WorkspaceRoute'));
const buildToolchainSection = lazy(() => import('../studio/settings/BuildToolchainSection'));
const diagnosticsSection = lazy(() => import('../studio/settings/DiagnosticsSection'));

/** @type {import('./index.js').FrontendModule} */
const studioModule = {
  id: 'studio',
  modes: ['studio'],
  routes: [
    { path: '/apps', Component: appsPage },
    { path: '/apps/:appId/*', Component: appWorkspace },
    { path: '/features', Component: featuresPage },
    { path: '/features/new', Component: featureBuilderPage },
    { path: '/features/:featureId/edit', Component: featureBuilderPage },
  ],
  navGroups: [
    {
      section: null,
      id: 'studio',
      items: [
        { to: '/apps', label: 'Apps', icon: LayoutGrid },
        { to: '/features', label: 'Features', icon: Puzzle },
      ],
    },
  ],
  replacesKitPaths: [],
  settingsSections: [
    // The build tools are for making an installer, which a build without the installer cannot do (docs/ARCHITECTURE.md, 'The pro seam').
    ...(PRO_PARTS.installer ? [{ id: 'build-toolchain', Component: buildToolchainSection }] : []),
    { id: 'diagnostics', Component: diagnosticsSection },
  ],
};

export default studioModule;
