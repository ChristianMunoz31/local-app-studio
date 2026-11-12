// ci:always-run
// @vitest-environment node
// `npm run gate` (scripts/ci/gate.js): the step list must mirror the ci.yml verify job, in the same order.
// This file reads ci.yml, so it is on the always-run list.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { REPO_ROOT } from '../../scripts/checks/gitFiles.js';
import {
  CI_ONLY_STEPS,
  GATE_STEPS,
  LINT_MAX_CHARS,
  LINT_MAX_FILES,
  decoratePlan,
  gitDiffAgainst,
  lintCommand,
  main as gateMain,
  maxWorkers,
  parseGateArgs,
  planGate,
  renderTable,
  runGate,
  stripCoverage,
} from '../../scripts/ci/gate.js';
import { unitReporterArgs } from '../../scripts/ci/runUnitTests.js';
import { PRIVATE_WORKFLOWS } from './helpers/workflowSet.js';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const f = (p, status = 'modified') => ({ path: p, status });
const BASE = 'c'.repeat(40);
const ALWAYS = ['server/__tests__/ciPipeline.test.js'];

/** The `- name:` lines of the verify job of ci.yml, in order. */
function verifySteps() {
  const ci = read('.github/workflows/ci.yml');
  const from = ci.indexOf('\n  verify:\n');
  const to = ci.indexOf('\n  visual-baselines:\n');
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return [...ci.slice(from, to).matchAll(/^ {6}- name: "?([^"\n]+)"?$/gm)].map((m) => m[1]);
}

const entry = (plan, id) => plan.entries.find((e) => e.id === id);

describe('GATE_STEPS against the ci.yml verify job', () => {
  // The suite body also runs when blocks are skipped (a public ci.yml has no visual-baselines job), so the read is guarded.
  const ciSteps = PRIVATE_WORKFLOWS ? verifySteps() : [];
  const gateCi = [...new Set(GATE_STEPS.map((s) => s.ciStep))];

  it.skipIf(!PRIVATE_WORKFLOWS)('every ciStep is a real step name of the verify job (pins the private ci.yml, which is not in a public export)', () => {
    for (const name of gateCi) expect(ciSteps, name).toContain(name);
  });

  it.skipIf(!PRIVATE_WORKFLOWS)('the ciStep names appear in the verify job in the same relative order (pins the private ci.yml, which is not in a public export)', () => {
    const positions = gateCi.map((name) => ciSteps.indexOf(name));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(new Set(positions).size).toBe(positions.length);
  });

  it.skipIf(!PRIVATE_WORKFLOWS)('every verify step has a gate step, except the CI only ones, and the CI only list holds no stale name (pins the private ci.yml, which is not in a public export)', () => {
    for (const name of ciSteps) {
      if (CI_ONLY_STEPS.includes(name)) continue;
      expect(gateCi, `ci.yml step "${name}" has no gate step: add one or list it in CI_ONLY_STEPS`).toContain(name);
    }
    for (const name of CI_ONLY_STEPS) expect(ciSteps, name).toContain(name);
  });

  it('the gate has the planned order: hygiene, lint, typecheck, unit tests, build, bundle, both sidecar budgets, cloud-off, e2e, public build', () => {
    expect(GATE_STEPS.map((s) => s.id)).toEqual([
      'hygiene: gitleaks',
      'hygiene: em dash',
      'hygiene: keys',
      'hygiene: personal data',
      'lint',
      'typecheck',
      'unit tests',
      'build',
      'bundle budget',
      'sidecar budget (studio)',
      'sidecar budget (runtime)',
      'cloud-off build',
      'e2e (Playwright)',
      'public build',
    ]);
  });

  it('has the runtime sidecar budget step, in runtime mode, after the studio one', () => {
    const runtime = GATE_STEPS.find((s) => s.id === 'sidecar budget (runtime)');
    expect(runtime.env).toEqual({ APP_MODE: 'runtime' });
    expect(runtime.run.flat().join(' ')).toContain('sidecarBudget.js --mode runtime');
    expect(GATE_STEPS.findIndex((s) => s === runtime)).toBeGreaterThan(GATE_STEPS.findIndex((s) => s.id === 'sidecar budget (studio)'));
  });

  it('the typecheck step runs scripts/ci/typecheck.js and the script exists', () => {
    expect(GATE_STEPS.find((s) => s.id === 'typecheck').run).toEqual([['scripts/ci/typecheck.js']]);
    expect(fs.existsSync(path.join(REPO_ROOT, 'scripts/ci/typecheck.js'))).toBe(true);
  });

  it('every script a step names exists, and steps run node directly (no npm wrapper)', () => {
    for (const step of GATE_STEPS) {
      for (const argv of step.run) {
        if (step.bin) continue;
        expect(argv[0], step.id).not.toMatch(/^npm|^npx/);
        if (!argv[0].includes('{TMP}')) expect(fs.existsSync(path.join(REPO_ROOT, argv[0])), `${step.id}: ${argv[0]}`).toBe(true);
      }
    }
  });

  it.skipIf(!PRIVATE_WORKFLOWS)('mirrors the CI commands of the budget and cloud steps (pins the private ci.yml, which is not in a public export)', () => {
    const ci = read('.github/workflows/ci.yml');
    const cloudOff = GATE_STEPS.find((s) => s.id === 'cloud-off build');
    expect(cloudOff.env).toEqual({ APP_CLOUD_AI: 'off' });
    expect(cloudOff.run.flat()).toContain('--require-absent');
    expect(ci).toContain('--require-absent');
    const studio = GATE_STEPS.find((s) => s.id === 'sidecar budget (studio)').run.flat().join(' ');
    expect(studio).toContain('--require-present --bundle .sidecar-build/server.cjs --dist-dir dist');
    expect(studio).toContain('sidecarBudget.js --mode studio');
  });

  it('e2e keeps visual out (Linux only) and the weekly and CI runs are the only places that add it', () => {
    const e2e = GATE_STEPS.find((s) => s.id === 'e2e (Playwright)').run.flat();
    expect(e2e).toEqual(expect.arrayContaining(['--project=flows', '--project=first-run', '--project=a11y']));
    expect(e2e).not.toContain('--project=visual');
  });

  it('package.json has the gate script', () => {
    expect(JSON.parse(read('package.json')).scripts.gate).toBe('node scripts/ci/gate.js');
  });
});

