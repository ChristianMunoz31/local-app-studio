// The summary layout of the gate (scripts/ci/gateSummary.js, DESIGN-phase15 section 2.10), pinned as inline strings.
import { describe, expect, it } from 'vitest';
import { renderSummary } from '../../scripts/ci/gateSummary.js';

const FLAKY_KEY = 'unit|src/studio/pages/__tests__/DescribeTab.test.tsx|DescribeTab runs a launch once under StrictMode';
const REAL_FILE = 'src/studio/pages/__tests__/DesignTab.test.tsx';
const NOW = Date.parse('2026-11-04T10:12:00.000Z');

const state = {
  version: 1,
  updatedAt: '2026-11-04T10:12:00.000Z',
  tests: {
    [FLAKY_KEY]: {
      kind: 'unit',
      file: 'src/studio/pages/__tests__/DescribeTab.test.tsx',
      title: 'DescribeTab runs a launch once under StrictMode',
      project: null,
      flakyStreak: 2,
      failStreak: 0,
      quarantine: { since: '2026-11-04T10:12:00.000Z', until: '2026-11-11T10:12:00.000Z', runId: '2026-11-04T10:12:00.000Z-1a2b3c4', reason: 'flaky in 2 runs in a row' },
    },
  },
};

const unit = {
  counts: { files: 560, total: 10520, passed: 10517, failed: 2, skipped: 2, flaky: 1, quarantinedFailures: 1 },
  real: [{ key: `unit|${REAL_FILE}|DesignTab saves on Ctrl+S`, kind: 'unit', file: REAL_FILE, title: 'DesignTab saves on Ctrl+S', project: null, outcome: 'fail', assertion: 'expected "Saved" to be "All changes saved"', where: `${REAL_FILE}:412:7`, reason: 'failed twice' }],
  flaky: [{ key: FLAKY_KEY, kind: 'unit', title: 'DescribeTab runs a launch once under StrictMode', outcome: 'flaky', quarantinedNow: true, quarantined: true }],
  quarantinedFailures: [],
  newlyQuarantined: [FLAKY_KEY],
  released: [],
  expired: [],
  failing: [`unit|${REAL_FILE}|DesignTab saves on Ctrl+S`],
  tooMany: false,
  unexplained: false,
};

const base = {
  mode: 'full',
  at: '2026-11-04T10:12:00.000Z',
  head: '1a2b3c4d5e6f7a8b',
  protectedGate: false,
  now: NOW,
  state,
  budgets: [],
  decisions: [],
  repairs: null,
};

