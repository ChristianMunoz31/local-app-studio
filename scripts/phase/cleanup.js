// Phase cleanup: ends the processes a finished phase left behind, removes its worktree, sandbox and temp folders and frees
// its port block. DESIGN-phase24 section 3. The default is a dry run that prints the plan and changes nothing.
//
//   node scripts/phase/cleanup.js --phase <N> [--worktree <path>] [--dry-run | --force] [--keep-worktree]
//     [--ports <from>-<to>] [--sandbox <name>]... [--since <ISO>] [--owner-pid <pid>]... [--workspace <dir>]
//
// Safety: no shell string is built from a path or an argument, a process is ended by pid (after a re-read that proves the pid
// still is the process the plan saw) and never by name, `git worktree remove` never gets --force, and a folder is deleted only
// after it is validated. The owner's processes and the owner's ports are never touched (cleanupPlan.js, refusal).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertUnderTmp } from '../lib/sandboxSafety.js';
import {
  OWNER_PIDS,
  OWNER_PORTS,
  SANDBOX_NAME_RE,
  TEMP_NAME_RE,
  ancestorsOf,
  buildPlan,
  describeAction,
  descendantsOf,
  folderDeleteAllowed,
  freePortBlock,
  isInside,
  matchProcesses,
  parsePortRange,
  pathMentioned,
  portsFromPhases,
  renderTable,
  sandboxNameMatches,
  tempCandidates,
} from './lib/cleanupPlan.js';
import { GIT_NOT_FOUND, gitExe, readPortHolders, readProcess, readProcessTable, readWorktrees, runFile, stopTree } from './lib/processTable.js';
import { renameRetry } from './lib/gateRun.js';
import { removeDir } from './lib/removeDir.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const USAGE = `Usage: node scripts/phase/cleanup.js --phase <N> [--worktree <path>] [--dry-run | --force] [--keep-worktree]
         [--ports <from>-<to>] [--sandbox <name>]... [--since <ISO>] [--owner-pid <pid>]... [--workspace <dir>]
  Default is a dry run. --force ends the listed processes and removes the folders. Windows only.`;

/**
 * @param {string[]} argv
 * @returns {{ error: string } | { phase: number, worktree: string | null, force: boolean, keepWorktree: boolean, ports: [number, number] | null, sandboxes: string[], since: number | null, ownerPids: number[], workspace: string | null }}
 */
export function parseArgs(argv) {
  const o = { phase: null, worktree: null, dryRun: false, force: false, keepWorktree: false, ports: null, sandboxes: [], since: null, ownerPids: [], workspace: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) return null;
      i += 1;
      return v;
    };
    if (a === '--dry-run') o.dryRun = true;
    else if (a === '--force') o.force = true;
    else if (a === '--keep-worktree') o.keepWorktree = true;
    else if (a === '--phase') {
      const v = value();
      if (v === null || !/^\d{1,3}$/.test(v)) return { error: '--phase needs a number' };
      o.phase = Number(v);
    } else if (a === '--worktree') {
      const v = value();
      if (v === null) return { error: '--worktree needs a path' };
      o.worktree = v;
    } else if (a === '--ports') {
      const v = value();
      const r = v === null ? null : parsePortRange(v);
      if (r === null) return { error: '--ports needs <from>-<to> between 1024 and 65535 (at most 1000 ports)' };
      o.ports = r;
    } else if (a === '--sandbox') {
      const v = value();
      if (v === null || !SANDBOX_NAME_RE.test(v)) return { error: '--sandbox needs a name of letters, digits, dot, underscore and dash (at most 40)' };
      o.sandboxes.push(v);
    } else if (a === '--since') {
      const v = value();
      const t = v === null ? Number.NaN : Date.parse(v);
      if (!Number.isFinite(t)) return { error: '--since needs an ISO date' };
      o.since = t;
    } else if (a === '--owner-pid') {
      const v = value();
      if (v === null || !/^\d{1,10}$/.test(v)) return { error: '--owner-pid needs a pid' };
      o.ownerPids.push(Number(v));
    } else if (a === '--workspace') {
      const v = value();
      if (v === null) return { error: '--workspace needs a folder' };
      o.workspace = v;
    } else return { error: `unknown argument ${a}` };
  }
  if (o.phase === null) return { error: '--phase <N> is required' };
  if (o.dryRun && o.force) return { error: '--dry-run and --force cannot be combined' };
  return { ...o, force: o.force };
}

/** True when the folder name of `p` is las-wt-phase<N>, with or without zero padding of N. */
export function worktreeMatchesPhase(p, phase) {
  const m = /^las-wt-phase0*(\d+)$/i.exec(path.basename(path.resolve(p)));
  return m !== null && Number(m[1]) === Number(phase);
}

const sameDir = (a, b) => isInside(a, b) && isInside(b, a);
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

function statOrNull(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

// The time the phase began: the worktree folder, else the git admin folder its .git file points at.
function creationTime(target) {
  const st = statOrNull(target);
  if (st) return st.birthtimeMs;
  return null;
}

function adminFolderTime(target) {
  try {
    const text = fs.readFileSync(path.join(target, '.git'), 'utf8');
    const m = /^gitdir:\s*(.+)$/m.exec(text);
    const st = m ? statOrNull(m[1].trim()) : null;
    return st ? st.birthtimeMs : null;
  } catch {
    return null;
  }
}

/**
 * Runs the cleanup. Returns the exit code (0 dry run or done, 1 a step could not finish, 2 usage).
 * @param {string[]} argv
 * @param {object} [deps] injectable for tests: out, err, platform, repoRoot, tmpdir, homedir, selfPid, cwd, now, readTable, readProcess,
 *   readPortHolders, readWorktrees, runFile, stop, sleep
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const d = {
    out: (l) => console.log(l),
    err: (l) => console.error(l),
    platform: process.platform,
    repoRoot: REPO_ROOT,
    tmpdir: os.tmpdir(),
    homedir: os.homedir(),
    selfPid: process.pid,
    cwd: process.cwd(),
    now: () => Date.now(),
    readTable: () => readProcessTable(),
    readProcess: (pid) => readProcess(pid),
    readPortHolders: (ports) => readPortHolders(ports),
    readWorktrees: (root) => readWorktrees(root),
    runFile,
    stop: stopTree,
    sleep: sleepMs,
    ...deps,
  };
  const opts = parseArgs(argv);
  if ('error' in opts) {
    d.err(`${opts.error}\n${USAGE}`);
    return 2;
  }
  const force = opts.force;
  const dryRun = !force;
  if (d.platform !== 'win32') {
    d.out('the process scan needs Windows; nothing was stopped or removed');
    return 0;
  }

  // 1. Scan.
  let listing;
  try {
    listing = await d.readWorktrees(d.repoRoot);
  } catch (e) {
    d.err(`could not list worktrees: ${e.message}`);
    return 2;
  }
  const mainPath = path.resolve(listing.main);
  const worktrees = listing.worktrees.map((w) => path.resolve(w.path));
  let target = null;
  if (opts.worktree !== null && !worktreeMatchesPhase(opts.worktree, opts.phase)) {
    d.err(`--worktree ${opts.worktree} is not the worktree of phase ${opts.phase} (its folder name must be las-wt-phase${opts.phase})`);
    return 2;
  }
  if (opts.worktree !== null) target = worktrees.find((w) => sameDir(w, path.resolve(opts.worktree))) ?? null;
  else target = worktrees.find((w) => path.basename(w).toLowerCase() === `las-wt-phase${opts.phase}`) ?? null;
  if (target === null) {
    d.err(`no listed worktree for phase ${opts.phase}${opts.worktree !== null ? ` at ${opts.worktree}` : ''} (the main checkout is never a target)`);
    return 2;
  }
  const others = worktrees.filter((w) => !sameDir(w, target));
  const notes = [];

  const sandboxRoot = path.join(d.tmpdir, 'local-app-studio-sandbox');
  const sandboxNames = new Set(opts.sandboxes);
  try {
    for (const e of fs.readdirSync(sandboxRoot, { withFileTypes: true })) {
      if (e.isDirectory() && SANDBOX_NAME_RE.test(e.name) && sandboxNameMatches(e.name, opts.phase)) sandboxNames.add(e.name);
    }
  } catch {
    // No sandbox folder yet.
  }
  const sandboxDirs = [...sandboxNames].map((name) => ({ name, path: path.join(sandboxRoot, name) })).filter((s) => statOrNull(s.path)?.isDirectory());

  const workspace = opts.workspace !== null ? path.resolve(opts.workspace) : path.join(d.homedir, 'local-app-studio-workspace');
  const phasesPath = path.join(workspace, 'phases.json');
  const phasesFile = statOrNull(phasesPath)?.isFile() ? phasesPath : null;
  let phasesJson = null;
  if (phasesFile !== null) {
    try {
      phasesJson = JSON.parse(fs.readFileSync(phasesFile, 'utf8'));
    } catch {
      notes.push('phases.json is not valid JSON; the port block is left as it is');
    }
  }

  const range = opts.ports ?? portsFromPhases(phasesJson, opts.phase);
  const phasePorts = [];
  if (range !== null) for (let p = range[0]; p <= range[1]; p += 1) phasePorts.push(p);
  else notes.push('no port range (pass --ports <from>-<to> or list the phase in phases.json): the port scan is skipped');
  const ports = await d.readPortHolders([...new Set([...phasePorts, ...OWNER_PORTS])]);
  if (!ports.known) notes.push('the port listing could not be read: port holders are unknown');
  const portHolders = ports.holders.filter((h) => phasePorts.includes(h.port));
  const ownerPortHolders = ports.holders.filter((h) => OWNER_PORTS.includes(h.port));

  let table;
  try {
    table = await d.readTable();
  } catch (e) {
    d.err(`could not read the process table: ${e.message}`);
    return 1;
  }
  if (force && !ports.known) {
    d.err('refusing --force: the port holders (the owner ports) could not be read');
    return 1;
  }

  const since = opts.since ?? creationTime(target) ?? adminFolderTime(target);
  if (since === null) notes.push('creation time unknown: pass --since <ISO>; temp folders are skipped');
  const now = d.now();
  const inUse = (dir) => table.some((p) => isInside(dir, p.cwd) || pathMentioned(p.cmd, dir));
  let tempEntries = [];
  try {
    tempEntries = fs
      .readdirSync(d.tmpdir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && TEMP_NAME_RE.test(e.name))
      .flatMap((e) => {
        const p = path.join(d.tmpdir, e.name);
        const st = statOrNull(p);
        return st ? [{ name: e.name, path: p, isDirectory: true, birthtimeMs: st.birthtimeMs, mtimeMs: st.mtimeMs }] : [];
      });
  } catch {
    // The temp folder cannot be listed: no temp candidates.
  }
  const temp = tempCandidates(tempEntries, { since, now, inUse });

  const ctx = { table, selfPid: d.selfPid, ownerPids: [...OWNER_PIDS, ...opts.ownerPids], ownerPortHolders, main: mainPath, others };
  const matchFacts = { worktree: target, sandboxDirs, portHolders };
  const plan = buildPlan({
    matches: matchProcesses(table, matchFacts),
    ctx,
    force,
    keepWorktree: opts.keepWorktree,
    target,
    sandboxDirs,
    temp,
    phase: opts.phase,
    phasesFile,
  });

  // 2. Print.
  d.out(`phase ${opts.phase} cleanup (${dryRun ? 'dry run' : 'force'}): worktree ${target}`);
  for (const n of notes) d.out(`note: ${n}`);
  const procRows = plan.filter((a) => a.kind === 'process');
  d.out(renderTable(procRows));
  if (procRows.length === 0) d.out('no matching processes');
  const steps = plan.filter((a) => a.kind !== 'process');
  for (const a of steps) d.out(describeAction(a, dryRun));
  if (dryRun) return 0;

  // 4. Stop.
  const failed = [];
  for (const row of procRows.filter((r) => r.stop)) {
    const { proc } = row;
    let again;
    try {
      again = await d.readProcess(proc.pid);
    } catch (e) {
      d.out(`pid ${proc.pid}: skipped: ${e.message}`);
      failed.push(`stop ${proc.pid}`);
      continue;
    }
    if (again.length === 0) {
      d.out(`pid ${proc.pid}: already gone`);
      continue;
    }
    if (again[0].cmd !== proc.cmd || again[0].created !== proc.created) {
      d.out(`pid ${proc.pid}: skipped: pid reused`);
      continue;
    }
    const r = d.stop(proc.pid);
    d.out(r.ok ? `pid ${proc.pid}: stopped (tree)` : `pid ${proc.pid}: stop failed: ${r.detail}`);
    if (!r.ok) failed.push(`stop ${proc.pid}`);
  }
  await d.sleep(2000);
  // A holder is any process that still names the worktree (cwd or command line) or a sandbox folder. A failed rescan is not
  // "nothing holds it": the folders are then left alone.
  let holders = [];
  let sandboxHolders = [];
  let rescanned = true;
  try {
    const after = await d.readTable();
    // L24-14: this process (its own command line names the worktree), the shell above it and what it started are not holders.
    const own = new Set([d.selfPid, ...ancestorsOf(after, d.selfPid), ...descendantsOf(after, d.selfPid).map((c) => c.pid)]);
    const still = matchProcesses(after, matchFacts).filter((m) => !own.has(m.proc.pid));
    holders = still.filter((m) => m.why.some((w) => w === 'cwd in worktree' || w === 'names worktree'));
    sandboxHolders = still.filter((m) => m.why.some((w) => w.startsWith('names sandbox ')));
  } catch (e) {
    d.out(`could not scan again: ${e.message}`);
    failed.push('second scan');
    rescanned = false;
  }

  // 5 and 6. Worktree.
  if (!opts.keepWorktree) {
    let removable = true;
    if (!rescanned) {
      d.out('worktree not removed: the second scan failed, so what still holds it is unknown');
      removable = false;
    } else if (isInside(target, d.cwd) || isInside(target, d.repoRoot)) {
      d.out(`worktree not removed: cd out of the worktree first (this process runs inside ${target})`);
      removable = false;
    } else if (holders.length > 0) {
      d.out(`worktree not removed: still held by pid ${holders.map((h) => h.proc.pid).join(', ')}`);
      removable = false;
    }
    const git = removable ? gitExe() : null;
    if (removable && git === null) {
      d.out(`worktree not removed: ${GIT_NOT_FOUND}`);
      removable = false;
    }
    if (removable) {
      const rm = await d.runFile(git, ['worktree', 'remove', target], { cwd: d.repoRoot, timeout: 120000 });
      if (rm.code !== 0) {
        d.out(`git worktree remove refused: ${String(rm.stderr).trim().split(/\r?\n/)[0]}`);
        d.out('uncommitted or locked work stops it: commit or discard it, then run again');
        removable = false;
      } else d.out(`removed worktree ${target}`);
      const pr = await d.runFile(git, ['worktree', 'prune'], { cwd: d.repoRoot, timeout: 60000 });
      if (pr.code !== 0) failed.push('prune');
    }
    if (!removable) failed.push('worktree removal');
    else {
      const stillListed = await d.readWorktrees(d.repoRoot).then(
        (l) => l.worktrees.some((w) => sameDir(path.resolve(w.path), target)),
        () => true,
      );
      if (!stillListed && statOrNull(target) !== null) {
        if (!folderDeleteAllowed(target, { main: mainPath, others })) {
          d.out(`leftover folder not deleted: ${target} is, holds or lies inside the main checkout or another worktree`);
          failed.push('leftover folder');
        } else {
          try {
            await removeDir(target);
            d.out(`deleted leftover folder ${target}`);
          } catch (e) {
            d.out(`leftover folder not deleted: ${e.message}`);
            failed.push('leftover folder');
          }
        }
      }
    }
  }

  // 7 and 8. Sandbox and temp folders.
  const folders = [...sandboxDirs.map((s) => s.path), ...temp.map((t) => t.path)];
  for (const dir of folders) {
    try {
      assertUnderTmp(dir);
      if (!rescanned) throw new Error('the second scan failed, so what still holds it is unknown');
      const held = sandboxHolders.filter((h) => pathMentioned(h.proc.cmd, dir) || isInside(dir, h.proc.cwd));
      if (held.length > 0) throw new Error(`still held by pid ${held.map((h) => h.proc.pid).join(', ')}`);
      if (!folderDeleteAllowed(dir, { main: mainPath, others })) throw new Error('it holds or lies inside a checkout');
      await removeDir(dir);
      d.out(`deleted ${dir}`);
    } catch (e) {
      d.out(`not deleted ${dir}: ${e.message}`);
      failed.push(`delete ${dir}`);
    }
  }

  // 9. Port block.
  if (phasesFile === null) d.out('phases.json not found, skipped');
  else if (phasesJson === null) failed.push('phases.json');
  else {
    const r = freePortBlock(phasesJson, opts.phase, new Date(now));
    if (r.changed) {
      try {
        const tmp = `${phasesFile}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, `${JSON.stringify(r.json, null, 2)}\n`);
        renameRetry(tmp, phasesFile);
        d.out(r.note);
      } catch (e) {
        d.out(`phases.json not written: ${e.message}`);
        failed.push('phases.json');
      }
    } else d.out(r.note);
  }

  if (failed.length > 0) {
    d.out(`not finished: ${failed.join(', ')}`);
    return 1;
  }
  d.out('cleanup done');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(`phase cleanup failed: ${e?.message ?? e}`);
      process.exitCode = 1;
    },
  );
}
