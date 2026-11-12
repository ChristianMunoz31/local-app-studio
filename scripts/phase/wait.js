// One wait command and one heavy-step lock for everyone who runs a heavy step (vitest, playwright, vite, buildSidecar, cargo,
// loading a model): the phase gate, the critics and the orchestrators.
//
//   node scripts/phase/wait.js [--owner <name>] [--max-wait <s>] [--poll <s>] [--wait-for any|<worktree name>] [--lock <file>]
//     [--cwd <dir>] [--dry-run] [-- <command line>]
//
// Without a command it waits until the lock is free and no other worktree runs a heavy tool, then exits 0 (a check). With a
// command it takes the lock, runs the command in the foreground (no shell: the words are run as given, cwd = this repo unless --cwd) and releases the lock.
// The lock file holds the holder's pid and creation time; a holder that is gone is a stale lock and is taken over.
// A heavy tool of another worktree blocks too (the brief's process poll: node, cargo or rustc running vitest, playwright,
// vite, buildSidecar or cargo whose command line names the main checkout or another worktree, never this one).
// Exit 75 = still busy after --max-wait (default 240 s): call again. 2 = usage. Otherwise the command's exit code.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveNpmCli } from '../lib/sandboxSafety.js';
import { readWorktrees } from './lib/processTable.js';
import { baseOf, heavyBlockers, makeIsAlive, readCreated, readProcesses, sleepMs, targetsFor, waitForQuiet } from './lib/waitFor.js';
import { REPO_ROOT, parseFlags, wholeNumber } from './common.js';

export const EXIT_BUSY = 75;
export const DEFAULT_MAX_WAIT_S = 240;
export const DEFAULT_POLL_S = 20;
const USAGE = `Usage: node scripts/phase/wait.js [--owner <name>] [--max-wait <s>] [--poll <s>] [--wait-for any|<worktree name>]
         [--lock <file>] [--cwd <dir>] [--dry-run] [-- <command line>]`;

/** The lock file every phase script shares (one per machine). */
export const defaultLockFile = (tmpdir = os.tmpdir()) => path.join(tmpdir, 'las-heavy.lock');

/** The parsed lock, or null when it is missing or damaged. */
export function readLock(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return j && Number.isInteger(j.pid) ? j : null;
  } catch {
    return null;
  }
}

/**
 * The live holder of the lock, or null (no lock, a damaged one, or a holder that is gone).
 * @param {string} file
 * @param {(pid: number, created?: string | null) => boolean} isAlive
 */
export function liveHolder(file, isAlive) {
  const held = readLock(file);
  return held !== null && isAlive(held.pid, held.created ?? null) ? held : null;
}

/** A lock file younger than this that cannot be read is being written by its owner right now: it is held, not damaged. */
export const FRESH_LOCK_MS = 2000;

/**
 * Takes the lock when it is free or stale. The create is exclusive ('wx'), and the file is read back afterwards: the call wins only
 * when the file holds this caller's pid and creation time, otherwise another caller replaced it and this one retries later. A stale lock
 * is removed only while it still holds the content that was judged stale. Taking over a stale lock is still a short window, not a
 * guarantee: the read-back and the re-check make a double win unlikely, they do not make it impossible.
 * An empty or unparsable file younger than 2 s counts as held (its owner is between create and write); an older one is damaged and replaced.
 * @param {string} file
 * @param {{ pid: number, created?: string | null }} info
 * @param {(pid: number, created?: string | null) => boolean} isAlive
 * @param {{ now?: () => number, onWritten?: () => void }} [hooks] `now` is the clock for the fresh check; `onWritten` runs between the write and the read-back (tests)
 * @returns {{ ok: true } | { ok: false, holder: object }}
 */
