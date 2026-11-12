// scripts/phase/state.js: the resume block over a throwaway git repo named like a phase worktree, a STATUS file, a gate JSON
// in both shapes and an injected process table. Read only.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lastEndedStep, notPassedSteps, parseStatus, sectionLines, unwrapGate } from '../../scripts/phase/common.js';
import { main, processesOf, renderState } from '../../scripts/phase/state.js';

let base = '';
let repo = '';
const git = (args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe', encoding: 'utf8' });

const STATUS = `# Phase 98 status

## Part A
- [x] A1 first thing
- [ ] A2 second thing

## Part B
- [x] B1 done one
- [ ] plain row without an id

## Owner questions
1. Is it fine?
`;
const gateState = (head) => ({
  v: 1,
  phase: 98,
  runId: 'p98-test',
  head,
  branch: 'feat/phase98-x',
  steps: [
    { key: 'pro:lint', status: 'pass', seconds: 3.2, endedAt: '2026-11-07T10:00:00Z', log: 'p98-pro-lint.log' },
    { key: 'pro:unit-pure', status: 'fail-real', reason: 'exit 1', seconds: 9, endedAt: '2026-11-07T10:05:00Z', log: 'p98-pro-unit-pure.log' },
    { key: 'pro:build', status: 'pending', endedAt: null },
  ],
});

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'phase-state-')));
  repo = path.join(base, 'las-wt-phase98');
  fs.mkdirSync(path.join(repo, 'docs', 'phase98'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'phase98', 'STATUS-phase98.md'), STATUS);
  git(['init', '-q', '-b', 'feat/phase98-x']);
  git(['add', '-A']);
  git(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'init']);
  fs.writeFileSync(path.join(repo, 'dirty.txt'), 'x');
});
afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

describe('common readers', () => {
  it('parseStatus reads ticked and open rows with their section and id', () => {
    const rows = parseStatus(STATUS);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({ section: 'Part A', id: 'A1', text: 'first thing', done: true });
    expect(rows[3]).toEqual({ section: 'Part B', id: null, text: 'plain row without an id', done: false });
    expect(sectionLines(STATUS, 'Owner questions')).toEqual(['1. Is it fine?']);
  });

  it('unwrapGate reads the live state and the --json output; lastEndedStep and notPassedSteps read the steps', () => {
    const s = gateState('abc');
    expect(unwrapGate(s).state.runId).toBe('p98-test');
    expect(unwrapGate({ v: 1, state: s, rows: [{ row: 'lint' }] }).rows).toHaveLength(1);
    expect(unwrapGate({ state: s, decisions: { pro: ['Needs a decision (pro build): x'] } }).decisions.pro).toHaveLength(1);
    expect(unwrapGate(s).decisions).toEqual({});
    expect(unwrapGate({ nope: 1 })).toBeNull();
    expect(lastEndedStep(s).key).toBe('pro:unit-pure');
    expect(notPassedSteps(s)).toEqual(['pro:unit-pure: fail-real (exit 1)', 'pro:build: pending']);
  });
});

describe('processesOf', () => {
  it('keeps node, cargo and rustc that live in or name the worktree', () => {
    const wt = 'D:\\p\\las-wt-phase98';
    const table = [
      { pid: 1, name: 'node.exe', cwd: wt, cmd: 'node a.js' },
      { pid: 2, name: 'cargo.exe', cwd: 'C:\\x', cmd: `cargo build --manifest-path ${wt}\\src-tauri\\Cargo.toml` },
      { pid: 3, name: 'node.exe', cwd: 'D:\\p\\las-wt-phase97', cmd: 'node b.js' },
      { pid: 4, name: 'powershell.exe', cwd: wt, cmd: 'powershell' },
    ];
    expect(processesOf(table, wt).map((p) => p.pid)).toEqual([1, 2]);
  });
});

describe('state main', () => {
  const run = async (argv) => {
    const out = [];
    const code = await main(argv, {
      out: (l) => out.push(l),
      err: (l) => out.push(l),
      root: repo,
      homedir: base,
      readTable: async () => [{ pid: 7001, name: 'node.exe', cwd: repo, cmd: 'node vitest' }],
    });
    return { code, text: out.join('\n') };
  };

  it('prints head, branch, uncommitted files, STATUS rows, the last gate step and the processes', async () => {
    const gateFile = path.join(base, 'gate.json');
    fs.writeFileSync(gateFile, JSON.stringify({ v: 1, state: gateState(git(['rev-parse', 'HEAD']).trim()), rows: [] }));
    const { code, text } = await run(['--gate', gateFile, '--dry-run']);
    expect(code).toBe(0);
    expect(text).toMatch(/Resume block for phase 98/);
    expect(text).toMatch(/on feat\/phase98-x/);
    expect(text).toMatch(/1 uncommitted: dirty\.txt/);
    expect(text).toMatch(/2 ticked, 2 open of 4/);
    expect(text).toMatch(/open \[Part A\] A2 second thing/);
    expect(text).toMatch(/gate p98-test at [0-9a-f]{7}.*2 of 3 steps run, 1 pending/);
    expect(text).not.toMatch(/HEAD moved/);
    expect(text).toMatch(/last step: pro:unit-pure fail-real 9s/);
    expect(text).toMatch(/not passed: pro:unit-pure: fail-real/);
    expect(text).toMatch(/process pid 7001 node\.exe/);
  });

  it('says when the gate head differs from HEAD, and when there is no gate JSON', async () => {
    const gateFile = path.join(base, 'gate-old.json');
    fs.writeFileSync(gateFile, JSON.stringify(gateState('0000000000000000000000000000000000000000')));
    expect((await run(['--gate', gateFile])).text).toMatch(/HEAD moved since/);
    const none = await run([]);
    expect(none.text).toMatch(/no gate JSON found/);
  });

  it('refuses a bad flag with exit 2', async () => {
    expect((await run(['--phase', 'x'])).code).toBe(2);
    expect((await run(['--wat'])).code).toBe(2);
  });

  it('renderState has a line for a missing STATUS file', () => {
    const lines = renderState({ facts: { phase: 1, root: 'r', head: 'abcdef123', branch: '' }, dirty: [], rows: [], statusFile: null, gate: null, gateFile: null, ports: null, procs: [] });
    expect(lines.join('\n')).toMatch(/no file at docs/);
    expect(lines.join('\n')).toMatch(/a detached HEAD/);
  });
});
