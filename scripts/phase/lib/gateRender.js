// The phase gate's markdown and JSON from the state file (docs/phase24/DESIGN-phase24.md, section 2.5). Pure.

const PUBLIC_HEADER = 'Public (APP_PRO_DIR=none)'
const GITLEAKS_SKIP = /not on PATH/i

const ROW_ORDER = ['vitest frontend', 'vitest pure', 'vitest backend', 'templateParity', 'lint', 'tsc (outside vendor)', 'check', 'check:public', 'bundle', 'studio sidecar', 'runtime sidecar', 'pro marker present', 'cloud-off build', 'e2e']
const TEST_KIND = (row) => (row.startsWith('vitest') ? 'unit' : row === 'e2e' ? 'e2e' : null)
const num = (n) => String(n)
const cell = (t) => String(t).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')

/** A hygiene: gitleaks step that was skipped because the binary is missing: not a failure. */
export const isGitleaksSkip = (s) => s.slug === 'hygiene-gitleaks' && s.status === 'not-run' && GITLEAKS_SKIP.test(String(s.reason ?? ''))

/** Steps that count as not passed (the "Not passed" block and the cells). */
const notPassed = (s) => s.status !== 'pass' && !isGitleaksSkip(s)

const budgetsOf = (s) => (Array.isArray(s.result?.budgets) ? s.result.budgets : [])

function testsOf(step, kind) {
  return step.result?.tests?.[kind] ?? null
}

function passText(steps, kind) {
  let passed = 0
  let skipped = 0
  let q = 0
  for (const s of steps) {
    const t = testsOf(s, kind)
    if (!t) continue
    passed += t.passed ?? 0
    skipped += t.skipped ?? 0
    q += t.quarantinedFailures ?? 0
  }
  return `${num(passed)} passed, ${num(skipped)} skipped${q > 0 ? `; ${num(q)} quarantined failures` : ''}`
}

const named = (list) => list.slice(0, 2).map((f) => `${f.file} "${f.title}"`).join(', ')

/** The cell of one step that did not pass. */
function failCell(s, kind) {
  switch (s.status) {
    case 'pending':
      return 'pending'
    case 'running':
      return 'running'
    case 'not-run':
      return `not run (${s.reason ?? 'no reason recorded'})`
    case 'fail-flake': {
      const flaky = s.result?.failures?.flaky ?? []
      return `${passText([s], kind)}; ${num(flaky.length)} flaky (${named(flaky)}), passed alone`
    }
    default: {
      const f = s.result?.failures
      const real = Array.isArray(f?.real) ? f.real : []
      if (real.length > 0) return `FAILED: ${num(real.length)} real (${named(real)}), log ${s.log}`
      if (kind && (f?.unexplained || !s.result?.tests?.[kind])) return `FAILED: no test report, log ${s.log}`
      return `FAILED, log ${s.log}`
    }
  }
}

/** The cell of a row whose steps all passed. */
function passCell(row, steps, kind) {
  if (kind) return passText(steps, kind)
  switch (row) {
    case 'lint':
    case 'tsc (outside vendor)':
      return '0'
    case 'check':
      return `ok${steps.some(isGitleaksSkip) ? ' (gitleaks not on PATH, CI runs it)' : ''}`
    case 'check:public':
      return 'ok (pro and cloud markers absent)'
    case 'pro marker present':
      return 'web, studio, runtime'
    case 'bundle':
      return numbers(steps, ['web.totalJsGzipKb', 'web.initialJsGzipKb', 'web.totalCssGzipKb'], 'measured')
    case 'studio sidecar':
      return numbers(steps, ['sidecar.studio.bundleKb', 'sidecar.studio.bundleGzipKb'], 'measured')
    case 'runtime sidecar':
      return numbers(steps, ['sidecar.runtime.bundleKb', 'sidecar.runtime.bundleGzipKb'], 'measured')
    default:
      return 'ok'
  }
}

function budgetValue(steps, id, field) {
  for (const s of steps) {
    const b = budgetsOf(s).find((x) => x.id === id)
    if (b && b[field] !== undefined && b[field] !== null) return b[field]
  }
  return null
}

function numbers(steps, ids, field) {
  const vals = ids.map((id) => budgetValue(steps, id, field))
  return vals.some((v) => v === null) ? 'ok' : vals.map(num).join(' / ')
}

/** One cell: a build the run did not cover, a row the build does not have, or the steps' result. */
export function cellFor(state, row, build) {
  if (!state.options.builds.includes(build)) return 'not in this run'
  const steps = state.steps.filter((s) => s.build === build && s.row === row)
  if (steps.length === 0) return 'n/a'
  const kind = TEST_KIND(row)
  const bad = steps.find(notPassed)
  if (!bad) return passCell(row, steps, kind)
  const text = failCell(bad, kind)
  return steps.length > 1 ? `[${bad.slug}] ${text}` : text
}

