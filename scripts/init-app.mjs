// One-time rebrand: turns this starter kit into your own app.
// Usage: npm run init-app -- --name "Acme Notes" --repo acme/notes [options]
// Run it with --help for every option. It needs only Node (no git, no network), so it works on an unzipped
// copy of the kit. It reads the CURRENT names from the tree: re-running with the same arguments changes
// nothing, and different arguments rename from whatever the names are now. A re-rename is plain text
// replacement of your current names, so it refuses single-word or very short current names unless --force.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const KEEP_MARKER = 'init-app:keep';
// The licensing values live in pro/config/store.json (the pro folder); a tree without it has no store config to read or rewrite.
const STORE_CONFIG_PATHS = Object.freeze(['config/store.json', 'pro/config/store.json']);
/** The store config path this tree has (pro/config/store.json in a tree with pro/), else the documented pro location, for messages. */
export function storeConfigRel(root) {
  return STORE_CONFIG_PATHS.find((p) => fs.existsSync(path.join(root, p))) ?? 'pro/config/store.json';
}
export const SUPPORT_PLACEHOLDER = '[OWNER TODO: your support email or URL]';
// The names the kit ships with. They are unique strings, so a first run can replace them anywhere safely.
export const KIT = {
  display: 'Starter App',
  kebab: 'starter-app',
  owner: 'your-github-user',
  releasesName: 'your-app-releases',
  identifierPrefix: 'com.example.',
};
// Icon files carrying one of these comments may be redrawn by init-app: the shipped placeholder, or an icon
// init-app drew earlier. Anything else is the buyer's artwork and is left alone.
export const ICON_PLACEHOLDER_MARKER = '<!-- init-app:placeholder -->';
export const ICON_GENERATED_MARKER = '<!-- init-app:generated -->';

// ---------------------------------------------------------------------------------------------
// Derivation and validation (pure)
// ---------------------------------------------------------------------------------------------

/**
 * Trims and collapses runs of spaces.
 * @param {string} name
 * @returns {string}
 */
export function normalizeName(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * @param {string} name
 * @returns {string | null} an error message, or null when the name is usable
 */
export function validateName(name) {
  const n = normalizeName(name);
  if (!n) return 'The app name is empty.';
  if (n.length < 2 || n.length > 40) return 'The app name must be 2 to 40 characters.';
  if (!/^[A-Za-z]/.test(n)) return 'The app name must start with a letter.';
  if (!/^[A-Za-z0-9 ]+$/.test(n)) return 'The app name may only contain letters (A-Z), digits and spaces.';
  return null;
}

/**
 * Every name the kit uses, derived from the display name.
 * @param {string} name
 * @returns {{
 *   display: string, devDisplay: string, upper: string, kebab: string, compact: string, exe: string,
 *   installerPrefix: string, crate: string, sidecar: string, devSidecar: string,
 *   dataDirWin: string, dataDirDevWin: string, dataDirLinux: string, dataDirDevLinux: string }}
 * @throws {Error} when the name fails validateName
 */
export function deriveNames(name) {
  const problem = validateName(name);
  if (problem) throw new Error(problem);
  const display = normalizeName(name);
  const words = display.split(' ');
  const kebab = words.map((w) => w.toLowerCase()).join('-');
  const exe = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  const installerPrefix = words.join('-');
  const names = {
    display,
    devDisplay: `${display} Dev`,
    upper: display.toUpperCase(),
    kebab,
    compact: words.join('').toLowerCase(),
    exe,
    installerPrefix,
    crate: `${kebab}-desktop`,
    sidecar: `${kebab}-server`,
    devSidecar: `${kebab}-dev-server`,
    dataDirWin: display,
    dataDirDevWin: `${display} Dev`,
    dataDirLinux: kebab,
    dataDirDevLinux: `${kebab}-dev`,
  };
  const exeProblem = validateExecutable(names.exe) ?? validateCrate(names.crate);
  if (exeProblem) throw new Error(exeProblem);
  return names;
}

/**
 * Reverse-DNS bundle identifier. Tauri accepts letters, digits, hyphens and periods; the kit adds a stricter
 * lowercase rule, and ".dev" and ".app" endings are reserved (the Dev channel is the identifier plus ".dev").
 * @param {string} id
 * @returns {string | null}
 */
export function validateIdentifier(id) {
  if (typeof id !== 'string' || !id) return 'The identifier is empty.';
  if (id.length > 120) return 'The identifier is longer than 120 characters.';
  const segments = id.split('.');
  if (segments.length < 2) return 'The identifier needs at least two dot-separated parts, like com.acme.notes.';
  for (const seg of segments) {
    if (!seg) return 'The identifier has an empty part (leading, trailing or doubled dot).';
    if (!/^[a-z][a-z0-9-]*$/.test(seg)) {
      return `Identifier part "${seg}" must start with a lowercase letter and use only a-z, 0-9 and hyphens.`;
    }
    if (seg.endsWith('-')) return `Identifier part "${seg}" must not end with a hyphen.`;
  }
  const last = segments[segments.length - 1];
  if (last === 'dev') return 'The identifier must not end in ".dev": that ending is how the app tells its Dev build apart.';
  if (last === 'app') return 'The identifier must not end in ".app": it clashes with the macOS bundle extension.';
  return null;
}

/**
 * GitHub "owner/name".
 * @param {string} repo
 * @returns {string | null}
 */
export function validateRepo(repo) {
  if (typeof repo !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(repo)) return 'A repository must look like owner/name.';
  const [owner, name] = repo.split('/');
  if (owner.length > 39 || !/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9]))*$/.test(owner)) {
    return `"${owner}" is not a valid GitHub owner (letters, digits and single hyphens, max 39, no leading or trailing hyphen).`;
  }
  if (name.length > 100 || !/^[A-Za-z0-9._-]+$/.test(name) || name === '.' || name === '..' || name.endsWith('.git')) {
    return `"${name}" is not a valid GitHub repository name (letters, digits, ".", "_" and "-"; not "." or "..", not ending in ".git").`;
  }
  return null;
}

/**
 * Executable base name (Cargo bin name and Tauri mainBinaryName).
 * @param {string} exe
 * @returns {string | null}
 */
export function validateExecutable(exe) {
  if (typeof exe !== 'string' || !exe) return 'The executable name is empty.';
  if (/\s/.test(exe)) return 'The executable name must not contain spaces.';
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(exe)) return 'The executable name must start with a letter and use only letters, digits, "_" and "-".';
  if (exe.length > 64) return 'The executable name is longer than 64 characters.';
  return null;
}

/**
 * Cargo package name.
 * @param {string} crate
 * @returns {string | null}
 */
