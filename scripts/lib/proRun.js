// `node scripts/lib/proRun.js <repo-relative script> [args]`: runs a CLI that has a pro twin. The script must be one of the
// PRO_SEAMS (scripts/lib/proDir.js): in a pro build it runs the twin under the pro folder (with the resolve hook); in a
// public build it runs the stub at the given path, which says the tool is not in this build. Any other path is refused, so
// this launcher can never run an arbitrary file. A missing twin is one plain line and exit 1. The exit code is the child's.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PRO_SEAMS, REPO_ROOT, resolveProDir } from './proDir.js';

// `--import` takes a URL on Windows, not a drive path.
const HOOK = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'proHook.js')).href;

/**
 * What to run for a seam path.
 * @param {string} given the script as written on the command line (repo-relative; `./` and backslashes are tolerated)
 * @param {{ mode: 'pro' | 'public', dir: string | null }} resolved
 * @param {string} [root]
 * @returns {{ script: string } | { error: string }} the file to run, or the one-line reason it cannot run
 */
export function planRun(given, resolved, root = REPO_ROOT) {
  const rel = path.posix.normalize(String(given).replaceAll('\\', '/'));
  if (!PRO_SEAMS.includes(rel)) return { error: `proRun runs only pro seams (see PRO_SEAMS in scripts/lib/proDir.js), not "${given}".` };
  const script = resolved.mode === 'pro' ? path.join(String(resolved.dir), rel) : path.join(root, rel);
  if (!fs.existsSync(script)) return { error: `The pro twin of ${rel} is missing: ${script}. Check APP_PRO_DIR, or use APP_PRO_DIR=none for a public build.` };
  return { script };
}

/** @returns {number} the exit code */
export function main(argv = process.argv.slice(2), env = process.env) {
  const [rel, ...rest] = argv;
  if (!rel) {
    console.error('Usage: node scripts/lib/proRun.js <repo-relative script> [args]');
    return 2;
  }
  let plan;
  try {
    plan = planRun(rel, resolveProDir(env));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  if ('error' in plan) {
    console.error(plan.error);
    return 1;
  }
  const res = spawnSync(process.execPath, ['--import', HOOK, plan.script, ...rest], { cwd: REPO_ROOT, stdio: 'inherit', shell: false });
  return res.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
