// Node module resolve hook of the pro seam (registered by proHook.js, runs on the loader thread). It is the source-checkout
// counterpart of the bundler plugins: `node server.js` is not bundled, so a seam file that resolves to a stub is
// redirected to its pro twin here. It never runs in a bundle.
import { pathToFileURL, fileURLToPath } from 'node:url';
import { REPO_ROOT, proTwinOf } from './proDir.js';

/** @type {{ mode: 'pro' | 'public', dir: string | null }} */
let resolved = { mode: 'public', dir: null };
let root = REPO_ROOT;

/** @param {{ dir: string | null, mode?: 'pro' | 'public', root?: string } | undefined} data */
export function initialize(data) {
  if (!data) return;
  resolved = { mode: data.dir ? (data.mode ?? 'pro') : 'public', dir: data.dir ?? null };
  if (data.root) root = data.root;
}

/**
 * @param {string} specifier
 * @param {object} context
 * @param {(s: string, c: object) => Promise<{ url: string }>} nextResolve
 */
export async function resolve(specifier, context, nextResolve) {
  const out = await nextResolve(specifier, context);
  if (resolved.mode !== 'pro' || !out.url.startsWith('file:')) return out;
  const twin = proTwinOf(fileURLToPath(out.url), resolved, root);
  return twin ? { ...out, url: pathToFileURL(twin).href } : out;
}
