// ci:always-run
// The structural validator of the workflows (scripts/ci/workflowCheck.js, DESIGN-phase15 section 3.1): each rule with a
// passing and a failing fixture, the nine real files, and the --graph output of every dispatchable file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REPO_ROOT } from '../../scripts/checks/gitFiles.js';
import { DRY_RUN_FILES, PUBLIC_MARKER, checkAll, checkWorkflow, detectWorkflowSet, graphLines, main, parseWorkflow, topoOrder } from '../../scripts/ci/workflowCheck.js';
import { PRIVATE_WORKFLOWS } from './helpers/workflowSet.js';

const SHA = 'a'.repeat(40);
const CHECKOUT = `actions/checkout@${SHA} # v7.0.1`;
const PKG_SCRIPTS = ['lint', 'check:bundle'];
const exists = (rel) => ['scripts/ci/ok.js', 'scripts/ok.sh', '.github/workflows/called.yml'].includes(rel);

/** A workflow around `jobs` (a string of job blocks, each indented two spaces). */
const wf = (jobs, head = 'name: t\non:\n  push:\n    branches: [main]\npermissions: {}\n') => `${head}jobs:\n${jobs}`;
const job = (id, body = `    runs-on: ubuntu-24.04\n    steps:\n      - uses: ${CHECKOUT}\n`) => `  ${id}:\n${body}`;
const ctx = { file: 't.yml', exists, readWorkflow: () => 'name: c\non:\n  workflow_call:\npermissions: {}\njobs:\n  a:\n    runs-on: x\n    steps:\n      - run: echo\n', scripts: PKG_SCRIPTS };
const messages = (text, extra = {}) => checkWorkflow(text, { ...ctx, ...extra }).map((p) => p.message);
const withRun = (cmd) => wf(job('a', `    runs-on: x\n    steps:\n      - run: ${cmd}\n`));

