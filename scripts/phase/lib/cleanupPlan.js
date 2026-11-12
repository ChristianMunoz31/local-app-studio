// Pure planning for scripts/phase/cleanup.js (DESIGN-phase24 section 3.3): which processes a phase owns, which of them
// may never be stopped, which temp folders are leftovers, and how the plan reads. Nothing here touches the machine.
import path from 'node:path';

export const OWNER_PIDS = Object.freeze([36948, 35016, 34988, 34964]);
export const OWNER_PORTS = Object.freeze([4321, 4791, 5174, 11434]);
export const SANDBOX_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
export const TEMP_NAME_RE = /^tmp\.[A-Za-z0-9]+$/;
export const TEMP_IDLE_MS = 30 * 60 * 1000;
const DEV_TOOLS = new Set(['node', 'bash', 'sh', 'cmd', 'powershell', 'pwsh', 'git', 'esbuild', 'cargo', 'rustc', 'link']);
// cargo's tree: the MSVC linker and the build scripts of crates (build-script-build, build-script-main).
const BUILD_SCRIPT_RE = /^build-script-/;
const PLAYWRIGHT_BROWSERS = new Set(['chrome', 'chromium', 'headless_shell']);
// Helpers a dev tool may own without being a stop reason: the console host and the WebView2 runtime.
const CHILD_HELPERS = new Set(['conhost', 'msedgewebview2']);
const MAX_PORT_SPAN = 1000;

