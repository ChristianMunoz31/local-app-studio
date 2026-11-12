// Renders the gate summary (DESIGN-phase15 section 2.10): stdout, $GITHUB_STEP_SUMMARY, .gate/run/summary.md and
// .gate/last-summary.md all get this text. Plain words first; a section appears only when it has something to say, except
// the steps table (always) and the budgets table (full runs that measured them). Pure: no file or clock access.
import { TOO_MANY } from './gateClassify.js'
import { activeQuarantine } from './gateState.js'

const KIND_LABEL = { unit: 'unit tests', e2e: 'e2e (Playwright)' }

/** The "Next:" sentence for a step that is always a real failure when it fails. */
const STEP_NEXT = {
  lint: 'eslint reported problems. Next: npm run lint, or npm run gate -- --quick --repair for the mechanical ones.',
  typecheck: 'TypeScript reported errors. Next: npx tsc --noEmit, then fix what it names.',
  build: 'the build failed. Next: npm run build, then fix the first error it prints.',
  'bundle budget': 'the web bundle is over its budget. Next: npm run check:bundle after a build; trim the bundle, or raise the limit on purpose with a rationale in docs/BUDGETS.md.',
  'cloud-off build': 'the build without the cloud provider failed. Next: run the cloud-off steps of npm run gate -- --dry-run by hand.',
  'public build': 'the public build (APP_PRO_DIR=none) failed or holds pro code. Next: npm run check:public, then fix what it names; run npm run build again afterwards for a pro build.',
}

const stepNext = (id) => {
  if (STEP_NEXT[id]) return STEP_NEXT[id]
  if (id.startsWith('hygiene')) return 'a hygiene check failed. Next: npm run check, then fix what it names.'
  if (id.startsWith('sidecar budget')) return 'the sidecar is over its budget. Next: run the budget command for that mode (npm run check:sidecar -- --mode <mode>); trim it, or raise the limit on purpose with a rationale in docs/BUDGETS.md.'
  return 'the step failed. Next: run it alone and read the first error.'
}

const when = (iso) => String(iso ?? '').slice(0, 16).replace('T', ' ')
const quoted = (s) => `"${s}"`

function testsLine(kind, report) {
  const c = report.counts
  const flaky = report.flaky.length
  const failed = Math.max(0, c.failed - flaky)
  let line = `- ${kind}: ${c.passed} passed, ${failed} failed, ${c.skipped} skipped`
  if (flaky > 0) {
    const q = report.flaky.filter((f) => f.quarantined || f.quarantinedNow).length
    line += `; ${flaky} flaky${q === flaky ? ' (quarantined)' : q > 0 ? ` (${q} quarantined)` : ''}`
  }
  return line
}

function realFailure(kind, f) {
  const out = []
  const label = KIND_LABEL[kind]
  if (f.reason === 'file did not run') out.push(`- ${label}: ${quoted(f.file)} did not load, so its tests did not run.`)
  else if (f.reason === 'no report from the second run') out.push(`- ${label}: ${quoted(f.title)} failed, and the second run gave no report, so it is a real failure.`)
  else if (f.reason === 'too many') out.push(`- ${label}: ${quoted(f.title)} failed.`)
  else out.push(`- ${label}: ${quoted(f.title)} failed twice, so it is a real failure.`)
  if (f.assertion) out.push(`  What happened: ${f.assertion}`)
  if (f.where) out.push(`  Where: ${f.where}`)
  const project = kind === 'e2e' && f.project ? ` --project=${f.project}` : ''
  const run = kind === 'unit' ? `npx vitest run ${f.file} -t ${quoted(f.title)}` : `npx playwright test ${f.file}${project} -g ${quoted(f.title)}`
  if (f.reason !== 'file did not run') out.push(`  Next: ${run}, then fix the code or the test.`)
  else out.push(`  Next: ${kind === 'unit' ? `npx vitest run ${f.file}` : `npx playwright test ${f.file}`}, then fix what stops the file from loading.`)
  return out
}

/**
 * @param {{ mode: string, at: string, head?: string, protectedGate?: boolean, steps: { id: string, status: string, seconds?: number, peakMB?: number | null }[],
 *   unit?: object | null, e2e?: object | null, state?: { tests: Record<string, object> }, now?: number,
 *   budgets?: { label: string, measured: number, limit: number, headroomPct: number, delta: number | null }[], decisions?: string[],
 *   repairs?: { committed?: { sha: string, files: string[], rules: string[] } | null, refused?: string[], skipped?: string[] } | null,
 *   ledgerLine?: number | null, stateNote?: string }} i
 * @returns {string}
 */
