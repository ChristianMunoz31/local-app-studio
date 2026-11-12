// Composes merge-p<NN>.txt from STATUS and the gate JSON, in the shape of the last merge messages, and merges only with --yes.
//
//   node scripts/phase/merge.js [--phase <N>] [--gate <gate.json>] [--out <file>] [--subject <text>] [--narrative <file>]
//     [--base <ref>] [--trailer <text>] [--workspace <dir>] [--dry-run] [--allow-moved] [--yes]
//
// Without --yes the message is composed, written to --out (default merge-p<NN>.txt in the workspace folder) and printed, and
// nothing is merged. --dry-run prints it and writes nothing. The merge decision, the narrative and the owner questions stay with
// the parent: --narrative takes a file of paragraphs that replace the generated "What landed" block. Every figure comes from the
// gate JSON rows and the STATUS file, none is typed.
// --yes runs `git merge --no-ff -F <file> <branch>` (execFile, no shell) in the main checkout, and only when: this worktree is
// clean, the gate JSON ran at HEAD (--allow-moved accepts a HEAD that moved), the gate has no real failure, and the main checkout
// is on --base (default main) and clean.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWorktrees, runFile, gitExe } from './lib/processTable.js';
import { REPO_ROOT, findGateFile, gitOut, notPassedSteps, parseFlags, parseStatus, readJsonFile, repoFacts, shortSha, statusPath, unwrapGate, wholeNumber, workspaceDir } from './common.js';

const WIDTH = 72;
const USAGE = `Usage: node scripts/phase/merge.js [--phase <N>] [--gate <gate.json>] [--out <file>] [--subject <text>] [--narrative <file>]
         [--base <ref>] [--trailer <text>] [--workspace <dir>] [--dry-run] [--allow-moved] [--yes]`;

/** Hard wrap at `width` columns on spaces; a word longer than the width stays whole. */
export function wrap(text, width = WIDTH) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (line !== '' && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line === '' ? word : `${line} ${word}`;
  }
  if (line !== '') lines.push(line);
  return lines.join('\n');
}

/** The conventional subject from the branch (`feat/phase27-lessons-and-optimization`), or null. */
export function subjectFromBranch(branch, phase) {
  const m = /^(feat|fix|chore|docs)\/phase\d+-(.+)$/.exec(String(branch));
  if (!m) return null;
  return `${m[1]}(phase): phase ${phase}, ${m[2].replace(/-/g, ' ')}`;
}

/** The Co-Authored-By trailer of the newest commit (what this branch's own commits carry), or '' when it has none. */
async function headTrailer(root, run) {
  const v = await gitOut(['log', '-1', '--format=%(trailers:key=Co-Authored-By,valueonly)'], root, run);
  return v ? `Co-Authored-By: ${v.split(String.fromCharCode(10))[0].trim()}` : '';
}

const tidy = (text) => String(text).replace(/\s+/g, ' ').replace(/\.$/, '').trim();

/** "What landed": one paragraph per STATUS section with its ticked rows. */
export function landedBlock(rows) {
  const bySection = new Map();
  for (const r of rows.filter((x) => x.done)) {
    if (/^(gates|owner questions|tracked)/i.test(r.section)) continue;
    const list = bySection.get(r.section) ?? [];
    list.push(`${r.id ? `${r.id} ` : ''}${tidy(r.text)}`);
    bySection.set(r.section, list);
  }
  return [...bySection].map(([section, list]) => wrap(`${section}: ${list.join('; ')}.`)).join('\n\n');
}

/** The cells of one build out of the gate rows: `row value, row value`; a row that is n/a for the build is left out. */
export function gateCells(rows, build) {
  return rows
    .filter((r) => typeof r[build] === 'string' && r[build] !== '' && r[build] !== 'n/a')
    .map((r) => `${r.row} ${r[build]}`)
    .join(', ');
}

/**
 * The whole message. Pure.
 * @param {{ subject: string, branch: string, base: string, commits: number, narrative: string | null, rows: object[],
 *   gate: { state: object, rows: object[], decisions: object } | null, trailer: string, statusName: string }} i
 * @returns {string}
 */
