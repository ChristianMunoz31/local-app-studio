// scripts/phase/merge.js: the composer over a STATUS file and a gate JSON (shape of merge-p25.txt), the refusals and the --yes
// path over an injected runner. No real merge is ever run here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseStatus } from '../../scripts/phase/common.js';
import { composeMessage, gateCells, landedBlock, main, mergeRefusals, subjectFromBranch, wrap } from '../../scripts/phase/merge.js';

const TRAILER = 'Co-Authored-By: Test Agent <noreply@example.com>';
const GATE = {
  state: {
    runId: 'p98-20261107-0100',
    head: 'a'.repeat(40),
    options: { builds: ['pro', 'public'] },
    steps: [
      { key: 'pro:lint', status: 'pass' },
      { key: 'pro:hygiene-gitleaks', status: 'fail-real', reason: 'exit 1' },
      { key: 'public:build', status: 'pending' },
    ],
  },
  rows: [
    { row: 'vitest frontend', pro: '2924 passed, 0 skipped', public: '2878 passed, 33 skipped' },
    { row: 'templateParity', pro: 'ok', public: 'n/a' },
    { row: 'lint', pro: '0', public: '0' },
  ],
  decisions: { pro: ['Needs a decision (pro build): x', 'Needs a decision (pro build): y'], public: [] },
};
const ROWS = parseStatus(`## Part A, lessons
- [x] A1 docs/LESSONS.md written.
- [ ] A2 open one
## Part B
- [x] B1 table
- [x] B2 cut
## Gates
- [x] G ran
`);

