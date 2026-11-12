// The build seams of the app mode (ADR-001), same pattern as scripts/desktop/cloudBuild.js. A runtime build
// swaps each Studio seam file for its `.disabled` stub, so the Studio code never enters the artifact:
//   studioUiPlugin      Vite (web UI): src/modules/studio.jsx and src/modules/studio.assistant.js
//   studioServerPlugin  esbuild (sidecar bundle, backup worker): server/modules/studio.js, studio.data.js,
//                       studio.tools.js and src/modules/studio.assistant.js (the server reads the page list too)
// In runtime mode both plugins also fail the build if anything under src/studio/, server/studio/ (or their twins under the pro
// folder: pro/src/studio/, pro/server/studio/) or src/catalog/features/, or the
// ui-builder editor entry, is still loaded, and the server plugin also refuses zod and packages/runtime/src/spec/schema.ts
// (a built app has no zod in its sidecar, ADR-006). In studio mode they change nothing.
// studioUiPlugin also serves the virtual module `virtual:app-spec`: the baked spec in a runtime build, else null.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_MODES, APP_SPEC_RELATIVE_PATH, resolveAppMode } from '../../server/appMode.js';
import { proFolders } from '../lib/proDir.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const APP_SPEC_VIRTUAL_ID = 'virtual:app-spec';
const RESOLVED_VIRTUAL_ID = `\0${APP_SPEC_VIRTUAL_ID}`;

const UI_SEAMS = [
  [path.join('src', 'modules', 'studio.jsx'), path.join('src', 'modules', 'studio.disabled.jsx')],
  [path.join('src', 'modules', 'studio.assistant.js'), path.join('src', 'modules', 'studio.assistant.disabled.js')],
];
const SERVER_SEAMS = [
  [path.join('server', 'modules', 'studio.js'), path.join('server', 'modules', 'studio.disabled.js')],
  [path.join('server', 'modules', 'studio.data.js'), path.join('server', 'modules', 'studio.data.disabled.js')],
  [path.join('server', 'modules', 'studio.tools.js'), path.join('server', 'modules', 'studio.tools.disabled.js')],
  [path.join('src', 'modules', 'studio.assistant.js'), path.join('src', 'modules', 'studio.assistant.disabled.js')],
];

/** Repo-relative, forward-slash path prefixes no runtime build may load (all of src/vendor/ is the unused vendored editor). */
const UI_FORBIDDEN = ['src/studio/', 'server/studio/', 'src/catalog/features/', 'src/vendor/'];
/** The Studio code that also has a twin under a pro folder (the helper's pipeline, the build service), relative to that folder. */
const PRO_STUDIO_PARTS = ['server/studio/', 'src/studio/'];
/** Packages the runtime UI must not contain: the drag and drop library belongs to the Design canvas. */
const UI_FORBIDDEN_PACKAGES = ['/node_modules/@dnd-kit/'];
const SERVER_FORBIDDEN = [...UI_FORBIDDEN, 'packages/runtime/src/spec/schema.ts'];
/** Packages the runtime server must not contain (a path segment of the file's location). */
const SERVER_FORBIDDEN_PACKAGES = ['/node_modules/zod/'];

const same = (a, b) => {
  const x = path.resolve(a);
  const y = path.resolve(b);
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
};
const stripQuery = (id) => id.split('?')[0];
const assertMode = (mode) => {
  if (!APP_MODES.includes(mode)) throw new Error(`app mode must be one of ${APP_MODES.join(', ')} (got "${String(mode)}")`);
};
const toPosix = (file) => file.split(path.sep).join('/');
/** Forbidden prefixes of the pro twins of Studio paths, relative to `root`, under every resolved pro folder. */
const proStudioPrefixes = (root, proDirs) => proDirs.flatMap((dir) => PRO_STUDIO_PARTS.map((p) => `${toPosix(path.relative(root, dir))}/${p}`));
/** The forbidden prefix or package the file matches, else null. Prefixes are relative to `root`. */
const forbiddenHit = (file, root, prefixes, packages = []) => {
  const abs = toPosix(path.resolve(stripQuery(file)));
  const rel = toPosix(path.relative(root, path.resolve(stripQuery(file))));
  const lower = (v) => (process.platform === 'win32' ? v.toLowerCase() : v);
  const prefix = prefixes.find((p) => lower(rel).startsWith(lower(p)));
  return prefix ?? packages.find((p) => lower(abs).includes(p)) ?? null;
};
const forbiddenText = (file, root, what) =>
  `${path.relative(root, stripQuery(file)).split(path.sep).join('/')} must not be in a runtime build (${what}). ` +
  'Import Studio code only through the src/modules/studio* and server/modules/studio* seam files.';

