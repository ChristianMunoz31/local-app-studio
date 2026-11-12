// The CI e2e step (scripts/ci/runE2e.js): the Playwright command it plans, its refusals, and classification through an
// injected runner and rerun (nothing here starts Playwright).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonPathFor } from '../../scripts/ci/gateClassify.js';
import { main, planE2eRun } from '../../scripts/ci/runE2e.js';

const temps = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const report = (status) => ({
  stats: { expected: status === 'expected' ? 1 : 0, unexpected: status === 'unexpected' ? 1 : 0, flaky: 0, skipped: 0 },
  suites: [{ title: 'flows/a.spec.js', specs: [{ title: 'does x', file: 'flows/a.spec.js', tests: [{ projectName: 'flows', status, results: [{ status: status === 'expected' ? 'passed' : 'failed', error: { message: 'boom' } }] }] }], suites: [] }],
});

describe('planE2eRun', () => {
  it('runs playwright for the projects with a JSON report, github and html reporters in CI, and no retry of its own', () => {
    const ci = planE2eRun(['--project=flows', '--project=first-run'], { CI: 'true' });
    expect(ci.argv).toEqual(['node_modules/@playwright/test/cli.js', 'test', '--project=flows', '--project=first-run', '--reporter=github,html,json,./e2e/support/previewStartReporter.js']);
    expect(ci.env).toEqual({ PLAYWRIGHT_JSON_OUTPUT_NAME: '.gate/run/e2e.json', GATE_CLASSIFY: '1' });
    expect(planE2eRun(['--project=a11y'], {}).argv.at(-1)).toBe('--reporter=list,json,./e2e/support/previewStartReporter.js');
  });

  it('takes only --project=<name> arguments', () => {
    expect(planE2eRun([])).toEqual({ error: expect.stringContaining('Usage') });
    expect(planE2eRun(['--project=flows', '--grep=x'])).toEqual({ error: expect.stringContaining('only takes --project') });
    expect(planE2eRun(['--project=a b'])).toHaveProperty('error');
    expect(planE2eRun(['e2e/x.spec.js'])).toHaveProperty('error');
  });
});

describe('main', () => {
  const setup = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-e2e-'));
    temps.push(root);
    return { root, stateFile: path.join(root, '.gate/flaky.json') };
  };
  const writeReport = (root, json) => {
    fs.mkdirSync(path.join(root, '.gate/run'), { recursive: true });
    fs.writeFileSync(path.join(root, jsonPathFor('e2e')), JSON.stringify(json));
  };

  it('exits 2 for a bad command line without running anything', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const run = vi.fn();
    expect(await main(['--bad'], {}, { run })).toBe(2);
    expect(run).not.toHaveBeenCalled();
  });

  it('a clean run exits 0', async () => {
    const { root, stateFile } = setup();
    const code = await main(['--project=flows'], { GITHUB_RUN_ID: '1' }, { run: () => (writeReport(root, report('expected')), 0), classifierOptions: { root, stateFile } });
    expect(code).toBe(0);
  });

  it('a failure that passes when run alone is flaky: the first run still fails, the second quarantines it and passes', async () => {
    const { root, stateFile } = setup();
    const rerunSpecs = [];
    const options = { root, stateFile, rerun: (spec) => (rerunSpecs.push(spec), report('expected')) };
    const run = () => (writeReport(root, report('unexpected')), 1);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await main(['--project=flows'], { GITHUB_RUN_ID: '1' }, { run, classifierOptions: options })).toBe(1);
    expect(await main(['--project=flows'], { GITHUB_RUN_ID: '2' }, { run, classifierOptions: options })).toBe(0);
    expect(rerunSpecs).toHaveLength(2);
    expect(rerunSpecs[0].argv).toContain('--workers=1');
    expect(rerunSpecs[0].argv).toContain('--retries=0');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    expect(Object.values(state.tests)[0].quarantine).toMatchObject({ reason: 'flaky in 2 runs in a row' });
  });

  it('a protected run never quarantines and never writes the state file', async () => {
    const { root, stateFile } = setup();
    const options = { root, stateFile, rerun: () => report('expected') };
    const run = () => (writeReport(root, report('unexpected')), 1);
    for (const id of ['1', '2']) expect(await main(['--project=flows'], { GITHUB_RUN_ID: id, GATE_PROTECTED: '1' }, { run, classifierOptions: options })).toBe(1);
    expect(fs.existsSync(stateFile)).toBe(false);
  });

  it('a real failure and a missing report keep the exit code', async () => {
    const { root, stateFile } = setup();
    expect(await main(['--project=flows'], {}, { run: () => (writeReport(root, report('unexpected')), 1), classifierOptions: { root, stateFile, rerun: () => report('unexpected') } })).toBe(1);
    expect(await main(['--project=flows'], {}, { run: () => 7, classifierOptions: { root, stateFile } })).toBe(7);
  });
});
