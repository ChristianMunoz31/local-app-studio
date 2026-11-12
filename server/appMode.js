// The app mode (ADR-001): one codebase, two modes. `studio` is the product; `runtime` is what every built
// app is. Pure resolution lives in resolveAppMode (used by the server, vite.config.js and the sidecar
// bundler); getAppMode() is what running server code asks.
//
// A bundle bakes its mode in (esbuild define __APP_MODE__), so the shell environment cannot switch it:
//   - a runtime bundle refuses APP_MODE=studio (the Studio code is not in it);
//   - a studio bundle may be switched to runtime by APP_MODE=runtime (the Preview child).
// An unbundled server (npm start, tests) resolves from the environment and config/app-spec.json.
/* global __APP_MODE__ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_MODES = Object.freeze(['studio', 'runtime']);
/** The baked spec, relative to the repo root. Written by the build pipeline into a runtime template, never committed here. */
export const APP_SPEC_RELATIVE_PATH = path.join('config', 'app-spec.json');
export const BUNDLED_APP_MODE = typeof __APP_MODE__ === 'string' ? __APP_MODE__ : undefined;

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Strict reading of an APP_MODE value: unset or blank is null, `studio` and `runtime` are accepted.
 * @param {unknown} raw
 * @param {string} [label] name shown in the error message
 * @returns {'studio' | 'runtime' | null}
 * @throws {Error} on any other value
 */
export function parseAppMode(raw, label = 'APP_MODE') {
  const value = String(raw ?? '').trim();
  if (value === '') return null;
  if (value === 'studio' || value === 'runtime') return value;
  throw new Error(`${label} must be one of ${APP_MODES.join(', ')} (got "${value}")`);
}

/**
 * ADR-001: `APP_MODE` if set, else `runtime` when config/app-spec.json exists, else `studio`.
 * @param {Record<string, string | undefined>} [env]
 * @param {{ root?: string }} [opts] repo root (default: this repo)
 * @returns {'studio' | 'runtime'}
 * @throws {Error} when APP_MODE is set to anything but studio or runtime
 */
export function resolveAppMode(env = process.env, { root = DEFAULT_ROOT } = {}) {
  const forced = parseAppMode(env?.APP_MODE);
  if (forced) return forced;
  return fs.existsSync(path.join(root, APP_SPEC_RELATIVE_PATH)) ? 'runtime' : 'studio';
}

/**
 * The mode of the running server, given a baked mode (or none for a source checkout).
 * @param {Record<string, string | undefined>} env
 * @param {string | undefined} bundled
 * @param {{ root?: string }} [opts]
 * @returns {'studio' | 'runtime'}
 * @throws {Error} when a runtime bundle is asked to run as studio
 */
export function effectiveAppMode(env, bundled, opts) {
  if (bundled === undefined) return resolveAppMode(env, opts);
  const baked = parseAppMode(bundled, 'baked app mode') ?? 'studio';
  const forced = parseAppMode(env?.APP_MODE);
  if (baked === 'runtime' && forced === 'studio') {
    throw new Error('This build is a runtime build and cannot run in studio mode.');
  }
  if (baked === 'studio' && forced === 'runtime') return 'runtime';
  return baked;
}

let cachedMode;

/**
 * The mode of the running server (cached for the life of the process).
 * @returns {'studio' | 'runtime'}
 */
export function getAppMode() {
  if (cachedMode === undefined) cachedMode = effectiveAppMode(process.env, BUNDLED_APP_MODE);
  return cachedMode;
}

/** Test seam: forget the cached mode so the next getAppMode() reads the environment again. */
export function resetAppModeCache() {
  cachedMode = undefined;
}
