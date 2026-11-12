// Release target repositories, read from ONE file: config/release.json at the repo root.
//   sourceRepo    owner/name of the (private) source repo; dev pre-releases are published there
//   releasesRepo  owner/name of the PUBLIC downloads repo; stable installers are published there
// Edit that file once; the release scripts, the in-app update check and the GitHub workflows all read it.
// The JSON import is static so esbuild bakes it into the desktop sidecar (same approach as config/store.json).
import releaseJson from '../../config/release.json' with { type: 'json' };

const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

/**
 * Validates a parsed release config.
 * @param {unknown} raw
 * @returns {{ sourceRepo: string, releasesRepo: string }}
 */
export function parseReleaseConfig(raw) {
  const obj = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const key of ['sourceRepo', 'releasesRepo']) {
    const value = obj[key];
    if (typeof value !== 'string' || !REPO_RE.test(value)) {
      throw new Error(`config/release.json: "${key}" must be an "owner/name" GitHub repository`);
    }
    out[key] = value;
  }
  return Object.freeze({ sourceRepo: out.sourceRepo, releasesRepo: out.releasesRepo });
}

/** The validated, frozen config shipped in config/release.json. */
export const RELEASE_CONFIG = parseReleaseConfig(releaseJson);

/**
 * Escapes text for literal use inside a RegExp.
 * @param {string} text
 * @returns {string}
 */
export const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Re-exported for existing callers. The implementation lives in placeholder.js (see the note there).
export { PLACEHOLDER_REPO_OWNER, isPlaceholderRepo } from './placeholder.js';
