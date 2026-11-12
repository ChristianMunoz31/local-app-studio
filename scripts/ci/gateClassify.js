// Classifies failed tests for the gate and for CI (DESIGN-phase15 section 2.4). A failed unit or e2e test is rerun once,
// alone (same file, one worker). Pass on the rerun: "flaky". Fail again (or not rerun, or no report): "fail", a real failure
// that names the test, the assertion and the first stack frame outside node_modules. Build, lint and typecheck failures are
// never classified: they are always real. The outcomes feed gateState.js (quarantine).
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { redactValue } from '../../server/redact.js'
import { REPO_ROOT } from '../checks/gitFiles.js'
import { applyOutcomes, expire, readState, writeState } from './gateState.js'

export const UNIT_RERUN_CAP = 10
export const E2E_RERUN_CAP = 5
export const TOO_MANY = 'Too many tests failed to check each one again, so all of them count as real failures.'
// GATE_RUN_DIR moves the run folder (the phase gate gives a light step `.gate/run-light`, so it does not clear the folder of the heavy step beside it).
// Only a folder directly under .gate/ is taken; anything else keeps the default.
export const DEFAULT_RUN_DIR = '.gate/run'
export const resolveRunDir = (value) => (/^\.gate\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value ?? '') && !value.endsWith('..') ? value : DEFAULT_RUN_DIR)
export const RUN_DIR = resolveRunDir(process.env.GATE_RUN_DIR)
// The Playwright reporter that prints the preview-start line (count and p95 of the waits for "Your app is running.", e2e/pages/preview.js).
export const PREVIEW_START_REPORTER = './e2e/support/previewStartReporter.js'
const ASSERTION_MAX = 300

const VITEST_BIN = 'node_modules/vitest/vitest.mjs'
const PLAYWRIGHT_BIN = 'node_modules/@playwright/test/cli.js'

/** Escapes a string for use inside a regular expression. */
export const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const slash = (p) => String(p).replace(/\\/g, '/')

/** A path relative to the repo with forward slashes; `file://` URLs are accepted. */
export function repoRelative(p, root = REPO_ROOT) {
  let s = slash(p).replace(/^file:\/\/\/?/, (m) => (/^[A-Za-z]:/.test(slash(p).slice(m.length)) ? '' : '/'))
  const r = slash(root).replace(/\/$/, '')
  if (s.toLowerCase().startsWith(`${r.toLowerCase()}/`)) s = s.slice(r.length + 1)
  return s
}

/** The state key of a test: `<kind>|<file>|<title>`; e2e titles carry their project: `[<project>] <title path>`. */
export function testKey(kind, file, title, project = null) {
  return `${kind}|${file}|${kind === 'e2e' && project ? `[${project}] ` : ''}${title}`
}

/** Where run `n` (1 based) of a kind writes its JSON report. */
export const jsonPathFor = (kind, n = 1, runDir = RUN_DIR) => `${runDir}/${kind === 'unit' ? `unit-${n}` : 'e2e'}.json`

const FRAME = /(?:\bat\s+(?:.*?\s\()?|[❯>]\s+)((?:file:\/\/\/)?(?:[A-Za-z]:)?[^\s():]+(?:\/|\\)[^\s():]*?):(\d+):(\d+)\)?\s*$/

/**
 * The plain facts of a failure: the first line of the message (redacted, at most 300 characters) and the first stack frame
 * outside node_modules and node:internal, repo relative as `file:line:col`.
 * @param {string} text the failure message, with its stack when there is one
 * @param {string} [root]
 * @returns {{ assertion: string, where: string | null }}
 */
export function failureDetails(text, root = REPO_ROOT) {
  const lines = String(text ?? '').split(/\r?\n/)
  const first = (lines.find((l) => l.trim() !== '') ?? '').trim()
  const assertion = String(redactValue(first.length > ASSERTION_MAX ? first.slice(0, ASSERTION_MAX) : first))
  let where = null
  for (const line of lines) {
    const m = FRAME.exec(line)
    if (!m) continue
    const file = slash(m[1])
    if (file.includes('node_modules') || file.includes('node:internal')) continue
    where = `${repoRelative(file, root)}:${m[2]}:${m[3]}`
    break
  }
  return { assertion, where }
}