export function validateCrate(crate) {
  if (typeof crate !== 'string' || !crate) return 'The crate name is empty.';
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(crate)) return 'A crate name must start with a letter and use only letters, digits, "_" and "-".';
  if (crate.length > 64) return 'A crate name must be at most 64 characters.';
  return null;
}

/**
 * Support contact: an email address or an http(s) URL.
 * @param {string} value
 * @returns {string | null}
 */
export function validateSupport(value) {
  if (typeof value !== 'string' || !value.trim()) return 'The support contact is empty.';
  if (value !== value.trim()) return 'The support contact has leading or trailing spaces.';
  if (/^[^\s@<>"]+@[^\s@<>"]+\.[A-Za-z]{2,}$/.test(value)) return null;
  try {
    const u = new URL(value);
    if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.')) return null;
  } catch {
    // fall through to the message below
  }
  return 'The support contact must be an email address or an http(s) URL.';
}

/**
 * Default bundle identifier: com.<owner>.<compact name>, each part reduced to a-z0-9.
 * @param {string} repo owner/name
 * @param {string} compact compact lowercase app name
 * @returns {string}
 */
export function defaultIdentifier(repo, compact) {
  const owner = repo.split('/')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  const seg = (s) => (/^[a-z]/.test(s) ? s : `x${s}`);
  return `com.${seg(owner || 'app')}.${seg(compact.replace(/[^a-z0-9]/g, ''))}`;
}

// ---------------------------------------------------------------------------------------------
// Reading the current names from the tree
// ---------------------------------------------------------------------------------------------

function readText(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function readJson(root, rel) {
  try {
    return JSON.parse(readText(root, rel));
  } catch (err) {
    throw new Error(`Cannot read ${rel}: ${err instanceof Error ? err.message : String(err)}. Is this the kit folder?`, { cause: err });
  }
}

/**
 * The names currently in the tree (the placeholders on a fresh kit, your names after an earlier run).
 * @param {string} root
 * @returns {{ display: string, devDisplay: string, identifier: string, kebab: string, exe: string, crate: string,
 *   installerPrefix: string, sourceRepo: string, releasesRepo: string, support: string }}
 * @throws {Error} when a source of truth is missing or unreadable
 */
export function readCurrent(root) {
  const conf = readJson(root, 'src-tauri/tauri.conf.json');
  const pkg = readJson(root, 'package.json');
  const release = readJson(root, 'config/release.json');
  const storePath = STORE_CONFIG_PATHS.find((p) => fs.existsSync(path.join(root, p)));
  const store = storePath ? readJson(root, storePath) : {};
  let devConf = {};
  if (fs.existsSync(path.join(root, 'src-tauri/tauri.dev.conf.json'))) devConf = readJson(root, 'src-tauri/tauri.dev.conf.json');
  const cargo = readText(root, 'src-tauri/Cargo.toml');
  const crate = /\[package\][^[]*?^name\s*=\s*"([^"]+)"/m.exec(cargo)?.[1];
  const bin = /\[\[bin\]\][^[]*?^name\s*=\s*"([^"]+)"/m.exec(cargo)?.[1];
  const display = conf.productName;
  const need = { 'tauri.conf.json productName': display, 'tauri.conf.json identifier': conf.identifier, 'package.json name': pkg.name,
    'Cargo.toml package name': crate, 'config/release.json sourceRepo': release.sourceRepo,
    'config/release.json releasesRepo': release.releasesRepo };
  for (const [what, value] of Object.entries(need)) {
    if (typeof value !== 'string' || !value) throw new Error(`Cannot find the current ${what}. Is this the kit folder?`);
  }
  return {
    display,
    devDisplay: typeof devConf.productName === 'string' && devConf.productName ? devConf.productName : `${display} Dev`,
    identifier: conf.identifier,
    kebab: pkg.name,
    exe: typeof conf.mainBinaryName === 'string' && conf.mainBinaryName ? conf.mainBinaryName : (bin ?? display.replace(/\s+/g, '')),
    crate,
    installerPrefix: display.replace(/\s+/g, '-'),
    sourceRepo: release.sourceRepo,
    releasesRepo: release.releasesRepo,
    support: typeof store.supportContact === 'string' ? store.supportContact : SUPPORT_PLACEHOLDER,
  };
}

// ---------------------------------------------------------------------------------------------
// Replacement rules
// ---------------------------------------------------------------------------------------------

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** English indefinite article by first letter (vowel letter: "an"). Names like "Uber" or "Hour" need a hand edit. */
export const article = (name) => (/^[aeiou]/i.test(name) ? 'an' : 'a');
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// A bare owner or repo name must stand alone: not inside a longer word, and not the start of a domain (acme.dev).
const WORD_CLASS = '[A-Za-z0-9_-]';
const BARE_BEFORE = `(?<!${WORD_CLASS}|\\.)`;
const BARE_AFTER = `(?!${WORD_CLASS}|\\.[A-Za-z0-9])`;
// A CODEOWNERS-style handle must also not be an npm scope (@owner/package).
const HANDLE_AFTER = `(?!${WORD_CLASS}|\\.[A-Za-z0-9]|/)`;
// An "owner/name" slug that is no longer the kit placeholder must not match inside a path (src/app/pages/x.js). It may
// follow a GitHub URL or API prefix, and may be followed by ".git", "/", "#", a quote, whitespace or the end.
const SLUG_BEFORE = '(?:(?<![A-Za-z0-9_./-])|(?<=github\\.com/)|(?<=githubusercontent\\.com/)|(?<=/repos/))';
const SLUG_AFTER = '(?![A-Za-z0-9_-])';

/**
 * Ordered old -> new text rules. Applied in ONE pass with the longest `from` first, so an earlier
 * replacement is never rewritten again and "owner/repo-releases" always beats "owner/repo".
 * @param {ReturnType<typeof readCurrent>} cur
 * @param {{ display: string, devDisplay: string, kebab: string, exe: string, crate: string, installerPrefix: string,
 *   identifier: string, sourceRepo: string, releasesRepo: string }} next
 * @returns {{ from: string, to: string, bare: boolean | 'handle' | 'slug' }[]}
 */
