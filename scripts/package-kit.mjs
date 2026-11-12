// Builds the sellable kit ZIP from a git tag.
//
// Usage: npm run package:kit -- [--tag vX.Y.Z] [--out dist-kit] [--allow-missing-rust-notices]
//                               [--allow-missing-gitleaks] [--allow-empty-denylist]
//
//   --tag    release tag to package (default: v<package.json version>). With no --tag the working tree must
//            have no uncommitted changes to tracked files. The tag must exist: create it with
//            `git tag -a vX.Y.Z -m "vX.Y.Z"` on the release commit.
//   --out    output folder, relative to the repo root (default: dist-kit; gitignored)
//   --allow-missing-rust-notices
//            continue (with a warning) when `cargo metadata --offline` cannot list the Rust crates. Without
//            this flag a missing or failing cargo aborts, because the kit must ship complete notices.
//
//   --allow-missing-gitleaks
//            continue (with a loud warning) when gitleaks is not installed. Without this flag a missing gitleaks
//            aborts. A GITLEAKS_BIN that points at a missing file always aborts.
//   --allow-empty-denylist
//            continue (with a loud warning) when there are zero forbidden terms. Without this flag an empty
//            denylist aborts: terms come from the gitignored .personal-denylist or PERSONAL_DENYLIST.
//
// Env: GITLEAKS_BIN (path to gitleaks; otherwise `gitleaks` on PATH), PERSONAL_DENYLIST (extra forbidden terms).
//
// Steps: `git archive` of the tag (honors `export-ignore` in .gitattributes), exclusion predicate on every
// entry (defense in depth), LICENSE and CHANGELOG.md must exist, THIRD_PARTY_NOTICES.md is generated, a safety
// scan runs over the final file set (denylist terms, private keys, gitleaks; both the denylist and gitleaks are
// required unless explicitly waived), then the ZIP and its .sha256 are
// written under a top-level folder `tauri-local-ai-starter-<tag>/`. Any scan hit aborts before a ZIP is written.
// No network and no paid tools are used.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { unzipSync, zipSync } from 'fflate';
import {
  KIT_NAME,
  KitError,
  NOTICES_FILE,
  REQUIRED_FILES,
  WINDOWS_TARGETS,
  archiveRootName,
  collectBundledComponents,
  collectNpmPackages,
  collectRustPackages,
  excludeRule,
  findGitleaks,
  formatSha256File,
  humanSize,
  loadForbiddenTerms,
  renderNotices,
  resolveTag,
  scanFileSet,
  sha256Hex,
} from './lib/kitPackage.js';

export {
  KitError,
  archiveRootName,
  collectNpmPackages,
  collectRustPackages,
  excludeRule,
  formatSha256File,
  isExcluded,
  renderNotices,
  resolveTag,
  scanFileSet,
} from './lib/kitPackage.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BUFFER = 1024 * 1024 * 1024;

function run(cmd, args, { cwd, input, env } = {}) {
  const res = spawnSync(cmd, args, { cwd, input, env, maxBuffer: MAX_BUFFER, windowsHide: true });
  return {
    status: res.status,
    error: res.error,
    stdout: res.stdout ?? Buffer.alloc(0),
    stderr: String(res.stderr ?? '').trim(),
  };
}

function git(repoRoot, args) {
  const res = run('git', args, { cwd: repoRoot });
  if (res.error || res.status !== 0) {
    throw new KitError(`git ${args[0]} failed${res.stderr ? `: ${res.stderr}` : res.error ? `: ${res.error.message}` : ''}`);
  }
  return res.stdout;
}

const gitText = (repoRoot, args) => git(repoRoot, args).toString('utf8').trim();

/** Fixed mtime for every entry: the tag commit time, so the same tag always gives the same ZIP bytes. */
function zipDate(epochSeconds) {
  const d = new Date(Math.max(epochSeconds, 315_619_200) * 1000);
  // fflate reads local date fields, so build the Date from the UTC fields to keep the DOS time timezone-free.
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds() & ~1);
}

