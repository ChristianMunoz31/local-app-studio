// The trend ledger of the gate: `.gate/ledger.jsonl`, one JSON line per full run (DESIGN-phase15 section 2.8).
// It records the measured numbers, the headroom of every budget and the change since the last full run. It never edits a
// limit: a budget with under 2 percent left only prints "Needs a decision: raise with a rationale in BUDGETS.md".
//   node scripts/ci/gateLedger.js --from .gate/run --mode ci     (CI: build the entry from the step reports, print the summary)
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { REPO_ROOT } from '../checks/gitFiles.js'
import { readOutcome } from './gateClassify.js'
import { activeQuarantine, makeRunId, readState } from './gateState.js'
import { renderSummary } from './gateSummary.js'

export const LEDGER_FILE = '.gate/ledger.jsonl'
export const LEDGER_MAX_LINES = 500
export const HEADROOM_MIN_PCT = 2

const WEB_PINS = ['scripts/checks/bundle-budget.json', 'server/__tests__/ciPipeline.test.js']
const SIDECAR_PINS = ['server/__tests__/ciPipeline.test.js', 'server/__tests__/sidecarBudget.test.js']

/** The eight budgets: id, label for the summary, the two files that pin the limit. */
export const BUDGETS = [
  { id: 'web.initialJsGzipKb', label: 'web initial JS gzip KB', pins: WEB_PINS },
  { id: 'web.totalJsGzipKb', label: 'web total JS gzip KB', pins: WEB_PINS },
  { id: 'web.largestJsGzipKb', label: 'web largest JS gzip KB', pins: WEB_PINS },
  { id: 'web.totalCssGzipKb', label: 'web CSS gzip KB', pins: WEB_PINS },
  { id: 'sidecar.studio.bundleKb', label: 'studio sidecar KB', pins: SIDECAR_PINS },
  { id: 'sidecar.studio.bundleGzipKb', label: 'studio sidecar gzip KB', pins: SIDECAR_PINS },
  { id: 'sidecar.runtime.bundleKb', label: 'runtime sidecar KB', pins: SIDECAR_PINS },
  { id: 'sidecar.runtime.bundleGzipKb', label: 'runtime sidecar gzip KB', pins: SIDECAR_PINS },
]

const round2 = (n) => Math.round(n * 100) / 100

/**
 * Measured values and limits from the `--json` files of the budget scripts.
 * @param {{ bundle?: { measured: Record<string, number>, limits: Record<string, number> } | null,
 *   studio?: { measured: Record<string, number>, limits: Record<string, number> } | null,
 *   runtime?: { measured: Record<string, number>, limits: Record<string, number> } | null }} files
 * @returns {{ id: string, measured: number, limit: number }[]}
 */
export function budgetRows({ bundle = null, studio = null, runtime = null } = {}) {
  const out = []
  const take = (id, source, key) => {
    const measured = source?.measured?.[key]
    const limit = source?.limits?.[key]
    if (typeof measured === 'number' && typeof limit === 'number') out.push({ id, measured, limit })
  }
  for (const key of ['initialJsGzipKb', 'totalJsGzipKb', 'largestJsGzipKb', 'totalCssGzipKb']) take(`web.${key}`, bundle, key)
  for (const key of ['bundleKb', 'bundleGzipKb']) take(`sidecar.studio.${key}`, studio, key)
  for (const key of ['bundleKb', 'bundleGzipKb']) take(`sidecar.runtime.${key}`, runtime, key)
  return out
}

/** Adds headroom (percent of the limit still free), the change since the previous full line, and the pins. */
export function withHeadroom(rows, previous = null) {
  const before = new Map((previous?.budgets ?? []).map((b) => [b.id, b.measured]))
  return rows.map((r) => {
    const meta = BUDGETS.find((b) => b.id === r.id)
    return {
      id: r.id,
      measured: r.measured,
      limit: r.limit,
      headroomPct: round2(((r.limit - r.measured) / r.limit) * 100),
      delta: before.has(r.id) ? round2(r.measured - before.get(r.id)) : null,
      pins: meta?.pins ?? [],
    }
  })
}

/**
 * The "Needs a decision" lines: one per budget with under 2 percent left. The gate never fails on them and never edits a limit.
 * With `build` ('pro' or 'public') the line names it; without it the text is the CI one.
 */
export function needsDecision(budgets, build) {
  const lead = build === undefined ? 'Needs a decision' : `Needs a decision (${build} build)`
  return budgets
    .filter((b) => b.headroomPct < HEADROOM_MIN_PCT)
    .map((b) => `${lead}: raise with a rationale in BUDGETS.md (${b.id} has ${b.headroomPct.toFixed(2)} percent left; pins: ${b.pins.join(', ')}).`)
}

/** Rows for the summary table, with labels. */
export function summaryRows(budgets) {
  return budgets.map((b) => ({ ...b, label: BUDGETS.find((x) => x.id === b.id)?.label ?? b.id }))
}

/** The build of a ledger line: 'public' only when it says so; a line from before this field is a pro build. */
export const buildOfEntry = (e) => (e?.build === 'public' ? 'public' : 'pro')

/**
 * The measured value of every budget id, from the newest line of this build (mode full or only) that holds that id, in the
 * shape withHeadroom reads. A public number is only compared with a public one, and a line from `--only` does not hide the
 * budgets of an earlier line that measured another step.
 * @param {object[]} entries ledger lines, oldest first
 * @param {'pro' | 'public'} build
 * @returns {{ budgets: { id: string, measured: number }[] }}
 */