describe('maxWorkers and stripCoverage', () => {
  it('reads GATE_MAX_WORKERS (1 to 64) and has no default: vitest.config.js is the single source', () => {
    expect(maxWorkers({})).toBeNull();
    expect(maxWorkers({ GATE_MAX_WORKERS: '6' })).toBe(6);
    for (const bad of ['0', '-1', '65', '1.5', 'abc', '']) expect(maxWorkers({ GATE_MAX_WORKERS: bad }), bad).toBeNull();
  });

  it('removes only the coverage flags', () => {
    expect(stripCoverage(['run', '--changed', BASE, '--passWithNoTests', '--coverage.enabled', '--coverage.include=src/a.ts'])).toEqual(['run', '--changed', BASE, '--passWithNoTests']);
  });
});

describe('planGate (full)', () => {
  const plan = planGate({ quick: false, env: {}, hasBinary: () => true, tmp: '/tmp' });

  it('plans every step and runs the whole unit suite with the worker count', () => {
    expect(plan.mode).toBe('full');
    expect(plan.entries.every((e) => !e.skip)).toBe(true);
    expect(entry(plan, 'unit tests').commands).toEqual([['node_modules/vitest/vitest.mjs', 'run']]);
    expect(planGate({ env: { GATE_MAX_WORKERS: '2' }, hasBinary: () => true }).entries.find((e) => e.id === 'unit tests').commands[0]).toContain('--maxWorkers=2');
  });

  it('puts the cloud-off dist directory under the temp folder', () => {
    const dist = entry(plan, 'cloud-off build').commands[0];
    expect(dist).toContain('/tmp/las-gate-dist-cloud-off');
    expect(dist.join(' ')).not.toContain('{TMP}');
  });

  it('skips gitleaks when it is not installed, with a reason, and keeps it when it is', () => {
    const without = planGate({ hasBinary: () => false });
    expect(entry(without, 'hygiene: gitleaks').skip).toMatch(/not on PATH, CI runs it/);
    expect(entry(plan, 'hygiene: gitleaks').skip).toBeUndefined();
  });

  it('marks the heavy steps', () => {
    expect(plan.entries.filter((e) => e.heavy).map((e) => e.id)).toEqual(['unit tests', 'build', 'sidecar budget (studio)', 'sidecar budget (runtime)', 'cloud-off build', 'e2e (Playwright)', 'public build']);
  });
});