/**
 * Reads a Vitest JSON report.
 * @returns {{ counts: { files: number, total: number, passed: number, failed: number, skipped: number }, passed: string[], failures: { key: string, kind: 'unit', file: string, title: string, project: null, fullName: string, names: string[], message: string, loadFailure: boolean }[] }}
 */
export function parseVitestJson(json, root = REPO_ROOT) {
  const failures = []
  const passed = []
  const results = Array.isArray(json?.testResults) ? json.testResults : []
  for (const suite of results) {
    const file = repoRelative(suite.name ?? '', root)
    let failedHere = 0
    for (const t of suite.assertionResults ?? []) {
      const title = t.fullName ?? t.title ?? ''
      const ancestors = Array.isArray(t.ancestorTitles) ? t.ancestorTitles.filter((x) => typeof x === 'string' && x !== '') : []
      const names = typeof t.title === 'string' && t.title !== '' ? [...ancestors, t.title] : [title]
      if (t.status === 'passed') passed.push(testKey('unit', file, title))
      else if (t.status === 'failed') {
        failedHere += 1
        failures.push({ key: testKey('unit', file, title), kind: 'unit', file, title, project: null, fullName: title, names, message: (t.failureMessages ?? []).join('\n'), loadFailure: false })
      }
    }
    if (suite.status === 'failed' && failedHere === 0) {
      failures.push({ key: testKey('unit', file, '(file did not run)'), kind: 'unit', file, title: '(file did not run)', project: null, fullName: '', names: [], message: suite.message ?? '', loadFailure: true })
    }
  }
  const counts = {
    files: results.length,
    total: json?.numTotalTests ?? 0,
    passed: json?.numPassedTests ?? 0,
    failed: json?.numFailedTests ?? 0,
    skipped: (json?.numPendingTests ?? 0) + (json?.numTodoTests ?? 0),
  }
  return { counts, passed, failures }
}

/**
 * Reads a Playwright JSON report (suites nest; the first level is the file, deeper levels are `describe` blocks).
 * The title path is the describe titles and the test title joined with a space (what `--grep` sees).
 */
