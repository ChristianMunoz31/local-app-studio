// The phase gate's markdown (scripts/phase/lib/gateRender.js, DESIGN-phase24 section 2.5): the literal example from a fixture
// state, and the cell grammar for every kind of non-pass.
import { describe, expect, it } from 'vitest'
import { buildPlan } from '../../scripts/phase/lib/gatePlan.js'
import { cellFor, isGitleaksSkip, renderJson, renderMarkdown } from '../../scripts/phase/lib/gateRender.js'

const HEAD = `abc1234${'0'.repeat(33)}`
const FLAKY_FILE = 'src/studio/pages/__tests__/DataTab.test.tsx'
const FLAKY_TITLE = 'DataTab keeps the edited cell'

const pins = 'pins: server/__tests__/ciPipeline.test.js, server/__tests__/sidecarBudget.test.js'
const budget = (id, measured, limit, headroomPct) => ({ id, measured, limit, headroomPct })
const unit = (passed, skipped) => ({ unit: { passed, skipped, failed: 0, quarantinedFailures: 0 } })
const e2e = (passed, skipped) => ({ e2e: { passed, skipped, failed: 0, quarantinedFailures: 0 } })

function fresh(builds = ['pro', 'public']) {
  const options = { builds, classify: true, maxWorkers: 4, e2eShards: 3, waitFor: null, logDir: 'logs' }
  const steps = buildPlan({ phase: 24, builds, classify: true, maxWorkers: 4, e2eShards: 3, resultDir: 'res' })
  return { v: 1, phase: 24, runId: 'p24-20261106-1402', createdAt: '2026-11-06T14:02:00.000Z', head: HEAD, branch: 'feat/phase24-phase-scripts', options, runner: null, steps }
}

function set(state, key, patch) {
  const s = state.steps.find((x) => x.key === key)
  if (!s) throw new Error(`no step ${key}`)
  Object.assign(s, patch)
}

const ok = (state, key, result = null) => set(state, key, { status: 'pass', seconds: 1, endedAt: '2026-11-06T15:00:00.000Z', result })

function passingFixture() {
  const state = fresh()
  for (const s of state.steps) ok(state, s.key, s.kind === 'direct' ? { exitCode: 0 } : { results: [{ id: s.slug, status: 'passed' }] })
  // gitleaks is missing on this PC in both builds
  for (const b of ['pro', 'public']) {
    set(state, `${b}:hygiene-gitleaks`, { status: 'not-run', reason: 'gitleaks is not on PATH, CI runs it', result: { results: [{ id: 'hygiene: gitleaks', status: 'skipped', reason: 'gitleaks is not on PATH, CI runs it' }] } })
  }
  const tests = {
    'pro:unit-frontend': unit(2826, 0), 'public:unit-frontend': unit(2779, 33),
    'pro:unit-pure': unit(3212, 3), 'public:unit-pure': unit(3144, 3),
    'pro:unit-backend': unit(6738, 16), 'public:unit-backend': unit(5393, 239),
  }
  for (const [key, t] of Object.entries(tests)) set(state, key, { result: { results: [{ status: 'passed' }], tests: t } })
  set(state, 'public:unit-frontend', {
    status: 'fail-flake',
    reason: '1 flaky, passed alone',
    result: { results: [{ status: 'FAILED' }], tests: unit(2779, 33), failures: { real: [], flaky: [{ kind: 'unit', file: FLAKY_FILE, title: FLAKY_TITLE }], unexplained: false, tooMany: false } },
  })
  const shards = [['flows-1of3', 100, 3, 80, 20], ['flows-2of3', 90, 2, 70, 20], ['flows-3of3', 40, 1, 31, 10], ['first-run', 20, 1, 12, 5], ['a11y', 13, 0, 8, 3]]
  for (const [name, p, sk, pp, psk] of shards) {
    set(state, `pro:e2e-${name}`, { result: { results: [{ status: 'passed' }], tests: e2e(p, sk) } })
    set(state, `public:e2e-${name}`, { result: { results: [{ status: 'passed' }], tests: e2e(pp, psk) } })
  }
  const decisions = [
    `Needs a decision (pro build): raise with a rationale in BUDGETS.md (sidecar.studio.bundleKb has 1.31 percent left; ${pins}).`,
    `Needs a decision (pro build): raise with a rationale in BUDGETS.md (sidecar.studio.bundleGzipKb has 1.12 percent left; ${pins}).`,
  ]
  const res = (budgets, extra = {}) => ({ results: [{ status: 'passed' }], budgets, ...extra })
  set(state, 'pro:bundle-budget', { result: res([budget('web.totalJsGzipKb', 521.39, 530, 1.62), budget('web.initialJsGzipKb', 130.41, 146, 10.68), budget('web.totalCssGzipKb', 31.72, 36, 11.89)]) })
  set(state, 'public:bundle-budget', { result: res([budget('web.totalJsGzipKb', 518.56, 530, 2.16), budget('web.initialJsGzipKb', 130.35, 146, 10.72), budget('web.totalCssGzipKb', 31.72, 36, 11.89)]) })
  set(state, 'pro:sidecar-studio', { result: res([budget('sidecar.studio.bundleKb', 3757, 3807, 1.31), budget('sidecar.studio.bundleGzipKb', 1140.09, 1153, 1.12)], { decisions }) })
  set(state, 'public:sidecar-studio', { result: res([budget('sidecar.studio.bundleKb', 3633, 3807, 4.57), budget('sidecar.studio.bundleGzipKb', 1096.37, 1153, 4.91)]) })
  set(state, 'pro:sidecar-runtime', { result: res([budget('sidecar.runtime.bundleKb', 3419, 3497, 2.23), budget('sidecar.runtime.bundleGzipKb', 1031.01, 1053, 2.09)]) })
  set(state, 'public:sidecar-runtime', { result: res([budget('sidecar.runtime.bundleKb', 3375, 3497, 3.49), budget('sidecar.runtime.bundleGzipKb', 1016.54, 1053, 3.48)]) })
  set(state, 'public:public-build', { endedAt: '2026-11-06T16:41:00.000Z' })
  return state
}

