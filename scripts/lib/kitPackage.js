// Pure helpers behind scripts/package-kit.mjs: the exclusion predicate, tag resolution, the third-party
// notices generator, the safety scan, gitleaks discovery and sha256sum formatting. Nothing here touches
// git or writes the ZIP; package-kit.mjs owns the orchestration.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadHashedDenylist, parseDenylist, scanPath, scanText as scanPersonal } from '../checks/personalData.js';
import { isCheckedFile as isKeyCheckedFile, scanText as scanKeys } from '../checks/noPrivateKeys.js';

export const KIT_NAME = 'tauri-local-ai-starter';
export const NOTICES_FILE = 'THIRD_PARTY_NOTICES.md';
export const REQUIRED_FILES = Object.freeze(['LICENSE', 'CHANGELOG.md']);
export const WINDOWS_TARGETS = Object.freeze(['x86_64-pc-windows-msvc', 'aarch64-pc-windows-msvc']);

/** A failure the CLI reports as one clear message (no stack trace). */
export class KitError extends Error {}

const TAG_RE = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Picks the tag to package. `implied` is true when the tag comes from package.json (then the working tree
 * must be clean, because the tag is expected to be the release being prepared right now).
 * @param {{ tagArg?: string | undefined, version: string }} opts
 * @returns {{ tag: string, implied: boolean }}
 */
export function resolveTag({ tagArg, version }) {
  const implied = !tagArg;
  const tag = implied ? `v${String(version ?? '').trim()}` : String(tagArg).trim();
  if (!TAG_RE.test(tag)) {
    throw new KitError(`"${tag}" is not a release tag like v1.2.3 (package.json version: ${JSON.stringify(version)}).`);
  }
  return { tag, implied };
}

export const archiveRootName = (tag) => `${KIT_NAME}-${tag}`;

/** Contents of a `<zip>.sha256` file in `sha256sum` format (two spaces, then the file name). */
export function formatSha256File(hex, fileName) {
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new KitError('Not a SHA-256 hex digest.');
  return `${hex}  ${fileName}\n`;
}

export const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');

