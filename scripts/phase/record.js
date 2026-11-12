// The records a phase leaves, drafted from the gate JSON, the gate --md table and STATUS. Append only.
//
//   node scripts/phase/record.js [--phase <N>] [--gate <gate.json>] [--md <gate.md>] --append-to <file> [--memory-out <file>]
//     [--workspace <dir>] [--dry-run]
//
// Appends two blocks to the file you give: "Gates at <sha>" (the gate --md table, verbatim, both builds) and a decision entry
// draft (what landed, what did not pass, the STATUS owner questions and the count of tracked LOWs). Writes the memory paragraph
// draft to --memory-out for the parent to paste; this script never touches ~/.claude. Both output files are refused when named OVERVIEW.md (the
// workspace OVERVIEW is the parent's, so append a draft file by hand) or when they lie under ~/.claude. A run already recorded in the file (same run id and head)
// is not appended twice. --dry-run prints the blocks and writes nothing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT, countLows, findGateFile, notPassedSteps, parseFlags, parseStatus, readJsonFile, repoFacts, sectionLines, shortSha, statusPath, unwrapGate, wholeNumber, workspaceDir } from './common.js';

const USAGE = `Usage: node scripts/phase/record.js [--phase <N>] [--gate <gate.json>] [--md <gate.md>] --append-to <file> [--memory-out <file>]
         [--workspace <dir>] [--dry-run]`;
const isoDay = (d) => d.toISOString().slice(0, 10);

/**
 * Why an output file is refused: it is named OVERVIEW.md (the parent's file) or lies under the user's ~/.claude folder; null when fine.
 * @param {string} file
 * @param {string} [homedir]
 */
export function outputRefusal(file, homedir = os.homedir()) {
  const full = path.resolve(file);
  if (/^overview\.md$/i.test(path.basename(full))) return "OVERVIEW.md is the parent's file; append to a draft file and paste it";
  const claude = path.resolve(homedir, '.claude');
  const rel = path.relative(claude, full);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return `${full} is under ${claude}; write a draft file elsewhere and paste it`;
  return null;
}

/** The next decision number in a records file (highest "decision <N>" plus one), or null when it names none. */
export function nextDecisionNumber(text) {
  let max = 0;
  for (const m of String(text ?? '').matchAll(/\bdecision\s+(\d{1,4})\b/gi)) max = Math.max(max, Number(m[1]));
  return max === 0 ? null : max + 1;
}

/** The marker line of a gates block; also what a second run looks for. */
export const gatesMarker = (state) => `Gates at ${shortSha(state.head)} (run ${state.runId})`;

/** The "Gates at" block: a heading and the --md text unedited. */
export function gatesBlock(state, md) {
  return `## ${gatesMarker(state)}\n\n${String(md).trim()}\n`;
}

/**
 * The decision entry draft. The decision itself is the parent's: this lists the facts it rests on.
 * @param {{ number: number | null, phase: number, day: string, facts: { head: string | null, branch: string }, rows: object[], state: object | null, questions: string[], lows: number }} i
 */
export function decisionDraft(i) {
  const ticked = i.rows.filter((r) => r.done);
  const open = i.rows.filter((r) => !r.done);
  const left = i.state === null ? [] : notPassedSteps(i.state).filter((x) => !/: pending$/.test(x));
  const L = [`## Decision${i.number === null ? '' : ` ${i.number}`} draft (phase ${i.phase} at ${shortSha(i.facts.head)}, ${i.day})`, ''];
  L.push(`- Branch ${i.facts.branch || 'detached'} at ${shortSha(i.facts.head)}; STATUS rows ${ticked.length} ticked, ${open.length} open of ${i.rows.length}.`);
  if (open.length > 0) L.push(`- Open rows: ${open.map((r) => r.id ?? r.text.slice(0, 40)).join(', ')}.`);
  L.push(i.state === null ? '- Gates: none recorded.' : `- Gates: run ${i.state.runId} at ${shortSha(i.state.head)}; ${left.length === 0 ? 'every step passed' : `not passed: ${left.join('; ')}`}.`);
  L.push(`- Tracked LOWs: ${i.lows}.`);
  if (i.questions.length > 0) {
    L.push('- Owner questions from STATUS:');
    for (const q of i.questions) L.push(`  ${q.trim()}`);
  } else L.push('- Owner questions from STATUS: none listed.');
  L.push('- The decision and its reasons are the parent\'s to write under this heading.');
  return `${L.join('\n')}\n`;
}

