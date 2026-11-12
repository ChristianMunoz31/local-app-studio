// The owner's preview on 4321: stop the old server by PID after a command-line check, rebuild dist, start it again with the proof
// data folder. It never runs by itself: the owner's rule is "restart only when the owner asks".
//
//   node scripts/phase/preview.js [--status | --stop | --restart] [--port <port>] [--data <dir>] [--dir <main checkout>]
//     [--no-build] [--create-data] [--workspace <dir>] [--dry-run]
//
// --status (default) prints who holds the port (every pid, IPv4 and IPv6) and whether each command line is this repo's server.js. --stop ends
// each holder's process tree by pid, only when every holder's command line is node running a server.js that resolves inside the main checkout (anything else on the port is refused,
// by pid, never by name). --restart does --stop, then `npm run build` and `npm run check:bundle` in the main checkout (the clean
// checkout on main test of devRefresh.js; no pull, there is no origin), then starts
// `node --import ./scripts/lib/proHook.js server.js` detached with APP_DATA_DIR, APP_PORT and APP_NO_DOTENV=1 and waits for the
// port. The data folder defaults to proof-data in the workspace folder and must exist (--create-data makes it): the real data
// folder is never a default. --dry-run prints the plan and the checks and changes nothing.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkoutProblems, realRunner } from '../devRefresh.js';
import { OWNER_PORTS, isInside } from './lib/cleanupPlan.js';
import { readPortHolders, readProcess, readWorktrees, stopTree } from './lib/processTable.js';
import { sleepMs } from './lib/waitFor.js';
import { REPO_ROOT, parseFlags, wholeNumber, workspaceDir } from './common.js';

const USAGE = `Usage: node scripts/phase/preview.js [--status | --stop | --restart] [--port <port>] [--data <dir>] [--dir <main checkout>]
         [--no-build] [--create-data] [--workspace <dir>] [--dry-run]`;
export const OWNER_PREVIEW_PORT = OWNER_PORTS[0];

/**
 * Is this process the preview server of the checkout? node, server.js, and the checkout named by its command line or directory.
 * @param {{ name: string, cmd: string, cwd: string | null } | null} proc
 * @param {string} checkout
 */
export function isPreviewServer(proc, checkout) {
  if (proc === null) return { ok: false, why: 'no process read for the pid' };
  if (!/^node(\.exe)?$/i.test(String(proc.name))) return { ok: false, why: `not node (${proc.name})` };
  if (!/(?:^|[\\/\s"'])server\.js(?:["'\s]|$)/i.test(String(proc.cmd))) return { ok: false, why: 'its command line does not run server.js' };
  // The server.js argument itself must resolve inside the checkout (a relative one against the process directory), not just a path
  // somewhere else on the command line.
  const target = serverScriptOf(proc.cmd, proc.cwd);
  if (target === null || !isInside(checkout, target)) return { ok: false, why: 'it does not run in the main checkout' };
  return { ok: true, why: 'node server.js of the main checkout' };
}

/** The words of a command line; double and single quotes group a word. */
const words = (cmd) => [...String(cmd).matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);

/** The absolute path of the server.js argument of a command line, or null (relative with no known directory, or no such word). */
function serverScriptOf(cmd, cwd) {
  const word = words(cmd).find((w) => /(?:^|[\\/])server\.js$/i.test(w));
  if (word === undefined) return null;
  if (path.isAbsolute(word) || /^[A-Za-z]:[\\/]/.test(word)) return path.resolve(word);
  return cwd ? path.resolve(cwd, word) : null;
}

/**
 * The plan for a restart. Pure.
 * `others` are further holders of the port (the IPv6 listener has its own pid), each with its own command-line check.
 * @param {{ port: number, holder: { pid: number } | null, holderCheck: { ok: boolean, why: string } | null, others?: { pid: number, check: { ok: boolean, why: string } }[],
 *   checkout: string, data: string, dataExists: boolean, createData: boolean, noBuild: boolean, checkoutProblems: string[] }} i
 * @returns {{ problems: string[], steps: string[] }}
 */
export function planRestart(i) {
  const problems = [];
  const steps = [];
  if (i.port !== OWNER_PREVIEW_PORT && OWNER_PORTS.includes(i.port)) problems.push(`port ${i.port} is an owner port other than the preview`);
  if (i.holder !== null && i.holderCheck !== null && !i.holderCheck.ok) problems.push(`pid ${i.holder.pid} holds port ${i.port} and is not the preview server (${i.holderCheck.why}); it is left alone`);
  for (const o of i.others ?? []) if (!o.check.ok) problems.push(`pid ${o.pid} holds port ${i.port} and is not the preview server (${o.check.why}); it is left alone`);
  if (!i.dataExists && !i.createData) problems.push(`the data folder ${i.data} does not exist (--create-data makes it)`);
  if (!i.noBuild) problems.push(...i.checkoutProblems);
  if (i.holder !== null) steps.push(`stop pid ${i.holder.pid} and its tree (${i.holderCheck?.why ?? 'unchecked'})`);
  else steps.push(`nothing holds port ${i.port}: no process to stop`);
  for (const o of i.others ?? []) steps.push(`stop pid ${o.pid} and its tree (${o.check.why})`);
  if (i.noBuild) steps.push('skip the build (--no-build)');
  else steps.push(`npm run build in ${i.checkout}`, `npm run check:bundle in ${i.checkout}`);
  steps.push(`start node --import ./scripts/lib/proHook.js server.js in ${i.checkout} detached with APP_DATA_DIR=${i.data} APP_PORT=${i.port} APP_NO_DOTENV=1`);
  steps.push(`wait for 127.0.0.1:${i.port}, then print http://127.0.0.1:${i.port}/`);
  return { problems, steps };
}

const portOpen = (port) =>
  new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port });
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('error', () => resolve(false));
    s.setTimeout(1000, () => {
      s.destroy();
      resolve(false);
    });
  });