/** Row label with the pro limits, for the rows that have a budget. */
function labelFor(state, row) {
  const pro = state.steps.filter((s) => s.build === 'pro')
  const limits = (ids) => ids.map((id) => budgetValue(pro, id, 'limit'))
  const withLimits = (label, ids) => {
    const l = limits(ids)
    return l.some((v) => v === null) ? label : `${label} (${l.map(num).join(' / ')})`
  }
  switch (row) {
    case 'bundle':
      return withLimits('bundle total / initial / CSS', ['web.totalJsGzipKb', 'web.initialJsGzipKb', 'web.totalCssGzipKb'])
    case 'studio sidecar':
      return withLimits('studio sidecar raw / gzip', ['sidecar.studio.bundleKb', 'sidecar.studio.bundleGzipKb'])
    case 'runtime sidecar':
      return withLimits('runtime sidecar raw / gzip', ['sidecar.runtime.bundleKb', 'sidecar.runtime.bundleGzipKb'])
    default:
      return row
  }
}

/** The children's "Needs a decision" lines, deduplicated, pro first then public. */
export function decisionsOf(state, build) {
  const seen = new Set()
  for (const s of state.steps) {
    if (s.build !== build || !Array.isArray(s.result?.decisions)) continue
    for (const d of s.result.decisions) if (typeof d === 'string') seen.add(d)
  }
  return [...seen]
}

/** Headroom per budget id (percent, two decimals) for one build. */
export function headroomOf(state, build) {
  const out = {}
  for (const s of state.steps) {
    if (s.build !== build) continue
    for (const b of budgetsOf(s)) if (typeof b.headroomPct === 'number') out[b.id] = b.headroomPct
  }
  return out
}

function headroomLine(state, build) {
  const h = headroomOf(state, build)
  const pct = (id) => (id in h ? `${h[id].toFixed(2)}%` : null)
  const groups = []
  const web = [['total', 'web.totalJsGzipKb'], ['initial', 'web.initialJsGzipKb'], ['CSS', 'web.totalCssGzipKb']].filter(([, id]) => pct(id) !== null)
  if (web.length) groups.push(`web ${web.map(([n, id]) => `${n} ${pct(id)}`).join(', ')}`)
  for (const kind of ['studio', 'runtime']) {
    const raw = pct(`sidecar.${kind}.bundleKb`)
    const gz = pct(`sidecar.${kind}.bundleGzipKb`)
    const parts = [raw && `${raw} raw`, gz && `${gz} gzip`].filter(Boolean)
    if (parts.length) groups.push(`${kind} sidecar ${parts.join(', ')}`)
  }
  return `Headroom (${build}): ${groups.length ? groups.join('; ') : 'not measured yet'}${groups.length ? '.' : ''}`
}

const stamp = (iso) => `${iso.slice(0, 10)} ${iso.slice(11, 16)}`

function contextLine(state) {
  const builds = state.options.builds
  const which = builds.length === 2 ? 'pro then public (APP_PRO_DIR=none)' : builds[0] === 'public' ? 'public (APP_PRO_DIR=none)' : 'pro'
  const heads = [...new Set(state.steps.map((s) => s.head).filter((h) => h && h !== state.head))].map((h) => h.slice(0, 7))
  const at = `${state.head.slice(0, 7)}${heads.length ? ` (also ${heads.join(', ')})` : ''}`
  const ends = state.steps.map((s) => s.endedAt).filter(Boolean).sort()
  const open = state.steps.some((s) => s.status === 'pending' || s.status === 'running')
  let when
  if (open || ends.length === 0) when = `${stamp(state.createdAt)} UTC, in progress`
  else {
    const end = ends[ends.length - 1]
    when = `${stamp(state.createdAt)} to ${end.slice(0, 10) === state.createdAt.slice(0, 10) ? end.slice(11, 16) : stamp(end)} UTC`
  }
  return `Gates by scripts/phase/gate.js, run ${state.runId} at ${at}, ${which}, ${when}.`
}

/** The rows of the table, in order. */
export function rowsOf(state) {
  return ROW_ORDER.filter((r) => state.steps.some((s) => s.row === r)).map((row) => ({ row: labelFor(state, row), pro: cellFor(state, row, 'pro'), public: cellFor(state, row, 'public') }))
}

/** The markdown of 2.5. */
export function renderMarkdown(state) {
  const decisions = [...decisionsOf(state, 'pro'), ...decisionsOf(state, 'public').filter((d) => !decisionsOf(state, 'pro').includes(d))]
  const out = []
  if (decisions.length) out.push(...decisions, '')
  out.push(contextLine(state), '')
  out.push(`| Gate | Pro | ${PUBLIC_HEADER} |`, '| --- | --- | --- |')
  for (const r of rowsOf(state)) out.push(`| ${cell(r.row)} | ${cell(r.pro)} | ${cell(r.public)} |`)
  out.push('')
  for (const b of ['pro', 'public']) if (state.options.builds.includes(b)) out.push(headroomLine(state, b))
  // Design 2.5: every step that did not pass is listed, a fail-flake step too (its cell also says it passed alone).
  const bad = state.steps.filter((s) => notPassed(s) && (s.status === 'fail-real' || s.status === 'not-run' || s.status === 'fail-flake'))
  if (bad.length) {
    out.push('', 'Not passed:')
    for (const s of bad) out.push(`- ${s.key}: ${s.status} (${s.reason ?? 'see log'}), log ${s.log}`)
  }
  return `${out.join('\n')}\n`
}

/** The `--json` document. */
export function renderJson(state) {
  return {
    v: 1,
    state,
    rows: rowsOf(state),
    decisions: { pro: decisionsOf(state, 'pro'), public: decisionsOf(state, 'public') },
    headroom: { pro: headroomOf(state, 'pro'), public: headroomOf(state, 'public') },
  }
}
