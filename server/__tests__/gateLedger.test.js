// The trend ledger (scripts/ci/gateLedger.js, DESIGN-phase15 section 2.8): entry shape, headroom math, the "Needs a decision"
// line with both pins, the change since the last full run, and the 500 line trim.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUDGETS, LEDGER_MAX_LINES, appendEntry, budgetRows, buildEntry, lastFull, main, needsDecision, readLedger, withHeadroom } from '../../scripts/ci/gateLedger.js';

const temps = [];
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-ledger-'));
  temps.push(dir);
  return dir;
};
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const bundle = { measured: { initialJsGzipKb: 128.68, totalJsGzipKb: 420, largestJsGzipKb: 90, totalCssGzipKb: 30.2 }, limits: { initialJsGzipKb: 146, totalJsGzipKb: 530, largestJsGzipKb: 120, totalCssGzipKb: 36 } };
const studio = { measured: { bundleKb: 3700, bundleGzipKb: 1118.2 }, limits: { bundleKb: 3800, bundleGzipKb: 1147 } };
const runtime = { measured: { bundleKb: 3400, bundleGzipKb: 1032.1 }, limits: { bundleKb: 3497, bundleGzipKb: 1053 } };

describe('budgets', () => {
  it('knows eight budgets, each pinned in two files', () => {
    expect(BUDGETS.map((b) => b.id)).toEqual([
      'web.initialJsGzipKb',
      'web.totalJsGzipKb',
      'web.largestJsGzipKb',
      'web.totalCssGzipKb',
      'sidecar.studio.bundleKb',
      'sidecar.studio.bundleGzipKb',
      'sidecar.runtime.bundleKb',
      'sidecar.runtime.bundleGzipKb',
    ]);
    for (const b of BUDGETS) expect(b.pins).toHaveLength(2);
    expect(BUDGETS.find((b) => b.id === 'sidecar.studio.bundleKb').pins).toEqual(['server/__tests__/ciPipeline.test.js', 'server/__tests__/sidecarBudget.test.js']);
    expect(BUDGETS.find((b) => b.id === 'web.totalJsGzipKb').pins).toEqual(['scripts/checks/bundle-budget.json', 'server/__tests__/ciPipeline.test.js']);
  });

  it('reads measured values and limits from the three --json files, skipping what is missing', () => {
    expect(budgetRows({ bundle, studio, runtime })).toHaveLength(8);
    expect(budgetRows({ studio })).toEqual([
      { id: 'sidecar.studio.bundleKb', measured: 3700, limit: 3800 },
      { id: 'sidecar.studio.bundleGzipKb', measured: 1118.2, limit: 1147 },
    ]);
    expect(budgetRows()).toEqual([]);
  });

  it('headroom is (limit - measured) / limit in percent with two decimals; the change comes from the previous full line', () => {
    const rows = budgetRows({ studio });
    const first = withHeadroom(rows, null);
    expect(first.find((b) => b.id === 'sidecar.studio.bundleGzipKb')).toMatchObject({ headroomPct: 2.51, delta: null });
    const previous = { budgets: [{ id: 'sidecar.studio.bundleGzipKb', measured: 1105.44 }] };
    expect(withHeadroom(rows, previous).find((b) => b.id === 'sidecar.studio.bundleGzipKb').delta).toBe(12.76);
  });

  it('under 2 percent prints Needs a decision with both pins; at 2 percent it prints nothing; the gate never edits a limit', () => {
    const rows = withHeadroom(budgetRows({ runtime }), null);
    const lines = needsDecision(rows);
    expect(lines).toEqual(['Needs a decision: raise with a rationale in BUDGETS.md (sidecar.runtime.bundleGzipKb has 1.98 percent left; pins: server/__tests__/ciPipeline.test.js, server/__tests__/sidecarBudget.test.js).']);
    expect(needsDecision(withHeadroom([{ id: 'sidecar.runtime.bundleGzipKb', measured: 98, limit: 100 }], null))).toEqual([]);
  });
});

