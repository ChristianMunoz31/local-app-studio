// The build plugins of the pro seam (docs/ARCHITECTURE.md, 'The pro seam'), the same pattern as scripts/desktop/cloudBuild.js.
//   proSeamVitePlugin    Vite (web UI, `npm run dev`, Vitest): a resolved seam file becomes its pro twin in a pro build
//   proSeamEsbuildPlugin esbuild (sidecar bundle, backup worker): the same redirect
// In a public build both refuse to load any file under pro/, so a stray import cannot put pro code in the artifact.
import path from 'node:path';
import { PRO_SEAMS, REPO_ROOT, isUnderProDir, proTwinOf } from './proDir.js';

const stripQuery = (id) => id.split('?')[0];
const stem = (file) => path.basename(file).replace(/\.[^.]+$/, '');
const SEAM_STEMS = () => new Set(PRO_SEAMS.map(stem));
const noExt = (file) => file.replace(/\.[^./\\]+$/, '');
const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
/** True when a relative or `@/` import cannot name a seam, judged from the path alone (no resolve needed). */
const surelyNotSeam = (source, importer, root, bases) => {
  const spec = stripQuery(source);
  let abs = null;
  if (spec.startsWith('.')) abs = path.resolve(path.dirname(stripQuery(importer)), spec);
  else if (spec.startsWith('@/')) abs = path.join(root, 'src', spec.slice(2));
  return abs !== null && !bases.has(fold(noExt(abs)));
};
const escapeRe = (s) => s.replace(/[^A-Za-z0-9_]/g, '\\$&');
const refusal = (file, root) =>
  `${path.relative(root, file).split(path.sep).join('/')} is pro code and must not be in a public build. Import it only through its stub (docs/ARCHITECTURE.md, 'The pro seam').`;

/**
 * @param {{ mode: 'pro' | 'public', dir: string | null }} resolved
 * @param {{ root?: string }} [opts]
 * @returns {import('vite').Plugin}
 */
export function proSeamVitePlugin(resolved, { root = REPO_ROOT } = {}) {
  const stems = SEAM_STEMS();
  const bases = new Set(PRO_SEAMS.map((s) => fold(noExt(path.join(root, s)))));
  return {
    name: 'pro-seam',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (resolved.mode !== 'pro' || !importer || !stems.has(stem(stripQuery(source)))) return null;
      if (surelyNotSeam(source, importer, root, bases)) return null;
      const hit = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!hit || hit.external) return null;
      return proTwinOf(stripQuery(hit.id), resolved, root);
    },
    load(id) {
      if (resolved.mode !== 'public') return null;
      const file = stripQuery(id);
      if (isUnderProDir(file, root)) this.error(refusal(file, root));
      return null;
    },
  };
}

/**
 * @param {{ mode: 'pro' | 'public', dir: string | null }} resolved
 * @param {{ root?: string }} [opts]
 * @returns {import('esbuild').Plugin}
 */
export function proSeamEsbuildPlugin(resolved, { root = REPO_ROOT } = {}) {
  return {
    name: 'pro-seam',
    setup(build) {
      if (resolved.mode === 'pro') {
        const names = PRO_SEAMS.map((s) => escapeRe(path.basename(s))).join('|');
        build.onResolve({ filter: new RegExp(`(^|[\\\\/])(${names})$`) }, (args) => {
          if (args.kind === 'entry-point') return undefined;
          const twin = proTwinOf(path.resolve(args.resolveDir, args.path), resolved, root);
          return twin ? { path: twin } : undefined;
        });
        return;
      }
      build.onLoad({ filter: /[\\/]pro[\\/]/ }, (args) => (isUnderProDir(args.path, root) ? { errors: [{ text: refusal(args.path, root) }] } : undefined));
    },
  };
}