const EXAMPLE = `Needs a decision (pro build): raise with a rationale in BUDGETS.md (sidecar.studio.bundleKb has 1.31 percent left; pins: server/__tests__/ciPipeline.test.js, server/__tests__/sidecarBudget.test.js).
Needs a decision (pro build): raise with a rationale in BUDGETS.md (sidecar.studio.bundleGzipKb has 1.12 percent left; pins: server/__tests__/ciPipeline.test.js, server/__tests__/sidecarBudget.test.js).

Gates by scripts/phase/gate.js, run p24-20261106-1402 at abc1234, pro then public (APP_PRO_DIR=none), 2026-11-06 14:02 to 16:41 UTC.

| Gate | Pro | Public (APP_PRO_DIR=none) |
| --- | --- | --- |
| vitest frontend | 2826 passed, 0 skipped | 2779 passed, 33 skipped; 1 flaky (src/studio/pages/__tests__/DataTab.test.tsx "DataTab keeps the edited cell"), passed alone |
| vitest pure | 3212 passed, 3 skipped | 3144 passed, 3 skipped |
| vitest backend | 6738 passed, 16 skipped | 5393 passed, 239 skipped |
| templateParity | ok | n/a |
| lint | 0 | 0 |
| tsc (outside vendor) | 0 | 0 |
| check | ok (gitleaks not on PATH, CI runs it) | ok (gitleaks not on PATH, CI runs it) |
| check:public | n/a | ok (pro and cloud markers absent) |
| bundle total / initial / CSS (530 / 146 / 36) | 521.39 / 130.41 / 31.72 | 518.56 / 130.35 / 31.72 |
| studio sidecar raw / gzip (3807 / 1153) | 3757 / 1140.09 | 3633 / 1096.37 |
| runtime sidecar raw / gzip (3497 / 1053) | 3419 / 1031.01 | 3375 / 1016.54 |
| pro marker present | web, studio, runtime | n/a |
| cloud-off build | ok | n/a |
| e2e | 263 passed, 7 skipped | 201 passed, 58 skipped |

Headroom (pro): web total 1.62%, initial 10.68%, CSS 11.89%; studio sidecar 1.31% raw, 1.12% gzip; runtime sidecar 2.23% raw, 2.09% gzip.
Headroom (public): web total 2.16%, initial 10.72%, CSS 11.89%; studio sidecar 4.57% raw, 4.91% gzip; runtime sidecar 3.49% raw, 3.48% gzip.

Not passed:
- public:unit-frontend: fail-flake (1 flaky, passed alone), log p24-public-unit-frontend.log
`

