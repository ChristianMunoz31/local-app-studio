// scripts/phase/new.js: the facts collector as a pure function, and main over a fake git and a fake installer (no worktree is
// created and nothing is installed). --dry-run prints the facts section and writes nothing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { countLows } from '../../scripts/phase/common.js';
import { budgetFacts, factsSection, main, newestPhase, testFacts } from '../../scripts/phase/new.js';

const STATE = {
  runId: 'p96-20261107-0800',
  head: 'a'.repeat(40),
  steps: [
    { key: 'pro:lint', build: 'pro', status: 'pass', seconds: 70, endedAt: '2026-11-07T08:01:00Z', result: {} },
    { key: 'pro:unit-pure', build: 'pro', status: 'pass', seconds: 20, endedAt: '2026-11-07T08:02:00Z', result: { tests: { unit: { passed: 30, skipped: 2 } } } },
    { key: 'pro:bundle-budget', build: 'pro', status: 'fail-real', reason: 'exit 1', seconds: 1, endedAt: '2026-11-07T08:03:00Z', result: { budgets: [{ id: 'web.totalJsGzipKb', measured: 529.2, limit: 530, headroomPct: 0.15 }] } },
  ],
};

let dir = '';
let repo = '';
beforeAll(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'phase-new-')));
  repo = path.join(dir, 'local-app-studio');
  fs.mkdirSync(path.join(repo, 'docs', 'phase95'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'docs', 'phase96'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'phase96', 'STATUS-phase96.md'), '## Owner questions\n1. A question?\n\n## Tracked LOWs\n\nL-1, L-2 (a, b), L-3\n');
  fs.mkdirSync(path.join(dir, 'ws', 'phase96-gates'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'ws', 'phase96-gates', 'gate.json'), JSON.stringify({ state: STATE, rows: [] }));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

describe('pieces', () => {
  it('newestPhase reads the docs folders, 0 when there are none', () => {
    expect(newestPhase(repo)).toBe(96);
    expect(newestPhase(path.join(dir, 'nowhere'))).toBe(0);
  });

  it('budgetFacts and testFacts read the step results', () => {
    expect(budgetFacts(STATE)).toEqual([{ build: 'pro', id: 'web.totalJsGzipKb', measured: 529.2, limit: 530, headroomPct: 0.15 }]);
    expect(testFacts(STATE)).toEqual([{ key: 'pro:unit-pure', passed: 30, skipped: 2, seconds: 20 }]);
  });

  it('countLows counts list items, else entries with brackets kept whole', () => {
    expect(countLows(['- one', '- two'])).toBe(2);
    expect(countLows(['', 'L-1, L-2 (a, b), L-3'])).toBe(3);
    expect(countLows([])).toBe(0);
  });

  it('factsSection states every fact from its inputs and uses no dash characters', () => {
    const text = factsSection({
      phase: 97,
      branch: 'feat/phase97-x',
      worktree: 'D:\\p\\las-wt-phase97',
      base: 'main',
      baseSha: 'b'.repeat(40),
      baseSubject: 'the base subject',
      day: '2026-11-07',
      gate: { state: STATE },
      gateFile: 'D:\\ws\\phase96-gates\\gate.json',
      flaky: 'No .gate/flaky.json yet',
      ports: '4581-4680',
      prevOpen: { phase: 96, questions: ['1. A question?'], lows: 3 },
      siblings: ['las-wt-phase96'],
    });
    expect(text).toMatch(/Base: main at bbbbbbb \(the base subject\)/);
    expect(text).toMatch(/Port block for phase 97: 4581-4680/);
    expect(text).toMatch(/scripts\/phase\/wait\.js --owner/);
    expect(text).toMatch(/Other worktrees: las-wt-phase96\./);
    expect(text).toMatch(/Last gate: run p96-20261107-0800 at aaaaaaa/);
    expect(text).toMatch(/not passed: pro:bundle-budget: fail-real \(exit 1\)/);
    expect(text).toMatch(/pro web\.totalJsGzipKb: 529\.2 of 530 \(0\.15 percent left\)/);
    expect(text).toMatch(/pro:unit-pure 30 passed, 2 skipped/);
    expect(text).toMatch(/3 tracked LOWs, 1 owner question line\./);
    expect(text).not.toMatch(/[\u2013\u2014]/);
  });
});