describe('planGate (quick) for fixture diffs', () => {
  const quick = (files) => planGate({ quick: true, env: {}, diff: { base: BASE, files }, hasBinary: () => true, alwaysRun: ALWAYS });
  const skipped = (plan) => plan.entries.filter((e) => e.skip).map((e) => e.id);

  it('a TypeScript-only change lints those files, type checks and runs only the affected tests without coverage flags', () => {
    const plan = quick([f('src/studio/lib/a.ts'), f('src/studio/lib/__tests__/a.test.ts'), f('docs/x.md')]);
    expect(plan.mode).toBe('quick');
    expect(entry(plan, 'lint').commands).toEqual([['node_modules/eslint/bin/eslint.js', '--no-warn-ignored', '--', 'src/studio/lib/a.ts', 'src/studio/lib/__tests__/a.test.ts']]);
    expect(entry(plan, 'typecheck').skip).toBeUndefined();
    expect(entry(plan, 'unit tests').commands).toEqual([
      ['node_modules/vitest/vitest.mjs', 'run', '--changed', BASE, '--passWithNoTests'],
      ['node_modules/vitest/vitest.mjs', 'run', ...ALWAYS],
    ]);
    expect(JSON.stringify(plan.entries)).not.toContain('--coverage');
  });

  it('quick skips everything after the unit tests', () => {
    const plan = quick([f('src/studio/lib/a.ts')]);
    expect(skipped(plan)).toEqual(['build', 'bundle budget', 'sidecar budget (studio)', 'sidecar budget (runtime)', 'cloud-off build', 'e2e (Playwright)', 'public build']);
    expect(entry(plan, 'build').skip).toBe('not part of --quick');
  });

  it('a docs-only change skips lint, typecheck and the unit tests (hygiene still runs)', () => {
    const plan = quick([f('docs/PIPELINE.md'), f('README.md')]);
    expect(skipped(plan)).toEqual(expect.arrayContaining(['lint', 'typecheck', 'unit tests']));
    expect(entry(plan, 'unit tests').skip).toBe('only docs or workspace files changed');
    expect(entry(plan, 'hygiene: em dash').skip).toBeUndefined();
    expect(plan.note).toContain('docs and workspace files only');
  });

  it('a workspace-only change is light as well', () => {
    const plan = quick([f('.env.example'), f('.vscode/settings.json')]);
    expect(skipped(plan)).toEqual(expect.arrayContaining(['lint', 'typecheck', 'unit tests']));
  });

  it('a .gitignore change is not light: lint, typecheck and unit tests are planned', () => {
    const plan = quick([f('.gitignore')]);
    expect(entry(plan, 'unit tests').skip).toBeUndefined();
    expect(entry(plan, 'typecheck').skip).toBeUndefined();
    expect(entry(plan, 'lint').skip).not.toBe('only docs or workspace files changed');
  });

  it('a scripts change runs the whole suite, not the changed mode', () => {
    const plan = quick([f('scripts/ci/gate.js')]);
    expect(entry(plan, 'unit tests').commands).toEqual([['node_modules/vitest/vitest.mjs', 'run']]);
    expect(entry(plan, 'lint').commands[0]).toEqual(['node_modules/eslint/bin/eslint.js', '--no-warn-ignored', '--', 'scripts/ci/gate.js']);
  });

  it('a change with no lintable files skips lint with a reason', () => {
    const plan = quick([f('src/styles/a.css')]);
    expect(entry(plan, 'lint').skip).toBe('no changed code files');
  });

  it('with no main to compare against, quick falls back to the whole plan', () => {
    const plan = planGate({ quick: true, env: {}, diff: null, hasBinary: () => true, alwaysRun: ALWAYS });
    expect(plan.note).toContain('no main found');
    expect(entry(plan, 'lint').commands).toEqual([['node_modules/eslint/bin/eslint.js', '.']]);
    expect(entry(plan, 'unit tests').commands).toEqual([['node_modules/vitest/vitest.mjs', 'run']]);
  });

  it('with no changes at all, only the always-run tests run', () => {
    const plan = quick([]);
    expect(entry(plan, 'unit tests').commands).toEqual([['node_modules/vitest/vitest.mjs', 'run', ...ALWAYS]]);
  });
});

