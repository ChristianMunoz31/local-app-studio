// @vitest-environment node
// `npm run gate` flags of the phase scripts (scripts/ci/gate.js): --only, --project, --shard and --public.
// Pure: no step is run; main is only called with --dry-run or with a refused flag.
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GATE_STEPS, buildOf, choosePlan, main as gateMain, parseGateArgs, parseGateExtras, planGate, publicPlan, selectSteps } from '../../scripts/ci/gate.js';

const plan = (env = {}) => planGate({ quick: false, env, hasBinary: () => true, tmp: '/tmp' });
const entry = (p, id) => p.entries.find((e) => e.id === id);
const UNIT = 'unit tests';
const E2E = 'e2e (Playwright)';
const VITEST = 'node_modules/vitest/vitest.mjs';
const PW = 'node_modules/@playwright/test/cli.js';

describe('parseGateExtras', () => {
  it('reads the four flags and leaves the rest of parseGateArgs alone', () => {
    expect(parseGateExtras([])).toEqual({ publicBuild: false });
    expect(parseGateExtras(['--only', UNIT, '--project', 'pure', '--public'])).toEqual({ only: UNIT, project: 'pure', publicBuild: true });
    expect(parseGateExtras(['--only', E2E, '--shard', '2/4'])).toEqual({ only: E2E, shard: '2/4', publicBuild: false });
    expect(parseGateArgs(['--only', UNIT])).toEqual({ quick: false, dryRun: false, json: undefined, base: undefined, head: undefined, repair: false, protectedGate: false, classify: true });
  });

  it('a missing value or an option where the value belongs is an empty string', () => {
    expect(parseGateExtras(['--only'])).toEqual({ only: '', publicBuild: false });
    expect(parseGateExtras(['--project', '--public'])).toEqual({ project: '', publicBuild: true });
    expect(parseGateExtras(['--shard', '--dry-run']).shard).toBe('');
  });
});

describe('selectSteps', () => {
  it('keeps exactly one step and names it in the note, mode only', () => {
    const out = selectSteps(plan(), { only: 'lint' });
    expect(out.mode).toBe('only');
    expect(out.note).toBe('only lint');
    expect(out.entries.map((e) => e.id)).toEqual(['lint']);
  });

  it('unit --project turns the vitest argv into run --project <name>, keeping the worker flag', () => {
    for (const p of ['frontend', 'pure', 'backend']) {
      const out = selectSteps(plan(), { only: UNIT, project: p });
      expect(out.entries[0].commands).toEqual([[VITEST, 'run', '--project', p]]);
      expect(out.note).toBe(`only ${UNIT} --project ${p}`);
    }
    expect(selectSteps(plan({ GATE_MAX_WORKERS: '4' }), { only: UNIT, project: 'backend' }).entries[0].commands).toEqual([[VITEST, 'run', '--project', 'backend', '--maxWorkers=4']]);
  });

  it('a unit shard passes with no tests (vitest 5 throws when --shard count exceeds the files, unless --passWithNoTests); e2e does not get the flag', () => {
    const unit = selectSteps(plan(), { only: UNIT, shard: '16/16' });
    expect(unit.entries[0].commands.every((c) => c.includes('--passWithNoTests'))).toBe(true);
    expect(selectSteps(plan(), { only: E2E, shard: '1/2' }).entries[0].commands.flat()).not.toContain('--passWithNoTests');
  });

  it('unit --shard appends --shard=i/n after the project and workers args', () => {
    const sharded = selectSteps(plan(), { only: UNIT, project: 'backend', shard: '1/2' });
    expect(sharded.entries[0].commands).toEqual([[VITEST, 'run', '--project', 'backend', '--passWithNoTests', '--shard=1/2']]);
    expect(sharded.note).toBe(`only ${UNIT} --project backend --shard 1/2`);
    expect(selectSteps(plan({ GATE_MAX_WORKERS: '4' }), { only: UNIT, project: 'pure', shard: '2/3' }).entries[0].commands).toEqual([[VITEST, 'run', '--project', 'pure', '--maxWorkers=4', '--passWithNoTests', '--shard=2/3']]);
  });

  it('e2e --project replaces the three project args by one, --shard appends', () => {
    expect(selectSteps(plan(), { only: E2E, project: 'a11y' }).entries[0].commands).toEqual([[PW, 'test', '--project=a11y']]);
    const sharded = selectSteps(plan(), { only: E2E, project: 'flows', shard: '2/3' });
    expect(sharded.entries[0].commands).toEqual([[PW, 'test', '--project=flows', '--shard=2/3']]);
    expect(sharded.note).toBe(`only ${E2E} --project flows --shard 2/3`);
    expect(selectSteps(plan(), { only: E2E, shard: '1/16' }).entries[0].commands).toEqual([[PW, 'test', '--project=flows', '--project=first-run', '--project=a11y', '--shard=1/16']]);
  });

  it('refuses an unknown step id with the list of ids', () => {
    const out = selectSteps(plan(), { only: 'nope' });
    expect(out.error).toBe(`--only needs a step id: one of ${GATE_STEPS.map((s) => s.id).join(', ')}`);
    expect(selectSteps(plan(), { only: '' }).error).toMatch(/^--only needs a step id/);
  });

  it('refuses --project for another step or a name outside the list', () => {
    const msg = `--project needs --only "${UNIT}" (frontend, pure, backend) or --only "${E2E}" (flows, first-run, a11y)`;
    expect(selectSteps(plan(), { project: 'pure' }).error).toBe(msg);
    expect(selectSteps(plan(), { only: 'lint', project: 'pure' }).error).toBe(msg);
    expect(selectSteps(plan(), { only: UNIT, project: 'flows' }).error).toBe(msg);
    expect(selectSteps(plan(), { only: E2E, project: 'pure' }).error).toBe(msg);
    expect(selectSteps(plan(), { only: E2E, project: '' }).error).toBe(msg);
  });

  it('refuses --shard unless it is the unit or e2e step and 1 <= i <= n <= 16', () => {
    const msg = `--shard needs --only "${UNIT}" or --only "${E2E}" and <i>/<n> with 1 <= i <= n <= 16`;
    expect(selectSteps(plan(), { shard: '1/2' }).error).toBe(msg);
    expect(selectSteps(plan(), { only: 'lint', shard: '1/2' }).error).toBe(msg);
    for (const only of [UNIT, E2E]) {
      for (const bad of ['0/2', '3/2', '1/17', '1', 'a/b', '', '1/2/3', '-1/2']) expect(selectSteps(plan(), { only, shard: bad }).error, `${only} ${bad}`).toBe(msg);
    }
  });
});

