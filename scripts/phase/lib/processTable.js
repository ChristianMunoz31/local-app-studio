// Live readers for scripts/phase/cleanup.js: the process table (lib/cwdScan.ps1), the port listeners (netstat through the
// diagnostics facade) and the worktree list (git). Every child runs through execFile or spawnSync with an argv array and
// no shell. Nothing here stops a process except stopTree, which is only called for a row the plan allowed.
import { execFile, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultPortsFacade, parseNetstat } from '../../../server/diagnostics/ports.js';
import { parseWorktreeList } from './worktrees.js';

export const CWD_SCAN_SCRIPT = fileURLToPath(new URL('./cwdScan.ps1', import.meta.url));
const MAX_BUFFER = 32 * 1024 * 1024;

// Windows tools by absolute path (the taskkill resolution below), so a planted powershell.exe in a cwd or on PATH is never run.
const systemExe = (...parts) => path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32', ...parts);
export const powershellExe = () => systemExe('WindowsPowerShell', 'v1.0', 'powershell.exe');
const netstatExe = () => systemExe('netstat.exe');

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const insideRoot = (dir, root) => {
  const rel = path.relative(path.resolve(root), path.resolve(dir));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/**
 * The absolute path of git (git.exe on Windows): the first absolute PATH entry outside the repo root that holds it, then,
 * on Windows, the default install folder. libuv searches the working directory before PATH for a bare name on Windows,
 * and `npm run` puts the repo's node_modules/.bin first on PATH, so git by name (or a git in a repo folder) could run
 * planted code. Returns null when nothing absolute is found; callers fail with GIT_NOT_FOUND.
 */
export function gitExe(env = process.env, exists = fs.existsSync, root = REPO_ROOT, platform = process.platform) {
  const name = platform === 'win32' ? 'git.exe' : 'git';
  const dirs = String(env.PATH ?? env.Path ?? '').split(path.delimiter).filter((d) => d !== '' && path.isAbsolute(d) && !insideRoot(d, root));
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    if (exists(candidate)) return candidate;
  }
  if (platform !== 'win32') return null;
  const fallback = path.join(env.ProgramFiles ?? 'C:/Program Files', 'Git', 'cmd', 'git.exe');
  return !insideRoot(fallback, root) && exists(fallback) ? fallback : null;
}

export const GIT_NOT_FOUND = 'git not found on an absolute PATH entry';

/** Runs a file with an argv array, no shell. Resolves `{ code, stdout, stderr }`, never rejects. */
export function runFile(file, args, { cwd, timeout = 60000 } = {}) {
  return new Promise((resolve) => {
    try {
      execFile(file, args, { shell: false, windowsHide: true, timeout, maxBuffer: MAX_BUFFER, encoding: 'utf8', cwd }, (err, stdout, stderr) => {
        const code = err === null ? 0 : typeof err.code === 'number' ? err.code : null;
        resolve({ code, stdout: typeof stdout === 'string' ? stdout : '', stderr: typeof stderr === 'string' ? stderr : '' });
      });
    } catch (e) {
      resolve({ code: null, stdout: '', stderr: String(e?.message ?? e) });
    }
  });
}

/** The argv of one cwdScan.ps1 call: `-File <script>` and each parameter as its own entry. */
export function scanArgv(script, { root, processId } = {}) {
  const argv = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script];
  if (typeof root === 'string' && root !== '') argv.push('-Root', root);
  if (Number.isInteger(processId) && processId > 0) argv.push('-ProcessId', String(processId));
  return argv;
}

/**
 * Parses the JSON of cwdScan.ps1 into rows. Throws on text that is not an array.
 * @param {string} text
 * @returns {{ pid: number, ppid: number, name: string, cwd: string | null, cmd: string, created: string | null }[]}
 */
export function parseScanOutput(text) {
  const parsed = JSON.parse(String(text).replace(/^\uFEFF/, '').trim() || '[]');
  if (!Array.isArray(parsed)) throw new Error('the process scan did not return a list');
  return parsed
    .filter((r) => r && Number.isInteger(r.pid))
    .map((r) => ({
      pid: r.pid,
      ppid: Number.isInteger(r.ppid) ? r.ppid : 0,
      name: typeof r.name === 'string' ? r.name : '',
      cwd: typeof r.cwd === 'string' ? r.cwd : null,
      cmd: typeof r.cmd === 'string' ? r.cmd : '',
      created: typeof r.created === 'string' ? r.created : null,
    }));
}

/** The whole process table (throws when the scan fails). */
export async function readProcessTable({ run = runFile, script = CWD_SCAN_SCRIPT } = {}) {
  const r = await run(powershellExe(), scanArgv(script), { timeout: 60000 });
  if (r.code !== 0) throw new Error(`the process scan failed (exit ${r.code ?? 'none'}): ${String(r.stderr).trim().slice(0, 200)}`);
  return parseScanOutput(r.stdout);
}

/** One process (an empty list when it is gone). */
export async function readProcess(pid, { run = runFile, script = CWD_SCAN_SCRIPT } = {}) {
  const r = await run(powershellExe(), scanArgv(script, { processId: pid }), { timeout: 60000 });
  if (r.code !== 0) throw new Error(`the process re-read failed (exit ${r.code ?? 'none'})`);
  return parseScanOutput(r.stdout);
}

/**
 * Listeners on the given ports from `netstat.exe -ano -p TCP` (IPv4) and `-p TCPv6` (`[::1]`, `[::]`); known only when both reads succeed.
 * @param {number[]} ports
 * @param {import('../../../server/diagnostics/ports.js').PortsFacade} [facade]
 * @returns {Promise<{ known: boolean, holders: { port: number, pid: number }[] }>}
 */
export async function readPortHolders(ports, facade = defaultPortsFacade()) {
  const v4 = await facade.exec(netstatExe(), ['-ano', '-p', 'TCP']);
  const v6 = await facade.exec(netstatExe(), ['-ano', '-p', 'TCPv6']);
  if (v4.code !== 0 || v6.code !== 0) return { known: false, holders: [] };
  const holders = [];
  for (const port of ports) {
    const pids = new Set([parseNetstat(v4.stdout, port), parseNetstat(v6.stdout, port)]);
    pids.delete(null);
    for (const pid of pids) holders.push({ port, pid });
  }
  return { known: true, holders };
}

/** `git worktree list --porcelain` run in `repoRoot`. */
export async function readWorktrees(repoRoot, run = runFile) {
  const git = gitExe();
  if (git === null) throw new Error(GIT_NOT_FOUND);
  const r = await run(git, ['worktree', 'list', '--porcelain'], { cwd: repoRoot, timeout: 30000 });
  if (r.code !== 0) throw new Error(`git worktree list failed: ${String(r.stderr).trim().slice(0, 200)}`);
  return parseWorktreeList(r.stdout);
}

/**
 * Ends one process and everything below it, by pid and by absolute taskkill path (like e2e/support/appServer.js).
 * @param {number} pid
 * @returns {{ ok: boolean, detail: string }}
 */
export function stopTree(pid) {
  if (!Number.isInteger(pid) || pid <= 4 || pid === process.pid) return { ok: false, detail: `refusing pid ${pid}` };
  const exe = path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'taskkill.exe');
  const r = spawnSync(exe, ['/PID', String(pid), '/T', '/F'], { shell: false, windowsHide: true, encoding: 'utf8' });
  return { ok: r.status === 0, detail: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split(/\r?\n/)[0] ?? '' };
}