describe('runGate', () => {
  const entries = (...rows) =>
    rows.map(([id, commands, extra = {}]) => ({ id, ciStep: id, heavy: false, env: {}, commands, ...extra }));
  const clock = () => {
    let t = 0;
    return () => {
      t += 1500;
      return t;
    };
  };

  it('runs steps in order, one at a time, and passes the step environment', async () => {
    const calls = [];
    let running = 0;
    let overlap = false;
    const runner = async (argv, env) => {
      running += 1;
      overlap ||= running > 1;
      calls.push([argv.join(' '), env]);
      await Promise.resolve();
      running -= 1;
      return { code: 0, peakMB: 120 };
    };
    const { results, exitCode } = await runGate({ entries: entries(['a', [['x.js'], ['y.js']]], ['b', [['z.js']], { env: { APP_MODE: 'runtime' } }]), runner, now: clock() });
    expect(exitCode).toBe(0);
    expect(overlap).toBe(false);
    expect(calls).toEqual([['x.js', {}], ['y.js', {}], ['z.js', { APP_MODE: 'runtime' }]]);
    expect(results.map((r) => r.status)).toEqual(['passed', 'passed']);
    expect(results[0]).toMatchObject({ seconds: 1.5, peakMB: 120 });
  });

  it('stops at the first failure, returns its exit code and marks the rest not run', async () => {
    const seen = [];
    const runner = async (argv) => {
      seen.push(argv[0]);
      return { code: argv[0] === 'b.js' ? 3 : 0, peakMB: 10 };
    };
    const { results, exitCode } = await runGate({ entries: entries(['a', [['a.js']]], ['b', [['b.js'], ['b2.js']]], ['c', [['c.js']]], ['d', [['d.js']]]), runner, now: clock() });
    expect(seen).toEqual(['a.js', 'b.js']);
    expect(exitCode).toBe(3);
    expect(results.map((r) => [r.id, r.status])).toEqual([['a', 'passed'], ['b', 'FAILED'], ['c', 'not run'], ['d', 'not run']]);
  });

  it('a failure without an exit code (signal) is exit code 1', async () => {
    const { exitCode, results } = await runGate({ entries: entries(['a', [['a.js']]]), runner: async () => ({ code: null, peakMB: 0 }), now: clock() });
    expect(exitCode).toBe(1);
    expect(results[0].status).toBe('FAILED');
  });

  it('skipped steps are reported, never run, and do not stop the gate; a failure after them still marks later steps not run', async () => {
    const seen = [];
    const runner = async (argv) => {
      seen.push(argv[0]);
      return { code: argv[0] === 'c.js' ? 1 : 0, peakMB: 0 };
    };
    const rows = entries(['a', [], { skip: 'not here' }], ['b', [['b.js']]], ['c', [['c.js']]], ['d', [], { skip: 'later' }], ['e', [['e.js']]]);
    const { results } = await runGate({ entries: rows, runner, now: clock() });
    expect(seen).toEqual(['b.js', 'c.js']);
    expect(results.map((r) => r.status)).toEqual(['skipped', 'passed', 'FAILED', 'skipped', 'not run']);
    expect(results[0].reason).toBe('not here');
  });

  it('runs an external program as the binary itself', async () => {
    const flags = [];
    await runGate({ entries: entries(['g', [['gitleaks', 'git']], { bin: 'gitleaks' }], ['n', [['n.js']]]), runner: async (argv, env, isBin) => (flags.push(isBin), { code: 0, peakMB: 0 }), now: clock() });
    expect(flags).toEqual([true, false]);
  });
});

describe('renderTable', () => {
  it('renders step, status, seconds and peak MB, with dashes where a step did not run', () => {
    const table = renderTable([
      { id: 'lint', status: 'passed', seconds: 12.3, peakMB: 410 },
      { id: 'unit tests', status: 'FAILED', seconds: 100, peakMB: null },
      { id: 'build', status: 'not run', seconds: 0, peakMB: null },
      { id: 'hygiene: gitleaks', status: 'skipped', seconds: 0, peakMB: null },
    ]);
    expect(table.split('\n')).toEqual([
      '| step | status | seconds | peak MB |',
      '| --- | --- | --- | --- |',
      '| lint | passed | 12.3 | 410 |',
      '| unit tests | FAILED | 100.0 | - |',
      '| build | not run | - | - |',
      '| hygiene: gitleaks | skipped | - | - |',
    ]);
  });
});