export function parsePlaywrightJson(json, root = REPO_ROOT) {
  const failures = []
  const passed = []
  const walk = (suite, titles, depth) => {
    const here = depth <= 1 ? titles : [...titles, suite.title]
    for (const spec of suite.specs ?? []) {
      const titlePath = [...here, spec.title].join(' ')
      const file = repoRelative(spec.file ?? suite.file ?? '', root).replace(/^e2e\//, '')
      for (const t of spec.tests ?? []) {
        const project = t.projectName ?? null
        const key = testKey('e2e', `e2e/${file}`, titlePath, project)
        if (t.status === 'expected') passed.push(key)
        else if (t.status === 'unexpected' || t.status === 'flaky') {
          const last = (t.results ?? []).filter((r) => r.status !== 'passed' && r.status !== 'skipped').at(-1)
          const err = last?.error ?? last?.errors?.[0]
          failures.push({ key, kind: 'e2e', file: `e2e/${file}`, title: titlePath, project, fullName: titlePath, message: [err?.message, err?.stack].filter(Boolean).join('\n'), loadFailure: false })
        }
      }
    }
    for (const child of suite.suites ?? []) walk(child, here, depth + 1)
  }
  for (const top of json?.suites ?? []) walk(top, [], 1)
  const s = json?.stats ?? {}
  const counts = {
    files: (json?.suites ?? []).length,
    total: (s.expected ?? 0) + (s.unexpected ?? 0) + (s.flaky ?? 0) + (s.skipped ?? 0),
    passed: (s.expected ?? 0) + (s.flaky ?? 0),
    failed: s.unexpected ?? 0,
    skipped: s.skipped ?? 0,
  }
  return { counts, passed, failures }
}

/**
 * The `--testNamePattern` that selects exactly one unit test. Vitest matches it against the describe titles and the test
 * title joined with " > " (not the space the JSON `fullName` uses), so the pattern is built from the title path.
 */
export function unitTestPattern(failure) {
  const names = Array.isArray(failure.names) && failure.names.length > 0 ? failure.names : [failure.fullName]
  return `^${names.map(escapeRegex).join(' > ')}$`
}

/** The command that reruns one failed unit test alone. Returns `{ argv, env, jsonFile }`; argv runs with `node`, no shell. */
export function unitRerunSpec(failure, k, runDir = RUN_DIR) {
  const jsonFile = `${runDir}/unit-rerun-${k}.json`
  return {
    argv: [VITEST_BIN, 'run', failure.file, '--maxWorkers=1', '--testNamePattern', unitTestPattern(failure), '--reporter=json', `--outputFile.json=${jsonFile}`],
    env: {},
    jsonFile,
  }
}

/** True when the spec file configures `mode: 'serial'` (its tests run in order and share state). Unreadable file: false. */
export function isSerialSpec(file, root = REPO_ROOT) {
  try {
    return /configure\(\s*\{[^}]*mode:\s*['"]serial['"]/.test(readFileSync(path.resolve(root, file), 'utf8'))
  } catch {
    return false
  }
}

/**
 * The command that reruns one failed e2e test alone: one worker, no retries, in its project. The pattern is anchored at
 * the end only, because Playwright puts a project prefix in front of the titles it matches.
 */
export function e2eRerunSpec(failure, k, runDir = RUN_DIR, root = REPO_ROOT) {
  const jsonFile = `${runDir}/e2e-rerun-${k}.json`
  // A test in a serial file depends on the tests before it (the first one creates the app), so the whole file is rerun
  // and the outcome is read for this test's key; a --grep on the one title would wait for an app nobody made.
  const grep = isSerialSpec(failure.file, root) ? [] : ['--grep', `${escapeRegex(failure.fullName)}$`]
  return {
    argv: [PLAYWRIGHT_BIN, 'test', failure.file, ...(failure.project ? [`--project=${failure.project}`] : []), '--workers=1', '--retries=0', ...grep, '--reporter=json'],
    env: { PLAYWRIGHT_JSON_OUTPUT_NAME: jsonFile, GATE_CLASSIFY: '1' },
    jsonFile,
  }
}

/** Default rerun: runs the spec as a child process and returns its JSON report, or null when there is none. */
export function defaultRerun(spec, root = REPO_ROOT) {
  const abs = path.join(root, spec.jsonFile)
  mkdirSync(path.dirname(abs), { recursive: true })
  rmSync(abs, { force: true })
  spawnSync(process.execPath, spec.argv, { cwd: root, env: { ...process.env, ...spec.env }, stdio: 'ignore', shell: false })
  try {
    return JSON.parse(readFileSync(abs, 'utf8'))
  } catch {
    return null
  }
}

/**
 * The state at the start of a run: read, with ended quarantines removed (and written back unless the gate is protected).
 * @returns {{ state: ReturnType<typeof readState>, expired: string[] }}
 */
export function prepareState({ stateFile, now = Date.now(), protectedGate = false } = {}) {
  const loaded = readState(stateFile, now)
  const { state, expired } = expire(loaded, now)
  if (expired.length > 0 && !protectedGate) writeState(state, stateFile)
  return { state: { ...state, note: loaded.note }, expired }
}

const RANK = { pass: 0, flaky: 1, fail: 2 }

/**
 * One classifier per step. Call `afterCommand(n, exitCode)` after each command of the step, then `finish()`.
 * `holder` (`{ state }`) lets the unit and e2e classifiers of one gate run share the state: each `finish()` stores the new one in it.
 * @param {{ kind: 'unit' | 'e2e', state?: object, holder?: { state: object }, expired?: string[], runId: string, protectedGate?: boolean, stateFile?: string,
 *   rerun?: (spec: object) => Promise<object | null> | object | null, now?: () => number, root?: string, runDir?: string, cap?: number, persist?: boolean }} o
 */
export function createClassifier(o) {
  const { kind, runId, protectedGate = false, now = Date.now, root = REPO_ROOT, runDir = RUN_DIR, persist = true } = o
  const cap = o.cap ?? (kind === 'unit' ? UNIT_RERUN_CAP : E2E_RERUN_CAP)
  const rerun = o.rerun ?? ((spec) => defaultRerun(spec, root))
  const parse = kind === 'unit' ? parseVitestJson : parsePlaywrightJson
  const spec = kind === 'unit' ? unitRerunSpec : e2eRerunSpec
  const holder = o.holder ?? { state: o.state }
  const outcomes = new Map()
  const details = new Map()
  const passedKeys = new Set()
  const counts = { files: 0, total: 0, passed: 0, failed: 0, skipped: 0 }
  let reruns = 0
  let tooMany = false
  let unexplained = false

  const record = (f, outcome, extra) => {
    const prev = outcomes.get(f.key)
    if (prev && RANK[prev.outcome] >= RANK[outcome]) return
    outcomes.set(f.key, { key: f.key, kind, file: f.file, title: f.title, project: f.project, outcome })
    details.set(f.key, extra ?? {})
  }

  const evaluate = () => applyOutcomes(holder.state, [...outcomes.values()], { now: now(), runId, protectedGate })

  async function afterCommand(n, exitCode) {
    const abs = path.join(root, jsonPathFor(kind, n, runDir))
    let parsed
    try {
      parsed = parse(JSON.parse(readFileSync(abs, 'utf8')), root)
    } catch {
      parsed = null
    }
    if (!parsed) {
      if (exitCode !== 0) unexplained = true
      return exitCode
    }
    for (const k of ['files', 'total', 'passed', 'failed', 'skipped']) counts[k] += parsed.counts[k]
    for (const key of parsed.passed) passedKeys.add(key)
    if (exitCode !== 0 && parsed.failures.length === 0) unexplained = true
    const known = parsed.failures.length
    if (known > 0 && reruns + known > cap) tooMany = true
    for (const failure of parsed.failures) {
      const first = failureDetails(failure.message, root)
      const base = { ...first, reason: failure.loadFailure ? 'file did not run' : 'failed twice' }
      if (tooMany || failure.loadFailure || !failure.fullName) {
        record(failure, 'fail', { ...first, reason: tooMany ? 'too many' : base.reason })
        continue
      }
      reruns += 1
      const second = await rerun(spec(failure, reruns, runDir))
      const again = second ? parse(second, root) : null
      if (again && again.passed.includes(failure.key)) record(failure, 'flaky', first)
      else if (again && again.failures.some((x) => x.key === failure.key)) {
        const x = again.failures.find((y) => y.key === failure.key)
        record(failure, 'fail', { ...failureDetails(x.message || failure.message, root), reason: 'failed twice' })
      } else record(failure, 'fail', { ...first, reason: 'no report from the second run' })
    }
    if (exitCode === 0) return 0
    if (unexplained || tooMany) return exitCode
    return evaluate().failing.length === 0 ? 0 : exitCode
  }

  /** Applies the outcomes to the state, writes it (unless protected), writes the step report and returns it. */
  function finish() {
    for (const [key, entry] of Object.entries(holder.state.tests)) {
      if (entry.kind === kind && !outcomes.has(key) && passedKeys.has(key)) outcomes.set(key, { key, kind, file: entry.file, title: entry.title, project: entry.project, outcome: 'pass' })
    }
    const result = evaluate()
    if (persist && !protectedGate) writeState(result.state, o.stateFile)
    holder.state = result.state
    const list = (keys) => keys.map((k) => ({ key: k, ...outcomes.get(k), ...(details.get(k) ?? {}) }))
    const real = [...outcomes.values()].filter((x) => x.outcome === 'fail' && !result.quarantinedFailures.includes(x.key)).map((x) => ({ ...x, ...(details.get(x.key) ?? {}) }))
    const flaky = [...outcomes.values()].filter((x) => x.outcome === 'flaky').map((x) => ({ ...x, ...(details.get(x.key) ?? {}), quarantinedNow: result.newlyQuarantined.includes(x.key), quarantined: result.quarantinedFailures.includes(x.key) }))
    const report = {
      v: 1,
      kind,
      counts: { ...counts, flaky: flaky.length, quarantinedFailures: result.quarantinedFailures.length },
      real,
      flaky,
      quarantinedFailures: list(result.quarantinedFailures).map((x) => ({ key: x.key, kind: x.kind, file: x.file, title: x.title, project: x.project, outcome: x.outcome })),
      newlyQuarantined: result.newlyQuarantined,
      released: result.released,
      expired: o.expired ?? [],
      failing: result.failing,
      tooMany,
      unexplained,
      protected: protectedGate,
    }
    if (persist) {
      mkdirSync(path.join(root, runDir), { recursive: true })
      writeFileSync(path.join(root, runDir, `${kind}-outcome.json`), `${JSON.stringify(report, null, 2)}\n`)
    }
    return report
  }

  return { afterCommand, finish, evaluate }
}

/** Reads a step report written by `finish()`, or null. */
export function readOutcome(kind, root = REPO_ROOT, runDir = RUN_DIR) {
  const file = path.join(root, runDir, `${kind}-outcome.json`)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}