describe('renderSummary', () => {
  it('prints every section in the documented order', () => {
    const text = renderSummary({
      ...base,
      steps: [
        { id: 'lint', status: 'passed', seconds: 41.2, peakMB: 820 },
        { id: 'unit tests', status: 'FAILED', seconds: 231, peakMB: 2460 },
        { id: 'build', status: 'not run', seconds: 0, peakMB: null },
      ],
      unit,
      budgets: [
        { label: 'web initial JS gzip KB', measured: 128.68, limit: 146, headroomPct: 11.86, delta: 0.1 },
        { label: 'runtime sidecar gzip KB', measured: 1032.1, limit: 1053, headroomPct: 1.9, delta: null },
      ],
      decisions: ['Needs a decision: raise with a rationale in BUDGETS.md (sidecar.runtime.bundleGzipKb has 1.90 percent left; pins: server/__tests__/ciPipeline.test.js, server/__tests__/sidecarBudget.test.js).'],
      repairs: { committed: { sha: '9f8e7d6aaaaaaaa', files: ['a.js', 'b.js'], rules: ['semi', 'prefer-const'] }, refused: [], skipped: [] },
      ledgerLine: 37,
    });
    expect(text).toBe(
      [
        '## gate (full, 2026-11-04 10:12, head 1a2b3c4, protected: no)',
        '',
        '| step | status | seconds | peak MB |',
        '| --- | --- | --- | --- |',
        '| lint | passed | 41.2 | 820 |',
        '| unit tests | FAILED | 231.0 | 2460 |',
        '| build | not run | - | - |',
        '',
        '### Tests',
        '- unit: 10517 passed, 1 failed, 2 skipped; 1 flaky (quarantined)',
        '',
        '### Real failures',
        '- unit tests: "DesignTab saves on Ctrl+S" failed twice, so it is a real failure.',
        '  What happened: expected "Saved" to be "All changes saved"',
        '  Where: src/studio/pages/__tests__/DesignTab.test.tsx:412:7',
        '  Next: npx vitest run src/studio/pages/__tests__/DesignTab.test.tsx -t "DesignTab saves on Ctrl+S", then fix the code or the test.',
        '',
        '### Flaky (failed, then passed when run again alone)',
        '- unit: "DescribeTab runs a launch once under StrictMode": flaky 2 runs in a row, quarantined now.',
        '',
        '### Quarantine (.gate/flaky.json)',
        '- unit: "DescribeTab runs a launch once under StrictMode" until 2026-11-11 10:12 (since run 2026-11-04T10:12:00.000Z-1a2b3c4); failing runs in a row: 0 of 3',
        '- Newly quarantined: 1. Released after 3 failing runs: 0. Expired: 0.',
        '',
        '### Budgets (headroom, change since the last full run)',
        '| budget | measured | limit | headroom | change |',
        '| --- | ---: | ---: | ---: | ---: |',
        '| web initial JS gzip KB | 128.68 | 146 | 11.86% | +0.10 |',
        '| runtime sidecar gzip KB | 1032.10 | 1053 | 1.90% | - |',
        'Needs a decision: raise with a rationale in BUDGETS.md (sidecar.runtime.bundleGzipKb has 1.90 percent left; pins: server/__tests__/ciPipeline.test.js, server/__tests__/sidecarBudget.test.js).',
        '',
        '### Repairs',
        '- Committed 9f8e7d6 "chore(gate): mechanical fixes" (2 files, rules: semi, prefer-const). Revert with: git revert 9f8e7d6',
        '',
        'Ledger: .gate/ledger.jsonl (line 37)',
      ].join('\n'),
    );
  });

  it('a failed lint step names its next action, and a clean quick run has only the table', () => {
    const lint = renderSummary({ ...base, mode: 'quick', state: { tests: {} }, steps: [{ id: 'lint', status: 'FAILED', seconds: 3.04, peakMB: null }] });
    expect(lint).toContain('### Real failures\n- lint: eslint reported problems. Next: npm run lint, or npm run gate -- --quick --repair for the mechanical ones.');
    const clean = renderSummary({ ...base, mode: 'quick', state: { tests: {} }, steps: [{ id: 'lint', status: 'passed', seconds: 3.04, peakMB: null }] });
    expect(clean).toBe(['## gate (quick, 2026-11-04 10:12, head 1a2b3c4, protected: no)', '', '| step | status | seconds | peak MB |', '| --- | --- | --- | --- |', '| lint | passed | 3.0 | - |'].join('\n'));
  });

  it('a quarantined pass is listed as passed with quarantined failures and the test count says so', () => {
    const text = renderSummary({
      ...base,
      state,
      steps: [{ id: 'unit tests', status: 'passed (quarantined failures)', seconds: 10, peakMB: 100 }],
      unit: { ...unit, counts: { ...unit.counts, failed: 1 }, real: [], failing: [], newlyQuarantined: [], flaky: [{ ...unit.flaky[0], quarantinedNow: false }] },
    });
    expect(text).toContain('| unit tests | passed (quarantined failures) | 10.0 | 100 |');
    expect(text).toContain('"DescribeTab runs a launch once under StrictMode": already quarantined.');
    expect(text).not.toContain('### Real failures');
  });

  it('says when too many tests failed to check each one again, when a file did not load and on a protected gate', () => {
    const text = renderSummary({
      ...base,
      protectedGate: true,
      state: { tests: {} },
      steps: [{ id: 'unit tests', status: 'FAILED', seconds: 1, peakMB: null }],
      unit: {
        ...unit,
        tooMany: true,
        real: [{ kind: 'unit', file: 'src/b.test.js', title: '(file did not run)', project: null, assertion: 'Cannot find module x', where: null, reason: 'file did not run' }],
        flaky: [{ key: 'unit|a|t', kind: 'unit', title: 't', quarantinedNow: false, quarantined: false }],
      },
    });
    expect(text).toContain('protected: yes');
    expect(text).toContain('- unit tests: Too many tests failed to check each one again, so all of them count as real failures.');
    expect(text).toContain('- unit tests: "src/b.test.js" did not load, so its tests did not run.');
    expect(text).toContain('"t": protected gate, so it fails the step.');
  });

  it('names an e2e failure with its project, and a repair that was refused', () => {
    const text = renderSummary({
      ...base,
      state: { tests: {} },
      steps: [{ id: 'e2e (Playwright)', status: 'FAILED', seconds: 1, peakMB: null }],
      e2e: { ...unit, counts: { files: 3, total: 10, passed: 9, failed: 1, skipped: 0, flaky: 0, quarantinedFailures: 0 }, flaky: [], newlyQuarantined: [], real: [{ kind: 'e2e', file: 'e2e/flows/a.spec.js', title: 'Group does x', project: 'flows', assertion: 'boom', where: null, reason: 'failed twice' }] },
      repairs: { committed: null, refused: ['Not repaired: a.js changed more than mechanical fixes, so nothing was changed.'], skipped: [] },
    });
    expect(text).toContain('- e2e: 9 passed, 1 failed, 0 skipped');
    expect(text).toContain('Next: npx playwright test e2e/flows/a.spec.js --project=flows -g "Group does x", then fix the code or the test.');
    expect(text).toContain('### Repairs\n- Not repaired: a.js changed more than mechanical fixes, so nothing was changed.');
  });
});
