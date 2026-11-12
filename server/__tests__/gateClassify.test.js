// Classification of failed tests (scripts/ci/gateClassify.js, DESIGN-phase15 section 2.4): parsing both reporters, the exact
// rerun commands, the first stack frame outside node_modules, the caps, and a missing report counting as real.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  E2E_RERUN_CAP,
  TOO_MANY,
  UNIT_RERUN_CAP,
  createClassifier,
  e2eRerunSpec,
  isSerialSpec,
  escapeRegex,
  failureDetails,
  jsonPathFor,
  parsePlaywrightJson,
  parseVitestJson,
  prepareState,
  readOutcome,
  repoRelative,
  testKey,
  unitRerunSpec,
  unitTestPattern,
} from '../../scripts/ci/gateClassify.js';
import { emptyState } from '../../scripts/ci/gateState.js';

const ROOT = '/repo';
const T0 = Date.parse('2026-11-04T10:12:00.000Z');

const vitestJson = (tests, { abs = false } = {}) => ({
  numTotalTests: tests.length,
  numPassedTests: tests.filter((t) => t.status === 'passed').length,
  numFailedTests: tests.filter((t) => t.status === 'failed').length,
  numPendingTests: 0,
  numTodoTests: 0,
  testResults: [
    {
      name: `${abs ? `${ROOT}/` : ''}src/a.test.js`,
      status: tests.some((t) => t.status === 'failed') ? 'failed' : 'passed',
      assertionResults: tests.map((t) => ({ fullName: t.name, ...(t.path ? { ancestorTitles: t.path.slice(0, -1), title: t.path.at(-1) } : {}), status: t.status, failureMessages: t.msg ? [t.msg] : [] })),
    },
  ],
});
const frame = `AssertionError: expected 1 to be 2\n    at node_modules/vitest/dist/x.js:1:1\n    at Object.<anonymous> (src/a.test.js:12:5)\n    at node:internal/process:3:3`;

