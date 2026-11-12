// Brings the owner's checkout up to date with origin/main and rebuilds it.
//
//   npm run dev:refresh -- [--dry-run] [--dir <path>] [--desktop]
//
// Steps: verify a clean checkout on main, refuse when a process or dev port is using it, record
// HEAD and the package-lock.json hash, `git pull --ff-only origin main`, `npm ci` only when the
// lockfile changed, `npm run build`, then the bundle check and a summary (commits pulled, changed
// files by area, whether deps were reinstalled).
//
//   --dry-run   print the plan and what the checks found; change nothing
//   --dir       the checkout to refresh (default: the repo this script lives in)
//   --desktop   also build the Local App Studio Dev channel installer (see buildDevChannelInstaller)
//
// It never reads or writes the Local App Studio data directory; git, npm and the build run in the checkout.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveNpmCli } from './lib/sandboxSafety.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEV_PORTS = Object.freeze([4321, 5174]);
export const DEV_CHANNEL_SCRIPT = 'desktop:build:dev';
export const DEV_CHANNEL_MISSING = 'Local App Studio Dev channel build is not available on this branch yet';
const USAGE = 'Usage: npm run dev:refresh -- [--dry-run] [--dir <path>] [--desktop]';

export class RefreshRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = 'RefreshRefusal';
  }
}

/**
 * @param {string[]} argv
 * @param {string} [defaultDir]
 * @returns {{ dryRun: boolean, dir: string, desktop: boolean }}
 */