function executablePaths(repoRoot, ref) {
  const out = git(repoRoot, ['ls-tree', '-r', '-z', ref]).toString('utf8');
  const exec = new Set();
  for (const rec of out.split('\0').filter(Boolean)) {
    const tab = rec.indexOf('\t');
    if (rec.slice(0, tab).startsWith('100755')) exec.add(rec.slice(tab + 1));
  }
  return exec;
}

function readArchive(repoRoot, ref) {
  const zip = git(repoRoot, ['archive', '--format=zip', ref]);
  const entries = unzipSync(new Uint8Array(zip.buffer, zip.byteOffset, zip.byteLength));
  const files = new Map();
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith('/')) continue;
    files.set(name, data);
  }
  return files;
}

function writeTree(dir, files, filter = () => true) {
  for (const [rel, data] of files) {
    if (!filter(rel)) continue;
    const dest = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
  }
}

/** Runs `cargo metadata --offline` per Windows target on the staged src-tauri folder. */
function cargoMetadata(stageDir) {
  const manifest = path.join(stageDir, 'src-tauri', 'Cargo.toml');
  return WINDOWS_TARGETS.map((target) => {
    const res = run('cargo', ['metadata', '--offline', '--locked', '--format-version', '1', '--filter-platform', target, '--manifest-path', manifest], {
      cwd: stageDir,
    });
    if (res.error) throw new KitError(`cargo is not available (${res.error.message}).`);
    if (res.status !== 0) throw new KitError(`cargo metadata --offline failed for ${target}: ${res.stderr.split('\n').slice(-6).join(' | ')}`);
    return JSON.parse(res.stdout.toString('utf8'));
  });
}