const temps = [];
const tmpRoot = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-classify-'));
  temps.push(dir);
  return dir;
};
afterEach(() => {
  for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('parsing', () => {
  it('reads a Vitest report: counts, passed keys and failures with their full title', () => {
    const r = parseVitestJson(vitestJson([{ name: 'A one', status: 'passed' }, { name: 'A two', status: 'failed', msg: frame }], { abs: true }), ROOT);
    expect(r.counts).toMatchObject({ files: 1, total: 2, passed: 1, failed: 1 });
    expect(r.passed).toEqual(['unit|src/a.test.js|A one']);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toMatchObject({ key: 'unit|src/a.test.js|A two', file: 'src/a.test.js', fullName: 'A two', loadFailure: false });
  });

  it('keeps the describe titles apart from the test title, so a rerun can build the pattern Vitest matches', () => {
    const r = parseVitestJson(vitestJson([{ name: 'A B x', path: ['A', 'B', 'x'], status: 'failed', msg: frame }]), ROOT);
    expect(r.failures[0]).toMatchObject({ key: 'unit|src/a.test.js|A B x', fullName: 'A B x', names: ['A', 'B', 'x'] });
  });

  it('a file that failed without a failed test is a load failure', () => {
    const json = { testResults: [{ name: `${ROOT}/src/b.test.js`, status: 'failed', message: 'Cannot find module', assertionResults: [] }] };
    const r = parseVitestJson(json, ROOT);
    expect(r.failures[0]).toMatchObject({ file: 'src/b.test.js', loadFailure: true, message: 'Cannot find module' });
  });

  it('reads a Playwright report: the describe titles and the test title make the title path, the project is part of the key', () => {
    const json = {
      stats: { expected: 1, unexpected: 1, flaky: 0, skipped: 0 },
      suites: [
        {
          title: 'flows/a.spec.js',
          file: 'flows/a.spec.js',
          specs: [{ title: 'top level', file: 'flows/a.spec.js', tests: [{ projectName: 'flows', status: 'expected', results: [{ status: 'passed' }] }] }],
          suites: [
            {
              title: 'Group',
              specs: [
                {
                  title: 'does x',
                  file: 'flows/a.spec.js',
                  tests: [{ projectName: 'flows', status: 'unexpected', results: [{ status: 'failed', error: { message: 'boom', stack: `at x (${ROOT}/e2e/flows/a.spec.js:10:5)` } }] }],
                },
              ],
            },
          ],
        },
      ],
    };
    const r = parsePlaywrightJson(json, ROOT);
    expect(r.passed).toEqual(['e2e|e2e/flows/a.spec.js|[flows] top level']);
    expect(r.failures[0]).toMatchObject({ key: 'e2e|e2e/flows/a.spec.js|[flows] Group does x', file: 'e2e/flows/a.spec.js', project: 'flows', fullName: 'Group does x' });
    expect(r.counts).toMatchObject({ total: 2, passed: 1, failed: 1 });
  });

  it('keys, repo relative paths and the report path', () => {
    expect(testKey('unit', 'a.js', 'T')).toBe('unit|a.js|T');
    expect(testKey('e2e', 'e2e/a.spec.js', 'T', 'flows')).toBe('e2e|e2e/a.spec.js|[flows] T');
    expect(repoRelative('C:\\work\\repo\\src\\a.js', 'C:/work/repo')).toBe('src/a.js');
    expect(jsonPathFor('unit', 2)).toBe('.gate/run/unit-2.json');
    expect(jsonPathFor('e2e')).toBe('.gate/run/e2e.json');
  });
});

describe('failureDetails', () => {
  it('names the first line and the first stack frame outside node_modules and node:internal, repo relative', () => {
    expect(failureDetails(frame, ROOT)).toEqual({ assertion: 'AssertionError: expected 1 to be 2', where: 'src/a.test.js:12:5' });
  });

  it('cuts a long assertion to 300 characters and redacts secrets', () => {
    const long = `${'x'.repeat(400)}`;
    expect(failureDetails(long, ROOT).assertion).toHaveLength(300);
    const secret = failureDetails('failed with Bearer abcdefghijklmnopqrstuvwxyz0123456789', ROOT).assertion;
    expect(secret).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789');
  });

  it('has no location when every frame is in node_modules', () => {
    expect(failureDetails('boom\n    at node_modules/x/y.js:1:2', ROOT).where).toBeNull();
    expect(failureDetails('', ROOT)).toEqual({ assertion: '', where: null });
  });
});

describe('rerun commands', () => {
  it('escapes a title for a regular expression', () => {
    expect(escapeRegex('a.b (c) [d] $e')).toBe('a\\.b \\(c\\) \\[d\\] \\$e');
  });

  it('reruns one unit test alone: same file, one worker, exact name, its own report', () => {
    const spec = unitRerunSpec({ file: 'src/a.test.js', fullName: 'A (does) it' }, 3);
    expect(spec.argv).toEqual(['node_modules/vitest/vitest.mjs', 'run', 'src/a.test.js', '--maxWorkers=1', '--testNamePattern', '^A \\(does\\) it$', '--reporter=json', '--outputFile.json=.gate/run/unit-rerun-3.json']);
    expect(spec.jsonFile).toBe('.gate/run/unit-rerun-3.json');
  });

  it('matches a nested test with the " > " path Vitest uses, not the space joined name', () => {
    expect(unitTestPattern({ fullName: 'A B (x)', names: ['A', 'B', '(x)'] })).toBe('^A > B > \\(x\\)$');
    expect(unitTestPattern({ fullName: 'top level' })).toBe('^top level$');
    const spec = unitRerunSpec({ file: 'src/a.test.js', fullName: 'A B x', names: ['A', 'B', 'x'] }, 1);
    expect(spec.argv).toContain('^A > B > x$');
  });

  it('a real Vitest run of a nested describe: the rerun pattern selects exactly one test and it passes the second time', () => {
    const dir = tmpRoot();
    fs.writeFileSync(
      path.join(dir, 'nested.test.js'),
      [
        "import fs from 'node:fs';",
        "import path from 'node:path';",
        "const marker = path.join(import.meta.dirname, 'second-run');",
        "describe('Outer', () => {",
        "  describe('Inner', () => {",
        "    it('flaky (one)', () => {",
        "      if (!fs.existsSync(marker)) throw new Error('first run fails');",
        '    });',
        "    it('flaky (two)', () => {});",
        '  });',
        "  it('flaky (one)', () => {});",
        '});',
        "it('flaky (one)', () => {});",
        '',
      ].join('\n'),
    );
    const bin = path.join(process.cwd(), 'node_modules/vitest/vitest.mjs');
    const run = (extra, out) => {
      const res = spawnSync(process.execPath, [bin, 'run', 'nested.test.js', '--root', dir, '--globals', '--reporter=json', `--outputFile.json=${out}`, ...extra], { cwd: dir, encoding: 'utf8', env: { ...process.env, VITEST_MAX_WORKERS: '1' } });
      return { status: res.status, json: JSON.parse(fs.readFileSync(out, 'utf8')) };
    };
    const first = run([], path.join(dir, 'first.json'));
    expect(first.status).not.toBe(0);
    const parsed = parseVitestJson(first.json, dir);
    expect(parsed.failures).toHaveLength(1);
    expect(parsed.failures[0].names).toEqual(['Outer', 'Inner', 'flaky (one)']);
    fs.writeFileSync(path.join(dir, 'second-run'), '');
    const spec = unitRerunSpec(parsed.failures[0], 1);
    const pattern = spec.argv[spec.argv.indexOf('--testNamePattern') + 1];
    const second = run(['--testNamePattern', pattern], path.join(dir, 'second.json'));
    const again = parseVitestJson(second.json, dir);
    expect(again.counts.passed).toBe(1);
    expect(again.passed).toEqual([parsed.failures[0].key]);
    expect(second.status).toBe(0);
  }, 60_000);

  it('reruns one e2e test alone: its project, one worker, no retries, anchored title', () => {
    const spec = e2eRerunSpec({ file: 'e2e/flows/a.spec.js', project: 'flows', fullName: 'Group does x' }, 1);
    expect(spec.argv).toEqual(['node_modules/@playwright/test/cli.js', 'test', 'e2e/flows/a.spec.js', '--project=flows', '--workers=1', '--retries=0', '--grep', 'Group does x$', '--reporter=json']);
    expect(spec.env).toEqual({ PLAYWRIGHT_JSON_OUTPUT_NAME: '.gate/run/e2e-rerun-1.json', GATE_CLASSIFY: '1' });
  });

  it('reruns the whole file for a test in a serial spec, since its earlier tests make what it needs', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-serial-'));
    try {
      fs.mkdirSync(path.join(root, 'e2e/flows'), { recursive: true });
      fs.writeFileSync(path.join(root, 'e2e/flows/serial.spec.js'), "test.describe.configure({ mode: 'serial' });\ntest('a', () => {});\n");
      fs.writeFileSync(path.join(root, 'e2e/flows/plain.spec.js'), "test('a', () => {});\n");
      expect(isSerialSpec('e2e/flows/serial.spec.js', root)).toBe(true);
      expect(isSerialSpec('e2e/flows/plain.spec.js', root)).toBe(false);
      expect(isSerialSpec('e2e/flows/missing.spec.js', root)).toBe(false);
      const spec = e2eRerunSpec({ file: 'e2e/flows/serial.spec.js', project: 'flows', fullName: 'Group does x' }, 2, '.gate/run', root);
      expect(spec.argv).toEqual(['node_modules/@playwright/test/cli.js', 'test', 'e2e/flows/serial.spec.js', '--project=flows', '--workers=1', '--retries=0', '--reporter=json']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('createClassifier', () => {
  const setup = (reports, { kind = 'unit', protectedGate = false, rerun } = {}) => {
    const root = tmpRoot();
    const state = emptyState();
    const holder = { state };
    const writeReport = (n, json) => {
      fs.mkdirSync(path.join(root, '.gate/run'), { recursive: true });
      fs.writeFileSync(path.join(root, jsonPathFor(kind, n)), JSON.stringify(json));
    };
    reports.forEach((json, i) => json && writeReport(i + 1, json));
    const reruns = [];
    const c = createClassifier({
      kind,
      holder,
      runId: 'run-1',
      protectedGate,
      root,
      now: () => T0,
      stateFile: path.join(root, '.gate/flaky.json'),
      rerun: (spec) => {
        reruns.push(spec);
        return rerun ? rerun(spec) : null;
      },
    });
    return { c, root, holder, reruns };
  };
  const passes = (name) => vitestJson([{ name, status: 'passed' }]);

  it('a pass in a sibling file with a similar name does not make a failure flaky (the key names the file)', async () => {
    const failing = vitestJson([{ name: 'A one', status: 'failed', msg: frame }]);
    const sibling = { ...vitestJson([{ name: 'A one', status: 'passed' }]), testResults: [{ name: 'src/a.test.jsx', status: 'passed', assertionResults: [{ fullName: 'A one', status: 'passed', failureMessages: [] }] }] };
    const { c } = setup([failing], { rerun: () => sibling });
    expect(await c.afterCommand(1, 1)).toBe(1);
    expect(c.finish().real).toHaveLength(1);
  });

  it('a failure that passes when run alone is flaky and still fails the step the first time', async () => {
    const { c, reruns, root } = setup([vitestJson([{ name: 'A flaky one', status: 'failed', msg: frame }])], { rerun: () => passes('A flaky one') });
    expect(await c.afterCommand(1, 1)).toBe(1);
    expect(reruns).toHaveLength(1);
    const report = c.finish();
    expect(report.flaky).toHaveLength(1);
    expect(report.real).toEqual([]);
    expect(report.failing).toEqual(['unit|src/a.test.js|A flaky one']);
    expect(readOutcome('unit', root).flaky).toHaveLength(1);
  });

  it('flaky in a second run in a row is quarantined, so the step passes', async () => {
    const first = setup([vitestJson([{ name: 'A flaky one', status: 'failed', msg: frame }])], { rerun: () => passes('A flaky one') });
    await first.c.afterCommand(1, 1);
    first.c.finish();
    const second = setup([vitestJson([{ name: 'A flaky one', status: 'failed', msg: frame }])], { rerun: () => passes('A flaky one') });
    second.holder.state = first.holder.state;
    expect(await second.c.afterCommand(1, 1)).toBe(0);
    const report = second.c.finish();
    expect(report.newlyQuarantined).toEqual(['unit|src/a.test.js|A flaky one']);
    expect(report.counts.quarantinedFailures).toBe(1);
  });

  it('a failure that fails again names the test, the assertion and the first frame', async () => {
    const failing = vitestJson([{ name: 'A real one', status: 'failed', msg: frame }]);
    const { c } = setup([failing], { rerun: () => failing });
    expect(await c.afterCommand(1, 1)).toBe(1);
    const report = c.finish();
    expect(report.real[0]).toMatchObject({ title: 'A real one', assertion: 'AssertionError: expected 1 to be 2', where: 'src/a.test.js:12:5', reason: 'failed twice', outcome: 'fail' });
  });

  it('a rerun with no report is a real failure', async () => {
    const { c } = setup([vitestJson([{ name: 'A real one', status: 'failed', msg: frame }])], { rerun: () => null });
    await c.afterCommand(1, 1);
    expect(c.finish().real[0].reason).toBe('no report from the second run');
  });

  it('a file that did not load is real and is not rerun', async () => {
    const json = { testResults: [{ name: 'src/b.test.js', status: 'failed', message: 'Cannot find module x', assertionResults: [] }] };
    const { c, reruns } = setup([json]);
    expect(await c.afterCommand(1, 1)).toBe(1);
    expect(reruns).toHaveLength(0);
    expect(c.finish().real[0]).toMatchObject({ reason: 'file did not run', file: 'src/b.test.js' });
  });

  it('above the cap every failure is real and nothing is rerun', async () => {
    expect([UNIT_RERUN_CAP, E2E_RERUN_CAP]).toEqual([10, 5]);
    const tests = Array.from({ length: UNIT_RERUN_CAP + 1 }, (_, i) => ({ name: `T${i}`, status: 'failed', msg: frame }));
    const { c, reruns } = setup([vitestJson(tests)], { rerun: () => passes('x') });
    expect(await c.afterCommand(1, 1)).toBe(1);
    expect(reruns).toHaveLength(0);
    const report = c.finish();
    expect(report.tooMany).toBe(true);
    expect(report.real).toHaveLength(UNIT_RERUN_CAP + 1);
    expect(TOO_MANY).toMatch(/Too many tests failed/);
  });

  it('a missing report with a failing exit code is real: nothing is forgiven', async () => {
    const { c } = setup([null]);
    expect(await c.afterCommand(1, 7)).toBe(7);
    expect(c.finish().unexplained).toBe(true);
  });

  it('a clean run returns 0 and removes tests that were flaky before', async () => {
    const { c, holder } = setup([passes('A flaky one')]);
    holder.state = {
      ...emptyState(),
      tests: { 'unit|src/a.test.js|A flaky one': { kind: 'unit', file: 'src/a.test.js', title: 'A flaky one', project: null, flakyStreak: 1, failStreak: 0, lastOutcome: 'flaky', lastRunId: 'r', lastRunAt: 'x', history: [], quarantine: null } },
    };
    expect(await c.afterCommand(1, 0)).toBe(0);
    c.finish();
    expect(holder.state.tests).toEqual({});
  });

  it('on a protected gate flaky twice never quarantines, and the state is not written', async () => {
    const run = (holder) => {
      const s = setup([vitestJson([{ name: 'A flaky one', status: 'failed', msg: frame }])], { protectedGate: true, rerun: () => passes('A flaky one') });
      if (holder) s.holder.state = holder.state;
      return s;
    };
    const one = run();
    expect(await one.c.afterCommand(1, 1)).toBe(1);
    one.c.finish();
    const two = run(one.holder);
    expect(await two.c.afterCommand(1, 1)).toBe(1);
    expect(two.c.finish().newlyQuarantined).toEqual([]);
    expect(fs.existsSync(path.join(one.root, '.gate/flaky.json'))).toBe(false);
  });

  it('works for e2e: the rerun reads a Playwright report', async () => {
    const failJson = {
      stats: { expected: 0, unexpected: 1, flaky: 0, skipped: 0 },
      suites: [{ title: 'flows/a.spec.js', specs: [{ title: 'does x', file: 'flows/a.spec.js', tests: [{ projectName: 'flows', status: 'unexpected', results: [{ status: 'failed', error: { message: 'boom' } }] }] }], suites: [] }],
    };
    const okJson = JSON.parse(JSON.stringify(failJson));
    okJson.suites[0].specs[0].tests[0] = { projectName: 'flows', status: 'expected', results: [{ status: 'passed' }] };
    const { c } = setup([failJson], { kind: 'e2e', rerun: () => okJson });
    expect(await c.afterCommand(1, 1)).toBe(1);
    expect(c.finish().flaky[0]).toMatchObject({ kind: 'e2e', project: 'flows', file: 'e2e/flows/a.spec.js' });
  });
});

describe('prepareState', () => {
  it('drops ended quarantines and writes the state back, except on a protected gate', () => {
    const root = tmpRoot();
    const file = path.join(root, 'flaky.json');
    const entry = { kind: 'unit', file: 'a', title: 't', project: null, flakyStreak: 2, failStreak: 0, lastOutcome: 'flaky', lastRunId: 'r', lastRunAt: '2026-10-25T00:00:00.000Z', history: [], quarantine: { since: '2026-10-25T00:00:00.000Z', until: '2026-11-01T00:00:00.000Z', runId: 'r', reason: 'x' } };
    fs.writeFileSync(file, JSON.stringify({ version: 1, updatedAt: null, tests: { 'unit|a|t': entry } }));
    const protectedRun = prepareState({ stateFile: file, now: T0, protectedGate: true });
    expect(protectedRun.expired).toEqual(['unit|a|t']);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).tests['unit|a|t'].quarantine).not.toBeNull();
    prepareState({ stateFile: file, now: T0 });
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).tests['unit|a|t'].quarantine).toBeNull();
  });
});
