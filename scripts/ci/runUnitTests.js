// Runs the unit tests once for CI, with coverage limited to the changed source files.
//  - FULL_SUITE=true, or a removed/renamed src/server JS file: `vitest run` (everything).
//  - otherwise: `vitest run --changed <BASE_SHA>` (tests affected by the PR, found through the import
//    graph), then `vitest run` on the repo-scanning tests (ALWAYS_RUN) that no import graph connects to
//    the change. Without a valid BASE_SHA the plan falls back to the full suite.
// Main runs the full suite sharded (ci.yml, job main-unit; a bot merge starts it through a workflow_dispatch), flaky.yml runs it weekly and release.yml
// runs it before every release.
// Every run also writes a Vitest JSON report and prints the ten slowest tests. A failed test is rerun once alone
// (gateClassify.js): flaky or real, quarantined or not (gateState.js). `GATE_PROTECTED=1` (release.yml) turns quarantine off.
// Usage (CI): FULL_SUITE=true|false BASE_SHA=<40 hex> CHANGED_JSON=<path> node scripts/ci/runUnitTests.js
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { REPO_ROOT } from '../checks/gitFiles.js'
import { CODE_EXT, removesSource } from './changeKinds.js'
import { RUN_DIR, createClassifier, jsonPathFor, prepareState } from './gateClassify.js'
import { makeRunId } from './gateState.js'

export const ALWAYS_RUN_MARKER = '// ci:always-run'
export const MAX_COVERAGE_FILES = 200

// Tests that read the source tree (architecture guards, parity checks, repo scans). A change can
// break them without any import edge, so they run on every PR. Any other test can opt in with the
// marker comment on its own line; this list covers the ones that exist today.
export const ALWAYS_RUN = [
  'server/__tests__/aiBoundary.test.js',
  'server/__tests__/cloudAiParity.test.js',
  'server/__tests__/cloudRestore.test.js',
  'server/__tests__/assistantDashesParity.test.js',
  'server/__tests__/assistantPagesParity.test.js',
  'server/__tests__/migrationSafety.test.js',
  'server/__tests__/checksScripts.test.js',
  'server/__tests__/ciPipeline.test.js',
  'server/__tests__/license/noPrivateKeys.test.js',
  'server/__tests__/license/scripts.test.js',
]

const isVitestFile = (p) => (/^(src|server)\//.test(p) && CODE_EXT.test(p)) || p === 'server.js'

export const isTestPath = (p) => /(^|\/)__tests__\//.test(p) || /\.test\.(js|jsx|ts|tsx|mjs|cjs)$/.test(p)

const SHA_RE = /^[0-9a-f]{40}$/

/** Source files that coverage is measured on for a change (the same list planUnitTests uses). */
export function plannedSources(files) {
  const live = files.filter((f) => f.status !== 'removed' && isVitestFile(f.path))
  return live.map((f) => f.path).filter((p) => !isTestPath(p) && p !== 'src/main.jsx')
}

/**
 * Builds the vitest argument lists for a change.
 * `baseSha` is the pull request base commit; anything but 40 hex characters means "run everything".
 * @param {{ files: { path: string, status: string }[], fullSuite: boolean, alwaysRun: string[], baseSha?: string }} input
 * @returns {{ mode: 'full' | 'changed', coverageInclude: string[], runs: string[][] }}
 */
export function planUnitTests({ files, fullSuite, alwaysRun, baseSha = '' }) {
  const live = files.filter((f) => f.status !== 'removed' && isVitestFile(f.path))
  const sources = plannedSources(files)
  const coverageInclude = sources.length > 0 && sources.length <= MAX_COVERAGE_FILES ? sources : []
  const coverageArgs = coverageInclude.length > 0 ? ['--coverage.enabled', ...coverageInclude.map((p) => `--coverage.include=${p}`)] : []
  if (fullSuite || removesSource(files) || !SHA_RE.test(baseSha)) return { mode: 'full', coverageInclude, runs: [['run', ...coverageArgs]] }
  const runs = []
  if (live.length > 0) runs.push(['run', '--changed', baseSha, '--passWithNoTests', ...coverageArgs])
  if (alwaysRun.length > 0) runs.push(['run', ...alwaysRun])
  return { mode: 'changed', coverageInclude, runs }
}

/**
 * The reporter flags of a unit run: the default reporter, the ten slowest tests, and a JSON report at `jsonPath`.
 * The gate and CI both build them here, so they classify the same way.
 * @param {string} jsonPath
 * @returns {string[]}
 */
export function unitReporterArgs(jsonPath) {
  return ['--reporter=default', '--reporter=./scripts/ci/slowestReporter.js', '--reporter=json', `--outputFile.json=${jsonPath}`]
}

/** Test files that carry the always-run marker (scanned under src/ and server/). */
export function scanAlwaysRun(root = REPO_ROOT) {
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.test\.(js|jsx|ts|tsx)$/.test(entry.name) && readFileSync(full, 'utf8').split('\n').some((l) => l.trim() === ALWAYS_RUN_MARKER)) {
        found.push(path.relative(root, full).split(path.sep).join('/'))
      }
    }
  }
  for (const top of ['src', 'server']) walk(path.join(root, top))
  return found
}

/** Removes a stale coverage folder, so changedCoverage can only read output from this run. */
export function cleanCoverage(root = REPO_ROOT) {
  rmSync(path.join(root, 'coverage'), { recursive: true, force: true })
}

export async function main(env = process.env) {
  cleanCoverage()
  if (!env.CHANGED_JSON) {
    console.error('runUnitTests needs CHANGED_JSON.')
    return 1
  }
  const files = JSON.parse(readFileSync(env.CHANGED_JSON, 'utf8'))
  const alwaysRun = [...new Set([...ALWAYS_RUN, ...scanAlwaysRun()])].sort()
  const plan = planUnitTests({ files, fullSuite: env.FULL_SUITE === 'true', alwaysRun, baseSha: env.BASE_SHA ?? '' })
  console.log(`unit tests: ${plan.mode} mode, ${plan.runs.length} vitest run(s)`)
  const bin = path.join(REPO_ROOT, 'node_modules', 'vitest', 'vitest.mjs')
  const protectedGate = env.GATE_PROTECTED === '1'
  const { state, expired } = prepareState({ protectedGate })
  const classifier = createClassifier({ kind: 'unit', state, expired, runId: makeRunId({ env, head: env.GITHUB_SHA ?? '' }), protectedGate })
  mkdirSync(path.join(REPO_ROOT, RUN_DIR), { recursive: true })
  let exitCode = 0
  let n = 0
  for (const args of plan.runs) {
    n += 1
    const json = jsonPathFor('unit', n)
    rmSync(path.join(REPO_ROOT, json), { force: true })
    const res = spawnSync(process.execPath, [bin, ...args, ...unitReporterArgs(json)], { cwd: REPO_ROOT, stdio: 'inherit', shell: false })
    const code = await classifier.afterCommand(n, res.status ?? 1)
    if (code !== 0) {
      exitCode = code
      break
    }
  }
  const report = classifier.finish()
  if (report.flaky.length > 0 || report.quarantinedFailures.length > 0) {
    console.log(`unit tests: ${report.flaky.length} flaky, ${report.quarantinedFailures.length} quarantined failure(s); see the gate summary.`)
  }
  return exitCode
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main()
}