export function buildRules(cur, next) {
  const curOwner = cur.sourceRepo.split('/')[0];
  const nextOwner = next.sourceRepo.split('/')[0];
  const curReleasesName = cur.releasesRepo.split('/')[1];
  // Bare owner and bare releases-repo name are replaced only while they are the unique kit placeholders.
  // Afterwards the owner may be a common word (app, react, data), so only "owner/name" and "@owner" change.
  const ownerIsPlaceholder = curOwner === KIT.owner;
  const releasesNameIsPlaceholder = curReleasesName === KIT.releasesName;
  // The kit's own slugs are unique strings; real ones need boundaries so "app/pages" never matches a path.
  const slugKind = (slug) => (slug.split('/')[0] === KIT.owner ? false : 'slug');
  const raw = [
    [cur.releasesRepo, next.releasesRepo, slugKind(cur.releasesRepo)],
    [cur.sourceRepo, next.sourceRepo, slugKind(cur.sourceRepo)],
    [cur.identifier, next.identifier, false],
    [cur.identifier.toUpperCase(), next.identifier.toUpperCase(), false],
    [cur.crate, next.crate, false],
    [cur.kebab, next.kebab, false],
    [cur.devDisplay, next.devDisplay, false],
    [cur.display, next.display, false],
    [cur.display.toUpperCase(), next.display.toUpperCase(), false],
    [cur.display.toLowerCase(), next.display.toLowerCase(), false],
    [cur.exe, next.exe, false],
    [cur.installerPrefix, next.installerPrefix, false],
  ];
  // "a Starter App" must become "an Acme Notes" (and back on a later rename). Bare, so "via Starter App" never matches;
  // longest-first ordering puts "a Starter App Dev" ahead of the shorter rules.
  for (const [c, n] of [[cur.devDisplay, next.devDisplay], [cur.display, next.display]]) {
    raw.push([`${article(c)} ${c}`, `${article(n)} ${n}`, true]);
    raw.push([`${capitalize(article(c))} ${c}`, `${capitalize(article(n))} ${n}`, true]);
  }
  if (releasesNameIsPlaceholder) raw.push([curReleasesName, next.releasesRepo.split('/')[1], true]);
  if (ownerIsPlaceholder) {
    raw.push([curOwner, nextOwner, true], [curOwner.toUpperCase(), nextOwner.toUpperCase(), true]);
  } else {
    // Only .github/CODEOWNERS carries handles (see planEdits); elsewhere "@media" or "@param" would be rewritten.
    raw.push([`@${curOwner}`, `@${nextOwner}`, 'handle']);
  }
  const seen = new Set();
  const rules = [];
  for (const [from, to, bare] of raw) {
    if (!from || from === to || seen.has(from)) continue;
    seen.add(from);
    rules.push({ from, to, bare });
  }
  return rules.sort((a, b) => b.from.length - a.from.length);
}

/**
 * Applies rules in a single pass.
 * @param {string} text
 * @param {{ from: string, to: string, bare: boolean }[]} rules
 * @returns {{ text: string, count: number }}
 */
export function applyRules(text, rules) {
  if (rules.length === 0) return { text, count: 0 };
  const alt = rules
    .map((r) => {
      if (!r.bare) return escapeRe(r.from);
      if (r.bare === 'slug') return `${SLUG_BEFORE}${escapeRe(r.from)}${SLUG_AFTER}`;
      return `${BARE_BEFORE}${escapeRe(r.from)}${r.bare === 'handle' ? HANDLE_AFTER : BARE_AFTER}`;
    })
    .join('|');
  const map = new Map(rules.map((r) => [r.from, r.to]));
  let count = 0;
  const out = text.replace(new RegExp(alt, 'g'), (m) => {
    count += 1;
    return map.get(m) ?? m;
  });
  return { text: out, count };
}

// ---------------------------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------------------------

const EXCLUDED_FILES = new Set(['CHANGELOG.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'scripts/init-app.mjs']);
const SKIP_ROOT_DIRS = new Set(['data', 'coverage', 'test-results', 'playwright-report', 'blob-report', '.sidecar-build', '.dev-build']);
const SKIP_ANY_DIRS = new Set(['node_modules', '.git']);
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.icns', '.zip', '.gz', '.exe', '.dll', '.db', '.woff',
  '.woff2', '.ttf', '.otf', '.pdf', '.wasm', '.node', '.bin']);
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Paths init-app never edits (root-relative, forward slashes).
 * @param {string} rel
 * @returns {boolean}
 */
export function isExcludedPath(rel) {
  if (EXCLUDED_FILES.has(rel)) return true;
  if (/^server\/__tests__\/initApp[^/]*$/.test(rel)) return true;
  if (rel.startsWith('server/__tests__/fixtures/initApp/')) return true;
  // Shipped migrations are immutable (their hashes are locked), so a rename must never touch them.
  if (rel.startsWith('server/db/migrations/') || rel === 'server/db/migrations.lock.json') return true;
  const parts = rel.split('/');
  if (parts.some((p) => SKIP_ANY_DIRS.has(p))) return true;
  if (parts.length > 1 && (SKIP_ROOT_DIRS.has(parts[0]) || /^dist/.test(parts[0]))) return true;
  if (/^src-tauri\/(target|binaries|gen|resources)\//.test(rel)) return true;
  return false;
}

/**
 * Describes why a rename from the CURRENT names is risky, or null when it is not. The kit's own names are
 * unique strings and always safe. Your own names are replaced as plain substrings, so a single-word or very
 * short current name (Notes, Data) would also rewrite ordinary identifiers that merely contain it.
 * @param {ReturnType<typeof readCurrent>} cur
 * @param {{ display: string }} next
 * @returns {string | null}
 */
export function rerunRisk(cur, next) {
  if (cur.display === KIT.display && cur.kebab === KIT.kebab) return null;
  if (cur.display === next.display) return null;
  const words = cur.display.split(/\s+/).filter(Boolean);
  const variants = [cur.display, cur.kebab, cur.exe, cur.crate, words.join('').toLowerCase()];
  const short = variants.find((v) => v.length < 4);
  if (words.length === 1 || short !== undefined) {
    const what = words.length === 1 ? `the current name "${cur.display}" is a single word` : `"${short}" is shorter than 4 characters`;
    return `Renaming again is risky: ${what}, so replacing it as plain text would also rewrite unrelated code that contains it ` +
      '(for example a column, a function or a category named after it). Pass --force to go ahead anyway, then review "git diff" carefully.';
  }
  return null;
}

// What may legitimately follow one of the kit's names right after a first run: derived crate, sidecar and Dev names,
// the executable and its installers (Name-Setup-x64.exe, Name-Dev_0.1.0_x64-setup.exe, name_0.1.0_...).
const DERIVED_AFTER = '(?:-desktop|-server|-dev-server|-dev|\\.exe|-Setup|-setup|_\\d|_\\$\\{|_x64|_arm64|_universal|_aarch64|_amd64)';

/**
 * Finds text that a plain-text rename from the CURRENT names would rewrite wrongly: a current name embedded in a
 * longer identifier (listItemNotes), or the lower-case display name ("item notes" in prose). Only meaningful when the
 * current names are not the kit placeholders; the placeholders are unique strings and always safe.
 * @param {string} root
 * @param {ReturnType<typeof readCurrent>} cur
 * @returns {{ rel: string, line: number, token: string, why: string }[]}
 */
export function scanRerunHazards(root, cur) {
  const names = [cur.devDisplay, cur.display, cur.display.toUpperCase(), cur.exe, cur.kebab, cur.crate, cur.installerPrefix,
    cur.identifier, cur.identifier.toUpperCase()].filter(Boolean);
  const unique = [...new Set(names)].sort((a, b) => b.length - a.length);
  const alt = unique.map(escapeRe).join('|');
  const embedded = new RegExp(`(?<=[A-Za-z0-9_])(?:${alt})|(?:${alt})(?=[A-Za-z0-9_])(?!${DERIVED_AFTER})`, 'g');
  const lower = cur.display.toLowerCase();
  const lowerRe = lower !== cur.display ? new RegExp(escapeRe(lower), 'g') : null;
  const hits = [];
  for (const rel of listFiles(root)) {
    const text = readTextFile(path.join(root, rel));
    if (text === null || text.includes(KEEP_MARKER)) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const lineText = lines[i];
      const token = (m) => /[A-Za-z0-9_]*$/.exec(lineText.slice(0, m.index))[0] + m[0] + /^[A-Za-z0-9_]*/.exec(lineText.slice(m.index + m[0].length))[0];
      for (const m of lineText.matchAll(embedded)) hits.push({ rel, line: i + 1, token: token(m), why: 'inside a longer identifier' });
      if (lowerRe) for (const m of lineText.matchAll(lowerRe)) hits.push({ rel, line: i + 1, token: token(m), why: 'the lower-case name' });
    }
  }
  return hits;
}