export function tryAcquire(file, info, isAlive, { now = Date.now, onWritten } = {}) {
  const holder = liveHolder(file, isAlive);
  if (holder !== null) return { ok: false, holder };
  if (fs.existsSync(file)) {
    try {
      const judged = fs.readFileSync(file, 'utf8');
      if (readLock(file) === null && now() - fs.statSync(file).mtimeMs < FRESH_LOCK_MS) return { ok: false, holder: { owner: '?', cmd: 'lock being written' } };
      if (fs.readFileSync(file, 'utf8') !== judged) return { ok: false, holder: { owner: '?', cmd: 'lock changed a moment ago' } };
      fs.unlinkSync(file);
    } catch {
      return { ok: false, holder: { owner: '?', cmd: 'lock being replaced' } };
    }
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const fd = fs.openSync(file, 'wx');
    fs.writeSync(fd, JSON.stringify(info));
    fs.closeSync(fd);
    if (onWritten) onWritten();
    const back = readLock(file);
    if (back === null || back.pid !== info.pid || (back.created ?? null) !== (info.created ?? null)) return { ok: false, holder: back ?? { owner: '?', cmd: 'lock taken a moment ago' } };
    return { ok: true };
  } catch {
    return { ok: false, holder: { owner: '?', cmd: 'lock taken a moment ago' } };
  }
}

/** Removes the lock only when `pid` holds it. */
export function release(file, pid) {
  const held = readLock(file);
  if (held !== null && held.pid === pid) {
    try {
      fs.unlinkSync(file);
    } catch {
      // Already gone.
    }
  }
}

/**
 * What blocks a heavy step now: the lock holder (never this pid) and the heavy tools of other worktrees.
 * @param {{ procs: { pid: number, name: string, cmd: string }[], self: string, targets: string[], lockFile: string, isAlive: (pid: number, c?: string | null) => boolean, pid?: number }} o
 * @returns {{ pids: number[], holder: object | null, foreign: number[] }}
 */
export function blockersNow({ procs, self, targets, lockFile, isAlive, pid = process.pid }) {
  const held = liveHolder(lockFile, isAlive);
  const holder = held !== null && held.pid !== pid ? held : null;
  const foreign = heavyBlockers(procs, { self, targets });
  return { pids: [...new Set([...(holder ? [holder.pid] : []), ...foreign])], holder, foreign };
}

/**
 * The file and arguments for a command line given as words: no shell is involved. `node` is this node, `npm` and `npx` run their
 * CLI scripts under this node; anything else is run by name (a .cmd file is not: name the tool it starts).
 * @param {string[]} argv
 * @returns {[string, string[]]}
 */
export function resolveCommand(argv, { execPath = process.execPath, npmCli = resolveNpmCli } = {}) {
  const [head, ...rest] = argv;
  if (/^node(\.exe)?$/i.test(head)) return [execPath, rest];
  if (/^npm$/i.test(head)) return [execPath, [npmCli(), ...rest]];
  if (/^npx$/i.test(head)) return [execPath, [path.join(path.dirname(npmCli()), 'npx-cli.js'), ...rest]];
  return [head, rest];
}

/** Folder names to watch: the worktree list when git answers, else just the main checkout's usual name. */
async function watchTargets(waitFor, root, readTrees) {
  const self = baseOf(root);
  try {
    return targetsFor(waitFor, await readTrees(root), self);
  } catch {
    return targetsFor(waitFor, { main: '', worktrees: [] }, self);
  }
}

