// The one resolver for the open-source seam (docs/ARCHITECTURE.md, 'The pro seam'). Every consumer (the Vite plugin,
// the esbuild plugin, the Node module hook and the packaging step) asks resolveProDir once and proTwinOf per resolved
// file; nothing else reads APP_PRO_DIR.
//
// A pro build uses the modules under pro/ (or APP_PRO_DIR); a public build keeps the stubs that sit at the original paths.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Repo-relative POSIX paths that have a stub (at the path) and a pro twin (the same path under the pro dir).
 * The single list: a module moved to pro/ that open code imports is added here.
 */
export const PRO_SEAMS = Object.freeze([
  'src/proParts.js',
  'server/studio/describe/pipeline.js',
  'scripts/evalAi.js',
  'server/studio/build/service.js',
  'server/studio/build/toolchain.js',
  'scripts/packageTemplate.mjs',
  'scripts/desktop/build.js',
  'scripts/checks/storeConfig.js',
  'scripts/release/publishPublic.js',
  'scripts/release/smokeInstaller.js',
  'scripts/release/smokeSidecar.js',
  'server/license/index.js',
  'server/pro.js',
  'server/ai/providers/openaiCompat.js',
  'src/components/settings/cloudUi.js',
]);

/** The env a public build runs with, wherever the repo has a pro/ folder. */
export const PUBLIC_BUILD_ENV = Object.freeze({ APP_PRO_DIR: 'none' });

const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Which build this is and where its pro modules are.
 * APP_PRO_DIR unset or empty: `<root>/pro` when `<root>/pro/server` is a folder, else public.
 * `none`: public, even when pro/ is present. Any other value: that folder (absolute, or relative to root); a folder
 * that does not exist throws, so a typo never turns into a quiet public build.
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [root]
 * @returns {{ mode: 'pro' | 'public', dir: string | null }}
 * @throws {Error} when APP_PRO_DIR names a folder that is not there
 */
export function resolveProDir(env = process.env, root = REPO_ROOT) {
  const raw = String(env?.APP_PRO_DIR ?? '').trim();
  if (raw === 'none') return { mode: 'public', dir: null };
  if (raw === '') {
    const dir = path.join(root, 'pro');
    return isDir(path.join(dir, 'server')) ? { mode: 'pro', dir } : { mode: 'public', dir: null };
  }
  const dir = path.resolve(root, raw);
  if (!isDir(dir)) throw new Error(`APP_PRO_DIR names a folder that does not exist: ${dir}. Use "none" for a public build.`);
  return { mode: 'pro', dir };
}

const win = () => process.platform === 'win32';
const fold = (p) => (win() ? p.toLowerCase() : p);

/**
 * The pro twin of a file, when that file is a seam and the build is a pro build.
 * @param {string} absPath absolute path (a query string is ignored)
 * @param {{ mode: 'pro' | 'public', dir: string | null }} resolved
 * @param {string} [root]
 * @returns {string | null} absolute path of the twin, else null
 */
export function proTwinOf(absPath, resolved, root = REPO_ROOT) {
  if (resolved.mode !== 'pro' || !resolved.dir) return null;
  const rel = path.relative(root, absPath.split('?')[0]).split(path.sep).join('/');
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const seam = PRO_SEAMS.find((s) => fold(s) === fold(rel));
  return seam ? path.join(resolved.dir, seam) : null;
}

/**
 * True when a file lives under the pro folder `<root>/pro`.
 * @param {string} absPath
 * @param {string} [root]
 * @returns {boolean}
 */
export function isUnderProDir(absPath, root = REPO_ROOT) {
  const rel = path.relative(path.join(root, 'pro'), absPath.split('?')[0]);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * The folders a build must treat as pro code: `<root>/pro` and, when a pro build points elsewhere (APP_PRO_DIR), that folder.
 * A refusal list built from this follows the resolved folder instead of assuming `pro/`.
 * @param {string} [root]
 * @param {Record<string, string | undefined>} [env]
 * @returns {string[]} absolute folders, `<root>/pro` first
 * @throws {Error} when APP_PRO_DIR names a folder that is not there
 */
export function proFolders(root = REPO_ROOT, env = process.env) {
  const dirs = [path.join(root, 'pro')];
  const { dir } = resolveProDir(env, root);
  if (dir && fold(path.resolve(dir)) !== fold(path.resolve(dirs[0]))) dirs.push(dir);
  return dirs;
}
