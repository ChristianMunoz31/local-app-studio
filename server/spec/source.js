// Where the running server gets its AppSpec (ADR-001): baked into a runtime bundle, read from config/app-spec.json
// in an unbundled checkout, or from APP_SPEC_PATH for the Studio preview child. Never imports zod.
/* global __APP_SPEC_JSON__ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_SPEC_RELATIVE_PATH, BUNDLED_APP_MODE, getAppMode } from '../appMode.js';
import { checkSpecShape, compileSpec } from './compile.js';
import { normalizeSpec } from './normalize.js';

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
 * @throws {Error} app_spec_unreadable, or `app_spec_invalid: <problem>`
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
  const spec = normalizeSpec(raw);
  if (spec === null) return { kind: 'none', spec: null };
  const problem = checkSpecShape(spec);
  if (problem) throw new Error(`app_spec_invalid: ${problem}`);
  return { kind, spec };
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