describe('parseGateArgs', () => {
  it('reads --quick, --dry-run and --json <file>', () => {
    const defaults = { quick: false, dryRun: false, json: undefined, base: undefined, head: undefined, repair: false, protectedGate: false, classify: true };
    expect(parseGateArgs(['--quick', '--json', 'out.json'])).toEqual({ ...defaults, quick: true, json: 'out.json' });
    expect(parseGateArgs(['--dry-run'])).toEqual({ ...defaults, dryRun: true });
    expect(parseGateArgs([])).toEqual(defaults);
  });

  it('reads --repair, --protected and --no-classify', () => {
    expect(parseGateArgs(['--quick', '--repair'])).toMatchObject({ quick: true, repair: true, protectedGate: false, classify: true });
    expect(parseGateArgs(['--protected', '--no-classify'])).toMatchObject({ repair: false, protectedGate: true, classify: false });
  });

  it('reads --base <sha>', () => {
    expect(parseGateArgs(['--quick', '--base', 'a'.repeat(40)])).toMatchObject({ quick: true, base: 'a'.repeat(40) });
  });
});

describe('gitDiffAgainst (injected git runner)', () => {
  const ORIGIN = 'a'.repeat(40);
  const LOCAL = 'b'.repeat(40);
  const REMOTE = 'd'.repeat(40);
  /** A fake git: `mergeBases` maps a ref to its merge-base answer (a missing ref throws, like git does). */
  const fakeGit = (mergeBases, diffOut = 'M\0src/a.js\0') => {
    const calls = [];
    const git = (args) => {
      calls.push(args);
      if (args[0] === 'merge-base') {
        const out = mergeBases[args[2]];
        if (out === undefined) throw new Error('unknown ref');
        return `${out}\n`;
      }
      return diffOut;
    };
    return { git, calls };
  };

  it('on main with unpushed commits the plan is not empty (origin/main is preferred over local main)', () => {
    // HEAD is main, so merge-base HEAD main is HEAD and the diff would be empty; origin/main is behind HEAD.
    const { git, calls } = fakeGit({ main: LOCAL, 'origin/main': ORIGIN });
    const diff = gitDiffAgainst({ git });
    expect(diff).toEqual({ base: ORIGIN, files: [{ path: 'src/a.js', status: 'modified' }] });
    expect(calls.some((a) => a[0] === 'merge-base' && a[2] === 'main')).toBe(false);
    const plan = planGate({ quick: true, env: {}, diff, hasBinary: () => true, alwaysRun: ALWAYS });
    expect(entry(plan, 'unit tests').skip).toBeUndefined();
    expect(entry(plan, 'lint').commands).toEqual([['node_modules/eslint/bin/eslint.js', '--no-warn-ignored', '--', 'src/a.js']]);
  });

  it('--base wins: the merge base with the remote sha is the diff base', () => {
    const { git, calls } = fakeGit({ [REMOTE]: REMOTE, 'origin/main': ORIGIN });
    expect(gitDiffAgainst({ base: REMOTE, git }).base).toBe(REMOTE);
    expect(calls[0]).toEqual(['merge-base', 'HEAD', REMOTE]);
    expect(calls[1]).toEqual(['diff', '--name-status', '-z', '-M', REMOTE, 'HEAD']);
  });

  it('falls back to origin/main, then main, when the base sha is unknown locally', () => {
    expect(gitDiffAgainst({ base: REMOTE, git: fakeGit({ 'origin/main': ORIGIN }).git }).base).toBe(ORIGIN);
    expect(gitDiffAgainst({ base: REMOTE, git: fakeGit({ main: LOCAL }).git }).base).toBe(LOCAL);
  });

  it('is null when no ref exists, and ignores an answer that is not 40 hex', () => {
    expect(gitDiffAgainst({ git: fakeGit({}).git })).toBeNull();
    expect(gitDiffAgainst({ git: fakeGit({ 'origin/main': 'not-a-sha' }).git })).toBeNull();
  });
});

describe('gitDiffAgainst with a head', () => {
  const PUSHED = 'e'.repeat(40);
  const REMOTE = 'd'.repeat(40);

  it('uses the pushed sha, not HEAD, for the merge base and the diff', () => {
    const calls = [];
    const git = (args) => {
      calls.push(args);
      return args[0] === 'merge-base' ? `${REMOTE}\n` : 'M\0src/a.js\0';
    };
    expect(gitDiffAgainst({ base: REMOTE, head: PUSHED, git }).base).toBe(REMOTE);
    expect(calls[0]).toEqual(['merge-base', PUSHED, REMOTE]);
    expect(calls[1]).toEqual(['diff', '--name-status', '-z', '-M', REMOTE, PUSHED]);
  });
});

