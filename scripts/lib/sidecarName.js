// One source of truth for the sidecar executable name used by the guards and the smoke. init-app.mjs treats
// package.json "name" as the kebab name and derives the sidecar as `${kebab}-server` (see its `sidecar` field,
// also the tauri.conf.json externalBin), so the same derivation here keeps these scripts correct after a rename.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Sidecar base name: package.json "name" plus "-server".
 * @param {string} [root] repo root holding package.json
 * @returns {string}
 */
export function sidecarBaseName(root = ROOT) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (typeof pkg.name !== 'string' || pkg.name.trim() === '') {
    throw new Error(`package.json in ${root} has no "name", so the sidecar name cannot be derived.`);
  }
  return `${pkg.name.trim()}-server`;
}

/**
 * File name of the sidecar executable built into .sidecar-build for a platform.
 * @param {{ root?: string, platform?: string }} [opts]
 * @returns {string}
 */
export function sidecarExeName({ root = ROOT, platform = process.platform } = {}) {
  return `${sidecarBaseName(root)}${platform === 'win32' ? '.exe' : ''}`;
}

/**
 * Executables in `dir` that look like a sidecar (`*-server` or `*-server.exe`) but do not carry the expected
 * name. A non-empty result means a guard would otherwise look for the wrong file and pass without checking.
 * @param {string} dir
 * @param {string} expectedName file name from sidecarExeName
 * @returns {string[]} file names
 */
export function findStraySidecars(dir, expectedName) {
  if (!fs.existsSync(dir)) return [];
  const base = expectedName.replace(/\.exe$/, '');
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /-server(\.exe)?$/.test(e.name) && e.name.replace(/\.exe$/, '') !== base)
    .map((e) => e.name);
}