describe('new main', () => {
  const calls = [];
  const fakeRun = async (file, args) => {
    calls.push([path.basename(file), ...args]);
    const key = args.join(' ');
    if (/^rev-parse main$/.test(key)) return { code: 0, stdout: `${'c'.repeat(40)}\n`, stderr: '' };
    if (/^log -1/.test(key)) return { code: 0, stdout: 'base subject\n', stderr: '' };
    if (args.some((a) => /flakyReport/.test(a))) return { code: 1, stdout: '', stderr: 'No .gate/flaky.json yet' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const base = (extra = {}) => {
    const out = [];
    const err = [];
    return {
      out,
      err,
      deps: { out: (l) => out.push(l), err: (l) => err.push(l), root: repo, homedir: dir, now: () => new Date('2026-11-07T10:00:00Z'), run: fakeRun, readTrees: async () => ({ main: repo, worktrees: [] }), install: async () => ({ code: 0, stdout: '', stderr: '' }), ...extra },
    };
  };

  it('--dry-run prints the facts section, runs no git worktree command and writes nothing', async () => {
    calls.length = 0;
    const { out, deps } = base();
    expect(await main(['--slug', 'next-thing', '--workspace', path.join(dir, 'ws'), '--dry-run'], deps)).toBe(0);
    const text = out.join('\n');
    expect(text).toMatch(/^## 1\. What exists today/);
    expect(text).toMatch(/branch `feat\/phase97-next-thing`/);
    expect(text).toMatch(/4581-4680 \(would be allocated\)/);
    expect(text).toMatch(/Last gate: run p96-20261107-0800/);
    expect(text).toMatch(/dry run: nothing created/);
    expect(calls.some((c) => c.includes('worktree'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'ws', 'phases.json'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'ws', 'BRIEF-phase97-facts.md'))).toBe(false);
  });

  it('creates the worktree, installs, allocates the block and writes the facts file', async () => {
    calls.length = 0;
    let installed = null;
    const { out, deps } = base({
      install: async (cwd) => {
        installed = cwd;
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    const ws = path.join(dir, 'ws');
    expect(await main(['--slug', 'next-thing', '--workspace', ws], deps)).toBe(0);
    const add = calls.find((c) => c.includes('worktree'));
    expect(add.slice(1, 3)).toEqual(['worktree', 'add']);
    expect(add).toContain('feat/phase97-next-thing');
    expect(installed).toBe(path.join(dir, 'las-wt-phase97'));
    expect(JSON.parse(fs.readFileSync(path.join(ws, 'phases.json'), 'utf8')).phases[0]).toMatchObject({ phase: 97, ports: [4581, 4680] });
    expect(fs.readFileSync(path.join(ws, 'BRIEF-phase97-facts.md'), 'utf8')).toMatch(/Port block for phase 97: 4581-4680 \(allocated now\)|Port block for phase 97: 4581-4680/);
    expect(out.join('\n')).toMatch(/npm ci done/);
  });

  it('--no-install skips npm ci; a failed git or install is exit 1; bad flags exit 2; an existing folder is refused', async () => {
    const ws = path.join(dir, 'ws2');
    const noInstall = base({ install: async () => { throw new Error('must not install'); } });
    expect(await main(['--slug', 'a-b', '--phase', '90', '--no-install', '--workspace', ws], noInstall.deps)).toBe(0);
    const failGit = base({ run: async (file, args) => (args[0] === 'worktree' ? { code: 128, stdout: '', stderr: 'fatal: no' } : fakeRun(file, args)) });
    expect(await main(['--slug', 'a-b', '--phase', '91', '--workspace', ws], failGit.deps)).toBe(1);
    const failCi = base({ install: async () => ({ code: 1, stdout: '', stderr: 'boom' }) });
    expect(await main(['--slug', 'a-b', '--phase', '92', '--workspace', ws], failCi.deps)).toBe(1);
    fs.mkdirSync(path.join(dir, 'las-wt-phase93'));
    const exists = base();
    expect(await main(['--slug', 'a-b', '--phase', '93', '--workspace', ws], exists.deps)).toBe(1);
    expect(exists.err.join('\n')).toMatch(/already exists/);
    expect(await main([], base().deps)).toBe(2);
    expect(await main(['--slug', 'Bad Slug'], base().deps)).toBe(2);
    expect(await main(['--slug', 'ok', '--phase', 'x'], base().deps)).toBe(2);
  });
});