describe('the file', () => {
  it('appends one JSON line per entry and trims to the last 500', () => {
    const file = path.join(tmp(), 'ledger.jsonl');
    for (let i = 0; i < LEDGER_MAX_LINES + 5; i += 1) appendEntry({ v: 1, i, mode: 'full' }, file);
    const entries = readLedger(file);
    expect(entries).toHaveLength(LEDGER_MAX_LINES);
    expect(entries[0].i).toBe(5);
    expect(entries.at(-1).i).toBe(LEDGER_MAX_LINES + 4);
    expect(fs.readFileSync(file, 'utf8').endsWith('\n')).toBe(true);
  });

  it('skips a damaged line and finds the last full entry', () => {
    const file = path.join(tmp(), 'ledger.jsonl');
    fs.writeFileSync(file, `${JSON.stringify({ mode: 'full', n: 1 })}\nnot json\n${JSON.stringify({ mode: 'ci', n: 2 })}\n`);
    const entries = readLedger(file);
    expect(entries).toHaveLength(2);
    expect(lastFull(entries).n).toBe(1);
    expect(lastFull([])).toBeNull();
    expect(readLedger(path.join(tmp(), 'none.jsonl'))).toEqual([]);
  });
});

describe('buildEntry', () => {
  it('has the documented shape', () => {
    const report = { counts: { files: 560, total: 10520, passed: 10517, failed: 3, skipped: 2, flaky: 1, quarantinedFailures: 1 }, newlyQuarantined: ['k'], released: [], expired: [] };
    const state = { tests: { k: { quarantine: { until: '2026-11-11T10:12:00.000Z' } } } };
    const entry = buildEntry({
      runId: 'r1',
      at: '2026-11-04T10:12:00.000Z',
      mode: 'full',
      protectedGate: false,
      head: 'abc',
      branch: 'feat/x',
      exitCode: 0,
      steps: [{ id: 'lint', status: 'passed', seconds: 1.5, peakMB: 80, extra: 'dropped' }],
      unit: report,
      e2e: null,
      budgets: [],
      state,
      now: Date.parse('2026-11-04T10:12:00.000Z'),
    });
    expect(entry).toEqual({
      v: 1,
      runId: 'r1',
      at: '2026-11-04T10:12:00.000Z',
      mode: 'full',
      protected: false,
      head: 'abc',
      branch: 'feat/x',
      exitCode: 0,
      steps: [{ id: 'lint', status: 'passed', seconds: 1.5, peakMB: 80 }],
      tests: { unit: { files: 560, total: 10520, passed: 10518, failed: 2, skipped: 2, flaky: 1, quarantinedFailures: 1 } },
      budgets: [],
      quarantine: { active: ['k'], new: ['k'], released: [], expired: [] },
      repair: { committed: null, refused: [] },
    });
  });
});

describe('main (CI)', () => {
  it('builds the entry from the step reports, appends it, prints the summary and writes summary.md', () => {
    const root = tmp();
    const run = path.join(root, '.gate/run');
    fs.mkdirSync(run, { recursive: true });
    fs.writeFileSync(path.join(run, 'bundle.json'), JSON.stringify(bundle));
    fs.writeFileSync(path.join(run, 'sidecar-runtime.json'), JSON.stringify(runtime));
    fs.writeFileSync(path.join(run, 'unit-outcome.json'), JSON.stringify({ v: 1, kind: 'unit', counts: { files: 1, total: 2, passed: 2, failed: 0, skipped: 0, flaky: 0, quarantinedFailures: 0 }, real: [], flaky: [], quarantinedFailures: [], newlyQuarantined: [], released: [], expired: [], failing: [], tooMany: false, unexplained: false }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const now = Date.parse('2026-11-04T10:12:00.000Z');
    expect(main(['--from', '.gate/run', '--mode', 'ci'], { GITHUB_RUN_ID: '55', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: 'a'.repeat(40) }, root, now)).toBe(0);
    const entries = readLedger(path.join(root, '.gate/ledger.jsonl'));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ runId: '55-1', mode: 'ci', exitCode: 0, head: 'a'.repeat(40) });
    expect(entries[0].budgets.map((b) => b.id)).toContain('sidecar.runtime.bundleGzipKb');
    const printed = log.mock.calls.join('\n');
    expect(printed).toContain('### Budgets');
    expect(printed).toContain('Needs a decision: raise with a rationale in BUDGETS.md (sidecar.runtime.bundleGzipKb');
    expect(fs.existsSync(path.join(run, 'summary.md'))).toBe(true);
  });

  it('refuses a missing --from value', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(main(['--from'], {}, tmp())).toBe(2);
  });
});
