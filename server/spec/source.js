// Where the running server gets its AppSpec (ADR-001): baked into a runtime bundle, read from config/app-spec.json
// in an unbundled checkout, or from APP_SPEC_PATH for the Studio preview child. Never imports zod.
/* global __APP_SPEC_JSON__ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_SPEC_RELATIVE_PATH, BUNDLED_APP_MODE, getAppMode } from '../appMode.js';
import { checkSpecShape, compileSpec } from './compile.js';
import { normalizeSpec } from './normalize.js';
import { specCompatProblem } from '@local-app-studio/runtime/runtime/specCompat.js';

export const BUNDLED_SPEC_JSON = typeof __APP_SPEC_JSON__ === 'string' ? __APP_SPEC_JSON__ : undefined;

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * @param {string} file
 * @returns {object}
 * @throws {Error} app_spec_unreadable
 */
export function readSpecFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error('app_spec_unreadable');
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('app_spec_unreadable');
  }
}

/**
 * @param {{ env?: Record<string, string | undefined>, mode?: 'studio' | 'runtime', bundledMode?: string, bundledJson?: string, root?: string }} [opts]
 * @returns {{ kind: 'baked' | 'file' | 'path' | 'none', spec: object | null }} spec is normalized
 * @throws {Error} app_spec_unreadable, `app_spec_invalid: <problem>`, or `spec_too_new: <sentence>` (code `spec_too_new`, `sentence`;
 *   the design uses something newer than this version, ADR-015)
 */
export function resolveSpecSource({
  env = process.env,
  mode = getAppMode(),
  bundledMode = BUNDLED_APP_MODE,
  bundledJson = BUNDLED_SPEC_JSON,
  root = DEFAULT_ROOT,
} = {}) {
  if (mode !== 'runtime') return { kind: 'none', spec: null };
  let kind = 'none';
  let raw = null;
  const specPath = (env.APP_SPEC_PATH || '').trim();
  if (bundledMode === 'runtime') {
    if (typeof bundledJson === 'string') {
      raw = parseJson(bundledJson);
      kind = 'baked';
    }
  } else if (bundledMode === 'studio') {
    if (specPath) {
      raw = readSpecFile(specPath);
      kind = 'path';
    }
  } else {
    const file = path.join(root, APP_SPEC_RELATIVE_PATH);
    if (fs.existsSync(file)) {
      raw = readSpecFile(file);
      kind = 'file';
    } else if (specPath) {
      raw = readSpecFile(specPath);
      kind = 'path';
    }
  }
  const spec = acceptSpec(raw);
  if (spec === null) return { kind: 'none', spec: null };
  return { kind, spec };
}

/**
 * The checks a running app makes on the spec it reads, apart from where it reads it: normalize, refuse what is newer, check the
 * shape. The Studio preview manager runs the same function on a saved spec before it keeps a running child (preview/swap.js).
 * @param {unknown} raw the parsed spec file or baked JSON
 * @returns {object | null} the normalized spec, or null when there is none
 * @throws {Error} `app_spec_invalid: <problem>` or `spec_too_new: <sentence>` (code `spec_too_new`, `sentence`)
 */
export function acceptSpec(raw) {
  const spec = normalizeSpec(raw);
  if (spec === null) return null;
  // No schema runs here, so an unknown key is checked as well as the positive evidence (ADR-015). A different specVersion is
  // left to checkSpecShape below (`app_spec_invalid`), as before.
  const newer = specCompatProblem(spec, undefined, { unknownKeys: true, version: false });
  if (newer) throw Object.assign(new Error(`spec_too_new: ${newer.sentence}`), { code: 'spec_too_new', sentence: newer.sentence });
  const problem = checkSpecShape(spec);
  if (problem) throw new Error(`app_spec_invalid: ${problem}`);
  return spec;
}

let cachedSpec;
let cachedCompiled;

/**
 * The normalized spec of the running app: null unless the mode is runtime and a spec exists.
 * @returns {object | null}
 */
export function getAppSpec() {
  if (cachedSpec === undefined) {
    cachedSpec = resolveSpecSource().spec;
    if (cachedSpec === null && getAppMode() === 'runtime') console.log('No app spec found; the app has no tables.');
  }
  return cachedSpec;
}

/**
 * @returns {import('./compile.js').CompiledSpec | null}
 */
export function getCompiledSpec() {
  if (cachedCompiled === undefined) {
    const spec = getAppSpec();
    cachedCompiled = spec ? compileSpec(spec) : null;
  }
  return cachedCompiled;
}

/** Test seam: forget the cached spec so the next call reads the sources again. */
export function resetAppSpecCache() {
  cachedSpec = undefined;
  cachedCompiled = undefined;
}