describe('composeMessage', () => {
  const msg = composeMessage({ subject: 'feat(phase): phase 98, a title', branch: 'feat/phase98-a-title', base: '0c4d6b0', commits: 12, narrative: null, rows: ROWS, gate: GATE, trailer: TRAILER, statusName: 'docs/phase98/STATUS-phase98.md' });
  const lines = msg.split('\n');
  const flat = msg.replace(/\s+/g, ' ');

  it('has the shape of the merge messages: subject, blank, Merge line, gates, ledger, owner questions, trailer last', () => {
    expect(lines[0]).toBe('feat(phase): phase 98, a title');
    expect(lines[1]).toBe('');
    expect(lines[2]).toMatch(/^Merge feat\/phase98-a-title \(12 orchestrator commits on 0c4d6b0\)\.$/);
    expect(flat).toMatch(/Gates by scripts\/phase\/gate\.js \(run p98-20261107-0100 at aaaaaaa\)/);
    expect(flat).toMatch(/pro build: vitest frontend 2924 passed, 0 skipped, templateParity ok, lint 0/);
    expect(flat).toMatch(/public build \(APP_PRO_DIR=none\): vitest frontend 2878 passed, 33 skipped, lint 0/);
    expect(flat).not.toMatch(/templateParity n\/a/);
    expect(flat).toMatch(/Ledger: 2 "Needs a decision" lines, nothing raised\./);
    expect(flat).toMatch(/Not passed: pro:hygiene-gitleaks: fail-real \(exit 1\)\./);
    expect(flat).toMatch(/Owner questions and tracked LOWs in docs\/phase98\/STATUS-phase98\.md\./);
    expect(lines[lines.length - 2]).toBe(TRAILER);
    expect(lines[lines.length - 1]).toBe('');
  });

  it('wraps at 72 columns, uses no dash characters and has no placeholder text', () => {
    expect(lines.every((l) => l.length <= 72 || !/\s/.test(l))).toBe(true);
    expect(msg).not.toMatch(/[\u2013\u2014]/);
    expect(msg).not.toMatch(/TODO|TBD|<[A-Za-z ]+>/);
  });

  it('lists the ticked rows per section and skips the Gates section; a narrative replaces them', () => {
    expect(landedBlock(ROWS)).toContain('Part A, lessons: A1 docs/LESSONS.md written.');
    expect(landedBlock(ROWS)).toContain('Part B: B1 table; B2 cut.');
    expect(landedBlock(ROWS)).not.toMatch(/G ran/);
    const withNarrative = composeMessage({ subject: 's', branch: 'b', base: 'x', commits: 1, narrative: 'The owner decided this.\n', rows: ROWS, gate: null, trailer: 't', statusName: 'S.md' });
    expect(withNarrative).toMatch(/Merge b \(1 orchestrator commit on x\)/);
    expect(withNarrative).toMatch(/The owner decided this\./);
    expect(withNarrative).not.toMatch(/Part B:/);
    expect(withNarrative).toMatch(/No gate JSON was found/);
  });

  it('follows the structure of the real merge-p25.txt when the workspace has it', () => {
    const real = path.join(os.homedir(), 'local-app-studio-workspace', 'merge-p25.txt');
    if (!fs.existsSync(real)) return;
    const text = fs.readFileSync(real, 'utf8');
    const rl = text.split('\n');
    expect(rl[0]).toMatch(/^[a-z]+\([a-z-]+\): phase \d+, /);
    expect(rl[1]).toBe('');
    expect(rl[2]).toMatch(/^Merge feat\/phase\d+-/);
    expect(text).toMatch(/^Gates rerun by the parent through scripts\/phase\/gate\.js \(run\s+p\d+-/m);
    expect(rl.filter(Boolean).pop()).toMatch(/^Co-Authored-By: /);
    expect(lines[0]).toMatch(/^[a-z]+\([a-z-]+\): phase \d+, /);
    expect(lines[2]).toMatch(/^Merge feat\/phase\d+-/);
  });
});

describe('pieces', () => {
  it('wrap keeps a long word whole and joins short ones', () => {
    expect(wrap('a b c', 72)).toBe('a b c');
    expect(wrap(`${'x'.repeat(80)} y`, 72)).toBe(`${'x'.repeat(80)}\ny`);
    expect(wrap('aaaa bbbb cccc', 9)).toBe('aaaa bbbb\ncccc');
  });

  it('subjectFromBranch and gateCells', () => {
    expect(subjectFromBranch('feat/phase27-lessons-and-optimization', 27)).toBe('feat(phase): phase 27, lessons and optimization');
    expect(subjectFromBranch('main', 27)).toBeNull();
    expect(gateCells(GATE.rows, 'public')).toBe('vitest frontend 2878 passed, 33 skipped, lint 0');
  });

  it('mergeRefusals names every reason and is empty when all is well', () => {
    const ok = { dirty: [], gate: GATE, head: GATE.state.head, allowMoved: false, mainBranch: 'main', base: 'main', mainDirty: [] };
    expect(mergeRefusals({ ...ok, gate: { ...GATE, state: { ...GATE.state, steps: [{ key: 'a', status: 'pass' }] } } })).toEqual([]);
    const bad = mergeRefusals({ ...ok, dirty: ['x'], head: 'b'.repeat(40), mainBranch: 'feat/other', mainDirty: ['y'] });
    expect(bad.join('\n')).toMatch(/uncommitted file/);
    expect(bad.join('\n')).toMatch(/gate ran at aaaaaaa and HEAD is bbbbbbb/);
    expect(bad.join('\n')).toMatch(/gate has steps that did not pass: pro:hygiene-gitleaks/);
    expect(bad.join('\n')).toMatch(/on feat\/other, not main/);
    expect(mergeRefusals({ ...ok, gate: null }).join('\n')).toMatch(/no gate JSON/);
    expect(mergeRefusals({ ...ok, head: 'b'.repeat(40), allowMoved: true, gate: { ...GATE, state: { ...GATE.state, steps: [{ key: 'a', status: 'pass' }] } } })).toEqual([]);
    expect(mergeRefusals({ ...ok, allowMoved: true, gate: { ...GATE, state: { ...GATE.state, steps: [] } } }).join('\n')).toMatch(/gate has no steps/);
  });

  it('mergeRefusals accepts only pass and fail-flake steps: pending, running, not-run and fail-real refuse', () => {
    const at = (steps) => mergeRefusals({ dirty: [], gate: { ...GATE, state: { ...GATE.state, steps } }, head: GATE.state.head, allowMoved: false, mainBranch: 'main', base: 'main', mainDirty: [] });
    expect(at([{ key: 'a', status: 'pass' }, { key: 'b', status: 'fail-flake' }])).toEqual([]);
    for (const status of ['pending', 'running', 'not-run', 'fail-real']) {
      expect(at([{ key: 'a', status: 'pass' }, { key: 'b', status }]).join('\n'), status).toContain(`b (${status})`);
    }
  });
});

describe('merge main', () => {
  let dir = '';
  let repo = '';
  beforeAll(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'phase-merge-')));
    repo = path.join(dir, 'las-wt-phase98');
    fs.mkdirSync(path.join(repo, 'docs', 'phase98'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'docs', 'phase98', 'STATUS-phase98.md'), '## Part A\n- [x] A1 one thing\n');
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

  // A fake git: answers by the arguments, records every call.
  const fakeRun = (answers, calls) => async (file, args) => {
    calls.push(args);
    const key = args.join(' ');
    for (const [pattern, value] of answers) if (pattern.test(key)) return typeof value === 'string' ? { code: 0, stdout: value, stderr: '' } : value;
    return { code: 0, stdout: '', stderr: '' };
  };
  const answers = (head, extra = []) => [
    ...extra,
    [/^rev-parse HEAD$/, head],
    [/rev-parse --abbrev-ref HEAD/, 'feat/phase98-a-title'],
    [/^merge-base/, 'c'.repeat(40)],
    [/^rev-list --count/, '5'],
    [/^status --porcelain/, ''],
  ];
  const run = async (argv, runner, extra = {}) => {
    const out = [];
    const err = [];
    const code = await main(['--gate', path.join(dir, 'gate.json'), '--out', path.join(dir, 'merge-p98.txt'), ...argv], {
      out: (l) => out.push(l),
      err: (l) => err.push(l),
      root: repo,
      homedir: dir,
      readTrees: async () => ({ main: path.join(dir, 'main-checkout'), worktrees: [] }),
      run: runner,
      ...extra,
    });
    return { code, text: out.join('\n'), err: err.join('\n') };
  };

  it('composes and writes the file without merging; --dry-run writes nothing; --yes with --dry-run is a usage error', async () => {
    fs.writeFileSync(path.join(dir, 'gate.json'), JSON.stringify({ state: { ...GATE.state, head: 'd'.repeat(40) }, rows: GATE.rows, decisions: GATE.decisions }));
    const calls = [];
    const r = await run([], fakeRun(answers('d'.repeat(40)), calls));
    expect(r.code).toBe(0);
    expect(r.text).toMatch(/Merge feat\/phase98-a-title \(5 orchestrator commits on ccccccc\)/);
    expect(r.text).toMatch(/not merged: read the message/);
    expect(fs.readFileSync(path.join(dir, 'merge-p98.txt'), 'utf8')).toMatch(/^feat\(phase\): phase 98, a title/);
    expect(calls.some((a) => a[0] === 'merge')).toBe(false);
    fs.rmSync(path.join(dir, 'merge-p98.txt'));
    const dry = await run(['--dry-run'], fakeRun(answers('d'.repeat(40)), []));
    expect(dry.text).toMatch(/dry run: would write/);
    expect(fs.existsSync(path.join(dir, 'merge-p98.txt'))).toBe(false);
    expect((await run(['--dry-run', '--yes'], fakeRun([], []))).code).toBe(2);
  });

  it('--yes refuses while the gate has a failing step, and merges with -F only when everything holds', async () => {
    const head = 'd'.repeat(40);
    const failing = [];
    const refused = await run(['--yes'], fakeRun(answers(head), failing), { readTrees: async () => ({ main: path.join(dir, 'main-checkout'), worktrees: [] }) });
    expect(refused.code).toBe(1);
    expect(refused.err).toMatch(/refused: the gate has steps that did not pass: pro:hygiene-gitleaks \(fail-real\), public:build \(pending\)/);
    expect(failing.some((a) => a[0] === 'merge')).toBe(false);

    fs.writeFileSync(path.join(dir, 'gate.json'), JSON.stringify({ state: { ...GATE.state, head, steps: [{ key: 'pro:lint', status: 'pass' }] }, rows: GATE.rows, decisions: {} }));
    const calls = [];
    const okRun = fakeRun(answers(head, [[/^merge --no-ff/, { code: 0, stdout: 'Merge made', stderr: '' }]]), calls);
    // The main checkout answers the same fake: branch main.
    const wrapped = async (file, args, o) => (args[0] === 'rev-parse' && args[1] === '--abbrev-ref' && String(o?.cwd).endsWith('main-checkout') ? { code: 0, stdout: 'main', stderr: '' } : okRun(file, args, o));
    const done = await run(['--yes'], wrapped);
    expect(done.code).toBe(0);
    const merge = calls.find((a) => a[0] === 'merge');
    expect(merge.slice(0, 3)).toEqual(['merge', '--no-ff', '-F']);
    expect(merge[merge.length - 1]).toBe('feat/phase98-a-title');
    expect(done.text).toMatch(/merged feat\/phase98-a-title into main/);
  });

  it('refuses a bad phase flag and a detached HEAD', async () => {
    expect((await run(['--phase', 'x'], fakeRun([], []))).code).toBe(2);
    const detached = fakeRun([[/rev-parse --abbrev-ref HEAD/, 'HEAD'], [/^rev-parse HEAD$/, 'e'.repeat(40)]], []);
    expect((await run([], detached)).code).toBe(2);
  });
});