describe('gate main option values', () => {
  it('refuses a --head that is not 40 hex, and a --base or --head with no value or followed by an option', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const argv of [
      ['--quick', '--dry-run', '--head', 'main'],
      ['--quick', '--dry-run', '--head'],
      ['--quick', '--dry-run', '--head', '--quick'],
      ['--quick', '--dry-run', '--base'],
      ['--quick', '--base', '--dry-run'],
    ]) {
      expect(await gateMain(argv, {}), argv.join(' ')).toBe(2);
    }
    expect(err).toHaveBeenCalledWith('--head needs a commit sha (40 hex characters)');
    expect(err).toHaveBeenCalledWith('--base needs a commit sha (40 hex characters)');
    err.mockRestore();
  });

  it('parseGateArgs reads --head <sha>', () => {
    expect(parseGateArgs(['--head', 'a'.repeat(40)])).toMatchObject({ head: 'a'.repeat(40) });
  });
});

describe('gate main --base', () => {
  it('refuses a --base that is not 40 hex, before running git', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const bad of ['main', 'abc123', 'g'.repeat(40), '']) {
      expect(await gateMain(['--quick', '--dry-run', '--base', bad], {}), bad).toBe(2);
    }
    expect(err).toHaveBeenCalledWith('--base needs a commit sha (40 hex characters)');
    err.mockRestore();
  });
});

describe('lintCommand', () => {
  const lintBin = 'node_modules/eslint/bin/eslint.js';

  it('puts -- before the targets, so a path that starts with - is a file', () => {
    expect(lintCommand(['-x.js', 'src/a.js'])).toEqual([lintBin, '--no-warn-ignored', '--', '-x.js', 'src/a.js']);
  });

  it('keeps the list at 200 files and falls back to eslint . above', () => {
    const files = (n) => Array.from({ length: n }, (_, i) => `s/${i}.js`);
    expect(lintCommand(files(LINT_MAX_FILES))).toContain('--');
    expect(lintCommand(files(LINT_MAX_FILES + 1))).toEqual([lintBin, '.']);
  });

  it('falls back to eslint . above about 24000 characters, with a few long paths', () => {
    const long = (i) => `src/${String(i).padStart(2, '0')}${'x'.repeat(2000)}.js`;
    expect(lintCommand(Array.from({ length: 10 }, (_, i) => long(i)))).toContain('--');
    expect(lintCommand(Array.from({ length: 12 }, (_, i) => long(i)))).toEqual([lintBin, '.']);
    expect(LINT_MAX_CHARS).toBe(24000);
  });

  it('the quick plan uses the fallback for a long change list and -- for a leading-dash name', () => {
    const many = Array.from({ length: LINT_MAX_FILES + 5 }, (_, i) => f(`src/m${i}.js`));
    const big = planGate({ quick: true, env: {}, diff: { base: BASE, files: many }, hasBinary: () => true, alwaysRun: ALWAYS });
    expect(entry(big, 'lint').commands).toEqual([[lintBin, '.']]);
    const dash = planGate({ quick: true, env: {}, diff: { base: BASE, files: [f('-rf.js')] }, hasBinary: () => true, alwaysRun: ALWAYS });
    expect(entry(dash, 'lint').commands).toEqual([[lintBin, '--no-warn-ignored', '--', '-rf.js']]);
  });
});