export function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let value = bytes;
  let unit = -1;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(2)} ${units[unit]}`;
}

// ---------------------------------------------------------------------------------------------------------
// Exclusions
// ---------------------------------------------------------------------------------------------------------

const ROOT_DIRS = new Map([
  ['data', 'local data'],
  ['logs', 'logs'],
  ['.sidecar-build', 'sidecar build output'],
  ['.dev-build', 'dev build output'],
]);
const ANY_DEPTH_DIRS = new Map([
  ['.git', 'git metadata'],
  ['node_modules', 'installed dependencies'],
  ['dist', 'build output'],
  ['coverage', 'test output'],
  ['test-results', 'test output'],
  ['playwright-report', 'test output'],
  ['blob-report', 'test output'],
  ['.idea', 'editor files'],
]);
const TAURI_DIRS = ['target', 'binaries', 'gen', 'resources'];
const FILE_RULES = [
  [/\.(db|db-wal|db-shm|bak|sqlite3?)$/i, 'local data'],
  [/\.(csv|tsv|xlsx)$/i, 'spreadsheet or data export'],
  [/\.log$/i, 'logs'],
  [/\.(pem|key|p12|pfx)$/i, 'private key material'],
  [/\.local$/i, 'local-only file'],
  [/^license-[^/]*\.json$/i, 'license activation, clock or trial record'],
];

/**
 * The rule that keeps a repo-relative path out of the kit, or null when it ships. Forward slashes only.
 * This runs on every archive entry as defense in depth next to the `export-ignore` lines in .gitattributes.
 * @param {string} relPath
 * @returns {string | null}
 */
export function excludeRule(relPath) {
  const p = String(relPath).replace(/\\/g, '/').replace(/^\.\//, '');
  const segs = p.split('/').filter(Boolean);
  if (!segs.length) return null;
  const lower = segs.map((s) => s.toLowerCase());
  const base = lower[lower.length - 1];

  for (const s of lower) if (ANY_DEPTH_DIRS.has(s)) return ANY_DEPTH_DIRS.get(s);
  if (ROOT_DIRS.has(lower[0]) && (segs.length > 1 || ROOT_DIRS.has(base))) return ROOT_DIRS.get(lower[0]);
  if (/^dist-/.test(lower[0])) return 'build output';
  if (lower[0] === 'src-tauri' && TAURI_DIRS.includes(lower[1] ?? '')) return 'Tauri build output';
  if (lower[0] === 'src-tauri' && lower[1] === 'tauri.dev.build.json') return 'generated dev build config';
  if (lower[0] === '.vscode' && segs.length > 1 && base !== 'extensions.json') return 'editor files';
  if (lower[0] === '.claude' && base === 'settings.local.json') return 'local Claude Code settings';
  if (base === '.personal-denylist') return 'seller-only private term list';
  if (base === '.env' || (base.startsWith('.env.') && base !== '.env.example')) return 'environment file';
  if (base === '.npmrc') return 'package manager config (can hold tokens)';
  if (base === 'claude.local.md') return 'local Claude Code notes';
  if (base === 'secrets.key') return 'private key material';
  if (['.ds_store', 'nul'].includes(base)) return 'editor or OS junk';
  for (const [re, name] of FILE_RULES) if (re.test(base)) return name;
  return null;
}

export const isExcluded = (relPath) => excludeRule(relPath) !== null;

// ---------------------------------------------------------------------------------------------------------
// Third-party notices
// ---------------------------------------------------------------------------------------------------------

const LICENSE_FILE_RE = /^(licen[cs]e|copying|unlicense)([._-].*)?$/i;
const MAX_LICENSE_BYTES = 256 * 1024;

/** Reads the license files (LICENSE, LICENCE, COPYING, UNLICENSE and variants) in a package directory. */
export function readLicenseFiles(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names.sort()) {
    if (!LICENSE_FILE_RE.test(name)) continue;
    const file = path.join(dir, name);
    try {
      const st = fs.statSync(file);
      if (!st.isFile() || st.size > MAX_LICENSE_BYTES) continue;
      out.push({ file: name, text: fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trim() });
    } catch {
      // Unreadable file: treated as absent.
    }
  }
  return out.filter((f) => f.text);
}

function licenseOf(lockEntry, pkgJson) {
  const candidates = [lockEntry?.license, pkgJson?.license];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
    if (c && typeof c === 'object' && typeof c.type === 'string') return c.type;
  }
  if (Array.isArray(pkgJson?.licenses)) {
    const types = pkgJson.licenses.map((l) => (typeof l === 'string' ? l : l?.type)).filter(Boolean);
    if (types.length) return types.join(' OR ');
  }
  return 'UNKNOWN';
}

function cleanUrl(url) {
  return String(url ?? '')
    .trim()
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^ssh:\/\/git@/, 'https://')
    .replace(/\.git$/, '');
}

function repositoryOf(pkgJson) {
  const repo = pkgJson?.repository;
  const url = typeof repo === 'string' ? repo : repo?.url;
  if (url && /^(https?:|git\+|git:|ssh:)/.test(url)) return cleanUrl(url);
  if (url && /^[\w.-]+\/[\w.-]+$/.test(url)) return `https://github.com/${url}`;
  return pkgJson?.homepage ? String(pkgJson.homepage) : '';
}

const nameFromKey = (key) => key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);

/**
 * Production npm packages from a package-lock.json object, with license data read from node_modules.
 * Dev-only entries (`dev` or `devOptional`) and the root are dropped; name@version duplicates collapse.
 * @param {{ packages?: Record<string, object> }} lock
 * @param {string} projectRoot directory holding node_modules (may not exist; license text is then absent)
 */