describe('publicPlan', () => {
  const pub = publicPlan(plan());

  it('puts APP_PRO_DIR=none on every step and keeps the other env', () => {
    for (const e of pub.entries) expect(e.env.APP_PRO_DIR, e.id).toBe('none');
    expect(entry(pub, 'sidecar budget (runtime)').env).toEqual({ APP_MODE: 'runtime', APP_PRO_DIR: 'none' });
  });

  it('the studio sidecar proves the cloud provider absent instead of present', () => {
    const studio = entry(pub, 'sidecar budget (studio)').commands;
    expect(studio[2]).toEqual(['scripts/checks/cloudMarker.js', '--require-absent', '--bundle', '.sidecar-build/server.cjs', '--dist-dir', 'dist']);
    expect(studio[0]).toEqual(entry(plan(), 'sidecar budget (studio)').commands[0]);
    expect(entry(plan(), 'sidecar budget (studio)').commands[2]).toContain('--require-present');
  });

  it('skips the cloud-off build and changes no other command', () => {
    expect(entry(pub, 'cloud-off build').skip).toBe('the public build has no cloud provider; the public build step proves it absent');
    const base = plan();
    for (const e of pub.entries) {
      if (e.id === 'sidecar budget (studio)') continue;
      expect(e.commands, e.id).toEqual(entry(base, e.id).commands);
    }
  });

  it('works on a one step plan', () => {
    const one = publicPlan(selectSteps(plan(), { only: UNIT, project: 'pure' }));
    expect(one.entries).toHaveLength(1);
    expect(one.entries[0].env).toEqual({ APP_PRO_DIR: 'none' });
    expect(one.mode).toBe('only');
  });
});

describe('GATE_STEPS stay as they are', () => {
  it('selectSteps and publicPlan never edit the step table', () => {
    const before = structuredClone(GATE_STEPS);
    selectSteps(plan(), { only: UNIT, project: 'pure' });
    selectSteps(plan(), { only: E2E, project: 'flows', shard: '1/2' });
    publicPlan(plan());
    expect(GATE_STEPS).toEqual(before);
    expect(entry(plan(), E2E).commands).toEqual([[PW, 'test', '--project=flows', '--project=first-run', '--project=a11y']]);
  });
});

describe('buildOf', () => {
  it('is public for APP_PRO_DIR=none and follows the resolver otherwise', () => {
    expect(buildOf({ APP_PRO_DIR: 'none' })).toBe('public');
    expect(['pro', 'public']).toContain(buildOf({}));
  });
});