export function parseArgs(argv, defaultDir = REPO_ROOT) {
  const out = { dryRun: false, dir: defaultDir, desktop: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--desktop') out.desktop = true;
    else if (a === '--dir') {
      if (i + 1 >= argv.length) throw new RefreshRefusal(`--dir needs a value.\n${USAGE}`);
      out.dir = path.resolve(argv[(i += 1)]);
    } else throw new RefreshRefusal(`Unknown argument: ${a}\n${USAGE}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------

/**
 * Reasons the checkout must not be refreshed (empty when it is fine).
 * @param {{ isGit: boolean, topLevelMatches: boolean, branch: string, dirty: string[] }} state
 * @returns {string[]}
 */
export function checkoutProblems({ isGit, topLevelMatches, branch, dirty }) {
  if (!isGit) return ['This folder is not a git checkout.'];
  const problems = [];
  if (!topLevelMatches) problems.push('This folder is inside a git checkout but is not its top level. Pass the checkout root with --dir.');
  if (branch !== 'main') problems.push(`The checkout is on ${branch ? `branch "${branch}"` : 'a detached HEAD'}, not main. Switch to main first.`);
  if (dirty.length > 0) {
    const shown = dirty.slice(0, 5).join(', ');
    problems.push(`The working tree is not clean (${dirty.length} change${dirty.length === 1 ? '' : 's'}: ${shown}${dirty.length > 5 ? ', ...' : ''}). Commit or stash them first.`);
  }
  return problems;
}

const toComparable = (value, platform) => {
  const slashed = String(value ?? '').replace(/\\/g, '/');
  return platform === 'win32' ? slashed.toLowerCase() : slashed;
};
const PATH_CHAR = /[A-Za-z0-9_.-]/;

/** True when `text` contains `needle` as a whole path (not as the prefix of a sibling folder name). */
function containsPath(text, needle) {
  if (!needle) return false;
  const trimmed = needle.replace(/\/+$/, '');
  let from = 0;
  for (;;) {
    const at = text.indexOf(trimmed, from);
    if (at === -1) return false;
    const next = text[at + trimmed.length];
    if (next === undefined || !PATH_CHAR.test(next)) return true;
    from = at + 1;
  }
}

const NAME_RE = /^(node|local-app-studio)/i;

/**
 * The node/local-app-studio processes whose command line or executable lives in `checkout`.
 * @param {Array<{ pid: number, name?: string, commandLine?: string, executablePath?: string }>} processes
 * @param {string} checkout
 * @param {{ platform?: NodeJS.Platform, ignorePids?: number[] }} [opts]
 * @returns {Array<{ pid: number, name: string, commandLine: string }>}
 */
export function matchCheckoutProcesses(processes, checkout, { platform = process.platform, ignorePids = [] } = {}) {
  const dir = toComparable(checkout, platform);
  const out = [];
  for (const p of Array.isArray(processes) ? processes : []) {
    if (!p || !Number.isInteger(p.pid) || ignorePids.includes(p.pid)) continue;
    const name = String(p.name ?? '');
    if (!NAME_RE.test(path.basename(name.replace(/\\/g, '/')))) continue;
    const cmd = String(p.commandLine ?? '');
    if (/devRefresh\.js|dev:refresh/.test(cmd)) continue;
    if (containsPath(toComparable(cmd, platform), dir) || containsPath(toComparable(p.executablePath, platform), dir)) {
      out.push({ pid: p.pid, name, commandLine: cmd.slice(0, 200) });
    }
  }
  return out;
}

/**
 * Parses the Windows process list (`ConvertTo-Json`: one object or an array) or POSIX `ps -eo pid,args`.
 * @param {string} text
 * @param {NodeJS.Platform} platform
 * @returns {Array<{ pid: number, name: string, commandLine: string, executablePath: string }>}
 */
export function parseProcessList(text, platform = process.platform) {
  if (platform === 'win32') {
    let data;
    try {
      data = JSON.parse(text || '[]');
    } catch {
      return [];
    }
    return (Array.isArray(data) ? data : [data])
      .filter((p) => p && Number.isInteger(p.ProcessId))
      .map((p) => ({ pid: p.ProcessId, name: String(p.Name ?? ''), commandLine: String(p.CommandLine ?? ''), executablePath: String(p.ExecutablePath ?? '') }));
  }
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (!m) continue;
    const args = m[2];
    const exe = args.split(/\s+/)[0];
    out.push({ pid: Number(m[1]), name: path.posix.basename(exe), commandLine: args, executablePath: exe });
  }
  return out;
}

const AREAS = [
  ['dependencies', /^(package(-lock)?\.json)$/],
  ['server', /^(server\.js|server\/)/],
  ['ui', /^(src\/|index\.html|vite\.config|public\/)/],
  ['desktop', /^src-tauri\//],
  ['scripts', /^scripts\//],
  ['ci', /^(\.github\/|\.githooks\/)/],
  ['docs', /^(docs\/|[^/]+\.md$)/],
];

/**
 * Groups changed file paths by area (dependencies, server, ui, desktop, scripts, ci, docs, other).
 * @param {string[]} files
 * @returns {Record<string, string[]>}
 */
export function groupChangedFiles(files) {
  const groups = {};
  for (const raw of Array.isArray(files) ? files : []) {
    const file = String(raw).replace(/\\/g, '/').trim();
    if (!file) continue;
    const area = AREAS.find(([, re]) => re.test(file))?.[0] ?? 'other';
    (groups[area] ||= []).push(file);
  }
  return groups;
}

/**
 * The ordered steps the refresh will run.
 * @param {{ dir: string, desktop: boolean }} opts
 * @returns {string[]}
 */
export function buildPlan({ dir, desktop }) {
  const steps = [
    `Check ${dir} is a clean git checkout on main`,
    `Refuse if a node/local-app-studio process uses this checkout or ports ${DEV_PORTS.join('/')} are listening`,
    'Record HEAD and the package-lock.json hash',
    'git pull --ff-only origin main',
    'npm ci (only if package-lock.json changed)',
    'npm run build',
    'npm run check:bundle (reported, does not fail the refresh)',
    'Print a summary: commits pulled, changed files by area, deps reinstalled, bundle check',
  ];
  if (desktop) steps.push(`npm run ${DEV_CHANNEL_SCRIPT} (Local App Studio Dev channel installer, if this branch has it)`);
  return steps;
}

/**
 * The summary text printed at the end.
 * @param {{ oldHead: string, newHead: string, commits: string[], files: string[], depsReinstalled: boolean, bundle: { ran: boolean, ok: boolean }, desktop?: string | null }} info
 * @returns {string[]}
 */
export function formatSummary({ oldHead, newHead, commits, files, depsReinstalled, bundle, desktop = null }) {
  const lines = ['', 'Summary'];
  if (oldHead === newHead) lines.push(`  Already up to date at ${newHead.slice(0, 7)} (rebuilt anyway).`);
  else lines.push(`  ${oldHead.slice(0, 7)} -> ${newHead.slice(0, 7)}, ${commits.length} commit${commits.length === 1 ? '' : 's'} pulled:`, ...commits.map((c) => `    ${c}`));
  const groups = groupChangedFiles(files);
  const areas = Object.keys(groups);
  if (areas.length) {
    lines.push('  Changed files:');
    for (const area of areas) lines.push(`    ${area} (${groups[area].length}): ${groups[area].slice(0, 6).join(', ')}${groups[area].length > 6 ? ', ...' : ''}`);
  }
  lines.push(`  Dependencies reinstalled: ${depsReinstalled ? 'yes (package-lock.json changed)' : 'no (package-lock.json unchanged)'}`);
  lines.push(`  Bundle check: ${bundle.ran ? (bundle.ok ? 'passed' : 'FAILED (see output above)') : 'not run'}`);
  if (desktop) lines.push(`  Dev channel: ${desktop}`);
  lines.push('  Restart your dev servers to use the new build.');
  return lines;
}

/**
 * Hook for the Local App Studio Dev channel: builds its installer when this branch defines the
 * `desktop:build:dev` script, else says it is not available yet.
 * @param {{ pkg: { scripts?: Record<string, string> } | null, dir: string, runner: Runner, log: (line: string) => void }} opts
 * @returns {string} A one-line result for the summary.
 */
export function buildDevChannelInstaller({ pkg, dir, runner, log }) {
  if (!pkg?.scripts?.[DEV_CHANNEL_SCRIPT]) {
    log(DEV_CHANNEL_MISSING);
    return DEV_CHANNEL_MISSING;
  }
  log(`Building the Local App Studio Dev channel installer (npm run ${DEV_CHANNEL_SCRIPT})...`);
  const res = runner('npm', ['run', DEV_CHANNEL_SCRIPT], { cwd: dir, inherit: true });
  if (res.status !== 0) throw new Error(`npm run ${DEV_CHANNEL_SCRIPT} failed (exit ${res.status ?? 'signal'})`);
  return 'built';
}

// ---------------------------------------------------------------------------
// Orchestration (everything external is injected)
// ---------------------------------------------------------------------------

/**
 * @typedef {(cmd: string, args: string[], opts?: { cwd?: string, inherit?: boolean }) => { status: number | null, stdout: string }} Runner
 */

/**
 * @param {{
 *   args: { dryRun: boolean, dir: string, desktop: boolean },
 *   runner: Runner,
 *   listProcesses: () => Array<{ pid: number, name: string, commandLine: string, executablePath: string }>,
 *   portOpen: (port: number) => Promise<boolean>,
 *   hashFile: (file: string) => string | null,
 *   readPackage: (dir: string) => { scripts?: Record<string, string> } | null,
 *   log?: (line: string) => void,
 *   platform?: NodeJS.Platform,
 *   ignorePids?: number[],
 * }} deps
 * @returns {Promise<{ refreshed: boolean }>}
 */
export async function refresh({ args, runner, listProcesses, portOpen, hashFile, readPackage, log = console.log, platform = process.platform, ignorePids = [] }) {
  const { dir, dryRun, desktop } = args;
  const git = (...a) => runner('git', a, { cwd: dir });
  const out = (res) => String(res.stdout ?? '').trim();

  const top = git('rev-parse', '--show-toplevel');
  const isGit = top.status === 0;
  const same = (a, b) => toComparable(path.resolve(a), platform) === toComparable(path.resolve(b), platform);
  const branch = isGit ? out(git('branch', '--show-current')) : '';
  const dirty = isGit ? out(git('status', '--porcelain')).split(/\r?\n/).filter(Boolean) : [];
  const problems = checkoutProblems({ isGit, topLevelMatches: isGit && same(out(top), dir), branch, dirty });

  const users = matchCheckoutProcesses(listProcesses(), dir, { platform, ignorePids });
  for (const u of users) problems.push(`Process ${u.pid} (${u.name}) is using this checkout: ${u.commandLine}`);
  const busy = [];
  for (const port of DEV_PORTS) if (await portOpen(port)) busy.push(port);
  if (busy.length) problems.push(`Something is listening on port${busy.length > 1 ? 's' : ''} ${busy.join(' and ')} (the dev servers). Stop it first.`);

  log(dryRun ? 'Dev refresh plan (dry run, nothing will change):' : `Refreshing ${dir}`);
  if (dryRun) buildPlan({ dir, desktop }).forEach((s, i) => log(`  ${i + 1}. ${s}`));
  if (problems.length) {
    const lead = dryRun ? 'A real run would refuse:' : 'Refusing to refresh:';
    throw new RefreshRefusal([lead, ...problems.map((p) => `  - ${p}`)].join('\n'));
  }
  if (dryRun) {
    log('Checks passed: a real run would proceed.');
    return { refreshed: false };
  }

  const oldHead = out(git('rev-parse', 'HEAD'));
  const lockFile = path.join(dir, 'package-lock.json');
  const oldLock = hashFile(lockFile);

  log('git pull --ff-only origin main');
  const pull = runner('git', ['pull', '--ff-only', 'origin', 'main'], { cwd: dir, inherit: true });
  if (pull.status !== 0) throw new Error('git pull --ff-only failed. Nothing was changed by this script; resolve it by hand.');

  const newHead = out(git('rev-parse', 'HEAD'));
  const newLock = hashFile(lockFile);
  const depsReinstalled = oldLock !== newLock;
  const npm = (...a) => {
    const res = runner('npm', a, { cwd: dir, inherit: true });
    if (res.status !== 0) throw new Error(`npm ${a.join(' ')} failed (exit ${res.status ?? 'signal'})`);
    return res;
  };
  if (depsReinstalled) {
    log('package-lock.json changed: npm ci');
    npm('ci');
  } else log('package-lock.json unchanged: skipping npm ci');
  log('npm run build');
  npm('run', 'build');

  log('npm run check:bundle');
  const bundleRes = runner('npm', ['run', 'check:bundle'], { cwd: dir, inherit: true });
  const bundle = { ran: bundleRes.status !== null, ok: bundleRes.status === 0 };

  const commits = oldHead === newHead ? [] : out(git('log', '--oneline', `${oldHead}..${newHead}`)).split(/\r?\n/).filter(Boolean);
  const files = oldHead === newHead ? [] : out(git('diff', '--name-only', oldHead, newHead)).split(/\r?\n/).filter(Boolean);
  const desktopResult = desktop ? buildDevChannelInstaller({ pkg: readPackage(dir), dir, runner, log }) : null;
  formatSummary({ oldHead, newHead, commits, files, depsReinstalled, bundle, desktop: desktopResult }).forEach((l) => log(l));
  return { refreshed: true };
}

// ---------------------------------------------------------------------------
// Real implementations
// ---------------------------------------------------------------------------

/** @type {Runner} */
export function realRunner(cmd, args, { cwd, inherit = false } = {}) {
  const [file, fileArgs] = cmd === 'npm' ? [process.execPath, [resolveNpmCli(), ...args]] : [cmd, args];
  const res = spawnSync(file, fileArgs, { cwd, shell: false, encoding: 'utf8', stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
  return { status: res.error ? null : res.status, stdout: res.stdout ?? '' };
}

function realListProcesses() {
  if (process.platform === 'win32') {
    const script =
      "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(node|local-app-studio)' } | Select-Object ProcessId,Name,CommandLine,ExecutablePath | ConvertTo-Json -Compress";
    const res = realRunner('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
    return parseProcessList(res.stdout, 'win32');
  }
  return parseProcessList(realRunner('ps', ['-eo', 'pid,args']).stdout, process.platform);
}

const realPortOpen = (port) =>
  new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(750, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });

const realHashFile = (file) => {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
};

const realReadPackage = (dir) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await refresh({
    args,
    runner: realRunner,
    listProcesses: realListProcesses,
    portOpen: realPortOpen,
    hashFile: realHashFile,
    readPackage: realReadPackage,
    ignorePids: [process.pid, process.ppid],
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(err instanceof RefreshRefusal ? 2 : 1);
  });
}
