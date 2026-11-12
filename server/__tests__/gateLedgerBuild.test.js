// The ledger by build (scripts/ci/gateLedger.js, DESIGN-phase24 section 1.3): old lines read as pro, previousFor never mixes
// builds and merges `only` lines per budget id, needsDecision names the build only when asked.
import { describe, expect, it } from 'vitest';
import { buildEntry, buildOfEntry, needsDecision, previousFor, withHeadroom } from '../../scripts/ci/gateLedger.js';

const line = (build, mode, budgets) => ({ ...(build === undefined ? {} : { build }), mode, budgets: budgets.map(([id, measured]) => ({ id, measured })) });

describe('buildOfEntry', () => {
  it('a line without build, or with anything but public, is pro', () => {
    expect(buildOfEntry({ mode: 'full' })).toBe('pro');
    expect(buildOfEntry({ build: 'pro' })).toBe('pro');
    expect(buildOfEntry({ build: 'public' })).toBe('public');
    expect(buildOfEntry({ build: 'weird' })).toBe('pro');
  });
});

describe('previousFor', () => {
  it('never mixes builds', () => {
    const entries = [line('public', 'full', [['web.totalJsGzipKb', 400]]), line('pro', 'full', [['web.totalJsGzipKb', 410]]), line('public', 'full', [['web.totalJsGzipKb', 405]])];
    expect(previousFor(entries, 'pro')).toEqual({ budgets: [{ id: 'web.totalJsGzipKb', measured: 410 }] });
    expect(previousFor(entries, 'public')).toEqual({ budgets: [{ id: 'web.totalJsGzipKb', measured: 405 }] });
    expect(previousFor([line('public', 'full', [['a', 1]])], 'pro')).toEqual({ budgets: [] });
  });

  it('reads old lines (no build) as pro', () => {
    expect(previousFor([line(undefined, 'full', [['a', 7]])], 'pro').budgets).toEqual([{ id: 'a', measured: 7 }]);
    expect(previousFor([line(undefined, 'full', [['a', 7]])], 'public').budgets).toEqual([]);
  });

  it('merges only lines per budget id: the newest line holding the id wins', () => {
    const entries = [
      line('pro', 'full', [['web.totalJsGzipKb', 400], ['sidecar.studio.bundleKb', 3700]]),
      line('pro', 'only', [['web.totalJsGzipKb', 401]]),
      line('pro', 'only', [['sidecar.studio.bundleKb', 3710]]),
      line('pro', 'only', []),
    ];
    const prev = previousFor(entries, 'pro');
    expect(Object.fromEntries(prev.budgets.map((b) => [b.id, b.measured]))).toEqual({ 'web.totalJsGzipKb': 401, 'sidecar.studio.bundleKb': 3710 });
  });

  it('skips ci lines and lines with damaged budgets', () => {
    const entries = [line('pro', 'full', [['a', 1]]), { build: 'pro', mode: 'ci', budgets: [{ id: 'a', measured: 99 }] }, { build: 'pro', mode: 'full', budgets: [{ id: 'a', measured: 'x' }, null].filter(Boolean) }, { mode: 'full' }];
    expect(previousFor(entries, 'pro').budgets).toEqual([{ id: 'a', measured: 1 }]);
    expect(previousFor([], 'pro')).toEqual({ budgets: [] });
  });

  it('feeds withHeadroom unchanged', () => {
    const rows = withHeadroom([{ id: 'sidecar.studio.bundleKb', measured: 3720, limit: 3807 }], previousFor([line('pro', 'only', [['sidecar.studio.bundleKb', 3700]])], 'pro'));
    expect(rows[0].delta).toBe(20);
  });
});

describe('needsDecision', () => {
  const rows = withHeadroom([{ id: 'sidecar.runtime.bundleGzipKb', measured: 1032.1, limit: 1053 }], null);
  const text = 'raise with a rationale in BUDGETS.md (sidecar.runtime.bundleGzipKb has 1.98 percent left; pins: server/__tests__/ciPipeline.test.js, server/__tests__/sidecarBudget.test.js).';

  it('without a build the text is the CI one, byte for byte', () => {
    expect(needsDecision(rows)).toEqual([`Needs a decision: ${text}`]);
  });

  it('with a build the line names it', () => {
    expect(needsDecision(rows, 'pro')).toEqual([`Needs a decision (pro build): ${text}`]);
    expect(needsDecision(rows, 'public')).toEqual([`Needs a decision (public build): ${text}`]);
    expect(needsDecision([], 'pro')).toEqual([]);
  });
});

describe('buildEntry fields', () => {
  const base = { runId: 'r', at: '2026-11-06T00:00:00.000Z', mode: 'only', protectedGate: false, head: 'h', branch: 'b', exitCode: 0, steps: [], unit: null, e2e: null, budgets: [], state: { tests: {} }, now: 0 };

  it('adds build, only, project and shard only when build is passed', () => {
    const old = buildEntry(base);
    for (const k of ['build', 'only', 'project', 'shard']) expect(old, k).not.toHaveProperty(k);
    expect(buildEntry({ ...base, build: 'public', only: 'unit tests', project: 'pure', shard: undefined })).toMatchObject({ mode: 'only', build: 'public', only: 'unit tests', project: 'pure', shard: null });
    expect(buildEntry({ ...base, build: 'pro' })).toMatchObject({ build: 'pro', only: null, project: null, shard: null });
  });
});