/** Lowercase, backslashes, no trailing separator. */
const norm = (p) => String(p ?? '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
const baseName = (p) => norm(p).split('\\').pop();
const stripExe = (name) => String(name ?? '').toLowerCase().replace(/\.exe$/, '');

/**
 * True when `text` names the folder `dir`: case-insensitive, `\` and `/` equal, `dir` followed by a separator, a quote,
 * a space or the end, and not glued to a longer name on the left.
 * @param {string} text
 * @param {string} dir
 * @returns {boolean}
 */
export function pathMentioned(text, dir) {
  const d = norm(dir);
  if (d === '') return false;
  const t = String(text ?? '').replace(/\//g, '\\').toLowerCase();
  let from = 0;
  for (;;) {
    const i = t.indexOf(d, from);
    if (i < 0) return false;
    const before = i === 0 ? '' : t[i - 1];
    const after = t[i + d.length] ?? '';
    if (!/[a-z0-9_.-]/.test(before) && (after === '' || /[\\"'\s]/.test(after))) return true;
    from = i + 1;
  }
}

/**
 * True when `p` is `dir` or a child of it (same normalization as pathMentioned).
 * @param {string} dir
 * @param {string | null | undefined} p
 * @returns {boolean}
 */
export function isInside(dir, p) {
  const d = norm(dir);
  const x = norm(p);
  if (d === '' || x === '') return false;
  return x === d || x.startsWith(`${d}\\`);
}

/**
 * @typedef {{ pid: number, ppid: number, name: string, cwd: string | null, cmd: string, created: string | null }} Proc
 */

/**
 * Processes that belong to the phase and why.
 * @param {Proc[]} table
 * @param {{ worktree: string, sandboxDirs: { name: string, path: string }[], portHolders: { port: number, pid: number }[] }} facts
 * @returns {{ proc: Proc, why: string[] }[]}
 */
export function matchProcesses(table, { worktree, sandboxDirs, portHolders }) {
  const out = [];
  for (const proc of table) {
    const why = [];
    if (isInside(worktree, proc.cwd)) why.push('cwd in worktree');
    if (pathMentioned(proc.cmd, worktree)) why.push('names worktree');
    for (const s of sandboxDirs) {
      if (pathMentioned(proc.cmd, s.path) || isInside(s.path, proc.cwd)) why.push(`names sandbox ${s.name}`);
    }
    if (stripExe(proc.name) === 'node') {
      for (const h of portHolders) if (h.pid === proc.pid) why.push(`holds port ${h.port}`);
    }
    if (why.length > 0) out.push({ proc, why });
  }
  return out;
}

/** Pids of the ancestors of `pid` (parent first), cycle safe. */
export function ancestorsOf(table, pid) {
  const byPid = new Map(table.map((p) => [p.pid, p]));
  const out = [];
  const seen = new Set([pid]);
  let cur = byPid.get(pid);
  while (cur && cur.ppid > 0 && !seen.has(cur.ppid)) {
    out.push(cur.ppid);
    seen.add(cur.ppid);
    cur = byPid.get(cur.ppid);
  }
  return out;
}

// True when a child was created before its parent (both times known): a reused ppid, not a child.
const olderThan = (child, parent) => {
  const c = Date.parse(child?.created ?? '');
  const p = Date.parse(parent?.created ?? '');
  return Number.isFinite(c) && Number.isFinite(p) && c < p;
};

/** The processes below `pid`, cycle safe; a process created before its parent is not a child (the ppid was reused). */
export function descendantsOf(table, pid) {
  const out = [];
  const seen = new Set([pid]);
  const queue = [pid];
  const byPid = new Map(table.map((p) => [p.pid, p]));
  while (queue.length > 0) {
    const parent = queue.shift();
    for (const p of table) {
      if (p.ppid === parent && !seen.has(p.pid) && !olderThan(p, byPid.get(parent))) {
        seen.add(p.pid);
        out.push(p);
        queue.push(p.pid);
      }
    }
  }
  return out;
}

/**
 * @typedef {object} RefusalCtx
 * @property {Proc[]} table the full process table
 * @property {number} selfPid
 * @property {number[]} ownerPids owner pids (the built in four plus --owner-pid)
 * @property {{ port: number, pid: number }[]} ownerPortHolders holders of the owner ports
 * @property {string} main the main checkout
 * @property {string[]} others the worktrees other than the target
 */

const isDevTool = (proc) => {
  const name = stripExe(proc.name);
  return DEV_TOOLS.has(name) || BUILD_SCRIPT_RE.test(name) || (PLAYWRIGHT_BROWSERS.has(name) && /ms-playwright/i.test(proc.cmd));
};

// The rules that say who a process is (everything but the dev tool list and the child rule).
function identityRefusal(proc, ctx) {
  if (proc.pid === ctx.selfPid || descendantsOf(ctx.table, ctx.selfPid).some((c) => c.pid === proc.pid)) return 'this process';
  if (ancestorsOf(ctx.table, ctx.selfPid).includes(proc.pid)) return 'an ancestor of this process';
  if (ctx.ownerPids.includes(proc.pid)) return 'owner pid';
  const held = ctx.ownerPortHolders.find((h) => h.pid === proc.pid);
  if (held) return `holds owner port ${held.port}`;
  if (pathMentioned(proc.cmd, ctx.main) || isInside(ctx.main, proc.cwd)) return 'names the main checkout';
  for (const o of ctx.others) {
    if (pathMentioned(proc.cmd, o) || isInside(o, proc.cwd)) return `names another worktree (${baseName(o)})`;
  }
  return null;
}

/**
 * Why a matched process must not be stopped, or null. Rules in the order of the design (3.3).
 * @param {Proc} proc
 * @param {RefusalCtx} ctx
 * @returns {string | null}
 */
export function refusal(proc, ctx) {
  const id = identityRefusal(proc, ctx);
  if (id !== null) return id;
  if (!isDevTool(proc)) return `not a dev tool (${proc.name})`;
  for (const d of descendantsOf(ctx.table, proc.pid)) {
    if (identityRefusal(d, ctx) !== null) return `a child is protected (pid ${d.pid})`;
    if (!isDevTool(d) && !CHILD_HELPERS.has(stripExe(d.name))) return `a child is not a dev tool (pid ${d.pid}, ${d.name})`;
  }
  return null;
}

/**
 * Leftover `tmp.*` folders of a phase: created after `since`, idle for 30 minutes, used by no process.
 * @param {{ name: string, path: string, isDirectory: boolean, birthtimeMs: number, mtimeMs: number }[]} entries
 * @param {{ since: number | null, now: number, inUse: (dir: string) => boolean }} opts
 * @returns {{ path: string, reason: string }[]}
 */
export function tempCandidates(entries, { since, now, inUse }) {
  if (since === null || !Number.isFinite(since)) return [];
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory || !TEMP_NAME_RE.test(e.name)) continue;
    if (!(e.birthtimeMs > since)) continue;
    if (!(e.mtimeMs < now - TEMP_IDLE_MS)) continue;
    if (inUse(e.path)) continue;
    out.push({ path: e.path, reason: `created ${new Date(e.birthtimeMs).toISOString()}` });
  }
  return out;
}

/** True for the sandbox folder names of phase `phase`: p<N>, p<NN>, phase<N>, alone or followed by - _ or . */
export function sandboxNameMatches(name, phase) {
  const n = String(Number(phase));
  const nn = n.padStart(2, '0');
  return new RegExp(`^(?:p${n}|p${nn}|phase${n})(?:[-_.].*)?$`, 'i').test(name);
}

/**
 * Parses `<from>-<to>` into two ports, or null.
 * @param {string} text
 * @returns {[number, number] | null}
 */
export function parsePortRange(text) {
  const m = /^(\d{1,5})-(\d{1,5})$/.exec(String(text).trim());
  if (!m) return null;
  const from = Number(m[1]);
  const to = Number(m[2]);
  if (from < 1024 || to > 65535 || from > to || to - from >= MAX_PORT_SPAN) return null;
  return [from, to];
}

const entryFor = (json, phase) =>
  json && typeof json === 'object' && Array.isArray(json.phases) ? json.phases.find((e) => e && Number(e.phase) === Number(phase)) : undefined;

/** The port range of the phase's block in phases.json, or null. */
export function portsFromPhases(json, phase) {
  const e = entryFor(json, phase);
  if (!e || !Array.isArray(e.ports) || e.ports.length !== 2) return null;
  return parsePortRange(`${e.ports[0]}-${e.ports[1]}`);
}

/**
 * Marks the phase's port block free.
 * @param {unknown} json parsed phases.json
 * @param {number} phase
 * @param {Date} [now]
 * @returns {{ json: unknown, changed: boolean, note: string }}
 */
export function freePortBlock(json, phase, now = new Date()) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.phases)) return { json, changed: false, note: 'unknown phases.json layout, skipped' };
  const e = entryFor(json, phase);
  if (!e) return { json, changed: false, note: `no block for phase ${phase} in phases.json, skipped` };
  if (e.status === 'free') return { json, changed: false, note: `the block of phase ${phase} is already free` };
  const phases = json.phases.map((x) => (x === e ? { ...x, status: 'free', freedAt: now.toISOString() } : x));
  return { json: { ...json, phases }, changed: true, note: `freed the port block of phase ${phase}` };
}