export function composeMessage(i) {
  const parts = [i.subject, ''];
  parts.push(wrap(`Merge ${i.branch} (${i.commits} orchestrator commit${i.commits === 1 ? '' : 's'} on ${i.base}).`));
  parts.push('');
  const landed = i.narrative !== null ? i.narrative.trim() : landedBlock(i.rows);
  if (landed !== '') parts.push(landed, '');
  if (i.gate === null) parts.push(wrap('No gate JSON was found: the gates are not recorded in this message.'), '');
  else {
    const s = i.gate.state;
    const builds = (s.options?.builds ?? ['pro']).filter((b) => b === 'pro' || b === 'public');
    const label = { pro: 'pro build', public: 'public build (APP_PRO_DIR=none)' };
    const cells = builds.map((b) => `${label[b]}: ${gateCells(i.gate.rows, b) || 'no row recorded'}`).join('. ');
    parts.push(wrap(`Gates by scripts/phase/gate.js (run ${s.runId} at ${shortSha(s.head)}), ${cells}.`), '');
    const left = notPassedSteps(s).filter((x) => !/: pending$/.test(x));
    const decisions = Object.values(i.gate.decisions ?? {}).flat();
    parts.push(wrap(`Ledger: ${decisions.length === 0 ? 'no "Needs a decision" line' : `${decisions.length} "Needs a decision" line${decisions.length === 1 ? '' : 's'}`}, nothing raised.`));
    parts.push('');
    if (left.length > 0) parts.push(wrap(`Not passed: ${left.join('; ')}.`), '');
  }
  parts.push(wrap(`Owner questions and tracked LOWs in ${i.statusName}.`));
  if (i.trailer !== '') parts.push('', i.trailer);
  return `${parts.join('\n')}\n`;
}

/**
 * Why a --yes merge must not run, as lines (empty when it may).
 * @param {{ dirty: string[], gate: object | null, head: string | null, allowMoved: boolean, mainBranch: string | null, base: string, mainDirty: string[] }} i
 */
export function mergeRefusals(i) {
  const out = [];
  if (i.dirty.length > 0) out.push(`this worktree has ${i.dirty.length} uncommitted file(s)`);
  if (i.gate === null) out.push('no gate JSON: a merge needs the gates recorded');
  else {
    if (!i.allowMoved && i.gate.state.head !== i.head) out.push(`the gate ran at ${shortSha(i.gate.state.head)} and HEAD is ${shortSha(i.head)} (--allow-moved accepts that)`);
    // A merge needs at least one step and every step pass or fail-flake: pending, running, not-run and fail-real all refuse.
    const steps = i.gate.state.steps;
    if (steps.length === 0) out.push('the gate has no steps: a merge needs a finished gate');
    const open = steps.filter((s) => s.status !== 'pass' && s.status !== 'fail-flake');
    if (open.length > 0) out.push(`the gate has steps that did not pass: ${open.map((s) => `${s.key} (${s.status})`).join(', ')}`);
  }
  if (i.mainBranch !== i.base) out.push(`the main checkout is on ${i.mainBranch ?? 'an unknown branch'}, not ${i.base}`);
  if (i.mainDirty.length > 0) out.push(`the main checkout has ${i.mainDirty.length} uncommitted file(s)`);
  return out;
}

/**
 * @param {string[]} argv
 * @param {object} [deps] out, err, root, homedir, readTrees, run
 * @returns {Promise<number>} 0 composed (or merged), 1 refused or the merge failed, 2 usage
 */
