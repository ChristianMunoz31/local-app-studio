// The Studio Tauri config overlay and the template step rule (open code). buildDev.js and the installer build
// (pro/scripts/desktop/build.js, behind the stub scripts/desktop/build.js) both read them from here, so the Dev build
// gets the same answer in a pro checkout (where buildDev.js runs with no module hook and sees only the stub build.js)
// as the stable build does.
import path from 'node:path';
import { resolveProDir } from '../lib/proDir.js';
import { ROOT } from './lib.js';

/** Repo-relative resource the Studio build adds to the bundle (written by scripts/packageTemplate.mjs). */
export const TEMPLATE_RESOURCE = 'resources/runtime-template.zip';
/** Where the Studio-only Tauri config overlay is written (CI passes it to `tauri build --config`). */
export const STUDIO_OVERLAY = path.join(ROOT, '.sidecar-build', 'tauri.studio.json');

/**
 * True when the build must package the runtime template: only the Studio app mode ships it, and only a build that
 * has the installer in it (a public build has no packaging step, so a public Dev build must not try one).
 * @param {string} mode 'studio' | 'runtime'
 * @param {{ mode: 'pro' | 'public' }} [resolved] the pro dir decision, default from the environment
 * @returns {boolean}
 */
export function templateStepFor(mode, resolved = resolveProDir()) {
  return mode === 'studio' && resolved.mode === 'pro';
}

/**
 * The Tauri config overlay for a Studio build: the committed resources plus the template ZIP. Tauri merges
 * the overlay over tauri.conf.json, and arrays are replaced, so the base list is repeated in full.
 * @param {{ bundle?: { resources?: unknown } }} tauriConf the parsed committed tauri.conf.json
 * @returns {{ bundle: { resources: string[] } }}
 */
export function studioTauriOverlay(tauriConf) {
  const base = Array.isArray(tauriConf?.bundle?.resources) ? tauriConf.bundle.resources.filter((r) => typeof r === 'string') : [];
  return { bundle: { resources: base.includes(TEMPLATE_RESOURCE) ? base : [...base, TEMPLATE_RESOURCE] } };
}
