// Regenerates the npm part of THIRD_PARTY_NOTICES.md from package-lock.json.
// Usage: node scripts/release/thirdPartyNotices.js [--check]
//   (no flag)  rewrite the block between the generated markers in THIRD_PARTY_NOTICES.md
//   --check    exit 1 when the file is not up to date, change nothing
// Production dependencies only (no dev, no workspace packages). Name, version, license and repository come from
// node_modules/<path>/package.json, with the lockfile license as the fallback. Output is sorted and has no machine paths.
// Needs only Node built-ins. Install first (npm ci) so node_modules exists.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const START_MARKER = '<!-- generated:start (node scripts/release/thirdPartyNotices.js) -->';
export const END_MARKER = '<!-- generated:end -->';
const MARKER = 'node_modules/';

/**
 * Name of the package a lockfile path points at (the part after the last `node_modules/`).
 * @param {string} lockPath
 * @returns {string}
 */
export function nameFromLockPath(lockPath) {
  return lockPath.slice(lockPath.lastIndexOf(MARKER) + MARKER.length);
}

/** @param {{ name: string, version: string }[]} list */
export function sortEntries(list) {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en', { numeric: true }));
}

/**
 * A license field as one SPDX-ish string. Handles the string, the legacy `{ type }` object and arrays.
 * @param {unknown} value
 * @returns {string} '' when nothing usable
 */
export function licenseText(value) {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(licenseText).filter(Boolean).join(' OR ');
  if (value && typeof value === 'object' && typeof value.type === 'string') return value.type.trim();
  return '';
}

/**
 * Production, non-workspace entries of a lockfile (v2 or v3), one per name@version, with their lock paths.
 * @param {{ packages?: Record<string, { version?: string, dev?: boolean, devOptional?: boolean, link?: boolean, license?: unknown }> }} lock
 * @returns {{ name: string, version: string, lockPath: string, license: string }[]}
 */
export function productionEntries(lock) {
  const seen = new Map();
  for (const [lockPath, info] of Object.entries(lock?.packages ?? {})) {
    if (lockPath === '' || !lockPath.includes(MARKER)) continue; // root and workspace folders
    if (info.link || info.dev || info.devOptional) continue;
    const name = nameFromLockPath(lockPath);
    const version = info.version ?? '';
    const id = `${name}@${version}`;
    if (!seen.has(id)) seen.set(id, { name, version, lockPath, license: licenseText(info.license) });
  }
  return sortEntries([...seen.values()]);
}

/**
 * A repository field as a plain https URL, or '' when there is none.
 * @param {unknown} repo `repository` or `homepage` of a package.json
 * @returns {string}
 */
export function repositoryUrl(repo) {
  const raw = typeof repo === 'string' ? repo : repo && typeof repo === 'object' && typeof repo.url === 'string' ? repo.url : '';
  let url = raw.trim();
  if (!url) return '';
  const short = /^(github|gitlab|bitbucket):(.+)$/.exec(url);
  if (short) url = `https://${short[1]}.${short[1] === 'bitbucket' ? 'org' : 'com'}/${short[2]}`;
  else if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}`;
  url = url.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/^ssh:\/\/git@/, 'https://').replace(/^git@([^:]+):/, 'https://$1/');
  url = url.replace(/#.*$/, '').replace(/\.git$/, '');
  return /^https?:\/\//.test(url) ? url : '';
}

/** Escapes a table cell. */
function cell(text) {
  return String(text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * The markdown block (counts and table) for resolved entries.
 * @param {{ name: string, version: string, license: string, repository: string }[]} entries
 * @returns {string} without a trailing newline
 */
export function renderBlock(entries) {
  const sorted = sortEntries(entries);
  const counts = new Map();
  for (const e of sorted) {
    const key = e.license || 'UNKNOWN';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const mix = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en')).map(([l, n]) => `${l} (${n})`);
  const lines = [
    '## npm production dependencies',
    '',
    `${sorted.length} packages from \`package-lock.json\` (production only, workspace packages excluded). License mix: ${mix.join(', ') || 'none'}.`,
    '',
    '| Package | Version | License | Source |',
    '| --- | --- | --- | --- |',
    ...sorted.map((e) => `| ${cell(e.name)} | ${cell(e.version)} | ${cell(e.license || 'UNKNOWN')} | ${cell(e.repository || '-')} |`),
  ];
  return lines.join('\n');
}

/**
 * Puts `block` between the markers of `text`; appends a marked block when the markers are absent.
 * @param {string} text
 * @param {string} block
 * @returns {string}
 */
export function replaceGenerated(text, block) {
  const start = text.indexOf(START_MARKER);
  const end = text.indexOf(END_MARKER);
  const wrapped = `${START_MARKER}\n${block}\n${END_MARKER}`;
  if (start === -1 || end === -1 || end < start) return `${text.trimEnd()}\n\n${wrapped}\n`;
  return `${text.slice(0, start)}${wrapped}${text.slice(end + END_MARKER.length)}`;
}

/**
 * Reads license and repository of each entry from node_modules.
 * @param {string} root repo root
 * @param {ReturnType<typeof productionEntries>} entries
 * @returns {{ name: string, version: string, license: string, repository: string }[]}
 */
export function resolveEntries(root, entries) {
  return entries.map((e) => {
    let pkg = {};
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(root, e.lockPath, 'package.json'), 'utf8'));
    } catch {
      // Not installed: the lockfile license stays the only source.
    }
    const license = licenseText(pkg.license ?? pkg.licenses) || e.license;
    return { name: e.name, version: e.version, license, repository: repositoryUrl(pkg.repository) || repositoryUrl(pkg.homepage) };
  });
}

/**
 * Builds the new file text for a repo root.
 * @param {string} root
 * @returns {{ file: string, current: string, next: string, count: number }}
 */
export function generate(root) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const entries = resolveEntries(root, productionEntries(lock));
  const file = path.join(root, 'THIRD_PARTY_NOTICES.md');
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  return { file, current, next: replaceGenerated(current, renderBlock(entries)), count: entries.length };
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const { file, current, next, count } = generate(root);
  if (process.argv.includes('--check')) {
    if (current !== next) {
      console.error('THIRD_PARTY_NOTICES.md is out of date. Run: node scripts/release/thirdPartyNotices.js');
      process.exit(1);
    }
    console.log(`THIRD_PARTY_NOTICES.md is current (${count} packages).`);
    return;
  }
  fs.writeFileSync(file, next);
  console.log(`THIRD_PARTY_NOTICES.md written (${count} packages).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