describe('renderMarkdown', () => {
  it('reproduces the literal example of the design from a fixture state', () => {
    expect(renderMarkdown(passingFixture())).toBe(EXAMPLE)
  })

  it('deduplicates decisions and puts pro before public', () => {
    const state = passingFixture()
    const line = 'Needs a decision (public build): raise with a rationale in BUDGETS.md (x has 1.00 percent left; pins: a, b).'
    set(state, 'public:sidecar-runtime', { result: { results: [{ status: 'passed' }], decisions: [line, line] } })
    const lines = renderMarkdown(state).split('\n')
    expect(lines[2]).toBe(line)
    expect(lines.filter((l) => l === line)).toHaveLength(1)
  })

  it('lists steps that did not pass and names the failure in the cell', () => {
    const state = passingFixture()
    set(state, 'pro:unit-backend', { status: 'fail-real', reason: 'exit 1', log: 'p24-pro-unit-backend.log', result: { results: [{ status: 'FAILED' }], failures: { real: [{ file: 'a.test.js', title: 'x > y' }, { file: 'b.test.js', title: 'z' }, { file: 'c.test.js', title: 'w' }], flaky: [], unexplained: false, tooMany: false } } })
    set(state, 'pro:lint', { status: 'fail-real', reason: 'exit 1', log: 'p24-pro-lint.log', result: { results: [{ status: 'FAILED' }] } })
    set(state, 'public:e2e-a11y', { status: 'not-run', reason: 'needs public:build, which did not pass', log: 'p24-public-e2e-a11y.log' })
    const md = renderMarkdown(state)
    expect(md).toContain('| vitest backend | FAILED: 3 real (a.test.js "x > y", b.test.js "z"), log p24-pro-unit-backend.log |')
    expect(md).toContain('| lint | FAILED, log p24-pro-lint.log | 0 |')
    expect(md).toContain('| e2e | 263 passed, 7 skipped | [e2e-a11y] not run (needs public:build, which did not pass) |')
    expect(md.endsWith('\nNot passed:\n- pro:lint: fail-real (exit 1), log p24-pro-lint.log\n- pro:unit-backend: fail-real (exit 1), log p24-pro-unit-backend.log\n- public:unit-frontend: fail-flake (1 flaky, passed alone), log p24-public-unit-frontend.log\n- public:e2e-a11y: not-run (needs public:build, which did not pass), log p24-public-e2e-a11y.log\n')).toBe(true)
  })

  it('says no test report for a test step with an unexplained failure, and prefixes the slug in a multi step row', () => {
    const state = passingFixture()
    set(state, 'pro:e2e-first-run', { status: 'fail-real', reason: 'exit 1', log: 'p24-pro-e2e-first-run.log', result: { results: [{ status: 'FAILED' }], failures: { real: [], flaky: [], unexplained: true, tooMany: false } } })
    expect(cellFor(state, 'e2e', 'pro')).toBe('[e2e-first-run] FAILED: no test report, log p24-pro-e2e-first-run.log')
  })

  it('shows quarantined failures in a pass cell', () => {
    const state = passingFixture()
    set(state, 'pro:unit-pure', { result: { results: [{ status: 'passed (quarantined failures)' }], tests: { unit: { passed: 10, skipped: 1, quarantinedFailures: 2 } } } })
    expect(cellFor(state, 'vitest pure', 'pro')).toBe('10 passed, 1 skipped; 2 quarantined failures')
  })

  it('shows not in this run for a build the run did not cover and a pro only run without the public lines', () => {
    const state = fresh(['pro'])
    const md = renderMarkdown(state)
    expect(md).toContain('| lint | pending | not in this run |')
    expect(md).toContain(', pro, 2026-11-06 14:02 UTC, in progress.')
    expect(md).toContain('Headroom (pro): not measured yet')
    expect(md).not.toContain('Headroom (public)')
  })

  it('names extra heads when a step ran at another commit', () => {
    const state = passingFixture()
    set(state, 'pro:lint', { head: `def5678${'0'.repeat(33)}` })
    expect(renderMarkdown(state)).toContain('at abc1234 (also def5678),')
  })

  it('knows the gitleaks skip only for that step and reason', () => {
    expect(isGitleaksSkip({ slug: 'hygiene-gitleaks', status: 'not-run', reason: 'gitleaks is not on PATH, CI runs it' })).toBe(true)
    expect(isGitleaksSkip({ slug: 'hygiene-keys', status: 'not-run', reason: 'gitleaks is not on PATH' })).toBe(false)
    expect(isGitleaksSkip({ slug: 'hygiene-gitleaks', status: 'fail-real', reason: 'exit 1' })).toBe(false)
  })
})

describe('renderJson', () => {
  it('has the state, the rows, the decisions and the headroom per build', () => {
    const j = renderJson(passingFixture())
    expect(j.v).toBe(1)
    expect(j.rows).toHaveLength(14)
    expect(j.rows[0]).toEqual({ row: 'vitest frontend', pro: '2826 passed, 0 skipped', public: expect.stringContaining('1 flaky') })
    expect(j.decisions.pro).toHaveLength(2)
    expect(j.decisions.public).toEqual([])
    expect(j.headroom.public['sidecar.studio.bundleKb']).toBe(4.57)
    expect(j.state.runId).toBe('p24-20261106-1402')
  })

  it('lists a fail-flake step in the Not passed block, together with the other failures in plan order', () => {
    const state = passingFixture()
    set(state, 'pro:lint', { status: 'fail-real', reason: 'exit 1', log: 'p24-pro-lint.log', result: { results: [{ status: 'FAILED' }] } })
    const tail = renderMarkdown(state).split('Not passed:\n')[1]
    expect(tail).toBe('- pro:lint: fail-real (exit 1), log p24-pro-lint.log\n- public:unit-frontend: fail-flake (1 flaky, passed alone), log p24-public-unit-frontend.log\n')
  })
})