/** Launches the server detached, hidden, its output in a log file; returns the pid. */
function launchDetached(checkout, env, logFile) {
  const fd = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, ['--import', './scripts/lib/proHook.js', 'server.js'], { cwd: checkout, env, detached: true, stdio: ['ignore', fd, fd], windowsHide: true });
  child.unref();
  fs.closeSync(fd);
  return child.pid;
}

/**
 * @param {string[]} argv
 * @param {object} [deps] out, err, root, homedir, readTrees, readHolders, readProc, stop, runner, portOpen, launch, sleep, tmpdir, git
 * @returns {Promise<number>} 0 done or dry run, 1 refused or failed, 2 usage
 */
export async function main(argv, deps = {}) {
  const d = {
    out: (l) => console.log(l),
    err: (l) => console.error(l),
    root: REPO_ROOT,
    homedir: undefined,
    tmpdir: os.tmpdir(),
    readTrees: readWorktrees,
    readHolders: readPortHolders,
    readProc: readProcess,
    stop: stopTree,
    runner: realRunner,
    portOpen,
    launch: launchDetached,
    sleep: sleepMs,
    ...deps,
  };
  const parsed = parseFlags(argv, { status: 'bool', stop: 'bool', restart: 'bool', port: 'string', data: 'string', dir: 'string', 'no-build': 'bool', 'create-data': 'bool', workspace: 'string', 'dry-run': 'bool' });
  if ('error' in parsed) {
    d.err(`${parsed.error}\n${USAGE}`);
    return 2;
  }
  const o = parsed.opts;
  if ([o.status, o.stop, o.restart].filter(Boolean).length > 1) {
    d.err(`pick one of --status, --stop, --restart\n${USAGE}`);
    return 2;
  }
  const mode = o.stop ? 'stop' : o.restart ? 'restart' : 'status';
  const port = o.port === null ? OWNER_PREVIEW_PORT : wholeNumber(o.port);
  if (port === null || port < 1024 || port > 65535) {
    d.err(`--port needs a port from 1024 to 65535\n${USAGE}`);
    return 2;
  }
  const listing = await d.readTrees(d.root).catch(() => ({ main: d.root, worktrees: [] }));
  const checkout = path.resolve(o.dir ?? listing.main ?? d.root);
  const workspace = o.workspace ?? workspaceDir(d.homedir);
  const data = path.resolve(o.data ?? path.join(workspace, 'proof-data'));

  // Every holder of the port (IPv4 and IPv6 listeners can be different pids), each read and checked on its own.
  const held = await d.readHolders([port]);
  const seen = [];
  for (const h of held.holders) {
    if (seen.some((x) => x.holder.pid === h.pid)) continue;
    const rows = await d.readProc(h.pid).catch(() => []);
    const proc = rows[0] ?? null;
    seen.push({ holder: h, proc, check: isPreviewServer(proc, checkout) });
  }
  const holder = seen[0]?.holder ?? null;
  const holderCheck = seen[0]?.check ?? null;
  const others = seen.slice(1).map((x) => ({ pid: x.holder.pid, check: x.check }));
  if (!held.known) d.out(`port ${port}: listing unreadable`);
  else if (seen.length === 0) d.out(`port ${port}: free`);
  for (const x of seen) {
    d.out(`port ${port}: pid ${x.holder.pid}${x.proc ? ` ${x.proc.name}: ${String(x.proc.cmd).slice(0, 160)}` : ''}`);
    d.out(`holder check: ${x.check.ok ? 'ok' : 'refused'} (${x.check.why})`);
  }
  if (!held.known && mode !== 'status') {
    d.err('refused: the port holders could not be read, so nothing is stopped');
    return 1;
  }
  if (mode === 'status') return 0;

  const gitState = async () => {
    const run = (...a) => d.runner('git', a, { cwd: checkout });
    const top = run('rev-parse', '--show-toplevel');
    const isGit = top.status === 0;
    const branch = isGit ? String(run('branch', '--show-current').stdout).trim() : '';
    const dirty = isGit ? String(run('--no-optional-locks', 'status', '--porcelain').stdout).split(/\r?\n/).filter(Boolean) : [];
    const same = isGit && path.resolve(String(top.stdout).trim()).toLowerCase() === checkout.toLowerCase();
    return checkoutProblems({ isGit, topLevelMatches: same, branch, dirty });
  };
  const plan = planRestart({
    port,
    holder,
    holderCheck,
    others,
    checkout,
    data,
    dataExists: fs.existsSync(data),
    createData: o['create-data'],
    noBuild: o['no-build'] || mode === 'stop',
    checkoutProblems: o['no-build'] || mode === 'stop' ? [] : await gitState(),
  });
  const steps = mode === 'stop' ? plan.steps.slice(0, 1) : plan.steps;
  const problems = mode === 'stop' ? plan.problems.filter((p) => /not the preview server|owner port/.test(p)) : plan.problems;
  d.out(`${o['dry-run'] ? 'dry run: ' : ''}${mode} plan:`);
  steps.forEach((s, i) => d.out(`  ${i + 1}. ${s}`));
  if (problems.length > 0) {
    for (const p of problems) d.err(`${o['dry-run'] ? 'a real run would refuse' : 'refused'}: ${p}`);
    return 1;
  }
  if (o['dry-run']) {
    d.out('checks passed: a real run would proceed');
    return 0;
  }

  // Re-read every holder first: one that changed since the check stops nothing at all.
  const targets = [];
  for (const x of seen) {
    const again = await d.readProc(x.holder.pid).catch(() => []);
    if (again.length > 0 && (again[0].cmd !== x.proc.cmd || again[0].created !== x.proc.created)) {
      d.err(`refused: pid ${x.holder.pid} changed since it was read (pid reused)`);
      return 1;
    }
    targets.push({ pid: x.holder.pid, gone: again.length === 0 });
  }
  for (const t of targets) {
    const r = t.gone ? { ok: true, detail: 'already gone' } : d.stop(t.pid);
    d.out(r.ok ? `pid ${t.pid}: stopped` : `pid ${t.pid}: stop failed: ${r.detail}`);
    if (!r.ok) return 1;
  }
  if (targets.length > 0) await d.sleep(1500);
  if (mode === 'stop') return 0;

  if (!o['no-build']) {
    for (const args of [['run', 'build'], ['run', 'check:bundle']]) {
      d.out(`npm ${args.join(' ')}`);
      const r = d.runner('npm', args, { cwd: checkout, inherit: true });
      if (r.status !== 0) {
        d.err(`npm ${args.join(' ')} failed (exit ${r.status ?? 'signal'}); the preview was stopped and not restarted`);
        return 1;
      }
    }
  }
  if (!fs.existsSync(data)) fs.mkdirSync(data, { recursive: true });
  const logFile = path.join(d.tmpdir, `las-preview-${port}.log`);
  const pid = d.launch(checkout, { ...process.env, APP_DATA_DIR: data, APP_PORT: String(port), APP_NO_DOTENV: '1' }, logFile);
  d.out(`started pid ${pid}, log ${logFile}`);
  for (let i = 0; i < 60; i += 1) {
    if (await d.portOpen(port)) {
      d.out(`preview ready: http://127.0.0.1:${port}/ (data ${data})`);
      return 0;
    }
    await d.sleep(1000);
  }
  d.err(`the server did not open port ${port} within 60 s; see ${logFile}`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`preview: ${e.message}`);
      process.exit(1);
    },
  );
}