export function renderSummary(i) {
  const reports = [['unit', i.unit ?? null], ['e2e', i.e2e ?? null]].filter(([, r]) => r)
  const out = [`## gate (${i.mode}, ${when(i.at)}, head ${String(i.head ?? '').slice(0, 7) || 'unknown'}, protected: ${i.protectedGate ? 'yes' : 'no'})`, '']

  out.push('| step | status | seconds | peak MB |', '| --- | --- | --- | --- |')
  for (const s of i.steps) {
    const ran = s.status.startsWith('passed') || s.status === 'FAILED'
    out.push(`| ${s.id} | ${s.status} | ${ran && typeof s.seconds === 'number' ? s.seconds.toFixed(1) : '-'} | ${s.peakMB ?? '-'} |`)
  }
  out.push('')

  if (reports.length > 0) out.push('### Tests', ...reports.map(([kind, r]) => testsLine(kind, r)), '')

  const real = []
  for (const [kind, r] of reports) {
    if (r.tooMany) real.push(`- ${KIND_LABEL[kind]}: ${TOO_MANY}`)
    for (const f of r.real) real.push(...realFailure(kind, f))
    if (r.unexplained) real.push(`- ${KIND_LABEL[kind]}: the run failed and no test report could be read, so it counts as a real failure. Next: ${kind === 'unit' ? 'npx vitest run' : 'npx playwright test'} and read the first error.`)
  }
  for (const s of i.steps) if (s.status === 'FAILED' && !Object.values(KIND_LABEL).includes(s.id)) real.push(`- ${s.id}: ${stepNext(s.id)}`)
  if (real.length > 0) out.push('### Real failures', ...real, '')

  const state = i.state ?? { tests: {} }
  const flaky = []
  for (const [kind, r] of reports) {
    for (const f of r.flaky) {
      const streak = state.tests[f.key]?.flakyStreak ?? 0
      let verdict
      if (i.protectedGate) verdict = 'protected gate, so it fails the step'
      else if (f.quarantinedNow) verdict = `flaky ${streak} runs in a row, quarantined now`
      else if (f.quarantined) verdict = 'already quarantined'
      else verdict = `flaky ${streak} run in a row, quarantined after 2`
      flaky.push(`- ${kind}: ${quoted(f.title)}: ${verdict}.`)
    }
  }
  if (flaky.length > 0) out.push('### Flaky (failed, then passed when run again alone)', ...flaky, '')

  const active = activeQuarantine(state, i.now ?? Date.parse(i.at))
  const sum = (key) => reports.reduce((n, [, r]) => n + (r[key] ?? []).length, 0)
  const events = { added: sum('newlyQuarantined'), released: sum('released'), expired: sum('expired') }
  if (active.length > 0 || events.added + events.released + events.expired > 0 || i.stateNote) {
    out.push('### Quarantine (.gate/flaky.json)')
    for (const [, e] of active) out.push(`- ${e.kind}: ${quoted(e.title)} until ${when(e.quarantine.until)} (since run ${e.quarantine.runId}); failing runs in a row: ${e.failStreak} of 3`)
    out.push(`- Newly quarantined: ${events.added}. Released after 3 failing runs: ${events.released}. Expired: ${events.expired}.`)
    if (i.stateNote) out.push(`- ${i.stateNote}`)
    out.push('')
  }

  if ((i.budgets ?? []).length > 0) {
    out.push('### Budgets (headroom, change since the last full run)', '| budget | measured | limit | headroom | change |', '| --- | ---: | ---: | ---: | ---: |')
    for (const b of i.budgets) {
      const change = b.delta === null || b.delta === undefined ? '-' : `${b.delta > 0 ? '+' : ''}${b.delta.toFixed(2)}`
      out.push(`| ${b.label} | ${b.measured.toFixed(2)} | ${b.limit} | ${b.headroomPct.toFixed(2)}% | ${change} |`)
    }
    out.push(...(i.decisions ?? []), '')
  }

  const r = i.repairs
  if (r && (r.committed || (r.refused ?? []).length > 0 || (r.skipped ?? []).length > 0)) {
    out.push('### Repairs')
    if (r.committed) {
      const sha = r.committed.sha.slice(0, 7)
      out.push(`- Committed ${sha} "chore(gate): mechanical fixes" (${r.committed.files.length} files, rules: ${r.committed.rules.join(', ')}). Revert with: git revert ${sha}`)
    }
    for (const line of r.refused ?? []) out.push(`- ${line}`)
    for (const line of r.skipped ?? []) out.push(`- ${line}`)
    out.push('')
  }

  if (typeof i.ledgerLine === 'number') out.push(`Ledger: .gate/ledger.jsonl (line ${i.ledgerLine})`)
  while (out.at(-1) === '') out.pop()
  return out.join('\n')
}