export function previousFor(entries, build) {
  const seen = new Map()
  for (const e of [...entries].reverse()) {
    if (buildOfEntry(e) !== build || (e.mode !== 'full' && e.mode !== 'only')) continue
    for (const b of e.budgets ?? []) {
      if (!seen.has(b.id) && typeof b.measured === 'number') seen.set(b.id, b.measured)
    }
  }
  return { budgets: [...seen].map(([id, measured]) => ({ id, measured })) }
}

/** The previous ledger line of a full run, or null. */
export function lastFull(entries) {
  return [...entries].reverse().find((e) => e.mode === 'full') ?? null
}

export function readLedger(file = path.join(REPO_ROOT, LEDGER_FILE)) {
  if (!existsSync(file)) return []
  const out = []
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line))
    } catch {
      // a damaged line is skipped, never repaired
    }
  }
  return out
}

/** Appends one entry and trims the file to the last 500 lines. Returns the line number of the entry. */
export function appendEntry(entry, file = path.join(REPO_ROOT, LEDGER_FILE), env = process.env) {
  // The light child of a phase gate pair leaves the shared ledger to the other step (GATE_LIGHT_CHILD=1): nothing is written.
  if (env.GATE_LIGHT_CHILD === '1') return 0
  mkdirSync(path.dirname(file), { recursive: true })
  appendFileSync(file, `${JSON.stringify(entry)}\n`)
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)
  if (lines.length > LEDGER_MAX_LINES) {
    const kept = lines.slice(-LEDGER_MAX_LINES)
    writeFileSync(file, `${kept.join('\n')}\n`)
    return kept.length
  }
  return lines.length
}

const testCounts = (report) => (report ? { files: report.counts.files, total: report.counts.total, passed: report.counts.passed + report.counts.flaky, failed: Math.max(0, report.counts.failed - report.counts.flaky), skipped: report.counts.skipped, flaky: report.counts.flaky, quarantinedFailures: report.counts.quarantinedFailures } : null)

/**
 * One ledger line. `build`, `only`, `project` and `shard` are added only when `build` is passed.
 * @param {{ runId: string, at: string, mode: string, protectedGate: boolean, head: string, branch: string, exitCode: number,
 *   steps: object[], unit: object | null, e2e: object | null, budgets: object[], state: object, now: number, repair?: object }} i
 */
export function buildEntry(i) {
  const events = (r) => r ?? { newlyQuarantined: [], released: [], expired: [] }
  const u = events(i.unit)
  const e = events(i.e2e)
  const tests = {}
  if (i.unit) tests.unit = testCounts(i.unit)
  if (i.e2e) tests.e2e = testCounts(i.e2e)
  const extra = i.build === undefined ? {} : { build: i.build, only: i.only ?? null, project: i.project ?? null, shard: i.shard ?? null }
  return {
    v: 1,
    runId: i.runId,
    at: i.at,
    mode: i.mode,
    protected: i.protectedGate,
    head: i.head,
    branch: i.branch,
    exitCode: i.exitCode,
    steps: i.steps.map((s) => ({ id: s.id, status: s.status, seconds: s.seconds, peakMB: s.peakMB })),
    tests,
    budgets: i.budgets,
    quarantine: {
      active: activeQuarantine(i.state, i.now).map(([key]) => key),
      new: [...u.newlyQuarantined, ...e.newlyQuarantined],
      released: [...u.released, ...e.released],
      expired: [...new Set([...u.expired, ...e.expired])],
    },
    repair: i.repair ?? { committed: null, refused: [] },
    ...extra,
  }
}

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** Reads the budget files of a run directory. */
export function readBudgetFiles(dir) {
  return budgetRows({ bundle: readJson(path.join(dir, 'bundle.json')), studio: readJson(path.join(dir, 'sidecar-studio.json')), runtime: readJson(path.join(dir, 'sidecar-runtime.json')) })
}

/** CI entry point: builds the ledger line from the step reports in `--from`, appends it, prints and appends the summary. */
export function main(argv = process.argv.slice(2), env = process.env, root = REPO_ROOT, now = Date.now()) {
  const at = argv.indexOf('--from')
  const from = at === -1 ? '.gate/run' : argv[at + 1]
  if (!from || from.startsWith('--')) {
    console.error('--from needs a folder')
    return 2
  }
  const runDir = path.resolve(root, from)
  const rel = path.relative(root, runDir).split(path.sep).join('/')
  const mode = argv.includes('--mode') ? argv[argv.indexOf('--mode') + 1] : 'ci'
  const file = path.join(root, LEDGER_FILE)
  const previous = lastFull(readLedger(file))
  const unit = readOutcome('unit', root, rel)
  const e2e = readOutcome('e2e', root, rel)
  const budgets = withHeadroom(readBudgetFiles(runDir), previous)
  const state = readState(path.join(root, '.gate/flaky.json'))
  const runId = makeRunId({ env, now, head: env.GITHUB_SHA ?? '' })
  const exitCode = [unit, e2e].some((r) => r && r.failing.length > 0) ? 1 : 0
  const entry = buildEntry({ runId, at: new Date(now).toISOString(), mode: 'ci', protectedGate: env.GATE_PROTECTED === '1', head: env.GITHUB_SHA ?? '', branch: env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || '', exitCode, steps: [], unit, e2e, budgets, state, now })
  entry.mode = mode === 'full' ? 'full' : 'ci'
  const line = appendEntry(entry, file)
  const text = renderSummary({ mode: 'ci', at: entry.at, head: entry.head, protectedGate: entry.protected, steps: [], unit, e2e, state, now, budgets: summaryRows(budgets), decisions: needsDecision(budgets), repairs: null, ledgerLine: line, stateNote: state.note })
  console.log(text)
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`)
  mkdirSync(runDir, { recursive: true })
  writeFileSync(path.join(runDir, 'summary.md'), `${text}\n`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main()
}