/** `command` is the gitleaks argv prefix: [binary] normally, or [node, script] for a test double. */
function gitleaksScan(command, files, log) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-gitleaks-'));
  try {
    const tree = path.join(tmp, 'tree');
    writeTree(tree, files);
    const args = ['dir', '.', '--no-banner', '--redact', '--exit-code', '1'];
    const config = files.get('.gitleaks.toml');
    if (config) {
      const configFile = path.join(tmp, 'gitleaks.toml');
      fs.writeFileSync(configFile, config);
      args.push('--config', configFile);
    }
    const res = run(command[0], [...command.slice(1), ...args], { cwd: tree });
    if (res.error) throw new KitError(`gitleaks could not run: ${res.error.message}`);
    if (res.status !== 0) {
      const text = `${res.stdout.toString('utf8')}\n${res.stderr}`.trim();
      throw new KitError(`gitleaks reported findings (exit ${res.status}); no ZIP written:\n${text}`);
    }
    log('gitleaks: no leaks found');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Builds the kit ZIP. Throws KitError for every expected failure.
 * @param {object} opts
 * @param {string} [opts.repoRoot]
 * @param {string} [opts.tag] explicit tag; omitted means v<package.json version> and a clean tree
 * @param {string} [opts.out] output folder, relative to repoRoot or absolute
 * @param {boolean} [opts.allowMissingRustNotices]
 * @param {boolean} [opts.allowMissingGitleaks] warn instead of abort when gitleaks is not installed
 * @param {boolean} [opts.allowEmptyDenylist] warn instead of abort when there are zero forbidden terms
 * @param {string[]} [opts.gitleaksCommand] argv prefix that replaces gitleaks discovery (tests)
 * @param {(stageDir: string) => object[]} [opts.rustMetadata] replaces `cargo metadata` (tests)
 * @param {NodeJS.ProcessEnv} [opts.env] used to find gitleaks and extra denylist terms
 * @param {(msg: string) => void} [opts.log]
 * @param {(msg: string) => void} [opts.warn]
 */
export function packageKit({
  repoRoot = REPO_ROOT,
  tag: tagArg,
  out = 'dist-kit',
  allowMissingRustNotices = false,
  allowMissingGitleaks = false,
  allowEmptyDenylist = false,
  gitleaksCommand,
  rustMetadata = cargoMetadata,
  env = process.env,
  log = console.log,
  warn = console.warn,
} = {}) {
  if (run('git', ['rev-parse', '--is-inside-work-tree'], { cwd: repoRoot }).status !== 0) {
    throw new KitError('package:kit must run inside a git repository.');
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const { tag, implied } = resolveTag({ tagArg, version: pkg.version });
  const ref = `refs/tags/${tag}`;
  if (run('git', ['rev-parse', '--verify', '--quiet', ref], { cwd: repoRoot }).status !== 0) {
    throw new KitError(`Tag ${tag} does not exist. Create it on the release commit first: git tag -a ${tag} -m "${tag}"`);
  }
  if (implied) {
    const dirty = gitText(repoRoot, ['status', '--porcelain', '--untracked-files=no']);
    if (dirty) {
      throw new KitError(
        `The working tree has uncommitted changes, and the tag ${tag} was implied from package.json. Commit or stash them, or pass --tag explicitly.\n${dirty}`,
      );
    }
  }
  const commit = gitText(repoRoot, ['rev-parse', `${ref}^{commit}`]);
  const commitTime = Number(gitText(repoRoot, ['log', '-1', '--format=%ct', commit]));

  // 1. Archive plus defense-in-depth exclusions.
  const archived = readArchive(repoRoot, ref);
  const files = new Map();
  const dropped = [];
  for (const [name, data] of archived) {
    const rule = excludeRule(name);
    if (rule) dropped.push({ name, rule });
    else files.set(name, data);
  }
  for (const d of dropped) warn(`excluded by predicate (not caught by export-ignore): ${d.name} (${d.rule})`);
  for (const required of REQUIRED_FILES) {
    if (!files.has(required)) throw new KitError(`${required} is missing from ${tag}; the kit must ship it.`);
  }

  // 2. Third-party notices (from the tag's lock file; license texts from the installed copies).
  const lockBytes = files.get('package-lock.json');
  if (!lockBytes) throw new KitError('package-lock.json is missing from the tag; cannot generate THIRD_PARTY_NOTICES.md.');
  const lock = JSON.parse(Buffer.from(lockBytes).toString('utf8'));
  const npm = collectNpmPackages(lock, repoRoot);
  const bundled = collectBundledComponents(lock, repoRoot);
  let rust = [];
  let rustNote = '';
  if (files.has('src-tauri/Cargo.toml')) {
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-cargo-'));
    try {
      writeTree(stage, files, (rel) => rel.startsWith('src-tauri/'));
      rust = collectRustPackages(rustMetadata(stage));
    } catch (e) {
      if (!allowMissingRustNotices) {
        const reason = e instanceof Error ? e.message : String(e);
        throw new KitError(`${reason}\nRust notices are required. Fix cargo, or pass --allow-missing-rust-notices to skip them.`);
      }
      rustNote = 'The Rust crate list could not be generated when this kit was packaged. See Cargo.lock for the crates in the desktop shell.';
      warn(`WARNING: Rust notices skipped (${e instanceof Error ? e.message : e}).`);
    } finally {
      fs.rmSync(stage, { recursive: true, force: true });
    }
  }
  files.set(NOTICES_FILE, new TextEncoder().encode(renderNotices({ tag, npm, rust, bundled, rustNote })));
  log(`notices: ${npm.length} npm package(s), ${bundled.length} bundled component(s), ${rust.length} Rust crate(s)`);

  // 3. Safety scan over the final set; abort before writing anything.
  const terms = loadForbiddenTerms(repoRoot, env);
  const termCount = terms.denylist.length + terms.hashed.length;
  if (termCount === 0) {
    if (!allowEmptyDenylist) {
      throw new KitError(
        'The forbidden-term list is empty, so the personal-data scan would pass silently. Add terms to the local .personal-denylist file or the PERSONAL_DENYLIST env var, or pass --allow-empty-denylist to skip this check.',
      );
    }
    warn('WARNING: the forbidden-term list is EMPTY; the personal-data scan checked nothing (--allow-empty-denylist).');
  }
  const findings = scanFileSet(files, terms);
  if (findings.length) {
    const lines = findings.map((f) => `  ${f.file}: ${f.rule}`).join('\n');
    throw new KitError(`Safety scan failed with ${findings.length} finding(s); no ZIP written:\n${lines}`);
  }
  log(`safety scan: clean (${files.size} files, ${termCount} forbidden term(s))`);
  if (!gitleaksCommand && env.GITLEAKS_BIN && !fs.existsSync(env.GITLEAKS_BIN)) {
    throw new KitError('GITLEAKS_BIN is set but that file does not exist. Fix the path or unset GITLEAKS_BIN.');
  }
  const gitleaks = gitleaksCommand ?? [findGitleaks(env)].filter(Boolean);
  if (gitleaks.length) gitleaksScan(gitleaks, files, log);
  else if (allowMissingGitleaks) warn('WARNING: gitleaks not found; the secret scan was SKIPPED (--allow-missing-gitleaks). Do not ship this ZIP without running gitleaks.');
  else {
    throw new KitError(
      'gitleaks was not found. Install it (winget install Gitleaks.Gitleaks), then set GITLEAKS_BIN or put it on PATH, or pass --allow-missing-gitleaks to skip the secret scan.',
    );
  }

  // 4. ZIP, sorted and with fixed mtimes.
  const root = archiveRootName(tag);
  const mtime = zipDate(commitTime);
  const executable = executablePaths(repoRoot, ref);
  const entries = {};
  for (const name of [...files.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const mode = executable.has(name) ? 0o100755 : 0o100644;
    entries[`${root}/${name}`] = [files.get(name), { level: 9, mtime, os: 3, attrs: (mode << 16) >>> 0 }];
  }
  const zipBytes = zipSync(entries);
  if (Object.keys(unzipSync(zipBytes)).length !== files.size) throw new KitError('ZIP verification failed: entry count mismatch.');

  const outDir = path.resolve(repoRoot, out);
  fs.mkdirSync(outDir, { recursive: true });
  const zipName = `${root}.zip`;
  const zipPath = path.join(outDir, zipName);
  const shaPath = `${zipPath}.sha256`;
  const sha256 = sha256Hex(zipBytes);
  fs.writeFileSync(zipPath, zipBytes);
  fs.writeFileSync(shaPath, formatSha256File(sha256, zipName));

  return { tag, commit, zipPath, shaPath, size: zipBytes.length, fileCount: files.size, sha256, root, excludedByPredicate: dropped, npmCount: npm.length, rustCount: rust.length };
}

export function main(argv = process.argv.slice(2)) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        tag: { type: 'string' },
        out: { type: 'string' },
        'allow-missing-rust-notices': { type: 'boolean' },
        'allow-missing-gitleaks': { type: 'boolean' },
        'allow-empty-denylist': { type: 'boolean' },
      },
      strict: true,
    }));
  } catch (e) {
    console.error(`${e.message}\nUsage: npm run package:kit -- [--tag vX.Y.Z] [--out dist-kit] [--allow-missing-rust-notices] [--allow-missing-gitleaks] [--allow-empty-denylist]`);
    return 2;
  }
  try {
    const r = packageKit({
      tag: values.tag,
      out: values.out,
      allowMissingRustNotices: values['allow-missing-rust-notices'],
      allowMissingGitleaks: values['allow-missing-gitleaks'],
      allowEmptyDenylist: values['allow-empty-denylist'],
    });
    console.log(`\n${KIT_NAME} ${r.tag} (${r.commit.slice(0, 7)})`);
    console.log(`ZIP:    ${r.zipPath}`);
    console.log(`Size:   ${r.size} bytes (${humanSize(r.size)})`);
    console.log(`Files:  ${r.fileCount}`);
    console.log(`SHA256: ${r.sha256}`);
    console.log(`Sum:    ${r.shaPath}`);
    return 0;
  } catch (e) {
    if (e instanceof KitError) {
      console.error(`package:kit failed: ${e.message}`);
      return 1;
    }
    throw e;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