describe('choosePlan: the public plan is automatic when pro/ is absent', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'las-gate-root-'));
  const proRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'las-gate-pro-'));
  fs.mkdirSync(path.join(proRoot, 'pro', 'server'), { recursive: true });
  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(proRoot, { recursive: true, force: true });
  });

  it('without pro/ it uses the public plan and says so in one line', () => {
    expect(buildOf({}, tmp)).toBe('public');
    const out = choosePlan(plan(), { env: {}, root: tmp });
    expect(out.note).toMatch(/^pro\/ is absent/);
    expect(out.note).not.toContain('\n');
    expect(entry(out.plan, 'sidecar budget (studio)').commands[2]).toContain('--require-absent');
    expect(entry(out.plan, 'cloud-off build').skip).toBeTruthy();
  });

  it('with pro/ present the plan stays the pro plan and there is no note', () => {
    const base = plan();
    const out = choosePlan(base, { env: {}, root: proRoot });
    expect(out.note).toBeNull();
    expect(out.plan).toBe(base);
    expect(entry(out.plan, 'sidecar budget (studio)').commands[2]).toContain('--require-present');
  });

  it('--public still applies the public plan with pro/ present, silently', () => {
    const out = choosePlan(plan(), { publicFlag: true, env: {}, root: proRoot });
    expect(out.note).toBeNull();
    expect(entry(out.plan, 'sidecar budget (studio)').commands[2]).toContain('--require-absent');
  });

  it('APP_PRO_DIR=none counts as absent', () => {
    expect(choosePlan(plan(), { env: { APP_PRO_DIR: 'none' }, root: proRoot }).note).toMatch(/^pro\/ is absent/);
  });
});

describe('gate main refusals (exit 2, nothing runs)', () => {
  const saved = process.env.APP_PRO_DIR;
  afterEach(() => {
    vi.restoreAllMocks();
    if (saved === undefined) delete process.env.APP_PRO_DIR;
    else process.env.APP_PRO_DIR = saved;
  });

  const refused = async (argv, text) => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await gateMain(argv, {}), argv.join(' ')).toBe(2);
    expect(err).toHaveBeenCalledWith(text);
  };

  it('--quick with --only or --public', async () => {
    await refused(['--quick', '--only', 'lint', '--dry-run'], '--quick cannot be combined with --only or --public');
    await refused(['--quick', '--public', '--dry-run'], '--quick cannot be combined with --only or --public');
  });

  it('--repair with --only', async () => {
    await refused(['--repair', '--only', 'lint', '--dry-run'], '--repair cannot be combined with --only');
  });

  it('an unknown or missing step id, a bad --project, a bad --shard', async () => {
    await refused(['--only', 'nope', '--dry-run'], `--only needs a step id: one of ${GATE_STEPS.map((s) => s.id).join(', ')}`);
    await refused(['--only', '--dry-run'], `--only needs a step id: one of ${GATE_STEPS.map((s) => s.id).join(', ')}`);
    await refused(['--project', 'pure', '--dry-run'], `--project needs --only "${UNIT}" (frontend, pure, backend) or --only "${E2E}" (flows, first-run, a11y)`);
    await refused(['--only', UNIT, '--project', 'flows', '--dry-run'], `--project needs --only "${UNIT}" (frontend, pure, backend) or --only "${E2E}" (flows, first-run, a11y)`);
    await refused(['--only', 'lint', '--shard', '1/2', '--dry-run'], `--shard needs --only "${UNIT}" or --only "${E2E}" and <i>/<n> with 1 <= i <= n <= 16`);
    await refused(['--only', UNIT, '--shard', '3/2', '--dry-run'], `--shard needs --only "${UNIT}" or --only "${E2E}" and <i>/<n> with 1 <= i <= n <= 16`);
  });

  it('a usage error with --public leaves APP_PRO_DIR unset on the env and on process.env', async () => {
    const saved = process.env.APP_PRO_DIR;
    delete process.env.APP_PRO_DIR;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const argv of [['--only', 'nope'], ['--only', 'lint', '--shard', '1/2'], ['--project', 'pure']]) {
        const env = {};
        expect(await gateMain([...argv, '--public', '--dry-run'], env), argv.join(' ')).toBe(2);
        expect(env.APP_PRO_DIR).toBeUndefined();
        expect(process.env.APP_PRO_DIR).toBeUndefined();
      }
    } finally {
      if (saved === undefined) delete process.env.APP_PRO_DIR;
      else process.env.APP_PRO_DIR = saved;
    }
  });

  it('writes no --json file on a usage error', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const file = path.join(os.tmpdir(), `gate-only-refused-${process.pid}.json`);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await gateMain(['--only', 'nope', '--json', file, '--dry-run'], {})).toBe(2);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('--public sets APP_PRO_DIR=none on the env and on process.env, before the plan is made', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const env = {};
    expect(await gateMain(['--only', UNIT, '--project', 'pure', '--public', '--dry-run'], env)).toBe(0);
    expect(env.APP_PRO_DIR).toBe('none');
    expect(process.env.APP_PRO_DIR).toBe('none');
    const printed = log.mock.calls.flat().join('\n');
    expect(printed).toContain(`only ${UNIT} --project pure`);
    expect(printed).toContain(`${VITEST} run --project pure`);
    expect(printed).not.toContain('hygiene');
  });
});