describe('classification wiring (phase 15)', () => {
  const full = () => planGate({ quick: false, env: {}, diff: null, hasBinary: () => true, alwaysRun: [] });
  const entry = (plan, id) => plan.entries.find((e) => e.id === id);

  it('decoratePlan gives the unit step the same reporter flags CI uses, one report file per vitest run', () => {
    const quick = planGate({ quick: true, env: {}, diff: { base: BASE, files: [f('src/a.js')] }, hasBinary: () => true, alwaysRun: ALWAYS });
    const unit = entry(decoratePlan(quick), 'unit tests');
    expect(unit.classify).toBe('unit');
    unit.commands.forEach((c, i) => expect(c.slice(-4)).toEqual(unitReporterArgs(`.gate/run/unit-${i + 1}.json`)));
    expect(unit.commands.length).toBeGreaterThan(1);
  });

  it('decoratePlan makes e2e write a JSON report with GATE_CLASSIFY, and the budget scripts write --json files', () => {
    const plan = decoratePlan(full());
    const e2e = entry(plan, 'e2e (Playwright)');
    expect(e2e.classify).toBe('e2e');
    expect(e2e.env).toMatchObject({ PLAYWRIGHT_JSON_OUTPUT_NAME: '.gate/run/e2e.json', GATE_CLASSIFY: '1' });
    expect(e2e.commands[0].at(-1)).toBe('--reporter=list,json,./e2e/support/previewStartReporter.js');
    expect(entry(plan, 'bundle budget').commands[0].slice(-2)).toEqual(['--json', '.gate/run/bundle.json']);
    expect(entry(plan, 'sidecar budget (studio)').commands[1].slice(-2)).toEqual(['--json', '.gate/run/sidecar-studio.json']);
    expect(entry(plan, 'sidecar budget (studio)').commands[0]).not.toContain('--json');
    expect(entry(plan, 'sidecar budget (runtime)').commands[1].slice(-2)).toEqual(['--json', '.gate/run/sidecar-runtime.json']);
    expect(entry(plan, 'cloud-off build').commands.flat()).not.toContain('--json');
  });

  it('--no-classify leaves the test steps alone', () => {
    const plan = decoratePlan(full(), { classify: false });
    expect(entry(plan, 'unit tests').classify).toBeUndefined();
    expect(entry(plan, 'unit tests').commands[0]).toEqual(['node_modules/vitest/vitest.mjs', 'run']);
    expect(entry(plan, 'e2e (Playwright)').classify).toBeUndefined();
  });

  it('budget builds never get --sourcemap (source maps are for the Dev build only)', () => {
    for (const e of decoratePlan(full()).entries) for (const c of e.commands) expect(c).not.toContain('--sourcemap');
  });

  const classifier = (afterExit, report) => ({
    calls: [],
    async afterCommand(n, code) {
      this.calls.push([n, code]);
      return afterExit(n, code);
    },
    finish: () => report,
  });
  const report = (quarantinedFailures = 0) => ({ counts: { quarantinedFailures } });
  const rows = (...commands) => [{ id: 'unit tests', ciStep: 'unit tests', heavy: false, env: {}, commands, classify: 'unit' }];

  it('runGate asks the classifier after every command and obeys its exit code', async () => {
    const c = classifier((n, code) => (n === 1 ? 0 : code), report(2));
    const runner = async (argv) => ({ code: argv[0] === 'a.js' ? 1 : 0, peakMB: 10 });
    const { results, exitCode, reports } = await runGate({ entries: rows(['a.js'], ['b.js']), runner, classifiers: { unit: c } });
    expect(c.calls).toEqual([[1, 1], [2, 0]]);
    expect(exitCode).toBe(0);
    expect(results[0].status).toBe('passed (quarantined failures)');
    expect(reports.unit.counts.quarantinedFailures).toBe(2);
  });

  it('a real failure still fails the step and stops the gate', async () => {
    const c = classifier((n, code) => code, report(0));
    const { results, exitCode } = await runGate({
      entries: [...rows(['a.js']), { id: 'next', ciStep: 'next', heavy: false, env: {}, commands: [['n.js']] }],
      runner: async () => ({ code: 3 }),
      classifiers: { unit: c },
    });
    expect(exitCode).toBe(3);
    expect(results.map((r) => r.status)).toEqual(['FAILED', 'not run']);
  });

  it('renderTable counts "passed (quarantined failures)" as a step that ran', () => {
    expect(renderTable([{ id: 'unit tests', status: 'passed (quarantined failures)', seconds: 2, peakMB: 5 }])).toContain('| unit tests | passed (quarantined failures) | 2.0 | 5 |');
  });

  it('CI plumbing steps of the gate are in CI_ONLY_STEPS', () => {
    for (const name of ['gate state (restore)', 'gate ledger', 'Upload gate state']) expect(CI_ONLY_STEPS).toContain(name);
  });

  it('--repair exits 2 in CI before anything runs', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await gateMain(['--quick', '--repair'], { CI: 'true' })).toBe(2);
    expect(err).toHaveBeenCalledWith('--repair never runs in CI: CI does not write to the branch.');
    err.mockRestore();
  });
});