describe('parseWorkflow', () => {
  it('reads triggers, jobs, needs (inline, list and block) and steps with block scalars', () => {
    const text = wf(
      `${job('a')}\n  b:\n    needs: [a]\n    if: \${{ always() }}\n    runs-on: x\n    steps:\n      - name: one\n        id: s1\n        run: |\n          echo a\n          echo b\n      - uses: ${CHECKOUT}\n\n  c:\n    needs:\n      - a\n      - b\n    uses: ./.github/workflows/called.yml\n`,
      'name: t\non:\n  workflow_dispatch:\n  schedule:\n    - cron: "1 1 * * 1"\npermissions: {}\n',
    );
    const parsed = parseWorkflow(text);
    expect([...parsed.triggers].sort()).toEqual(['schedule', 'workflow_dispatch']);
    expect(parsed.jobs.map((j) => j.id)).toEqual(['a', 'b', 'c']);
    expect(parsed.jobs[1].needs).toEqual(['a']);
    expect(parsed.jobs[2].needs).toEqual(['a', 'b']);
    expect(parsed.jobs[1].steps).toHaveLength(2);
    expect(parsed.jobs[1].steps[0]).toMatchObject({ id: 's1', name: 'one', run: 'echo a\necho b' });
    expect(parsed.jobs[1].ifText).toBe('${{ always() }}');
    expect(topoOrder(parsed.jobs).map((j) => j.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('WF-1 top level and text', () => {
  it('passes a minimal file', () => {
    expect(messages(wf(job('a')))).toEqual([]);
  });

  it('needs name, on, permissions and jobs', () => {
    const found = messages('on: push\n').join('\n');
    expect(found).toContain('no top-level name');
    expect(found).toContain('no top-level permissions');
    expect(found).toContain('no top-level jobs');
  });

  it('refuses tabs, em and en dashes and an unbalanced expression', () => {
    expect(messages(`${wf(job('a'))}\t`)).toContain('tab');
    expect(messages(`${wf(job('a'))}# a ${String.fromCharCode(0x2014)} b\n`)).toContain('em or en dash');
    expect(messages(`${wf(job('a'))}# a ${String.fromCharCode(0x2013)} b\n`)).toContain('em or en dash');
    expect(messages(wf(job('a', '    runs-on: x\n    steps:\n      - run: echo ${{ a }\n')))).toContain('unbalanced expression');
  });
});

describe('WF-2 jobs', () => {
  it('needs runs-on or uses, a lowercase id and a unique id and name', () => {
    expect(messages(wf(job('a', '    steps:\n      - run: echo\n')))).toContain('job a: no runs-on or uses');
    expect(messages(wf(job('Bad_Id')))).toEqual(expect.arrayContaining([expect.stringContaining('the id must be lowercase')]));
    expect(messages(wf(job('a') + job('a')))).toContain('duplicate job a');
    const dupName = wf(job('a', `    name: same\n    runs-on: x\n    steps:\n      - run: echo\n`) + job('b', `    name: same\n    runs-on: x\n    steps:\n      - run: echo\n`));
    expect(messages(dupName).join('\n')).toContain('the name "same" is also used by job a');
  });

  it('keeps the job verify in ci.yml', () => {
    expect(messages(wf(job('a')), { file: 'ci.yml' }).join('\n')).toContain('the job verify must keep the id and the name verify');
    expect(messages(wf(job('verify', '    name: verify\n    runs-on: x\n    steps:\n      - run: echo\n')), { file: 'ci.yml' }).filter((m) => m.includes('verify must'))).toEqual([]);
  });
});

describe('WF-3 needs', () => {
  it('flags a missing target, a self need and a cycle', () => {
    const body = (needs) => `    needs: ${needs}\n    runs-on: x\n    steps:\n      - run: echo\n`;
    expect(messages(wf(job('a', body('lint')))).join('\n')).toContain('needs "lint" which does not exist');
    expect(messages(wf(job('a', body('a')))).join('\n')).toContain('needs itself');
    expect(messages(wf(job('a', body('b')) + job('b', body('a')))).join('\n')).toContain('is part of a needs cycle');
    expect(messages(wf(job('a', body('[b]')) + job('b')))).toEqual([]);
  });
});

describe('WF-4 uses is pinned', () => {
  const step = (uses) => wf(job('a', `    runs-on: x\n    steps:\n      - uses: ${uses}\n`));

  it('accepts a 40 character sha with a version comment, a pinned image and an existing local reusable workflow', () => {
    expect(messages(step(CHECKOUT))).toEqual([]);
    expect(messages(step(`docker://alpine@sha256:${'b'.repeat(64)}`))).toEqual([]);
    expect(messages(wf(`  a:\n    uses: ./.github/workflows/called.yml\n`))).toEqual([]);
  });

  it('refuses a tag, a short sha, a missing comment, an unpinned image and a missing local file', () => {
    expect(messages(step('actions/checkout@v4')).join('\n')).toContain('must be pinned to a 40 character commit');
    expect(messages(step(`actions/checkout@${'a'.repeat(7)} # v4`)).join('\n')).toContain('must be pinned');
    expect(messages(step(`actions/checkout@${SHA}`)).join('\n')).toContain('needs a "# v<version>" comment');
    expect(messages(step('docker://alpine:3')).join('\n')).toContain('not pinned by sha256');
    expect(messages(wf('  a:\n    uses: ./.github/workflows/gone.yml\n')).join('\n')).toContain('that file does not exist');
  });
});

describe('WF-5 scripts exist', () => {
  it('passes real node, bash and npm run calls and npx of a dev dependency', () => {
    expect(messages(withRun('FOO=1 node scripts/ci/ok.js --x'))).toEqual([]);
    expect(messages(withRun('bash scripts/ok.sh'))).toEqual([]);
    expect(messages(withRun('npm run lint'))).toEqual([]);
    expect(messages(withRun('npm run check:bundle -- --json x.json'))).toEqual([]);
    expect(messages(withRun('npx vitest run'))).toEqual([]);
    expect(messages(withRun('node -e "1"'))).toEqual([]);
  });

  it('flags a script that is not there, an npm script that is not defined and an npx binary that is not a dev dependency', () => {
    expect(messages(withRun('node scripts/ci/missing.js')).join('\n')).toContain('run calls node scripts/ci/missing.js but that file does not exist');
    expect(messages(withRun('bash scripts/missing.sh')).join('\n')).toContain('scripts/missing.sh but that file does not exist');
    expect(messages(withRun('npm run nope')).join('\n')).toContain('package.json has no such script');
    expect(messages(withRun('npx cowsay hi')).join('\n')).toContain('npx cowsay');
  });

  it('ignores comment lines inside a run block', () => {
    expect(messages(wf(job('a', '    runs-on: x\n    steps:\n      - run: |\n          # node scripts/ci/missing.js\n          echo ok\n')))).toEqual([]);
  });
});

describe('WF-6 no secret in an if', () => {
  it('flags secrets. in a job if, a step if and a block scalar if', () => {
    expect(messages(wf(job('a', "    if: ${{ secrets.X != '' }}\n    runs-on: x\n    steps:\n      - run: echo\n"))).join('\n')).toContain('a secret is used inside an if');
    expect(messages(wf(job('a', "    runs-on: x\n    steps:\n      - if: ${{ secrets.X }}\n        run: echo\n"))).join('\n')).toContain('a secret is used inside an if');
    expect(messages(wf(job('a', '    runs-on: x\n    steps:\n      - if: >-\n          ${{ github.ref == 1 &&\n          secrets.X }}\n        run: echo\n'))).join('\n')).toContain('a secret is used inside an if');
  });

  it('allows a secret in env', () => {
    expect(messages(wf(job('a', '    runs-on: x\n    steps:\n      - env:\n          T: ${{ secrets.X }}\n        run: echo\n')))).toEqual([]);
  });
});

describe('WF-7 steps', () => {
  it('needs run or uses, unique ids and references to ids that exist', () => {
    expect(messages(wf(job('a', '    runs-on: x\n    steps:\n      - name: nothing\n'))).join('\n')).toContain('a step has neither run nor uses: name: nothing');
    expect(messages(wf(job('a', '    runs-on: x\n    steps:\n      - id: s\n        run: echo\n      - id: s\n        run: echo\n'))).join('\n')).toContain('duplicate step id');
    expect(messages(wf(job('a', '    runs-on: x\n    steps:\n      - id: s\n        run: echo\n      - if: steps.zzz.outcome == 1\n        run: echo\n'))).join('\n')).toContain('refers to steps.zzz');
    expect(messages(wf(job('a', '    runs-on: x\n    steps:\n      - id: s\n        run: echo\n      - if: steps.s.outcome == 1\n        run: echo\n')))).toEqual([]);
  });
});

describe('WF-8 dry run jobs and WF-9 reusable workflows', () => {
  const dispatch = 'name: t\non:\n  workflow_dispatch:\n    inputs:\n      graph_check:\n        description: x\n        required: false\n        default: false\n        type: boolean\npermissions: {}\n';
  const graph = (file) => job('graph-check', `    if: \${{ inputs.graph_check }}\n    runs-on: x\n    steps:\n      - run: node scripts/ci/workflowCheck.js --graph .github/workflows/${file}\n`);
  const guarded = job('a', '    if: ${{ !inputs.graph_check }}\n    runs-on: x\n    steps:\n      - run: echo\n');
  const real = { exists: () => true };

  it('passes a dispatchable file with the input, the graph-check job and the guard on every other job', () => {
    expect(messages(wf(guarded + graph('flaky.yml'), dispatch), { file: 'flaky.yml', ...real })).toEqual([]);
  });

  it('flags a missing input, a missing graph-check job and an unguarded job', () => {
    const noInput = messages(wf(guarded + graph('flaky.yml')), { file: 'flaky.yml', ...real }).join('\n');
    expect(noInput).toContain('no workflow_dispatch trigger');
    const noJob = messages(wf(guarded, dispatch), { file: 'flaky.yml', ...real }).join('\n');
    expect(noJob).toContain('the job graph-check is missing');
    const unguarded = messages(wf(job('a') + graph('flaky.yml'), dispatch), { file: 'flaky.yml', ...real }).join('\n');
    expect(unguarded).toContain('job a must have !inputs.graph_check in its if');
    const wrongFile = messages(wf(guarded + graph('other.yml'), dispatch), { file: 'flaky.yml', ...real }).join('\n');
    expect(wrongFile).toContain('graph-check must run node scripts/ci/workflowCheck.js --graph .github/workflows/flaky.yml');
    const alwaysOn = messages(wf(guarded + job('graph-check', '    if: ${{ !inputs.graph_check }}\n    runs-on: x\n    steps:\n      - run: node scripts/ci/workflowCheck.js --graph .github/workflows/flaky.yml\n'), dispatch), { file: 'flaky.yml', ...real }).join('\n');
    expect(alwaysOn).toContain('graph-check must run only when inputs.graph_check is true');
  });

  it('WF-9: a reusable workflow that is called must declare workflow_call', () => {
    const caller = wf('  a:\n    uses: ./.github/workflows/called.yml\n');
    expect(messages(caller, { readWorkflow: () => 'name: c\non:\n  push:\npermissions: {}\njobs:\n  a:\n    runs-on: x\n    steps:\n      - run: echo\n' }).join('\n')).toContain('does not declare on: workflow_call');
    expect(messages(caller)).toEqual([]);
  });
});

describe.skipIf(!PRIVATE_WORKFLOWS)('the real workflows (pins the private workflow set, which is not in a public export)', () => {
  it('all nine pass', () => {
    const results = checkAll(REPO_ROOT);
    expect(results.map((r) => r.file)).toEqual(['branch-cleanup.yml', 'ci.yml', 'desktop-check.yml', 'desktop-windows.yml', 'dev-build.yml', 'flaky.yml', 'pr-bot.yml', 'release-please.yml', 'release.yml']);
    for (const r of results) expect(r.problems, r.file).toEqual([]);
  });

  it('the seven dispatchable files have a graph job; desktop-windows.yml and pr-bot.yml have none', () => {
    expect(DRY_RUN_FILES).toHaveLength(7);
    for (const file of DRY_RUN_FILES) {
      const text = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows', file), 'utf8');
      expect(text, file).toContain(`node scripts/ci/workflowCheck.js --graph .github/workflows/${file}`);
    }
    for (const file of ['desktop-windows.yml', 'pr-bot.yml']) expect(fs.readFileSync(path.join(REPO_ROOT, '.github/workflows', file), 'utf8'), file).not.toContain('graph_check');
  });

  it.each(DRY_RUN_FILES)('--graph %s prints the jobs in run order and exits 0', (file) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(main(['--graph', `.github/workflows/${file}`])).toBe(0);
    const printed = log.mock.calls.join('\n');
    expect(printed.split('\n')[0]).toBe(file);
    log.mockRestore();
  });

  it('the graph of release.yml also lists the workflow it calls, after the jobs it needs', () => {
    const lines = graphLines('.github/workflows/release.yml');
    const order = lines.map((l) => l.trim().split(' ')[0]);
    expect(order.indexOf('plan')).toBeLessThan(order.indexOf('stage'));
    expect(order.indexOf('stage')).toBeLessThan(order.indexOf('desktop-windows'));
    expect(lines.join('\n')).toContain('desktop-windows.yml');
    expect(lines.join('\n')).toContain('windows');
  });
});

describe('main', () => {
  const temps = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });
  const repo = (files) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-check-'));
    temps.push(dir);
    fs.mkdirSync(path.join(dir, '.github/workflows'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { lint: 'x' } }));
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, '.github/workflows', name), text);
    return dir;
  };

  it('prints the count and exits 0 when clean', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(main([], repo({ 'a.yml': wf(job('a')) }))).toBe(0);
    expect(log).toHaveBeenCalledWith('workflowCheck: 1 workflows, 0 problems');
  });

  it('prints one line per problem with the file and the line, and exits 1', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(main([], repo({ 'a.yml': wf(job('a', '    needs: lint\n    runs-on: x\n    steps:\n      - run: echo\n')) }))).toBe(1);
    expect(err.mock.calls[0][0]).toMatch(/^a\.yml:\d+ job a: needs "lint" which does not exist$/);
    expect(log).toHaveBeenCalledWith('workflowCheck: 1 workflows, 1 problems');
  });

  it('--graph refuses a path outside the workflows folder', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(main(['--graph', '../x.yml'], repo({}))).toBe(2);
    expect(main(['--graph'], repo({}))).toBe(2);
  });

  describe('detectWorkflowSet with the private-only overlay folder', () => {
    const marked = `${PUBLIC_MARKER}\n${wf(job('verify', '    name: verify\n    runs-on: x\n    steps:\n      - run: echo\n'))}`;
    const withOverlay = (root) => fs.mkdirSync(path.join(root, 'scripts/release/public-overlay'), { recursive: true });

    it('marker and overlay: private, and check:workflows fails with a plain message', () => {
      const root = repo({ 'ci.yml': marked });
      withOverlay(root);
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(detectWorkflowSet(root)).toBe('private');
      expect(main([], root)).toBe(1);
      expect(err.mock.calls.map((c) => c[0]).join('\n')).toContain('the public workflow marker is in the private ci.yml');
    });

    it('marker without overlay: public', () => {
      expect(detectWorkflowSet(repo({ 'ci.yml': marked }))).toBe('public');
    });

    it('no marker: private, with or without the overlay, and no marker message', () => {
      const root = repo({ 'ci.yml': wf(job('a')) });
      expect(detectWorkflowSet(root)).toBe('private');
      withOverlay(root);
      expect(detectWorkflowSet(root)).toBe('private');
      expect(checkAll(root).flatMap((r) => r.problems.map((p) => p.message))).not.toContain('the public workflow marker is in the private ci.yml');
    });
  });
});
