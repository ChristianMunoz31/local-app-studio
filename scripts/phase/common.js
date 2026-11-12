// Shared helpers of the phase scripts that read the gate JSON, STATUS and the repo (ports, wait, state, merge, record, new,
// preview, eval). Pure where it can be; the few readers take an injectable runner. No script here takes a typed number: the
// phase comes from the folder name or the branch (detectPhase), the head from git, the figures from the gate JSON.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectPhase } from './lib/gatePlan.js';
import { gitExe, runFile } from './lib/processTable.js';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const pad2 = (n) => String(n).padStart(2, '0');
export const shortSha = (sha) => String(sha ?? '').slice(0, 7);

/** The workspace folder (the parent's, read only except a phase folder): default `local-app-studio-workspace` in the home folder. */
export const workspaceDir = (homedir = os.homedir()) => path.join(homedir, 'local-app-studio-workspace');

/**
 * A tiny flag parser. `spec` maps a flag to `bool`, `string` or `list` (repeatable). `--flag=value` is accepted.
 * @param {string[]} argv
 * @param {Record<string, 'bool' | 'string' | 'list'>} spec
 * @returns {{ opts: Record<string, unknown>, rest: string[] } | { error: string }} `rest` is what follows a bare `--`
 */
export function parseFlags(argv, spec) {
  const opts = {};
  for (const [k, kind] of Object.entries(spec)) opts[k] = kind === 'bool' ? false : kind === 'list' ? [] : null;
  const dd = argv.indexOf('--');
  const head = dd < 0 ? argv : argv.slice(0, dd);
  const rest = dd < 0 ? [] : argv.slice(dd + 1);
  for (let i = 0; i < head.length; i += 1) {
    const raw = head[i];
    if (!raw.startsWith('--')) return { error: `unexpected argument ${raw}` };
    const eq = raw.indexOf('=');
    const name = eq < 0 ? raw.slice(2) : raw.slice(2, eq);
    const kind = spec[name];
    if (kind === undefined) return { error: `unknown argument --${name}` };
    if (kind === 'bool') {
      if (eq >= 0) return { error: `--${name} takes no value` };
      opts[name] = true;
      continue;
    }
    const value = eq >= 0 ? raw.slice(eq + 1) : head[(i += 1)];
    if (value === undefined || value === '' || (eq < 0 && value.startsWith('--'))) return { error: `--${name} needs a value` };
    if (kind === 'list') opts[name].push(value);
    else opts[name] = value;
  }
  return { opts, rest };
}

/** A whole non-negative number given as text, or null. Used for flags such as --max-wait. */
export const wholeNumber = (text) => (/^\d{1,9}$/.test(String(text ?? '')) ? Number(text) : null);

/**
 * Runs git (absolute path, no shell) and returns trimmed stdout, or null on any failure.
 * @param {string[]} args
 * @param {string} cwd
 * @param {typeof runFile} [run]
 */
export async function gitOut(args, cwd, run = runFile) {
  const git = gitExe();
  if (git === null) return null;
  const r = await run(git, args, { cwd, timeout: 60000 });
  return r.code === 0 ? String(r.stdout).trim() : null;
}

/** The facts git knows about a checkout: head, branch (empty when detached), the phase from the folder or the branch. */
export async function repoFacts(root, run = runFile) {
  const head = await gitOut(['rev-parse', 'HEAD'], root, run);
  const branch = (await gitOut(['rev-parse', '--abbrev-ref', 'HEAD'], root, run)) ?? '';
  const name = path.basename(root);
  return { root, name, head, branch: branch === 'HEAD' ? '' : branch, phase: detectPhase(name, branch) };
}

/** Reads a JSON file; null when it is missing or not JSON. */
export function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** The gate state out of either shape: the live state file (`{ steps }`) or the `--json` output (`{ state, rows, ... }`). */
export function unwrapGate(json) {
  if (!json || typeof json !== 'object') return null;
  const state = json.state && typeof json.state === 'object' ? json.state : json;
  if (!Array.isArray(state.steps)) return null;
  return { state, rows: Array.isArray(json.rows) ? json.rows : [], decisions: json.decisions && typeof json.decisions === 'object' ? json.decisions : {}, headroom: json.headroom ?? null };
}

/**
 * The gate JSON to read for a phase: `--gate` when given, else the live state file of the worktree, else the newest
 * `phase<N>-gates/gate.json` in the workspace, else null.
 * @param {{ gate: string | null, root: string, phase: number | null, workspace: string }} o
 * @returns {string | null}
 */
export function findGateFile({ gate, root, phase, workspace }) {
  if (gate) return path.resolve(gate);
  const candidates = [];
  if (phase !== null) {
    candidates.push(path.join(root, '.gate', 'phase', `phase-${pad2(phase)}.json`));
    candidates.push(path.join(workspace, `phase${phase}-gates`, 'gate.json'));
  }
  return candidates.find((f) => fs.existsSync(f)) ?? null;
}

/** The STATUS file of a phase inside a checkout. */
export const statusPath = (root, phase) => path.join(root, 'docs', `phase${phase}`, `STATUS-phase${phase}.md`);

/**
 * STATUS rows: `- [x] <ID> text` and `- [ ] <ID> text` under their `##` heading.
 * @param {string} text
 * @returns {{ section: string, id: string | null, text: string, done: boolean }[]}
 */
export function parseStatus(text) {
  const rows = [];
  let section = '';
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      section = h[1];
      continue;
    }
    const m = /^- \[( |x|X)\]\s+(.*)$/.exec(line);
    if (!m) continue;
    const idm = /^([A-Z]{1,3}\d+[a-z]?)\s+(.*)$/.exec(m[2]);
    rows.push({ section, id: idm ? idm[1] : null, text: idm ? idm[2] : m[2], done: m[1] !== ' ' });
  }
  return rows;
}

/** The lines under one `##` heading (until the next heading), trimmed of blank edges. */
export function sectionLines(text, heading) {
  const out = [];
  let on = false;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      on = h[1].toLowerCase().startsWith(heading.toLowerCase());
      continue;
    }
    if (on) out.push(line);
  }
  while (out.length > 0 && out[0].trim() === '') out.shift();
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
  return out;
}

/** The steps of a gate state that did not pass (pending and running included), as `key: status (reason)`. */
export function notPassedSteps(state) {
  return state.steps.filter((s) => s.status !== 'pass').map((s) => `${s.key}: ${s.status}${s.reason ? ` (${s.reason})` : ''}`);
}

/** The step that ended last, or null. */
export function lastEndedStep(state) {
  const ended = state.steps.filter((s) => s.endedAt);
  if (ended.length === 0) return null;
  return ended.reduce((a, b) => (Date.parse(b.endedAt) >= Date.parse(a.endedAt) ? b : a));
}

/**
 * How many tracked LOWs a STATUS "Tracked LOWs" section lists: its list items when it has any, else its comma separated
 * entries (commas inside brackets do not split).
 * @param {string[]} lines the section's lines (sectionLines)
 */
export function countLows(lines) {
  const items = lines.filter((l) => /^\s*(?:[-*]|\d+[.)])\s/.test(l));
  if (items.length > 0) return items.length;
  let depth = 0;
  let count = 0;
  let any = false;
  for (const ch of lines.join(' ')) {
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      if (any) count += 1;
      any = false;
      continue;
    }
    if (!/\s/.test(ch)) any = true;
  }
  return count + (any ? 1 : 0);
}