/**
 * Waits for quiet, then takes the lock. Returns the exit code of the whole call (0 free or command done, 75 busy).
 * @param {string[]} argv
 * @param {object} [deps] out, err, root, tmpdir, readProcs, readTrees, isAlive, sleep, now, spawnArgv, pid
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const d = {
    out: (l) => console.error(l),
    err: (l) => console.error(l),
    root: REPO_ROOT,
    tmpdir: os.tmpdir(),
    readProcs: readProcesses,
    readTrees: readWorktrees,
    isAlive: makeIsAlive(readCreated),
    sleep: sleepMs,
    now: () => Date.now(),
    pid: process.pid,
    spawnArgv: (argv, cwd) => {
      const [file, args] = resolveCommand(argv);
      return spawn(file, args, { shell: false, stdio: 'inherit', cwd, env: { VITEST_MAX_WORKERS: '4', ...process.env } });
    },
    ...deps,
  };
  const parsed = parseFlags(argv, { owner: 'string', 'max-wait': 'string', poll: 'string', 'wait-for': 'string', lock: 'string', cwd: 'string', 'dry-run': 'bool' });
  if ('error' in parsed) {
    d.err(`${parsed.error}\n${USAGE}`);
    return 2;
  }
  const o = parsed.opts;
  const maxWait = o['max-wait'] === null ? DEFAULT_MAX_WAIT_S : wholeNumber(o['max-wait']);
  const poll = o.poll === null ? DEFAULT_POLL_S : wholeNumber(o.poll);
  if (maxWait === null || poll === null || poll < 1) {
    d.err(`--max-wait and --poll need whole seconds (--poll at least 1)\n${USAGE}`);
    return 2;
  }
  const owner = o.owner ?? 'unknown';
  const waitFor = o['wait-for'] ?? 'any';
  const lockFile = o.lock ?? defaultLockFile(d.tmpdir);
  const cmdArgv = parsed.rest.length === 1 ? parsed.rest[0].split(/\s+/).filter(Boolean) : parsed.rest;
  const cmd = cmdArgv.join(' ');
  const cwd = o.cwd ?? d.root;
  const self = baseOf(d.root);
  const targets = await watchTargets(waitFor, d.root, d.readTrees);
  const look = async () => blockersNow({ procs: await d.readProcs(), self, targets, lockFile, isAlive: d.isAlive, pid: d.pid });

  if (o['dry-run']) {
    const b = await look();
    d.out(`wait dry run: lock ${lockFile}`);
    d.out(b.holder ? `holder: pid ${b.holder.pid} (${b.holder.owner}: ${b.holder.cmd})` : readLock(lockFile) ? 'holder: none alive (a stale lock would be taken over)' : 'holder: none');
    d.out(`watching ${targets.length === 0 ? 'no other worktree' : targets.join(', ')}; heavy tools there: ${b.foreign.length === 0 ? 'none' : `pid ${b.foreign.join(', ')}`}`);
    d.out(b.pids.length === 0 ? 'would not wait' : `would wait on pid ${b.pids.join(', ')} (poll ${poll} s, up to ${maxWait} s, then exit ${EXIT_BUSY})`);
    d.out(cmd ? `would then run: ${cmd}` : 'no command: would only wait, then exit 0');
    return 0;
  }

  const t0 = d.now();
  for (;;) {
    const quiet = await waitForQuiet({ read: async () => (await look()).pids, sleep: d.sleep, now: d.now, pollMs: poll * 1000, maxMs: Math.max(0, maxWait * 1000 - (d.now() - t0)) });
    if (!quiet.quiet) {
      d.err(`[wait] busy: pid ${quiet.pids.join(', ')}; exit ${EXIT_BUSY}, call again`);
      return EXIT_BUSY;
    }
    if (cmd === '') {
      d.out(`[wait] quiet after ${Math.round((d.now() - t0) / 1000)} s`);
      return 0;
    }
    const got = tryAcquire(lockFile, { pid: d.pid, created: readCreated(d.pid), owner, cmd, at: new Date(d.now()).toISOString() }, d.isAlive);
    if (got.ok) break;
    if (d.now() - t0 > maxWait * 1000) {
      d.err(`[wait] busy: ${got.holder.owner} ${got.holder.cmd}; exit ${EXIT_BUSY}, call again`);
      return EXIT_BUSY;
    }
    await d.sleep(poll * 1000);
  }
  d.out(`[wait] ${owner} holds the lock after ${Math.round((d.now() - t0) / 1000)} s: ${cmd}`);
  return new Promise((resolve) => {
    const child = d.spawnArgv(cmdArgv, cwd);
    let done = false;
    const finish = (code) => {
      if (done) return;
      done = true;
      release(lockFile, d.pid);
      resolve(code);
    };
    child.on('error', () => finish(1));
    child.on('exit', (code) => finish(code ?? 1));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`wait: ${e.message}`);
      process.exit(1);
    },
  );
}
