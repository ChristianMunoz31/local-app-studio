// The resume block for a cut-off orchestrator: what to paste into the message that resumes it. Read only.
//
//   node scripts/phase/state.js [--phase <N>] [--gate <gate.json>] [--workspace <dir>] [--dry-run]
//
// It prints the head and branch, the uncommitted files, the STATUS rows ticked and still open, the last gate step from the gate
// JSON (the live state file of this worktree, else the workspace phase<N>-gates/gate.json), the ports of the phase from
// phases.json and the node, cargo and rustc processes whose directory or command line is this worktree. --dry-run is accepted
// and changes nothing (this script never writes).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isInside, pathMentioned } from './lib/cleanupPlan.js';
import { readProcessTable } from './lib/processTable.js';
import { REPO_ROOT, findGateFile, gitOut, lastEndedStep, notPassedSteps, parseFlags, parseStatus, readJsonFile, repoFacts, shortSha, statusPath, unwrapGate, wholeNumber, workspaceDir } from './common.js';
import { blockText } from './ports.js';

const USAGE = 'Usage: node scripts/phase/state.js [--phase <N>] [--gate <gate.json>] [--workspace <dir>] [--dry-run]';
const TOOLS = /^(node|cargo|rustc)(\.exe)?$/i;

/** The node, cargo and rustc processes that live in or name the worktree. */
export function processesOf(table, root) {
  return table.filter((p) => TOOLS.test(String(p.name)) && (isInside(root, p.cwd) || pathMentioned(p.cmd, root)));
}

/**
 * The block as lines. Pure: every input is already read.
 * @param {{ facts: object, dirty: string[], rows: object[], statusFile: string | null, gate: object | null, gateFile: string | null, ports: string | null, procs: object[] }} i
 * @returns {string[]}
 */
export function renderState(i) {
  const L = [];
  L.push(`Resume block for phase ${i.facts.phase ?? '?'} (${i.facts.root})`);
  L.push(`head ${shortSha(i.facts.head)} on ${i.facts.branch || 'a detached HEAD'}`);
  L.push(i.dirty.length === 0 ? 'tree: clean' : `tree: ${i.dirty.length} uncommitted: ${i.dirty.slice(0, 12).join(', ')}${i.dirty.length > 12 ? ', ...' : ''}`);
  if (i.statusFile === null) L.push('STATUS: no file at docs/phase<N>/STATUS-phase<N>.md');
  else {
    const done = i.rows.filter((r) => r.done);
    const open = i.rows.filter((r) => !r.done);
    L.push(`STATUS ${path.basename(i.statusFile)}: ${done.length} ticked, ${open.length} open of ${i.rows.length}`);
    const label = (r) => `${r.id ?? '-'} ${r.text}`.slice(0, 110);
    if (done.length > 0) L.push(`  last ticked: ${label(done[done.length - 1])}`);
    for (const r of open.slice(0, 40)) L.push(`  open [${r.section}] ${label(r)}`);
    if (open.length > 40) L.push(`  ... and ${open.length - 40} more open`);
  }
  if (i.gate === null) L.push('gate: no gate JSON found (none run yet)');
  else {
    const s = i.gate.state;
    const last = lastEndedStep(s);
    const pending = s.steps.filter((x) => x.status === 'pending').length;
    L.push(`gate ${s.runId} at ${shortSha(s.head)} (${path.basename(i.gateFile)}): ${s.steps.length - pending} of ${s.steps.length} steps run, ${pending} pending${s.head && i.facts.head && s.head !== i.facts.head ? `, HEAD moved since (now ${shortSha(i.facts.head)})` : ''}`);
    if (last) L.push(`  last step: ${last.key} ${last.status}${last.seconds != null ? ` ${last.seconds}s` : ''} (log ${last.log ?? 'none'})`);
    const bad = notPassedSteps(s).filter((x) => !/: pending$/.test(x));
    for (const b of bad.slice(0, 12)) L.push(`  not passed: ${b}`);
  }
  L.push(`ports: ${i.ports ?? 'no block in phases.json'}`);
  if (i.procs.length === 0) L.push('processes in this worktree: none');
  else for (const p of i.procs) L.push(`process pid ${p.pid} ${p.name}: ${String(p.cmd).slice(0, 140)}`);
  return L;
}

/**
 * @param {string[]} argv
 * @param {object} [deps] out, err, root, homedir, readTable, git
 * @returns {Promise<number>} 0 printed, 2 usage
 */
export async function main(argv, deps = {}) {
  const d = { out: (l) => console.log(l), err: (l) => console.error(l), root: REPO_ROOT, homedir: undefined, readTable: () => readProcessTable(), git: gitOut, ...deps };
  const parsed = parseFlags(argv, { phase: 'string', gate: 'string', workspace: 'string', 'dry-run': 'bool' });
  if ('error' in parsed) {
    d.err(`${parsed.error}\n${USAGE}`);
    return 2;
  }
  const o = parsed.opts;
  const facts = await repoFacts(d.root);
  if (o.phase !== null) {
    const n = wholeNumber(o.phase);
    if (n === null || n < 1) {
      d.err(`--phase needs a number\n${USAGE}`);
      return 2;
    }
    facts.phase = n;
  }
  const workspace = o.workspace ?? workspaceDir(d.homedir);
  const porcelain = await d.git(['status', '--porcelain'], d.root);
  const dirty = porcelain ? porcelain.split(/\r?\n/).filter(Boolean).map((l) => l.slice(3)) : [];
  const sf = facts.phase === null ? null : statusPath(d.root, facts.phase);
  const statusFile = sf !== null && fs.existsSync(sf) ? sf : null;
  const rows = statusFile === null ? [] : parseStatus(fs.readFileSync(statusFile, 'utf8'));
  const gateFile = findGateFile({ gate: o.gate, root: d.root, phase: facts.phase, workspace });
  const gate = gateFile === null ? null : unwrapGate(readJsonFile(gateFile));
  const ports = facts.phase === null ? null : blockText(readJsonFile(path.join(workspace, 'phases.json')), facts.phase);
  let procs = [];
  try {
    procs = processesOf(await d.readTable(), d.root).filter((p) => p.pid !== process.pid && p.pid !== process.ppid);
  } catch (e) {
    d.out(`note: the process table could not be read (${e.message})`);
  }
  for (const line of renderState({ facts, dirty, rows, statusFile, gate, gateFile, ports, procs })) d.out(line);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`state: ${e.message}`);
      process.exit(1);
    },
  );
}