export function collectNpmPackages(lock, projectRoot) {
  const seen = new Map();
  for (const [key, entry] of Object.entries(lock?.packages ?? {})) {
    if (key === '' || !key.includes('node_modules/')) continue;
    if (entry.dev === true || entry.devOptional === true || entry.link === true) continue;
    const name = entry.name ?? nameFromKey(key);
    const dir = path.join(projectRoot, key);
    let pkgJson = null;
    try {
      pkgJson = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    } catch {
      // No installed copy: lock data only.
    }
    const version = entry.version ?? pkgJson?.version ?? '';
    const id = `${name}@${version}`;
    if (seen.has(id)) continue;
    // A mismatched installed copy (a different checkout than the tag) must not supply license text.
    const usable = pkgJson && (!pkgJson.version || pkgJson.version === version);
    seen.set(id, {
      name,
      version,
      license: licenseOf(entry, usable ? pkgJson : null),
      repository: usable ? repositoryOf(pkgJson) : '',
      texts: usable ? readLicenseFiles(dir) : [],
    });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/**
 * Components that ship INSIDE an npm package's own files, so the lock file does not list them: unpdf bundles a
 * build of Mozilla's pdf.js (Apache-2.0; unpdf itself is MIT). The license text is vendored under
 * scripts/lib/bundled-licenses/<dir>/ because the npm package does not carry it. Update the entry when unpdf's
 * bundled pdfjs-dist version changes (its devDependency `pdfjs-dist`). `requiredByVersion` is the version of the
 * carrying package this entry was checked against; collectBundledComponents refuses a lock file with another one, so
 * a dependency bump cannot ship a notice that names the wrong pdf.js version.
 *
 * The runtime package (@local-app-studio/runtime, MIT) is listed the same way: the lock file holds it only as a workspace link, and
 * the app's own license (AGPL) differs from its. `workspace` is its folder; the version is read from that folder's package.json, so a
 * release bump cannot leave a stale notice. Its license text here is a copy of packages/runtime/LICENSE (a test keeps them equal).
 */
export const BUNDLED_COMPONENTS = Object.freeze([
  Object.freeze({
    name: 'pdf.js (pdfjs-dist, bundled inside unpdf)',
    version: '6.1.200',
    license: 'Apache-2.0',
    repository: 'https://github.com/mozilla/pdf.js',
    dir: 'pdfjs-dist',
    requiredBy: 'unpdf',
    requiredByVersion: '1.8.1',
  }),
  Object.freeze({
    name: '@local-app-studio/runtime (the runtime slice, a workspace package of this repository)',
    version: '',
    license: 'MIT',
    repository: 'packages/runtime in this repository',
    dir: 'local-app-studio-runtime',
    requiredBy: '@local-app-studio/runtime',
    workspace: 'packages/runtime',
  }),
]);

/** The `version` of a workspace package folder's package.json. */
function workspaceVersion(projectRoot, workspace) {
  const file = path.join(projectRoot, ...workspace.split('/'), 'package.json');
  const version = JSON.parse(fs.readFileSync(file, 'utf8')).version;
  if (typeof version !== 'string' || !version) throw new Error(`${workspace}/package.json has no version.`);
  return version;
}

/**
 * The bundled components that apply to this lock file (the package that carries them is a production dependency),
 * with their vendored license text.
 * @param {{ packages?: Record<string, object> }} lock
 * @param {string} projectRoot repository root holding scripts/lib/bundled-licenses
 * @throws {Error} when the locked version of the carrying package is not the one the entry was checked against
 */
export function collectBundledComponents(lock, projectRoot) {
  /** @type {Map<string, Set<string>>} package name -> locked production versions */
  const present = new Map();
  for (const [key, entry] of Object.entries(lock?.packages ?? {})) {
    if (!key.includes('node_modules/') || entry.dev === true || entry.devOptional === true) continue;
    const name = entry.name ?? nameFromKey(key);
    present.set(name, (present.get(name) ?? new Set()).add(String(entry.version ?? '')));
  }
  const applicable = BUNDLED_COMPONENTS.filter((c) => present.has(c.requiredBy));
  for (const c of applicable) {
    const versions = [...present.get(c.requiredBy)];
    if (c.requiredByVersion && versions.some((v) => v !== c.requiredByVersion)) {
      throw new Error(
        `${c.requiredBy} is locked at ${versions.join(', ')} but BUNDLED_COMPONENTS names the pdf.js bundled in ${c.requiredBy}@${c.requiredByVersion}. ` +
          `Check which pdfjs-dist version the new release bundles, then update version and requiredByVersion for "${c.name}".`,
      );
    }
  }
  return applicable.map((c) => ({
    name: c.name,
    version: c.workspace ? workspaceVersion(projectRoot, c.workspace) : c.version,
    license: c.license,
    repository: c.repository,
    texts: readLicenseFiles(path.join(projectRoot, 'scripts', 'lib', 'bundled-licenses', c.dir)),
  }));
}

/**
 * Third-party Rust crates from one or more `cargo metadata` objects (one per target platform), unioned.
 * Workspace and path crates (`source: null`, which includes the app's own crate) are dropped. When the
 * metadata has a resolve graph, crates only reachable through dev-dependencies are dropped too.
 * @param {object[]} metadatas
 */
export function collectRustPackages(metadatas) {
  const seen = new Map();
  for (const meta of metadatas) {
    const packages = meta?.packages ?? [];
    const reachable = reachableIds(meta);
    for (const pkg of packages) {
      if (pkg.source === null || pkg.source === undefined) continue;
      if (reachable && !reachable.has(pkg.id)) continue;
      const id = `${pkg.name}@${pkg.version}`;
      if (seen.has(id)) continue;
      const dir = pkg.manifest_path ? path.dirname(pkg.manifest_path) : null;
      seen.set(id, {
        name: pkg.name,
        version: pkg.version,
        license: pkg.license || (pkg.license_file ? `see ${pkg.license_file}` : 'UNKNOWN'),
        repository: pkg.repository || pkg.homepage || '',
        texts: dir ? readLicenseFiles(dir) : [],
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/** Ids reachable from the resolve root through non-dev dependency edges, or null without a resolve graph. */
function reachableIds(meta) {
  const nodes = meta?.resolve?.nodes;
  const root = meta?.resolve?.root;
  if (!Array.isArray(nodes) || !root) return null;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Set([root]);
  const queue = [root];
  while (queue.length) {
    const node = byId.get(queue.pop());
    for (const dep of node?.deps ?? []) {
      const kinds = dep.dep_kinds ?? [];
      const dev = kinds.length > 0 && kinds.every((k) => k.kind === 'dev');
      if (dev || out.has(dep.pkg)) continue;
      out.add(dep.pkg);
      queue.push(dep.pkg);
    }
  }
  return out;
}

/**
 * Renders THIRD_PARTY_NOTICES.md. License texts are written once in an appendix and referenced by id, so a
 * hundred packages sharing the Apache-2.0 text do not repeat it.
 * @param {{ kitName?: string, tag: string, npm: object[], rust: object[], bundled?: object[], rustNote?: string }} input
 *   `bundled` is from collectBundledComponents
 */
export function renderNotices({ kitName = KIT_NAME, tag, npm, rust, bundled = [], rustNote = '' }) {
  const textIds = new Map();
  const usedBy = [];
  const refs = (pkg, label) => {
    if (!pkg.texts.length) return 'License text: not included in the package; see the repository or license identifier above.';
    const ids = pkg.texts.map((t) => {
      const hash = sha256Hex(t.text);
      if (!textIds.has(hash)) {
        textIds.set(hash, textIds.size + 1);
        usedBy.push({ id: textIds.size, text: t.text, users: [] });
      }
      const id = textIds.get(hash);
      usedBy[id - 1].users.push(label);
      return `[LT-${id}](#lt-${id}) (${t.file})`;
    });
    return `License text: ${ids.join(', ')}`;
  };
  const section = (title, list, kind) => {
    const lines = [`## ${title} (${list.length})`, ''];
    for (const pkg of list) {
      const label = `${pkg.name}@${pkg.version}`;
      lines.push(`### ${label}`, '', `- License: ${pkg.license}`);
      if (pkg.repository) lines.push(`- Source: ${pkg.repository}`);
      lines.push(`- ${refs(pkg, `${kind}: ${label}`)}`, '');
    }
    return lines;
  };

  const lines = [
    '# Third-party notices',
    '',
    `${kitName} ${tag} depends on the third-party packages listed below. They are installed by npm and Cargo when`,
    'you build; their licenses are reproduced here. This file is generated when the kit is packaged, from',
    'package-lock.json (production npm dependencies only) and from Cargo metadata (Rust crates compiled into the',
    'desktop shell). Each package stays under its own license.',
    '',
    'Installers built from this kit also include the Node.js runtime, because the desktop sidecar is a Node',
    'single-executable application. The runtime brings its own bundled components (OpenSSL, ICU and others).',
    'The Node.js LICENSE that matches the Node version used to build the sidecar must be shipped with the installer: take it',
    'from that Node install folder, or from https://github.com/nodejs/node/blob/v<version>/LICENSE (for example v24.0.0).',
    '',
    ...section('npm packages', npm, 'npm'),
    ...(bundled.length > 0 ? section('Components bundled inside npm packages', bundled, 'bundled') : []),
    ...section('Rust crates', rust, 'crate'),
  ];
  if (rustNote) lines.push(`> ${rustNote}`, '');
  lines.push('## License texts', '');
  for (const t of usedBy) {
    lines.push(`### <a id="lt-${t.id}"></a>LT-${t.id}`, '', `Used by: ${t.users.join(', ')}`, '', '```text', t.text, '```', '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

// ---------------------------------------------------------------------------------------------------------
// Safety scan
// ---------------------------------------------------------------------------------------------------------

const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|icns|woff2?|ttf|otf|eot|zip|gz|pdf|db|bak|mp3|mp4|wasm|exe)$/i;

function looksBinary(bytes) {
  const head = bytes.subarray(0, 8192);
  for (let i = 0; i < head.length; i++) if (head[i] === 0) return true;
  return false;
}

/** Denylist terms for a repo root: its `.personal-denylist`, the hashed list, and PERSONAL_DENYLIST. */
export function loadForbiddenTerms(repoRoot, env = process.env) {
  const file = path.join(repoRoot, '.personal-denylist');
  const plain = fs.existsSync(file) ? parseDenylist(fs.readFileSync(file, 'utf8')) : [];
  return {
    denylist: [...plain, ...parseDenylist(env.PERSONAL_DENYLIST)],
    hashed: loadHashedDenylist(path.join(repoRoot, 'scripts', 'checks', 'personal-denylist.hashes.json')),
  };
}

/**
 * Scans the final file set. Findings name the file and the rule, never the matched text.
 * @param {Map<string, Uint8Array>} files repo-relative path to content
 * @param {{ denylist?: string[], hashed?: object[] }} terms
 * @returns {{ file: string, rule: string }[]}
 */
export function scanFileSet(files, { denylist = [], hashed = [] } = {}) {
  const findings = [];
  for (const [file, bytes] of files) {
    for (const hit of scanPath(file, denylist, hashed)) {
      findings.push({ file, rule: `forbidden term #${hit.termIndex + 1} in file path` });
    }
    if (BINARY_EXT.test(file) || looksBinary(bytes)) continue;
    const text = Buffer.from(bytes).toString('utf8');
    if (denylist.length || hashed.length) {
      const seen = new Set();
      for (const f of scanPersonal(text, { denylist, hashedDenylist: hashed })) {
        if (f.kind !== 'denylist' || seen.has(f.termIndex)) continue;
        seen.add(f.termIndex);
        findings.push({ file, rule: `forbidden term #${f.termIndex + 1} (line ${f.line})` });
      }
    }
    if (isKeyCheckedFile(file)) {
      for (const f of scanKeys(text)) findings.push({ file, rule: `private key (${f.kind}, line ${f.line})` });
    }
  }
  return findings;
}

/**
 * Path to gitleaks: GITLEAKS_BIN when set and present, else the first `gitleaks` on PATH, else null.
 * Only .exe and extensionless candidates are considered: Node cannot spawn a .cmd shim without a shell.
 * A set-but-missing GITLEAKS_BIN returns null; callers check `env.GITLEAKS_BIN` to tell that case apart.
 */
export function findGitleaks(env = process.env) {
  if (env.GITLEAKS_BIN) return fs.existsSync(env.GITLEAKS_BIN) ? env.GITLEAKS_BIN : null;
  const names = process.platform === 'win32' ? ['gitleaks.exe', 'gitleaks'] : ['gitleaks'];
  for (const dir of String(env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // Not here.
      }
    }
  }
  return null;
}