/**
 * The app mode a build uses: APP_MODE, else runtime when config/app-spec.json exists, else studio.
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [root]
 * @returns {'studio' | 'runtime'}
 */
export function resolveBuildAppMode(env = process.env, root = ROOT) {
  return resolveAppMode(env, { root });
}

/**
 * The baked spec as JSON text (re-serialized, so the text is minimal), or null when the file is absent.
 * Only the build reads this; the spec is validated by the pipeline that wrote it.
 * @param {string} [root]
 * @returns {string | null}
 * @throws {Error} when the file exists but is not JSON
 */
export function readBakedSpecJson(root = ROOT) {
  const file = path.join(root, APP_SPEC_RELATIVE_PATH);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    throw new Error(`${APP_SPEC_RELATIVE_PATH.split(path.sep).join('/')} is not valid JSON`);
  }
}

/**
 * Vite plugin for the web UI. Runs before Vite's own resolver.
 * @param {'studio' | 'runtime'} mode
 * @param {{ root?: string, specJson?: string | null, proDirs?: string[] }} [opts] `specJson`: the baked spec text (runtime builds);
 *   `proDirs`: the pro folders whose Studio twins are refused too (default: the resolved ones)
 * @returns {import('vite').Plugin}
 */
export function studioUiPlugin(mode, { root = ROOT, specJson = null, proDirs = proFolders(root) } = {}) {
  assertMode(mode);
  const forbiddenPrefixes = [...UI_FORBIDDEN, ...proStudioPrefixes(root, proDirs)];
  const seams = UI_SEAMS.map(([from, to]) => ({ from: path.join(root, from), to: path.join(root, to) }));
  return {
    name: 'studio-ui-seam',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === APP_SPEC_VIRTUAL_ID) return RESOLVED_VIRTUAL_ID;
      if (mode !== 'runtime' || !importer) return null;
      let base = null;
      if (source.startsWith('.')) base = path.resolve(path.dirname(stripQuery(importer)), stripQuery(source));
      else if (source.startsWith('@/')) base = path.join(root, 'src', stripQuery(source).slice(2));
      if (base === null) return null;
      const hit = seams.find((s) => ['', '.js', '.jsx'].some((ext) => same(base + ext, s.from)));
      return hit ? hit.to : null;
    },
    load(id) {
      if (id === RESOLVED_VIRTUAL_ID) return `export default ${mode === 'runtime' && specJson ? specJson : 'null'};`;
      if (mode !== 'runtime') return null;
      const hit = forbiddenHit(id, root, forbiddenPrefixes, UI_FORBIDDEN_PACKAGES);
      if (hit) this.error(forbiddenText(id, root, hit));
      return null;
    },
  };
}

/**
 * esbuild plugin for the server bundle and the backup worker bundle.
 * @param {'studio' | 'runtime'} mode
 * @param {{ root?: string, proDirs?: string[] }} [opts] `proDirs`: the pro folders whose Studio twins are refused too (default: the resolved ones)
 * @returns {import('esbuild').Plugin}
 */
export function studioServerPlugin(mode, { root = ROOT, proDirs = proFolders(root) } = {}) {
  assertMode(mode);
  const forbiddenPrefixes = [...SERVER_FORBIDDEN, ...proStudioPrefixes(root, proDirs)];
  return {
    name: 'studio-server-seam',
    setup(build) {
      if (mode !== 'runtime') return;
      const seams = SERVER_SEAMS.map(([from, to]) => ({ from: path.join(root, from), to: path.join(root, to) }));
      build.onResolve({ filter: /(^|[\\/])studio(\.data|\.assistant|\.tools)?\.jsx?$/ }, (args) => {
        const resolved = path.resolve(args.resolveDir, args.path);
        const hit = seams.find((s) => same(resolved, s.from));
        return hit ? { path: hit.to } : undefined;
      });
      build.onLoad({ filter: /./ }, (args) => {
        const hit = forbiddenHit(args.path, root, forbiddenPrefixes, SERVER_FORBIDDEN_PACKAGES);
        return hit ? { errors: [{ text: forbiddenText(args.path, root, hit) }] } : undefined;
      });
    },
  };
}
