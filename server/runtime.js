// Packaging seams. In the repo these resolve from import.meta.url / package.json as before; the
// desktop sidecar bundle (scripts/desktop/buildSidecar.js) points them at files shipped beside the
// executable via env, and bakes the app version in at build time.
/* global __APP_APP_VERSION__ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Directory override from env (absolute), or undefined when unset/blank.
 * @param {string} name Env var name, e.g. APP_DIST_DIR.
 * @param {Record<string, string | undefined>} [env]
 * @returns {string | undefined}
 */
export function envDir(name, env = process.env) {
  const value = (env[name] || '').trim();
  return value ? path.resolve(value) : undefined;
}

/** App version injected by the sidecar bundler (esbuild define), else undefined. */
export const BUNDLED_APP_VERSION = typeof __APP_APP_VERSION__ === 'string' ? __APP_APP_VERSION__ : undefined;

/**
 * Desktop (Tauri sidecar) mode is on iff APP_DESKTOP=1.
 * @param {Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function isDesktopMode(env = process.env) {
  return env.APP_DESKTOP === '1';
}

let cachedVersion;

/**
 * App version: the bundler-injected value, else package.json, else 'unknown'.
 * @returns {string}
 */
export function getAppVersion() {
  if (BUNDLED_APP_VERSION) return BUNDLED_APP_VERSION;
  if (cachedVersion !== undefined) return cachedVersion;
  try {
    const raw = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8');
    const version = JSON.parse(raw).version;
    cachedVersion = typeof version === 'string' && version ? version : 'unknown';
  } catch {
    cachedVersion = 'unknown';
  }
  return cachedVersion;
}