function sameDir(a, b) {
  const norm = (p) => fs.realpathSync.native(p).replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
  return norm(a) === norm(b);
}

/**
 * True when `root` is itself the top of a git work tree (an unzipped kit inside an unrelated repo is not).
 * @param {string} root
 * @returns {boolean}
 */
export function isGitRoot(root) {
  try {
    const top = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return sameDir(top, root);
  } catch {
    return false;
  }
}

function gitDirty(root) {
  return execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).trim() !== '';
}

function walk(root, dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (!isExcludedPath(`${rel}/x`)) walk(root, abs, out);
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
}

/**
 * Root-relative paths of the files to consider: tracked plus untracked-not-ignored files in a git repo,
 * otherwise a filtered directory walk.
 * @param {string} root
 * @returns {string[]}
 */
export function listFiles(root) {
  let files;
  if (isGitRoot(root)) {
    const raw = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    files = [...new Set(raw.split('\0').filter(Boolean))].filter((rel) => {
      try {
        return fs.lstatSync(path.join(root, rel)).isFile();
      } catch {
        return false;
      }
    });
  } else {
    files = [];
    walk(root, root, files);
  }
  return files.filter((rel) => !isExcludedPath(rel)).sort();
}

/**
 * The text of a file, or null for binary, huge or non-UTF-8 files.
 * @param {string} abs
 * @returns {string | null}
 */
function readTextFile(abs) {
  if (BINARY_EXT.has(path.extname(abs).toLowerCase())) return null;
  if (fs.statSync(abs).size > MAX_BYTES) return null;
  const buf = fs.readFileSync(abs);
  if (buf.subarray(0, 8000).includes(0)) return null;
  const text = buf.toString('utf8');
  return text.includes('�') ? null : text;
}

// ---------------------------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------------------------

const CODEOWNERS_HINT = /^# Replace @\S+ with your own GitHub handle or team\.\r?\n/m;
const SUPPORT_FIELD = /("supportContact"\s*:\s*)"(?:[^"\\]|\\.)*"/;

/**
 * Computes every file edit in memory.
 * @param {string} root
 * @param {ReturnType<typeof readCurrent>} cur
 * @param {ReturnType<typeof deriveNames> & { identifier: string, sourceRepo: string, releasesRepo: string, support: string }} next
 * @returns {{ edits: { rel: string, content: string, count: number, notes: string[] }[], skippedKeep: string[] }}
 * @throws {Error} when an edited JSON file would no longer parse
 */
export function planEdits(root, cur, next) {
  const rules = buildRules(cur, next);
  const rulesWithoutHandle = rules.filter((r) => r.bare !== 'handle');
  const edits = [];
  const skippedKeep = [];
  for (const rel of listFiles(root)) {
    const abs = path.join(root, rel);
    const original = readTextFile(abs);
    if (original === null) continue;
    if (original.includes(KEEP_MARKER)) {
      skippedKeep.push(rel);
      continue;
    }
    let text = original;
    let count = 0;
    const notes = [];
    if (rel === '.github/CODEOWNERS' && rules.length > 0 && CODEOWNERS_HINT.test(text)) {
      text = text.replace(CODEOWNERS_HINT, '');
      count += 1;
      notes.push('removed the "replace the owner" hint line');
    }
    const applied = applyRules(text, rel === '.github/CODEOWNERS' ? rules : rulesWithoutHandle);
    text = applied.text;
    count += applied.count;
    if (STORE_CONFIG_PATHS.includes(rel) && next.support !== cur.support) {
      const before = text;
      text = text.replace(SUPPORT_FIELD, (_m, head) => `${head}${JSON.stringify(next.support)}`);
      if (text !== before) {
        count += 1;
        notes.push(`supportContact: ${JSON.stringify(cur.support)} -> ${JSON.stringify(next.support)}`);
      }
    }
    if (rel === 'src-tauri/Cargo.lock' && count > 0) text = sortCargoLockRoot(text, next.crate);
    if (text === original) continue;
    if (rel.endsWith('.json')) {
      try {
        JSON.parse(original);
      } catch {
        // the original was not strict JSON (for example tsconfig comments): nothing to verify
        edits.push({ rel, content: text, count, notes });
        continue;
      }
      try {
        JSON.parse(text);
      } catch (err) {
        throw new Error(`Renaming would break ${rel} (${err instanceof Error ? err.message : String(err)}). Nothing was written.`, { cause: err });
      }
    }
    edits.push({ rel, content: text, count, notes });
  }
  return { edits, skippedKeep };
}

// ---------------------------------------------------------------------------------------------
// Cargo.lock ordering
// ---------------------------------------------------------------------------------------------

const utf8Compare = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));

