// Release channel: 'stable' (Local App Studio) or 'dev' (Local App Studio Dev, a side-by-side test build).
// This file is the one place that decides the channel. Ask isDevChannel() instead of comparing strings.
// The sidecar bundler bakes __APP_CHANNEL__ in, so the shell environment can never switch a
// bundled build. Only a source checkout (npm start) reads APP_CHANNEL from the environment.
/* global __APP_CHANNEL__ */

export const CHANNELS = Object.freeze(['stable', 'dev']);
export const DEV_VERSION_RE = /^(\d+)\.(\d+)\.(\d+)-dev\.(\d{8})\.([0-9a-f]{7})$/;
export const DEV_TAG_RE = /^dev-(\d{8})-([0-9a-f]{7})$/;
export const BUNDLED_CHANNEL = typeof __APP_CHANNEL__ === 'string' ? __APP_CHANNEL__ : undefined;

/**
 * Exact match only.
 * @param {unknown} value
 * @returns {'stable' | 'dev' | null}
 */
export function parseChannel(value) {
  return value === 'stable' || value === 'dev' ? value : null;
}

/**
 * Runtime channel of this server process.
 *
 * Precedence: the bundled `__APP_CHANNEL__` esbuild define wins when present (a sidecar always has
 * it, so the environment cannot switch a bundled build). Only when unbundled (a source checkout, e.g.
 * `npm start`) is the env var `APP_CHANNEL` read, and only the exact value `dev` selects dev. Anything
 * else, including unset, is `stable`.
 *
 * This is not a trust boundary: a source checkout or zip can set the env var. It decides which
 * behavior and data folder to use, and backs safety nets against mistakes.
 *
 * Matching signals: the build-time `channel` field in `dist/local-app-studio-build-info.json` (written by
 * scripts/license/writeBuildInfo.js, for build checks only) and the client-side `channel` field of
 * `GET /api/app-info` (server/appInfoRoutes.js). To ask "is this Local App Studio Dev?" in server code, use
 * isDevChannel().
 * @param {Record<string, string | undefined>} [env]
 * @param {string | undefined} [bundled] the bundled define; tests pass `undefined` to simulate a source checkout
 * @returns {'stable' | 'dev'}
 */
export function getChannel(env = process.env, bundled = BUNDLED_CHANNEL) {
  if (bundled !== undefined) return bundled === 'dev' ? 'dev' : 'stable';
  return env.APP_CHANNEL === 'dev' ? 'dev' : 'stable';
}

/**
 * The one place to ask "is this Local App Studio Dev?". Same precedence and caveats as getChannel(): the bundled
 * define wins, env `APP_CHANNEL` is read only when unbundled, and it is not a trust boundary.
 * @param {Record<string, string | undefined>} [env]
 * @param {string | undefined} [bundled]
 * @returns {boolean}
 */
export const isDevChannel = (env = process.env, bundled = BUNDLED_CHANNEL) => getChannel(env, bundled) === 'dev';

/**
 * Build-time channel from the build environment (`APP_CHANNEL`, trimmed; empty or unset is
 * `stable`). Unlike getChannel(), an unknown value is an error, so a typo can never ship as stable.
 * @param {Record<string, string | undefined>} env the build environment
 * @param {string} [label] name used in the error message
 * @returns {'stable' | 'dev'}
 * @throws {Error} on a value other than `stable` or `dev`
 */
export function resolveBuildChannel(env, label = 'APP_CHANNEL') {
  const raw = (env.APP_CHANNEL ?? '').trim();
  const channel = raw === '' ? 'stable' : parseChannel(raw);
  if (channel === null) throw new Error(`${label} must be one of ${CHANNELS.join(', ')} (got "${raw}")`);
  return channel;
}