/**
 * The ordered actions of a run.
 * @param {{
 *   matches: { proc: Proc, why: string[] }[], ctx: RefusalCtx, force: boolean, keepWorktree: boolean, target: string,
 *   sandboxDirs: { name: string, path: string }[], temp: { path: string, reason: string }[], phase: number, phasesFile: string | null
 * }} facts phasesFile is the file when it exists, else null
 * @returns {object[]}
 */
export function buildPlan(facts) {
  const actions = [];
  for (const { proc, why } of facts.matches) {
    const reason = refusal(proc, facts.ctx);
    const action = reason === null ? (facts.force ? 'stop (tree)' : 'would stop (tree)') : `refused: ${reason}`;
    actions.push({ kind: 'process', proc, why, stop: reason === null, action });
  }
  if (!facts.keepWorktree) {
    actions.push({ kind: 'remove-worktree', path: facts.target });
    actions.push({ kind: 'prune' });
  }
  for (const s of facts.sandboxDirs) actions.push({ kind: 'delete-folder', label: 'sandbox', path: s.path, note: '' });
  for (const t of facts.temp) actions.push({ kind: 'delete-folder', label: 'temp', path: t.path, note: ` (${t.reason})` });
  actions.push({ kind: 'phases', file: facts.phasesFile, phase: facts.phase });
  return actions;
}

/**
 * One plain line for a non process action.
 * @param {{ kind: string, path?: string, note?: string, file?: string | null, phase?: number }} a
 * @param {boolean} dryRun
 * @returns {string}
 */
export function describeAction(a, dryRun) {
  const w = dryRun ? 'would' : 'will';
  if (a.kind === 'remove-worktree') return `${w} remove worktree ${a.path}`;
  if (a.kind === 'prune') return `${w} prune worktrees`;
  if (a.kind === 'delete-folder') return `${w} delete ${a.path}${a.note ?? ''}`;
  if (a.kind === 'phases') return a.file === null ? 'phases.json not found, skipped' : `${w} free the port block of phase ${a.phase} in ${a.file}`;
  return '';
}

const cell = (v, max) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return (max && s.length > max ? s.slice(0, max) : s).replace(/\|/g, '\\|');
};

/**
 * The process table in the literal shape of design 3.4.
 * @param {{ proc: Proc, why: string[], action: string }[]} rows process actions
 * @returns {string}
 */
export function renderTable(rows) {
  const lines = ['| pid | name | cwd | command (first 100) | why | action |', '| --- | --- | --- | --- | --- | --- |'];
  for (const r of rows) {
    lines.push(`| ${r.proc.pid} | ${cell(r.proc.name)} | ${cell(r.proc.cwd)} | ${cell(r.proc.cmd, 100)} | ${cell(r.why.join(', '))} | ${cell(r.action)} |`);
  }
  return lines.join('\n');
}

/** True when `candidate` is not the main checkout, another worktree or a parent of either. */
export function folderDeleteAllowed(candidate, { main, others }) {
  const c = path.resolve(candidate);
  if (isInside(c, main) || isInside(main, c)) return false;
  return !others.some((o) => isInside(c, o) || isInside(o, c));
}