/** The memory paragraph draft: one paragraph, facts only. */
export function memoryParagraph(i) {
  const ticked = i.rows.filter((r) => r.done).length;
  const left = i.state === null ? [] : notPassedSteps(i.state).filter((x) => !/: pending$/.test(x));
  const gates = i.state === null ? 'no gate run recorded' : `gate run ${i.state.runId} at ${shortSha(i.state.head)}, ${left.length === 0 ? 'every step passed' : `${left.length} step${left.length === 1 ? '' : 's'} not passed (${left.join('; ')})`}`;
  return `Phase ${i.phase} (${i.day}), branch ${i.facts.branch || 'detached'} at ${shortSha(i.facts.head)}: ${ticked} of ${i.rows.length} STATUS rows ticked; ${gates}; ${i.lows} tracked LOW${i.lows === 1 ? '' : 's'}, ${i.questions.length} owner question line${i.questions.length === 1 ? '' : 's'} in docs/phase${i.phase}/STATUS-phase${i.phase}.md.\n`;
}

/**
 * @param {string[]} argv
 * @param {object} [deps] out, err, root, homedir, now
 * @returns {Promise<number>} 0 recorded or dry run, 1 refused, 2 usage
 */
export async function main(argv, deps = {}) {
  const d = { out: (l) => console.log(l), err: (l) => console.error(l), root: REPO_ROOT, homedir: undefined, now: () => new Date(), ...deps };
  const parsed = parseFlags(argv, { phase: 'string', gate: 'string', md: 'string', 'append-to': 'string', 'memory-out': 'string', workspace: 'string', 'dry-run': 'bool' });
  if ('error' in parsed) {
    d.err(`${parsed.error}\n${USAGE}`);
    return 2;
  }
  const o = parsed.opts;
  if (o['append-to'] === null && !o['dry-run']) {
    d.err(`--append-to <file> is required (or --dry-run)\n${USAGE}`);
    return 2;
  }
  for (const flag of ['append-to', 'memory-out']) {
    const why = o[flag] === null ? null : outputRefusal(o[flag], d.homedir);
    if (why !== null) {
      d.err(`refused: --${flag}: ${why}`);
      return 1;
    }
  }
  const facts = await repoFacts(d.root);
  const phase = o.phase === null ? facts.phase : wholeNumber(o.phase);
  if (phase === null || phase < 1) {
    d.err(`no phase: pass --phase or run inside las-wt-phase<N>\n${USAGE}`);
    return 2;
  }
  const workspace = o.workspace ?? workspaceDir(d.homedir);
  const gateFile = findGateFile({ gate: o.gate, root: d.root, phase, workspace });
  const gate = gateFile === null ? null : unwrapGate(readJsonFile(gateFile));
  const mdFile = o.md === null ? (gateFile === null ? null : path.join(path.dirname(gateFile), 'gate.md')) : path.resolve(o.md);
  const md = mdFile !== null && fs.existsSync(mdFile) ? fs.readFileSync(mdFile, 'utf8') : null;
  const sf = statusPath(d.root, phase);
  const statusText = fs.existsSync(sf) ? fs.readFileSync(sf, 'utf8') : '';
  const rows = parseStatus(statusText);
  const questions = sectionLines(statusText, 'Owner questions').filter((l) => l.trim() !== '');
  const lows = countLows(sectionLines(statusText, 'Tracked LOWs'));
  const target = o['append-to'] === null ? null : path.resolve(o['append-to']);
  const existing = target !== null && fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  const day = isoDay(d.now());
  const state = gate === null ? null : gate.state;
  const blocks = [];
  let note = '';
  if (state === null || md === null) note = `no gates block: ${state === null ? 'no gate JSON found' : `no gate markdown at ${mdFile}`}`;
  else if (existing.includes(gatesMarker(state))) note = `the gates block for run ${state.runId} at ${shortSha(state.head)} is already in the file`;
  else blocks.push(gatesBlock(state, md));
  const decision = decisionDraft({ number: nextDecisionNumber(existing), phase, day, facts, rows, state, questions, lows });
  if (!existing.includes(`draft (phase ${phase} at ${shortSha(facts.head)},`)) blocks.push(decision);
  else note = `${note ? `${note}; ` : ''}a decision draft for this phase at this head is already in the file`;
  const memory = memoryParagraph({ phase, day, facts, rows, state, questions, lows });

  for (const b of blocks) d.out(b.trimEnd());
  d.out(`memory draft: ${memory.trim()}`);
  if (note) d.out(`note: ${note}`);
  if (o['dry-run']) {
    d.out(`dry run: would append ${blocks.length} block(s) to ${target ?? 'the --append-to file'} and write ${o['memory-out'] ?? 'no memory file'}`);
    return 0;
  }
  if (blocks.length > 0) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(target, `${existing === '' || existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n'}${blocks.join('\n')}`);
    d.out(`appended ${blocks.length} block(s) to ${target}`);
  }
  if (o['memory-out'] !== null) {
    const m = path.resolve(o['memory-out']);
    fs.mkdirSync(path.dirname(m), { recursive: true });
    fs.writeFileSync(m, memory);
    d.out(`wrote ${m}`);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`record: ${e.message}`);
      process.exit(1);
    },
  );
}