// Cargo's SourceId order: the source kind first (git, then path, then registries), then the URL.
function sourceRank(source) {
  if (source === null) return 1;
  return source.startsWith('git+') ? 0 : 2;
}

// SemVer precedence for two dot-separated identifier lists (pre-release or build); an empty list sorts first.
function compareIdentifiers(a, b) {
  const xs = a ? a.split('.') : [];
  const ys = b ? b.split('.') : [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i += 1) {
    const xn = /^\d+$/.test(xs[i]);
    const yn = /^\d+$/.test(ys[i]);
    let c;
    if (xn && yn) c = Math.sign(Number(xs[i]) - Number(ys[i]));
    else if (xn !== yn) c = xn ? -1 : 1;
    else c = utf8Compare(xs[i], ys[i]);
    if (c !== 0) return c;
  }
  return Math.sign(xs.length - ys.length);
}

function compareVersions(a, b) {
  const parse = (v) => /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(v);
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return utf8Compare(a, b);
  for (let i = 1; i <= 3; i += 1) {
    const c = Math.sign(Number(pa[i]) - Number(pb[i]));
    if (c !== 0) return c;
  }
  // A release outranks its own pre-releases; build metadata then breaks any remaining tie.
  if (pa[4] === undefined && pb[4] !== undefined) return 1;
  if (pa[4] !== undefined && pb[4] === undefined) return -1;
  return compareIdentifiers(pa[4], pb[4]) || compareIdentifiers(pa[5], pb[5]);
}

function parsePackage(block) {
  const field = (key) => new RegExp(`^${key} = "([^"]*)"`, 'm').exec(block)?.[1] ?? null;
  return { name: field('name') ?? '', version: field('version') ?? '', source: field('source') };
}

// cargo orders [[package]] entries by name (plain byte order), then version, then source.
function comparePackages(a, b) {
  return utf8Compare(a.name, b.name) || compareVersions(a.version, b.version) ||
    sourceRank(a.source) - sourceRank(b.source) || utf8Compare(a.source ?? '', b.source ?? '');
}

/**
 * Moves the root crate's [[package]] block to where cargo itself would write it. Renaming the crate in place keeps the
 * old position, so the first cargo build would re-sort the file and leave the buyer's tree dirty.
 * Returns the text unchanged when the layout is not a plain Cargo.lock or the crate has no path-source block.
 * @param {string} text Cargo.lock content
 * @param {string} crate the root package name
 * @returns {string}
 */
export function sortCargoLockRoot(text, crate) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const first = text.search(/^\[\[package\]\]\r?$/m);
  if (first < 0) return text;
  const header = text.slice(0, first);
  let body = text.slice(first);
  let tail = '';
  const other = /^\[(?!\[package\]\])/m.exec(body);
  if (other) {
    tail = body.slice(other.index);
    body = body.slice(0, other.index);
  }
  const blocks = body.split(/^(?=\[\[package\]\]\r?$)/m).map((b) => b.replace(/\s+$/, '')).filter(Boolean);
  const infos = blocks.map(parsePackage);
  const at = infos.findIndex((p) => p.name === crate && p.source === null);
  if (at < 0) return text;
  const [root] = blocks.splice(at, 1);
  const [rootInfo] = infos.splice(at, 1);
  let to = infos.findIndex((p) => comparePackages(rootInfo, p) < 0);
  if (to < 0) to = blocks.length;
  blocks.splice(to, 0, root);
  const joined = `${blocks.join(`${eol}${eol}`)}${eol}`;
  return `${header}${joined}${tail ? `${eol}${tail}` : ''}`;
}

// ---------------------------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------------------------

// Stroke-drawn glyphs in a 12 x 16 box (no <text>: the renderer behind `tauri icon` may have no fonts).
const O_PATH = 'M6 0 C2.5 0 0.5 3 0.5 8 C0.5 13 2.5 16 6 16 C9.5 16 11.5 13 11.5 8 C11.5 3 9.5 0 6 0 Z';
const P_PATH = 'M1 16 V0 H7 C11.5 0 11.5 9 7 9 H1';
const GLYPHS = {
  A: 'M0 16 L6 0 L12 16 M2.5 10.5 H9.5',
  B: 'M1 0 V16 M1 0 H7 C10.5 0 10.5 7.5 7 7.5 H1 M7 7.5 C11.5 7.5 11.5 16 7 16 H1',
  C: 'M11.5 3.5 C10 1 8 0 6 0 C2.5 0 0.5 3 0.5 8 C0.5 13 2.5 16 6 16 C8 16 10 15 11.5 12.5',
  D: 'M1 0 H5 C10.5 0 11.5 4 11.5 8 C11.5 12 10.5 16 5 16 H1 Z',
  E: 'M11 0 H1 V16 H11 M1 8 H9',
  F: 'M11 0 H1 V16 M1 8 H9',
  G: 'M11.5 3.5 C10 1 8 0 6 0 C2.5 0 0.5 3 0.5 8 C0.5 13 2.5 16 6 16 C9.5 16 11.5 14 11.5 10 V8.5 H6.5',
  H: 'M1 0 V16 M11 0 V16 M1 8 H11',
  I: 'M3 0 H9 M6 0 V16 M3 16 H9',
  J: 'M10 0 V11 C10 14.5 8.5 16 6 16 C3 16 1.5 14.5 1 12',
  K: 'M1 0 V16 M11 0 L1 9 M4 6.5 L11.5 16',
  L: 'M1 0 V16 H11',
  M: 'M0.5 16 V0 L6 10 L11.5 0 V16',
  N: 'M1 16 V0 L11 16 V0',
  O: O_PATH,
  P: P_PATH,
  Q: `${O_PATH} M7.5 11.5 L11.5 16.5`,
  R: `${P_PATH} M6 9 L11 16`,
  S: 'M11 3.5 C11 1.5 9 0 6 0 C3 0 1 1.5 1 4 C1 9 11 7 11 12 C11 14.5 9 16 6 16 C3 16 1 14.5 1 12.5',
  T: 'M0.5 0 H11.5 M6 0 V16',
  U: 'M1 0 V10 C1 14 3 16 6 16 C9 16 11 14 11 10 V0',
  V: 'M0.5 0 L6 16 L11.5 0',
  W: 'M0 0 L3 16 L6 6 L9 16 L12 0',
  X: 'M1 0 L11 16 M11 0 L1 16',
  Y: 'M0.5 0 L6 8 L11.5 0 M6 8 V16',
  Z: 'M1 0 H11 L1 16 H11',
};

/**
 * True when init-app may redraw this icon: it carries the placeholder or the generated marker.
 * @param {string} svg
 * @returns {boolean}
 */
