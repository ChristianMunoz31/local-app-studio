// Which optional features this build contains. A build made with APP_CLOUD_AI=off has no cloud
// provider in it (docs/AI.md, 'Building without the cloud provider'). This file is the one place
// that decides it: ask isCloudAiInBuild() instead of reading the environment.
//
// The sidecar bundler bakes __APP_CLOUD_AI__ in, so the shell environment can never switch a bundled
// build. Only an unbundled server (npm start, tests) reads APP_CLOUD_AI: unset, empty or `on` is on,
// anything else is off (a typo fails closed).
/* global __APP_CLOUD_AI__ */
import { PRO_PARTS } from '../src/proParts.js';
import { sendError } from './errors.js';

export const CLOUD_AI_MODES = Object.freeze(['on', 'off']);
export const BUNDLED_CLOUD_AI = typeof __APP_CLOUD_AI__ === 'string' ? __APP_CLOUD_AI__ : undefined;
export const MSG_CLOUD_ABSENT = 'This build contains no cloud provider.';
export const MSG_CLOUD_NOT_PUBLIC = 'The cloud provider is not in a public build.';

/** The pro parts a build can leave out (src/proParts.js), with the sentence a refused request gets. */
export const PRO_PART_NAMES = Object.freeze(['helper', 'installer', 'licensing', 'cloud']);
const MSG_PART_ABSENT = Object.freeze({
  helper: 'The helper is not in this build. Build it yourself in Design.',
  installer: 'Making an installer is not in this build. Export the app instead.',
  licensing: 'Licensing is not in this build.',
  cloud: MSG_CLOUD_ABSENT,
});

// The sentence for a feature this build lacks: the pro part's own, else the cloud provider's (the network feature `cloudAi`).
const absentMessage = (feature) => (Object.hasOwn(MSG_PART_ABSENT, feature) ? MSG_PART_ABSENT[feature] : MSG_CLOUD_ABSENT);

/**
 * Whether a pro part is in this build.
 * @param {string} part one of PRO_PART_NAMES
 * @param {Readonly<Record<string, boolean>>} [parts] tests pass their own table
 * @returns {boolean}
 */
export const isProPartInBuild = (part, parts = PRO_PARTS) => parts[part] === true;

/**
 * Express middleware for a route that needs a pro part: 403 feature_unavailable (the error envelope, no-store) when this
 * build lacks it. Mount it first on the route, before body validation and before requireAi.
 * @param {string} part one of PRO_PART_NAMES
 * @param {Readonly<Record<string, boolean>>} [parts]
 * @returns {import('express').RequestHandler}
 */
export function requireInBuild(part, parts = PRO_PARTS) {
  if (!PRO_PART_NAMES.includes(part)) throw new Error(`Unknown pro part "${String(part)}"`);
  return (_req, res, next) => {
    if (isProPartInBuild(part, parts)) return next();
    return sendError(res, 'feature_unavailable', { message: MSG_PART_ABSENT[part], extra: { feature: part } });
  };
}

/**
 * 'on' or 'off' for the running server. Never cached.
 * @param {Record<string, string | undefined>} [env]
 * @param {string | undefined} [bundled] the bundled define; tests pass `undefined` to simulate a source checkout
 * @returns {'on' | 'off'}
 */
export function getCloudAiBuild(env = process.env, bundled = BUNDLED_CLOUD_AI) {
  if (!PRO_PARTS.cloud) return 'off';
  if (bundled !== undefined) return bundled === 'on' ? 'on' : 'off';
  const raw = (env.APP_CLOUD_AI ?? '').trim();
  return raw === '' || raw === 'on' ? 'on' : 'off';
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @param {string | undefined} [bundled]
 * @returns {boolean}
 */
export const isCloudAiInBuild = (env = process.env, bundled = BUNDLED_CLOUD_AI) => getCloudAiBuild(env, bundled) === 'on';

/**
 * Strict reading for build scripts: unset or empty is `on`, only `on` and `off` are accepted.
 * @param {Record<string, string | undefined>} env reads `APP_CLOUD_AI`
 * @param {string} [label] name shown in the error message (for example `--cloud-ai`)
 * @param {{ mode: 'pro' | 'public' }} [resolved] the resolved pro dir (scripts/lib/proDir.js); a public build has no cloud
 *   provider, so it answers `off` and refuses an explicit `on`
 * @returns {'on' | 'off'}
 * @throws {Error} on any other value, or `on` in a public build
 */
export function resolveBuildCloudAi(env, label = 'APP_CLOUD_AI', resolved = undefined) {
  const raw = String(env?.APP_CLOUD_AI ?? '').trim();
  if (resolved?.mode === 'public') {
    if (raw === 'on') throw new Error(MSG_CLOUD_NOT_PUBLIC);
    if (raw === '' || raw === 'off') return 'off';
    throw new Error(`${label} must be one of ${CLOUD_AI_MODES.join(', ')} (got "${raw}")`);
  }
  if (raw === '') return 'on';
  if (raw === 'on' || raw === 'off') return raw;
  throw new Error(`${label} must be one of ${CLOUD_AI_MODES.join(', ')} (got "${raw}")`);
}

/**
 * Whether a network feature id exists in this build. Only `cloudAi` can be left out.
 * @param {string} id
 * @param {Record<string, string | undefined>} [env]
 * @param {string | undefined} [bundled]
 * @returns {boolean}
 */
export const isFeatureInBuild = (id, env = process.env, bundled = BUNDLED_CLOUD_AI) => id !== 'cloudAi' || isCloudAiInBuild(env, bundled);

/**
 * The 403 body for a feature this build does not contain.
 * @param {string} feature
 */
export function featureUnavailableBody(feature) {
  return { error: 'feature_unavailable', code: 'feature_unavailable', feature, message: absentMessage(feature) };
}

/** Thrown by library code (not routes) when a feature this build lacks is invoked. */
export class FeatureUnavailableError extends Error {
  /** @param {string} feature */
  constructor(feature) {
    super(absentMessage(feature));
    this.name = 'FeatureUnavailableError';
    this.status = 403;
    this.feature = feature;
    this.body = featureUnavailableBody(feature);
  }
}