export async function main(argv, deps = {}) {
  const d = { out: (l) => console.log(l), err: (l) => console.error(l), root: REPO_ROOT, homedir: undefined, readTrees: readWorktrees, run: runFile, ...deps };
  const parsed = parseFlags(argv, { phase: 'string', gate: 'string', out: 'string', subject: 'string', narrative: 'string', base: 'string', trailer: 'string', workspace: 'string', 'dry-run': 'bool', 'allow-moved': 'bool', yes: 'bool' });
  if ('error' in parsed) {
    d.err(`${parsed.error}\n${USAGE}`);
    return 2;
  }
  const o = parsed.opts;
  if (o['dry-run'] && o.yes) {
    d.err(`--dry-run and --yes cannot be combined\n${USAGE}`);
    return 2;
  }
  const facts = await repoFacts(d.root, d.run);
  const phase = o.phase === null ? facts.phase : wholeNumber(o.phase);
  if (phase === null || phase < 1) {
    d.err(`no phase: pass --phase or run inside las-wt-phase<N>\n${USAGE}`);
    return 2;
  }
  if (!facts.branch) {
    d.err('this worktree is on a detached HEAD: there is no branch to merge');
    return 2;
  }
  const workspace = o.workspace ?? workspaceDir(d.homedir);
  const base = o.base ?? 'main';
  const sf = statusPath(d.root, phase);
  const rows = fs.existsSync(sf) ? parseStatus(fs.readFileSync(sf, 'utf8')) : [];
  const gateFile = findGateFile({ gate: o.gate, root: d.root, phase, workspace });
  const gate = gateFile === null ? null : unwrapGate(readJsonFile(gateFile));
  const narrative = o.narrative === null ? null : fs.readFileSync(path.resolve(o.narrative), 'utf8');
  const mergeBase = (await gitOut(['merge-base', 'HEAD', base], d.root, d.run)) ?? '';
  const count = mergeBase === '' ? '' : (await gitOut(['rev-list', '--count', `${mergeBase}..HEAD`], d.root, d.run)) ?? '';
  const subject = o.subject ?? subjectFromBranch(facts.branch, phase) ?? `feat(phase): phase ${phase}`;
  const message = composeMessage({
    subject,
    branch: facts.branch,
    base: mergeBase === '' ? base : shortSha(mergeBase),
    commits: Number(count) || 0,
    narrative,
    rows,
    gate,
    trailer: o.trailer ?? (await headTrailer(d.root, d.run)),
    statusName: `docs/phase${phase}/STATUS-phase${phase}.md`,
  });
  const outFile = path.resolve(o.out ?? path.join(workspace, `merge-p${phase}.txt`));
  d.out(message.trimEnd());
  if (o['dry-run']) {
    d.out(`dry run: would write ${outFile}; nothing merged`);
    return 0;
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, message);
  d.out(`wrote ${outFile} (${message.split('\n').length - 1} lines)`);
  if (!o.yes) {
    d.out(`not merged: read the message, then run again with --yes to run git merge --no-ff -F ${path.basename(outFile)} ${facts.branch}`);
    return 0;
  }

  const listing = await d.readTrees(d.root);
  const mainPath = listing.main;
  const dirty = ((await gitOut(['status', '--porcelain'], d.root, d.run)) ?? '').split(/\r?\n/).filter(Boolean);
  const mainBranch = await gitOut(['rev-parse', '--abbrev-ref', 'HEAD'], mainPath, d.run);
  const mainDirty = ((await gitOut(['--no-optional-locks', 'status', '--porcelain'], mainPath, d.run)) ?? '').split(/\r?\n/).filter(Boolean);
  const refusals = mergeRefusals({ dirty, gate, head: facts.head, allowMoved: o['allow-moved'], mainBranch, base, mainDirty });
  if (refusals.length > 0) {
    for (const r of refusals) d.err(`refused: ${r}`);
    return 1;
  }
  const git = gitExe();
  if (git === null) {
    d.err('refused: git not found on an absolute PATH entry');
    return 1;
  }
  const r = await d.run(git, ['merge', '--no-ff', '-F', outFile, facts.branch], { cwd: mainPath, timeout: 300000 });
  d.out(`${String(r.stdout ?? '').trim()}${String(r.stderr ?? '').trim() ? `\n${String(r.stderr).trim()}` : ''}`.trim());
  d.out(r.code === 0 ? `merged ${facts.branch} into ${base} in ${mainPath}` : `git merge exited ${r.code}: resolve it in ${mainPath}`);
  return r.code === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`merge: ${e.message}`);
      process.exit(1);
    },
  );
}