export function isReplaceableIcon(svg) {
  return svg.includes(ICON_PLACEHOLDER_MARKER) || svg.includes(ICON_GENERATED_MARKER);
}

/**
 * The monogram glyph path for a letter or digit (the name rule guarantees a letter first).
 * @param {string} ch
 * @returns {string}
 */
export function glyphPath(ch) {
  const g = GLYPHS[ch.toUpperCase()];
  if (!g) throw new Error(`No icon glyph for "${ch}"`);
  return g;
}

/**
 * The 32 x 32 letter icon (gradient tile, same look as the placeholder S) used for source.svg.
 * @param {string} display
 * @returns {string}
 */
export function letterIconSvg(display) {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">',
    `  ${ICON_GENERATED_MARKER}`,
    `  <title>${display}</title>`,
    '  <defs>',
    '    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">',
    '      <stop offset="0" stop-color="#64748b"/>',
    '      <stop offset="1" stop-color="#334155"/>',
    '    </linearGradient>',
    '  </defs>',
    '  <rect width="32" height="32" rx="8" fill="url(#bg)"/>',
    `  <path transform="translate(10 8)" d="${glyphPath(display[0])}" fill="none" stroke="#f8fafc" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
    '</svg>',
    '',
  ].join('\n');
}

/**
 * The letter favicon (same artwork as the placeholder in public/favicon.svg).
 * @param {string} display
 * @returns {string}
 */
export function letterFaviconSvg(display) {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">',
    `  ${ICON_GENERATED_MARKER}`,
    `  <title>${display}</title>`,
    '  <rect width="32" height="32" rx="7" fill="#863bff"/>',
    `  <path transform="translate(10 8)" d="${glyphPath(display[0])}" fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`,
    '</svg>',
    '',
  ].join('\n');
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Reads a PNG's size.
 * @param {Buffer} buf
 * @returns {{ width: number, height: number } | null} null when the bytes are not a PNG
 */
export function readPngSize(buf) {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE) || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * An SVG wrapper around the buyer's PNG, so the Dev badge step (which works on SVG) still applies.
 * @param {string} display
 * @param {Buffer} png
 * @returns {string}
 */
export function pngIconSvg(display, png) {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1024 1024" width="1024" height="1024">',
    `  <title>${display}</title>`,
    `  <image width="1024" height="1024" xlink:href="data:image/png;base64,${png.toString('base64')}" href="data:image/png;base64,${png.toString('base64')}"/>`,
    '</svg>',
    '',
  ].join('\n');
}

/**
 * Validates the file given to --icon.
 * @param {string} file
 * @returns {{ png: Buffer, error: string | null, warning: string | null }}
 */
export function checkIconFile(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return { png: Buffer.alloc(0), error: `Icon file not found: ${file}`, warning: null };
  const png = fs.readFileSync(file);
  const size = readPngSize(png);
  if (!size) return { png, error: `${file} is not a PNG file.`, warning: null };
  if (size.width !== size.height) return { png, error: `The icon must be square (this one is ${size.width} x ${size.height}).`, warning: null };
  if (size.width < 256) return { png, error: `The icon is ${size.width} px; use at least 256 px (1024 x 1024 is best).`, warning: null };
  return { png, error: null, warning: size.width < 1024 ? `The icon is ${size.width} px; 1024 x 1024 gives the sharpest result.` : null };
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

const HELP = `Usage: npm run init-app -- [options]

Rebrands this starter kit as your own app. Run it on a clean tree, ideally right after "git init" and a first
commit, so "git diff" shows exactly what changed (it also works on an unzipped kit with no git). Running it
again with the same values changes nothing. Renaming again is supported, but it is plain text replacement of
your current names: a single-word or very short current name, or one that appears inside longer identifiers, needs
--force and a careful "git diff" review.

Options:
  --name <text>            App name, for example "Acme Notes" (required; letters, digits, spaces)
  --repo <owner/name>      GitHub source repository, for example acme/notes (required)
  --releases-repo <o/n>    Public downloads repository (default: <repo>-releases)
  --identifier <id>        Bundle identifier, for example com.acme.notes (default: com.<owner>.<compact name>)
  --support <email|url>    Support contact shown to buyers (default: keep the current value; the placeholder gets a warning)
  --icon <file.png>        Square PNG (1024 x 1024 best) to use as the app icon (replaces your current icon)
  --skip-icons             Do not touch or regenerate the icons (without --icon, your own icon artwork is kept anyway)
  --yes, -y                Never prompt: use defaults for optional values, fail on missing required ones
  --dry-run                Print the plan and write nothing
  --force                  Run even when git reports uncommitted changes, or accept a risky re-rename
  --help, -h               Show this help

Without --yes, any missing value is asked for interactively.`;

const OPTIONS = {
  name: { type: 'string' },
  repo: { type: 'string' },
  'releases-repo': { type: 'string' },
  identifier: { type: 'string' },
  support: { type: 'string' },
  icon: { type: 'string' },
  'skip-icons': { type: 'boolean', default: false },
  yes: { type: 'boolean', short: 'y', default: false },
  'dry-run': { type: 'boolean', default: false },
  force: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
};

/**
 * @param {string[]} argv
 * @returns {Record<string, string | boolean | undefined>}
 */
export function parseCli(argv) {
  return parseArgs({ args: argv, options: OPTIONS, allowPositionals: false, strict: true }).values;
}

function makeIo(overrides) {
  const out = overrides.out ?? ((line) => console.log(line));
  const err = overrides.err ?? ((line) => console.error(line));
  let rl = null;
  const ask =
    overrides.ask ??
    (async (question) => {
      rl ??= readline.createInterface({ input: process.stdin, output: process.stdout });
      return rl.question(question);
    });
  return { out, err, ask, close: () => rl?.close() };
}

/**
 * Takes a flag value, or asks for it, or falls back to a default, validating along the way.
 * @returns {Promise<string | null>} the value, or null after printing an error
 */
async function resolveValue({ label, flag, given, fallback, validate, yes, interactive, io, trustFallback = false }) {
  if (given !== undefined) {
    const problem = validate(given);
    if (problem) {
      io.err(`${flag}: ${problem}`);
      return null;
    }
    return given;
  }
  if (yes || !interactive) {
    if (fallback !== undefined) {
      const problem = trustFallback ? null : validate(fallback);
      if (problem) {
        io.err(`${flag}: the default "${fallback}" is not usable (${problem}) Pass ${flag} explicitly.`);
        return null;
      }
      return fallback;
    }
    io.err(`${flag} is required${yes ? ' with --yes' : ' (no terminal to ask in; pass it as a flag or use a terminal)'}.`);
    return null;
  }
  for (;;) {
    const suffix = fallback !== undefined ? ` [${fallback}]` : '';
    const answer = (await io.ask(`${label}${suffix}: `)).trim();
    const value = answer || fallback;
    if (value === undefined) {
      io.out('This value is required.');
      continue;
    }
    const problem = trustFallback && value === fallback ? null : validate(value);
    if (problem) {
      io.out(problem);
      continue;
    }
    return value;
  }
}

function row(label, from, to) {
  return `  ${label.padEnd(18)} ${from}  ->  ${to}`;
}

/**
 * Runs init-app.
 * @param {string[]} argv
 * @param {{ root?: string, out?: (line: string) => void, err?: (line: string) => void,
 *   ask?: (question: string) => Promise<string>, interactive?: boolean }} [opts]
 * @returns {Promise<number>} process exit code
 */
export async function run(argv, opts = {}) {
  const io = makeIo(opts);
  const root = path.resolve(opts.root ?? ROOT);
  const interactive = opts.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  try {
    return await runInner(argv, root, io, interactive);
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    return 1;
  } finally {
    io.close();
  }
}

async function runInner(argv, root, io, interactive) {
  let flags;
  try {
    flags = parseCli(argv);
  } catch (err) {
    io.err(`${err instanceof Error ? err.message : String(err)}\nRun with --help for the options.`);
    return 1;
  }
  if (flags.help) {
    io.out(HELP);
    return 0;
  }
  const yes = Boolean(flags.yes);
  const dryRun = Boolean(flags['dry-run']);
  const skipIcons = Boolean(flags['skip-icons']);
  const cur = readCurrent(root);

  const inGit = isGitRoot(root);
  if (inGit && gitDirty(root)) {
    if (dryRun) io.out('Note: git reports uncommitted changes (a real run would need --force).');
    else if (!flags.force) {
      io.err('git reports uncommitted changes. Commit or stash them first (so "git diff" shows only the rename), or pass --force.');
      return 1;
    }
  } else if (!inGit) {
    io.out('Tip: this folder is not a git repository. Run "git init" and make a first commit before init-app, so you can review the rename with "git diff".');
  }

  const base = { yes, interactive, io };
  const rawName = await resolveValue({ ...base, label: 'App name', flag: '--name', given: flags.name, required: true, validate: validateName });
  if (rawName === null) return 1;
  const repo = await resolveValue({ ...base, label: 'GitHub source repo (owner/name)', flag: '--repo', given: flags.repo, required: true, validate: validateRepo });
  if (repo === null) return 1;
  const names = deriveNames(rawName);

  const placeholderNames = cur.display === KIT.display && cur.kebab === KIT.kebab;
  const risk = rerunRisk(cur, names);
  if (risk) {
    if (dryRun) io.out(`Note: ${risk}`);
    else if (!flags.force) {
      io.err(risk);
      return 1;
    }
  }
  if (!placeholderNames && names.display !== cur.display && !flags.force) {
    const hazards = scanRerunHazards(root, cur);
    if (hazards.length > 0) {
      const shown = hazards.slice(0, 10).map((h) => `  ${h.rel}:${h.line}  ${h.token}  (${h.why})`);
      const more = hazards.length > shown.length ? [`  ...and ${hazards.length - shown.length} more`] : [];
      const message = [`Renaming again would also rewrite text that only contains "${cur.display}" or its derived names (${hazards.length} place(s)):`,
        ...shown, ...more,
        'Replacing your current names is plain text replacement, so these would be changed wrongly. Pass --force to go ahead anyway, then review "git diff" carefully.'].join('\n');
      if (dryRun) io.out(`Note: ${message}`);
      else {
        io.err(message);
        return 1;
      }
    }
  }
  if (placeholderNames && !names.display.includes(' ')) {
    io.out(`Warning: "${names.display}" is a single word. A later rename from it is plain text replacement and will need --force and a careful "git diff" review.`);
  }

  const sameName = names.display === cur.display;
  const releasesFallback = repo.toLowerCase() === cur.sourceRepo.toLowerCase() ? cur.releasesRepo : `${repo}-releases`;
  // Keep a real current identifier while the name is unchanged; never keep (or default to) a com.example.* one.
  const identifierFallback = sameName && !cur.identifier.startsWith(KIT.identifierPrefix) ? cur.identifier : defaultIdentifier(repo, names.compact);
  const releasesRepo = await resolveValue({ ...base, label: 'Public releases repo', flag: '--releases-repo', given: flags['releases-repo'], fallback: releasesFallback, validate: validateRepo });
  if (releasesRepo === null) return 1;
  const identifier = await resolveValue({ ...base, label: 'Bundle identifier', flag: '--identifier', given: flags.identifier, fallback: identifierFallback, validate: validateIdentifier });
  if (identifier === null) return 1;
  const support = await resolveValue({ ...base, label: 'Support email or URL', flag: '--support', given: flags.support, fallback: cur.support, validate: validateSupport, trustFallback: true });
  if (support === null) return 1;
  if (releasesRepo.toLowerCase() === repo.toLowerCase()) {
    io.err('--releases-repo must differ from --repo: the downloads repo is public, the source repo is private.');
    return 1;
  }

  let iconPng = null;
  if (flags.icon !== undefined && skipIcons) {
    io.err('--icon and --skip-icons cannot be used together.');
    return 1;
  }
  if (flags.icon !== undefined) {
    const checked = checkIconFile(path.resolve(flags.icon));
    if (checked.error) {
      io.err(checked.error);
      return 1;
    }
    if (checked.warning) io.out(`Warning: ${checked.warning}`);
    iconPng = checked.png;
  }

  const next = { ...names, identifier, sourceRepo: repo, releasesRepo, support };
  const { edits, skippedKeep } = planEdits(root, cur, next);

  // Icons: planned content for source.svg and favicon.svg
  const iconsDir = path.join(root, 'src-tauri', 'icons');
  const sourceSvgPath = path.join(iconsDir, 'source.svg');
  const faviconPath = path.join(root, 'public', 'favicon.svg');
  const iconPlan = [];
  const iconNotes = [];
  if (!skipIcons) {
    const letter = names.display[0].toUpperCase();
    const currentSource = fs.existsSync(sourceSvgPath) ? fs.readFileSync(sourceSvgPath, 'utf8') : null;
    if (iconPng) {
      const plannedSource = pngIconSvg(names.display, iconPng);
      if (currentSource !== plannedSource) iconPlan.push({ file: sourceSvgPath, content: plannedSource, what: 'embed your PNG in src-tauri/icons/source.svg' });
    } else if (currentSource === null || isReplaceableIcon(currentSource)) {
      const plannedSource = letterIconSvg(names.display);
      if (currentSource !== plannedSource) iconPlan.push({ file: sourceSvgPath, content: plannedSource, what: `draw the letter ${letter} in src-tauri/icons/source.svg` });
    } else {
      iconNotes.push('src-tauri/icons/source.svg is your own artwork, so it was left as is. Use --icon <file.png> to replace it.');
    }
    if (!iconPng && fs.existsSync(faviconPath)) {
      const currentFavicon = fs.readFileSync(faviconPath, 'utf8');
      if (isReplaceableIcon(currentFavicon)) {
        const plannedFavicon = letterFaviconSvg(names.display);
        if (currentFavicon !== plannedFavicon) iconPlan.push({ file: faviconPath, content: plannedFavicon, what: `draw the letter ${letter} in public/favicon.svg` });
      } else {
        iconNotes.push('public/favicon.svg is your own artwork, so it was left as is.');
      }
    }
  }
  const runIconPipeline = iconPlan.some((p) => p.file === sourceSvgPath);

  io.out(`${dryRun ? 'Plan (dry run, nothing is written)' : 'Plan'}:`);
  io.out(row('App name', cur.display, next.display));
  io.out(row('Dev name', cur.devDisplay, next.devDisplay));
  io.out(row('Identifier', cur.identifier, next.identifier));
  io.out(row('Package / kebab', cur.kebab, next.kebab));
  io.out(row('Executable', cur.exe, next.exe));
  io.out(row('Crate', cur.crate, next.crate));
  io.out(row('Installer prefix', cur.installerPrefix, next.installerPrefix));
  io.out(row('Sidecars', `${cur.kebab}-server`, next.sidecar));
  io.out(row('Data folder', `${cur.display} (Linux: ${cur.kebab})`, `${next.dataDirWin} (Linux: ${next.dataDirLinux})`));
  io.out(row('Source repo', cur.sourceRepo, next.sourceRepo));
  io.out(row('Releases repo', cur.releasesRepo, next.releasesRepo));
  io.out(row('Support contact', cur.support, next.support));
  if (support.includes('OWNER TODO')) io.out(`  Warning: the support contact is still the placeholder. Set it in ${storeConfigRel(root)} (or pass --support) before you ship.`);

  const total = edits.reduce((n, e) => n + e.count, 0);
  if (edits.length === 0 && iconPlan.length === 0) {
    io.out('Nothing to change.');
    return 0;
  }
  io.out(`Files: ${edits.length} to change, ${total} replacement(s)`);
  for (const e of edits) {
    io.out(`  ${e.rel}: ${e.count} replacement(s)`);
    for (const n of e.notes) io.out(`    ${n}`);
  }
  for (const p of iconPlan) io.out(`  icon: ${p.what}`);
  for (const n of iconNotes) io.out(`  icon: ${n}`);
  if (runIconPipeline) io.out(`  icon: ${dryRun ? 'would run' : 'will run'} npm run desktop:icons (stable set and Dev set in src-tauri/icons)`);
  if (skippedKeep.length > 0) io.out(`Left alone (contains "${KEEP_MARKER}"): ${skippedKeep.join(', ')}`);
  io.out('Never edited: CHANGELOG.md, LICENSE, THIRD_PARTY_NOTICES.md, scripts/init-app.mjs and its tests.');

  if (dryRun) return 0;

  if (!yes && interactive) {
    const answer = (await io.ask('Apply these changes? [y/N]: ')).trim().toLowerCase();
    if (answer !== 'y' && answer !== 'yes') {
      io.out('Cancelled. Nothing was written.');
      return 1;
    }
  }

  for (const e of edits) fs.writeFileSync(path.join(root, e.rel), e.content);
  for (const p of iconPlan) {
    fs.mkdirSync(path.dirname(p.file), { recursive: true });
    fs.writeFileSync(p.file, p.content);
  }
  io.out(`Wrote ${edits.length} file(s).`);

  if (runIconPipeline) {
    const code = regenerateIcons(root, io);
    if (code !== 0) return code;
  }

  formatRust(root, edits.map((e) => e.rel), io);

  io.out('');
  io.out('Next steps:');
  io.out('  1. Review the result: git diff   (or git status; the rename is plain text edits, so read it before you commit)');
  io.out('  2. npm ci                        (refreshes node_modules; package-lock.json was renamed in place)');
  io.out('  3. cargo check --manifest-path src-tauri/Cargo.toml   (confirms the renamed crate builds)');
  io.out('  4. npm run desktop:dev           (try the app)');
  io.out(`  5. Fill in ${storeConfigRel(root)}, then: npm run check:store-config`);
  io.out('  6. Create the two GitHub repositories and set the RELEASES_TOKEN secret on the source repo (docs/RELEASING.md)');
  io.out('  7. Update the README, privacy and install guides to your own product text');
  if (iconPng) io.out('  8. public/favicon.svg was left as is: replace it with your own favicon');
  return 0;
}

/**
 * Renamed strings change line lengths, so run cargo fmt on the shell when Rust files were edited (desktop-check.yml
 * runs cargo fmt --check). Only in a real kit tree (src-tauri/src/main.rs present); a missing or failing cargo is
 * reported, never fatal.
 */
function formatRust(root, editedRels, io) {
  if (!editedRels.some((rel) => rel.startsWith('src-tauri/') && rel.endsWith('.rs'))) return;
  if (!fs.existsSync(path.join(root, 'src-tauri', 'src', 'main.rs'))) return;
  const result = spawnSync('cargo', ['fmt', '--manifest-path', path.join(root, 'src-tauri', 'Cargo.toml')], { cwd: root, encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    io.out('Note: could not run cargo fmt (is Rust installed?). Run it in src-tauri before you commit: cargo fmt');
    return;
  }
  io.out('Formatted the Rust sources (cargo fmt).');
}

function regenerateIcons(root, io) {
  const script = path.join(root, 'scripts', 'desktop', 'icons.js');
  const cli = path.join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
  if (!fs.existsSync(script) || !fs.existsSync(cli)) {
    io.out('Icons: source.svg was updated, but the Tauri CLI is not installed here. Run npm ci, then npm run desktop:icons.');
    return 0;
  }
  io.out('Regenerating icons (npm run desktop:icons)...');
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    io.err(`Icon generation failed: ${(result.stderr || result.stdout || String(result.error ?? '')).trim()}`);
    io.err('The rename itself is done. Fix the problem and run: npm run desktop:icons');
    return 1;
  }
  io.out((result.stdout || '').trim());
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
