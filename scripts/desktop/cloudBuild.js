// The two build seams of a cloud-off build (APP_CLOUD_AI=off, docs/AI.md 'Building without the cloud
// provider'). Each swaps one module for a stub, so the real code never enters the artifact:
//   cloudProviderPlugin  esbuild (sidecar bundle, backup worker): server/ai/providers/openaiCompat.js
//                        becomes openaiCompat.disabled.js
//   cloudUiPlugin        Vite (web UI): src/components/settings/cloudUi.js becomes cloudUi.disabled.js
// In off mode both plugins also fail the build if anything else still pulls the real code in, so a new
// import around the seam is caught at build time. In on mode they do nothing.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { proFolders } from '../lib/proDir.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const PROVIDER = path.join('server', 'ai', 'providers', 'openaiCompat.js');
const PROVIDER_STUB = path.join('server', 'ai', 'providers', 'openaiCompat.disabled.js');
// The real provider and its transport are pro twins (docs/ARCHITECTURE.md, 'The pro seam'): the stub sits at PROVIDER, so the
// twin paths are named too, under every pro folder the build resolved (proFolders), and a cloud-off pro build still refuses them.
const PROVIDER_PARTS = [PROVIDER, path.join('server', 'ai', 'llmClient.js')];

const UI_SEAM = path.join('src', 'components', 'settings', 'cloudUi.js');
const UI_STUB = path.join('src', 'components', 'settings', 'cloudUi.disabled.js');
// A new cloud UI component must be added to this list, or be reached only through cloudUi.js.
const UI_PARTS = ['CloudAiBlock.jsx', 'CloudAiConsentDialog.jsx', 'CloudCategoryList.jsx'].map((f) => path.join('src', 'components', 'settings', f));

const same = (a, b) => {
  const x = path.resolve(a);
  const y = path.resolve(b);
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
};
const stripQuery = (id) => id.split('?')[0];
const assertMode = (mode) => {
  if (mode !== 'on' && mode !== 'off') throw new Error(`cloud AI mode must be on or off (got "${String(mode)}")`);
};

/**
 * esbuild plugin for the server bundle.
 * @param {'on' | 'off'} mode
 * @param {{ root?: string, proDirs?: string[] }} [opts] `proDirs`: the pro folders whose twins are refused (default: the resolved ones)
 * @returns {import('esbuild').Plugin}
 */
export function cloudProviderPlugin(mode, { root = ROOT, proDirs = proFolders(root) } = {}) {
  assertMode(mode);
  return {
    name: 'cloud-provider-seam',
    setup(build) {
      if (mode !== 'off') return;
      const real = path.join(root, PROVIDER);
      build.onResolve({ filter: /(^|[\\/])openaiCompat\.js$/ }, (args) => {
        const resolved = path.resolve(args.resolveDir, args.path);
        return same(resolved, real) ? { path: path.join(root, PROVIDER_STUB) } : undefined;
      });
      const forbidden = [root, ...proDirs].flatMap((base) =>
        PROVIDER_PARTS.map((rel) => ({ rel: path.relative(root, path.join(base, rel)), file: path.join(base, rel) })),
      );
      build.onLoad({ filter: /[\\/](openaiCompat|llmClient)\.js$/ }, (args) => {
        const hit = forbidden.find((f) => same(args.path, f.file));
        if (!hit) return undefined;
        return { errors: [{ text: `${hit.rel.split(path.sep).join('/')} must not be in a cloud-off build. Import the provider only through server/ai/registry.js.` }] };
      });
    },
  };
}

/**
 * Vite plugin for the web UI. Runs before Vite's own resolver.
 * @param {'on' | 'off'} mode
 * @param {{ root?: string, proDirs?: string[] }} [opts] `proDirs`: the pro folders whose twins are refused (default: the resolved ones)
 * @returns {import('vite').Plugin}
 */
export function cloudUiPlugin(mode, { root = ROOT, proDirs = proFolders(root) } = {}) {
  assertMode(mode);
  const seam = path.join(root, UI_SEAM);
  const stub = path.join(root, UI_STUB);
  const forbidden = [root, ...proDirs].flatMap((base) => (base === root ? UI_PARTS : [...UI_PARTS, UI_SEAM]).map((rel) => path.join(base, rel)));
  return {
    name: 'cloud-ui-seam',
    enforce: 'pre',
    resolveId(source, importer) {
      if (mode !== 'off' || !importer || !source.startsWith('.')) return null;
      const base = path.resolve(path.dirname(stripQuery(importer)), stripQuery(source));
      const hit = ['', '.js', '.jsx'].some((ext) => same(base + ext, seam));
      return hit ? stub : null;
    },
    load(id) {
      if (mode !== 'off') return null;
      const file = stripQuery(id);
      if (forbidden.some((f) => same(f, file))) {
        this.error(`${path.basename(file)} must not be in a cloud-off build. Import the cloud UI only through src/components/settings/cloudUi.js.`);
      }
      return null;
    },
  };
}
