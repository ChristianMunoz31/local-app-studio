import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolveDevProxyPort } from './server/config.js'
import { mergeEnvFiles } from './server/envFiles.js'
import { resolveBuildCloudAi } from './server/buildFeatures.js'
import { cloudUiPlugin } from './scripts/desktop/cloudBuild.js'
import { resolveProDir } from './scripts/lib/proDir.js'
import { RUNTIME_ALIASES } from './scripts/lib/runtimeAlias.js'
import { proSeamVitePlugin } from './scripts/lib/proSeam.js'
import { webStubsPlugin } from './scripts/lib/webStubs/index.js'
import { readBakedSpecJson, resolveBuildAppMode, studioUiPlugin } from './scripts/desktop/modeBuild.js'

// https://vite.dev/config/
// The API port the dev proxy targets: the same env merge (loadEnv.js) and port parsing (server/config.js) the server uses.
const apiPort = () => resolveDevProxyPort(mergeEnvFiles(fileURLToPath(new URL('.', import.meta.url))))

// APP_PRO_DIR (scripts/lib/proDir.js): a pro build swaps each seam stub for its twin under pro/, a public build (APP_PRO_DIR=none) keeps
// the stubs and refuses any file under pro/. Also applies to `npm run dev`.
const proDir = resolveProDir(process.env)

// APP_CLOUD_AI=off builds the UI without the cloud provider screens (docs/AI.md). A public build has no cloud provider at all. Also applies to `npm run dev`.
const cloudAi = resolveBuildCloudAi(process.env, 'APP_CLOUD_AI', proDir)

// ADR-001: APP_MODE, else runtime when config/app-spec.json exists, else studio. A runtime build swaps the Studio seam files for
// stubs (scripts/desktop/modeBuild.js). Also applies to `npm run dev`.
const root = fileURLToPath(new URL('.', import.meta.url))
const appMode = resolveBuildAppMode(process.env, root)
const appSpecJson = appMode === 'runtime' ? readBakedSpecJson(root) : null

// `vite build` also swaps three unused modules for stubs (scripts/lib/webStubs/index.js); dev, Vitest and the sidecar bundles keep the real ones.
export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    cloudUiPlugin(cloudAi),
    proSeamVitePlugin(proDir),
    studioUiPlugin(appMode, { root, specJson: appSpecJson }),
    ...(command === 'build' ? [webStubsPlugin()] : []),
  ],
  define: { __APP_MODE__: JSON.stringify(appMode) },
  // "@/" maps to src/ (the app and Studio code use it; the vendored ui-builder in src/vendor/ is not built any more). The runtime package
  // (@local-app-studio/runtime, packages/runtime) resolves through the same list (scripts/lib/runtimeAlias.js).
  resolve: { alias: RUNTIME_ALIASES },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          // Module ids use forward slashes on every OS.
          groups: [
            // React itself must not be swept into a lazy group: the entry needs it first.
            { name: 'react', test: /node_modules\/(react|react-dom|scheduler)\//, priority: 3 },
            // Tiny modules shared by several lazy pages otherwise each become their own
            // chunk, and every cross-chunk binding costs bytes. One shared chunk is smaller overall.
            // The catalog, Studio code, the runtime renderer, the spec schema and the error copy table (src/errors) are left out: if the entry (or another initially
            // loaded chunk) imported a shared chunk holding them, the Design canvas and zod would load at first paint. They stay
            // in the lazy chunks of the routes that import them.
            // The drag and drop library only the Design tab uses: its own lazy chunk, never initial and never in a built app.
            { name: 'editor-libs', test: /node_modules\/@dnd-kit\//, priority: 2 },
            { name: 'shared', test: /\/src\/(?!(vendor|catalog|studio|runtime|spec|errors)\/)/, minShareCount: 2, priority: 1 },
          ],
        },
      },
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    // Relative /api calls in dev are forwarded to the local Local App Studio server
    // (127.0.0.1, port from env APP_PORT, default 4321). Changing APP_PORT moves the API and this proxy together.
    proxy: {
      '/api': `http://127.0.0.1:${apiPort()}`,
    },
  },
}))
