// `npm run gate`: the CI `verify` job, run locally, one step at a time, with a summary table.
//   npm run gate                  every step in the order of ci.yml (hygiene, lint, typecheck, unit tests, build,
//                                 bundle budget, sidecar budgets for both modes, cloud-off build, e2e, public build)
//   npm run gate -- --quick       only the cheap steps on what changed against main (hygiene, lint on changed
//                                 files, typecheck, the affected unit tests); this is what the pre-push hook runs
//   npm run gate -- --quick --base <sha>   diff from the merge base with that commit first (the pre-push hook passes the remote sha)
//   npm run gate -- --dry-run     print the plan, run nothing
//   npm run gate -- --json <file> also write the result table as JSON
//   npm run gate -- --repair      before the steps, run eslint --fix on the changed files and commit it as
//                                 "chore(gate): mechanical fixes" when the diff is mechanical (never in CI; the pre-push hook passes it)
//   npm run gate -- --protected   no quarantine: every flaky or failed test fails (release); also GATE_PROTECTED=1
//   npm run gate -- --no-classify run the test steps without rerunning failures alone or reading .gate/flaky.json
//   npm run gate -- --only "<step id>"   exactly one step; with --project (unit: frontend|pure|backend, e2e: flows|first-run|a11y)
//                                 and --shard <i>/<n> (either step) to keep a step under a time cap
//   npm run gate -- --public      the public build pass: APP_PRO_DIR=none for every step (automatic, with a one-line note, when pro/ is absent)
// A failed test is rerun once alone: pass is "flaky", fail is "real" (gateClassify.js). Flaky in 2 runs in a row quarantines
// the test for 7 days (gateState.js). A full run appends its numbers to .gate/ledger.jsonl and prints the summary (gateSummary.js).
// Memory: steps never overlap. The unit step passes --maxWorkers only when GATE_MAX_WORKERS is set; otherwise
// vitest.config.js decides (it is the single source of the tuned worker count). Use GATE_MAX_WORKERS=4 while
// another heavy job runs on the machine.
// Every step runs `node <script>` straight (no npm wrapper), so the measured process tree is the real one.
// Exit code: the exit code of the first failing step (1 when it has none); later steps are "not run".
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { appendFileSync, copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { REPO_ROOT } from '../checks/gitFiles.js'
import { resolveProDir } from '../lib/proDir.js'
import { gitExe } from '../phase/lib/processTable.js'
import { changeKinds, parseNameStatus } from './changeKinds.js'
import { PREVIEW_START_REPORTER, RUN_DIR, createClassifier, jsonPathFor, prepareState } from './gateClassify.js'
import { LEDGER_FILE, appendEntry, buildEntry, needsDecision, previousFor, readBudgetFiles, readLedger, summaryRows, withHeadroom } from './gateLedger.js'
import { CI_REFUSAL, repair } from './gateRepair.js'
import { makeRunId } from './gateState.js'
import { renderSummary } from './gateSummary.js'
import { startSampler } from './measureRun.js'
import { ALWAYS_RUN, planUnitTests, scanAlwaysRun, unitReporterArgs } from './runUnitTests.js'

const SAMPLE_INTERVAL_MS = 2000
const LINT_TARGET = /\.(js|jsx|ts|tsx)$/
// Above either limit the quick lint runs `eslint .` instead of listing files: a long list can exceed the Windows command line limit (about 32k characters).
export const LINT_MAX_FILES = 200
export const LINT_MAX_CHARS = 24000
const CLOUD_OFF_DIST = '{TMP}/las-gate-dist-cloud-off'

const BIN = {
  eslint: 'node_modules/eslint/bin/eslint.js',
  vitest: 'node_modules/vitest/vitest.mjs',
  vite: 'node_modules/vite/bin/vite.js',
  playwright: 'node_modules/@playwright/test/cli.js',
}
const BUILD_SIDECAR = ['scripts/desktop/buildSidecar.js', '--minify', '--bundle-only']

/**
 * The gate, in the order of the ci.yml `verify` job.
 *  - id: short name in the summary table
 *  - ciStep: the exact `- name:` of the ci.yml step it mirrors (a unit test compares names and order)
 *  - run: commands, each an argv run with `node` (or the binary itself when `bin` is set); `{TMP}` is os.tmpdir()
 *  - quick: true runs in --quick, false is skipped there, 'affected' runs the planUnitTests runs
 *  - heavy: true for steps that need a lot of CPU or memory (documented in PIPELINE.md)
 *  - bin: an external program that may be missing; the step is skipped when it is not on PATH
 *  - env: extra environment for every command of the step
 */
export const GATE_STEPS = [
  {
    id: 'hygiene: gitleaks',
    ciStep: 'hygiene: gitleaks',
    run: [['gitleaks', 'git', '--redact', '--no-banner', '--exit-code', '1', '--config', '.gitleaks.toml']],
    bin: 'gitleaks',
    quick: true,
    heavy: false,
  },
  { id: 'hygiene: em dash', ciStep: 'hygiene: em dash', run: [['scripts/checks/noEmDash.js']], quick: true, heavy: false },
  { id: 'hygiene: keys', ciStep: 'hygiene: keys', run: [['scripts/checks/noPrivateKeys.js']], quick: true, heavy: false },
  { id: 'hygiene: personal data', ciStep: 'hygiene: personal data', run: [['scripts/checks/personalData.js']], quick: true, heavy: false },
  { id: 'lint', ciStep: 'lint', run: [[BIN.eslint, '.']], quick: true, heavy: false },
  { id: 'typecheck', ciStep: 'typecheck', run: [['scripts/ci/typecheck.js']], quick: true, heavy: false },
  { id: 'unit tests', ciStep: 'unit tests', run: [[BIN.vitest, 'run']], quick: 'affected', heavy: true },
  {
    id: 'build',
    ciStep: 'build',
    run: [[BIN.vite, 'build'], ['scripts/license/writeBuildInfo.js']],
    quick: false,
    heavy: true,
  },
  { id: 'bundle budget', ciStep: 'bundle budget', run: [['scripts/checks/bundleBudget.js']], quick: false, heavy: false },
  {
    id: 'sidecar budget (studio)',
    ciStep: 'sidecar budget',
    run: [
      BUILD_SIDECAR,
      ['scripts/checks/sidecarBudget.js', '--mode', 'studio'],
      ['scripts/checks/cloudMarker.js', '--require-present', '--bundle', '.sidecar-build/server.cjs', '--dist-dir', 'dist'],
    ],
    quick: false,
    heavy: true,
  },
  {
    id: 'sidecar budget (runtime)',
    ciStep: 'sidecar budget',
    run: [BUILD_SIDECAR, ['scripts/checks/sidecarBudget.js', '--mode', 'runtime']],
    env: { APP_MODE: 'runtime' },
    quick: false,
    heavy: true,
  },
  {
    id: 'cloud-off build',
    ciStep: 'cloud-off build',
    run: [
      [BIN.vite, 'build', '--outDir', CLOUD_OFF_DIST, '--emptyOutDir'],
      BUILD_SIDECAR,
      ['scripts/checks/cloudMarker.js', '--require-absent', '--bundle', '.sidecar-build/server.cjs', '--dist-dir', CLOUD_OFF_DIST],
    ],
    env: { APP_CLOUD_AI: 'off' },
    quick: false,
    heavy: true,
  },
  // visual stays Linux-only: its baselines are rendered in the pinned container.
  {
    id: 'e2e (Playwright)',
    ciStep: 'e2e (Playwright)',
    run: [[BIN.playwright, 'test', '--project=flows', '--project=first-run', '--project=a11y']],
    quick: false,
    heavy: true,
  },
  // The public half of the open-source seam (APP_PRO_DIR=none) is built over dist/ and .sidecar-build/, so it runs after e2e,
  // which needs the pro build that the steps above left there. It proves no pro code is in the public bundles.
  { id: 'public build', ciStep: 'public build', run: [['scripts/checks/publicBuild.js']], quick: false, heavy: true },
]

/** ci.yml verify steps that have no local meaning (CI plumbing, PR-only work, or covered by another gate step). */
export const CI_ONLY_STEPS = [
  'tools',
  'git safe directory',
  'classify',
  'hygiene: trusted config',
  'tests-required',
  'npm ci',
  'coverage (changed files)',
  'Upload web build',
  'Upload Playwright report',
  'gate state (restore)',
  'gate ledger',
  'Upload gate state',
]

/** Reads GATE_MAX_WORKERS: a whole number from 1 to 64, else null (no flag: vitest.config.js decides). */
export function maxWorkers(env = process.env) {
  const n = Number(env.GATE_MAX_WORKERS)
  return env.GATE_MAX_WORKERS !== undefined && Number.isInteger(n) && n >= 1 && n <= 64 ? n : null
}

/** Drops the coverage flags of a planUnitTests run; the gate checks tests, CI checks coverage. */
export function stripCoverage(args) {
  return args.filter((a) => a !== '--coverage.enabled' && !a.startsWith('--coverage.'))
}

const expand = (argv, tmp) => argv.map((a) => a.replaceAll('{TMP}', tmp))

/**
 * The quick lint command for the changed files. `--` ends the options, so a path that starts with "-" is a file and not a
 * flag. A long list becomes `eslint .` (see LINT_MAX_FILES).
 * @param {string[]} targets
 */
export function lintCommand(targets) {
  const chars = targets.reduce((n, t) => n + t.length + 1, 0)
  if (targets.length > LINT_MAX_FILES || chars > LINT_MAX_CHARS) return [BIN.eslint, '.']
  return [BIN.eslint, '--no-warn-ignored', '--', ...targets]
}

/**
 * Builds the list of steps to run, each with its commands or the reason it is skipped.
 * Pure when `diff` and `hasBinary` are given.
 * @param {{ quick?: boolean, env?: Record<string, string | undefined>, diff?: { base: string, files: { path: string, status: string, previous?: string }[] } | null,
 *   hasBinary?: (name: string) => boolean, alwaysRun?: string[], tmp?: string }} input
 * @returns {{ mode: 'full' | 'quick', note: string, entries: { id: string, ciStep: string, bin?: string, heavy: boolean, commands: string[][], env: Record<string, string>, skip?: string }[] }}
 */
export function planGate({ quick = false, env = process.env, diff = null, hasBinary = () => false, alwaysRun = [], tmp = os.tmpdir() } = {}) {
  const count = maxWorkers(env)
  const workers = count === null ? [] : [`--maxWorkers=${count}`]
  const files = diff?.files ?? []
  const kinds = changeKinds(files)
  const light = quick && kinds.light
  let note = quick ? (diff ? `quick, against ${diff.base.slice(0, 7)}` : 'quick, no main found: the whole plan') : 'full'
  if (light) note += ', docs and workspace files only'

  const entries = GATE_STEPS.map((step) => {
    const base = { id: step.id, ciStep: step.ciStep, bin: step.bin, heavy: step.heavy, env: step.env ?? {}, commands: [] }
    const skip = (reason) => ({ ...base, skip: reason })
    const plain = { ...base, commands: step.run.map((c) => expand(c, tmp)) }
    if (step.bin && !hasBinary(step.bin)) return skip(`${step.bin} is not on PATH, CI runs it`)
    if (quick && step.quick === false) return skip('not part of --quick')
    if (light && ['lint', 'typecheck', 'unit tests'].includes(step.id)) return skip('only docs or workspace files changed')
    if (quick && step.id === 'lint' && diff) {
      const targets = files.filter((f) => f.status !== 'removed' && LINT_TARGET.test(f.path)).map((f) => f.path)
      if (targets.length === 0) return skip('no changed code files')
      return { ...base, commands: [lintCommand(targets)] }
    }
    if (step.quick === 'affected') {
      if (!quick) return { ...base, commands: [[BIN.vitest, 'run', ...workers]] }
      const plan = planUnitTests({ files, fullSuite: kinds.fullSuite, alwaysRun, baseSha: diff?.base ?? '' })
      return { ...base, commands: plan.runs.map((args) => [BIN.vitest, ...stripCoverage(args), ...workers]) }
    }
    return plain
  })
  return { mode: quick ? 'quick' : 'full', note, entries }
}

const HEX40 = /^[0-9a-f]{40}$/

const defaultGit = (cwd) => (args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })

/**
 * The changed files since the merge base of HEAD and the first usable ref. `--base <sha>` (the remote sha the pre-push hook
 * got from git) comes first, so commits not pushed yet are checked even on main; then origin/main, then local main (a stale
 * local main must not hide commits that origin/main already has). Null when none exists.
 * `head` (the pre-push hook passes the pushed sha when it is not the checked-out commit) replaces HEAD for the merge base and the diff.
 * @param {{ base?: string, head?: string, cwd?: string, git?: (args: string[]) => string }} [opts] `git` is injected by tests.
 */
export function gitDiffAgainst({ base, head = 'HEAD', cwd = REPO_ROOT, git = defaultGit(cwd) } = {}) {
  const refs = [...(base ? [base] : []), 'origin/main', 'main']
  for (const ref of refs) {
    try {
      const mergeBase = git(['merge-base', head, ref]).trim()
      if (!HEX40.test(mergeBase)) continue
      return { base: mergeBase, files: parseNameStatus(git(['diff', '--name-status', '-z', '-M', mergeBase, head])) }
    } catch {
      // try the next ref
    }
  }
  return null
}

export function binaryOnPath(name) {
  const res = spawnSync(name, ['--version'], { stdio: 'ignore', shell: false })
  return !res.error
}

/**
 * Runs the planned steps one at a time. Stops at the first failing step; every later step is "not run".
 * @param {{ entries: ReturnType<typeof planGate>['entries'], runner: (argv: string[], env: Record<string, string>, bin: boolean) => Promise<{ code: number | null, peakMB: number }>,
 *   now?: () => number }} input
 * @returns {Promise<{ results: { id: string, ciStep: string, status: string, seconds: number, peakMB: number | null, reason?: string }[], exitCode: number }>}
 */
export async function runGate({ entries, runner, now = Date.now, classifiers = {} }) {
  const results = []
  const reports = {}
  let exitCode = 0
  let failed = false
  for (const entry of entries) {
    const row = { id: entry.id, ciStep: entry.ciStep, status: '', seconds: 0, peakMB: null }
    if (entry.skip) {
      results.push({ ...row, status: 'skipped', reason: entry.skip })
      continue
    }
    if (failed) {
      results.push({ ...row, status: 'not run' })
      continue
    }
    if (entry.commands.length === 0) {
      results.push({ ...row, status: 'skipped', reason: 'nothing to run' })
      continue
    }
    const classifier = entry.classify ? classifiers[entry.classify] : undefined
    const started = now()
    let peak = 0
    let code = 0
    let n = 0
    for (const argv of entry.commands) {
      n += 1
      const out = await runner(argv, entry.env, entry.bin !== undefined)
      peak = Math.max(peak, out.peakMB ?? 0)
      const exit = classifier ? await classifier.afterCommand(n, out.code ?? 1) : out.code
      if (exit !== 0) {
        code = exit ?? 1
        break
      }
    }
    const seconds = Math.round((now() - started) / 100) / 10
    let status = code === 0 ? 'passed' : 'FAILED'
    if (classifier) {
      const report = classifier.finish()
      reports[entry.classify] = report
      if (code === 0 && report.counts.quarantinedFailures > 0) status = 'passed (quarantined failures)'
    }
    results.push({ ...row, status, seconds, peakMB: peak > 0 ? peak : null })
    if (code !== 0) {
      failed = true
      exitCode = code
    }
  }
  return { results, exitCode, reports }
}

/** Markdown table: one row per step. Used for stdout, $GITHUB_STEP_SUMMARY and --json. */
export function renderTable(results) {
  const rows = results.map((r) => `| ${r.id} | ${r.status} | ${r.status.startsWith('passed') || r.status === 'FAILED' ? r.seconds.toFixed(1) : '-'} | ${r.peakMB ?? '-'} |`)
  return ['| step | status | seconds | peak MB |', '| --- | --- | --- | --- |', ...rows].join('\n')
}

/** Default runner: one child at a time, inherited output, memory sampled over its whole process tree. */
export function spawnRunner(argv, extraEnv, isBin = false) {
  return new Promise((resolve) => {
    const [cmd, args] = isBin ? [argv[0], argv.slice(1)] : [process.execPath, argv]
    const child = spawn(cmd, args, { cwd: REPO_ROOT, env: { ...process.env, ...extraEnv }, stdio: 'inherit', shell: false })
    let peak = 0
    const stop = startSampler(child.pid, SAMPLE_INTERVAL_MS, (bytes) => {
      if (bytes > peak) peak = bytes
    })
    const finish = (code) => {
      stop()
      resolve({ code, peakMB: Math.round(peak / 1048576) })
    }
    child.on('error', () => finish(1))
    child.on('exit', (code) => finish(code))
  })
}

/** @param {string[]} argv */
export function parseGateArgs(argv) {
  const i = argv.indexOf('--json')
  // A missing value, or an option where the value should be, becomes '' so main refuses it (exit 2) instead of ignoring the flag.
  const valueOf = (name) => {
    const at = argv.indexOf(name)
    if (at === -1) return undefined
    const v = argv[at + 1]
    return v === undefined || v.startsWith('--') ? '' : v
  }
  return {
    quick: argv.includes('--quick'),
    dryRun: argv.includes('--dry-run'),
    json: i === -1 ? undefined : argv[i + 1],
    base: valueOf('--base'),
    head: valueOf('--head'),
    repair: argv.includes('--repair'),
    protectedGate: argv.includes('--protected'),
    classify: !argv.includes('--no-classify'),
  }
}

const UNIT_ID = 'unit tests'
const E2E_ID = 'e2e (Playwright)'
const UNIT_PROJECTS = ['frontend', 'pure', 'backend']
const E2E_PROJECTS = ['flows', 'first-run', 'a11y']
const PROJECT_REFUSAL = `--project needs --only "${UNIT_ID}" (${UNIT_PROJECTS.join(', ')}) or --only "${E2E_ID}" (${E2E_PROJECTS.join(', ')})`
const SHARD_REFUSAL = `--shard needs --only "${UNIT_ID}" or --only "${E2E_ID}" and <i>/<n> with 1 <= i <= n <= 16`
export const QUICK_REFUSAL = '--quick cannot be combined with --only or --public'
export const REPAIR_ONLY_REFUSAL = '--repair cannot be combined with --only'

/**
 * The flags of the phase scripts: --only <step id>, --project <name>, --shard <i>/<n> and --public. A missing value, or an
 * option where the value should be, is '' so main refuses it (exit 2).
 * @param {string[]} argv
 * @returns {{ only?: string, project?: string, shard?: string, publicBuild: boolean }}
 */
export function parseGateExtras(argv) {
  const valueOf = (name) => {
    const at = argv.indexOf(name)
    if (at === -1) return undefined
    const v = argv[at + 1]
    return v === undefined || v.startsWith('--') ? '' : v
  }
  const out = { publicBuild: argv.includes('--public') }
  for (const [key, flag] of [['only', '--only'], ['project', '--project'], ['shard', '--shard']]) {
    const v = valueOf(flag)
    if (v !== undefined) out[key] = v
  }
  return out
}

/**
 * Keeps exactly one step of a plan and rewrites its commands for --project and --shard. Applied before decoratePlan.
 * @param {ReturnType<typeof planGate>} plan
 * @param {{ only?: string, project?: string, shard?: string }} o
 * @returns {ReturnType<typeof planGate> | { error: string }}
 */
export function selectSteps(plan, { only, project, shard } = {}) {
  const onlyRefusal = `--only needs a step id: one of ${plan.entries.map((e) => e.id).join(', ')}`
  if (only === undefined) return { error: project !== undefined ? PROJECT_REFUSAL : shard !== undefined ? SHARD_REFUSAL : onlyRefusal }
  const chosen = plan.entries.find((e) => e.id === only)
  if (!chosen) return { error: onlyRefusal }
  const isUnit = chosen.id === UNIT_ID
  const isE2e = chosen.id === E2E_ID
  if (project !== undefined && !(isUnit ? UNIT_PROJECTS : isE2e ? E2E_PROJECTS : []).includes(project)) return { error: PROJECT_REFUSAL }
  if (shard !== undefined) {
    const m = /^(\d+)\/(\d+)$/.exec(shard)
    const i = m ? Number(m[1]) : 0
    const n = m ? Number(m[2]) : 0
    if (!(isE2e || isUnit) || !m || i < 1 || i > n || n > 16) return { error: SHARD_REFUSAL }
  }
  let commands = chosen.commands
  if (project !== undefined && isUnit) commands = commands.map((c) => [c[0], 'run', '--project', project, ...c.slice(2)])
  if (project !== undefined && isE2e) {
    commands = commands.map((c) => {
      const at = c.findIndex((a) => a.startsWith('--project='))
      return at === -1 ? c : [...c.slice(0, at), `--project=${project}`, ...c.slice(at).filter((a) => !a.startsWith('--project='))]
    })
  }
  if (shard !== undefined) commands = commands.map((c) => [...c, ...(isUnit ? ['--passWithNoTests'] : []), `--shard=${shard}`])
  const tail = `${project !== undefined ? ` --project ${project}` : ''}${shard !== undefined ? ` --shard ${shard}` : ''}`
  return { ...plan, mode: 'only', note: `only ${chosen.id}${tail}`, entries: [{ ...chosen, commands }] }
}

/**
 * The public build pass: every step runs under APP_PRO_DIR=none; the studio sidecar proves the cloud provider absent; the
 * cloud-off build is skipped (the public build has no cloud provider, and the public build step proves it).
 * @param {ReturnType<typeof planGate>} plan
 */
export function publicPlan(plan) {
  const entries = plan.entries.map((e) => {
    const next = { ...e, env: { ...e.env, APP_PRO_DIR: 'none' } }
    if (e.id === 'sidecar budget (studio)') next.commands = e.commands.map((c) => c.map((a) => (a === '--require-present' ? '--require-absent' : a)))
    if (e.id === 'cloud-off build') next.skip = 'the public build has no cloud provider; the public build step proves it absent'
    return next
  })
  return { ...plan, entries }
}

/** 'pro' or 'public' for an environment, as the one resolver of APP_PRO_DIR says. */
export function buildOf(env = process.env, root = REPO_ROOT) {
  return resolveProDir(env, root).mode
}

/**
 * The public plan applies on --public, and automatically when pro/ is absent (a public checkout has no cloud provider to
 * require). `note` is the one line to print when the plan was chosen automatically, else null.
 * @param {ReturnType<typeof planGate>} plan
 * @param {{ publicFlag?: boolean, env?: Record<string, string | undefined>, root?: string }} [o]
 */
export function choosePlan(plan, { publicFlag = false, env = process.env, root = REPO_ROOT } = {}) {
  if (publicFlag) return { plan: publicPlan(plan), note: null }
  if (buildOf(env, root) !== 'public') return { plan, note: null }
  return { plan: publicPlan(plan), note: 'pro/ is absent: using the public plan (same as --public)' }
}

function printPlan(plan) {
  console.log(`gate plan (${plan.note}):`)
  for (const e of plan.entries) {
    if (e.skip) console.log(`  [skip] ${e.id}: ${e.skip}`)
    else {
      console.log(`  [run]  ${e.id}${e.heavy ? ' (heavy)' : ''}`)
      for (const c of e.commands) console.log(`           ${c.join(' ')}`)
    }
  }
}

/**
 * Adds what classification and the ledger need to a plan: JSON reporters on the test steps (the same flags CI uses) and
 * `--json` on the budget scripts. Pure; the plan printed by --dry-run shows it too.
 * @param {ReturnType<typeof planGate>} plan
 * @param {{ classify?: boolean }} [o]
 */
export function decoratePlan(plan, { classify = true } = {}) {
  const budgetFiles = { 'bundle budget': 'bundle.json', 'sidecar budget (studio)': 'sidecar-studio.json', 'sidecar budget (runtime)': 'sidecar-runtime.json' }
  const entries = plan.entries.map((e) => {
    if (e.skip) return e
    if (classify && e.id === 'unit tests') {
      return { ...e, classify: 'unit', commands: e.commands.map((c, i) => [...c, ...unitReporterArgs(jsonPathFor('unit', i + 1))]) }
    }
    if (classify && e.id === 'e2e (Playwright)') {
      return { ...e, classify: 'e2e', env: { ...e.env, PLAYWRIGHT_JSON_OUTPUT_NAME: jsonPathFor('e2e'), GATE_CLASSIFY: '1' }, commands: e.commands.map((c) => [...c, `--reporter=list,json,${PREVIEW_START_REPORTER}`]) }
    }
    const file = budgetFiles[e.id]
    if (file) return { ...e, commands: e.commands.map((c) => (c.some((a) => a.endsWith('Budget.js')) ? [...c, '--json', `${RUN_DIR}/${file}`] : c)) }
    return e
  })
  return { ...plan, entries }
}

const gitOut = (args) => {
  try {
    const exe = gitExe()
    if (exe === null) throw new Error('git not found on an absolute PATH entry')
    return execFileSync(exe, args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

/** Why `--repair` cannot run for a `--head` other than the checked-out commit (it would fix and commit the wrong branch), else null. */
export function repairHeadRefusal(head, currentHead) {
  if (head === undefined || head === currentHead) return null
  return '--repair fixes and commits the checked-out branch, so it cannot run for a different --head. Check that commit out, or run without --repair.'
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const { quick, dryRun, json, base, head, repair: wantRepair, protectedGate: protectedFlag, classify } = parseGateArgs(argv)
  if (json !== undefined && (!json || json.startsWith('--'))) {
    console.error('--json needs a file path')
    return 2
  }
  if (base !== undefined && !HEX40.test(base)) {
    console.error('--base needs a commit sha (40 hex characters)')
    return 2
  }
  if (head !== undefined && !HEX40.test(head)) {
    console.error('--head needs a commit sha (40 hex characters)')
    return 2
  }
  if (wantRepair && env.CI) {
    console.error(CI_REFUSAL)
    return 2
  }
  const refusal = wantRepair ? repairHeadRefusal(head, gitOut(['rev-parse', 'HEAD'])) : null
  if (refusal) {
    console.error(refusal)
    return 2
  }
  const extras = parseGateExtras(argv)
  const picked = extras.only !== undefined || extras.project !== undefined || extras.shard !== undefined
  if (quick && (picked || extras.publicBuild)) {
    console.error(QUICK_REFUSAL)
    return 2
  }
  if (wantRepair && picked) {
    console.error(REPAIR_ONLY_REFUSAL)
    return 2
  }
  const protectedGate = protectedFlag || env.GATE_PROTECTED === '1'
  const diff = quick ? gitDiffAgainst({ base, head }) : null
  const alwaysRun = quick ? [...new Set([...ALWAYS_RUN, ...scanAlwaysRun()])].sort() : []
  // The public pass decides the build before anything reads the environment; process.env too, because the classifier's rerun spreads it.
  // A usage error is found first on a copy of the environment, so a refused run never leaves APP_PRO_DIR set.
  if (extras.publicBuild) {
    if (picked) {
      const probe = selectSteps(planGate({ quick, env: { ...env, APP_PRO_DIR: 'none' }, diff, hasBinary: binaryOnPath, alwaysRun }), extras)
      if ('error' in probe) {
        console.error(probe.error)
        return 2
      }
    }
    env.APP_PRO_DIR = 'none'
    process.env.APP_PRO_DIR = 'none'
  }
  let planned = planGate({ quick, env, diff, hasBinary: binaryOnPath, alwaysRun })
  if (picked) {
    const selected = selectSteps(planned, extras)
    if ('error' in selected) {
      console.error(selected.error)
      return 2
    }
    planned = selected
  }
  const chosen = choosePlan(planned, { publicFlag: extras.publicBuild, env })
  planned = chosen.plan
  if (chosen.note) console.log(chosen.note)
  const plan = decoratePlan(planned, { classify })
  printPlan(plan)
  if (dryRun) return 0

  const runDir = path.join(REPO_ROOT, RUN_DIR)
  rmSync(runDir, { recursive: true, force: true })
  mkdirSync(runDir, { recursive: true })

  let repairs = null
  if (wantRepair) {
    const repairDiff = diff ?? gitDiffAgainst({ base, head })
    const targets = (repairDiff?.files ?? []).filter((f) => f.status !== 'removed' && LINT_TARGET.test(f.path)).map((f) => f.path)
    repairs = await repair({ targets, env })
    for (const line of [...repairs.refused, ...repairs.skipped]) console.log(`repair: ${line}`)
  }

  const now = Date.now()
  const headSha = gitOut(['rev-parse', 'HEAD'])
  const runId = makeRunId({ env, now, head: headSha })
  const classifiers = {}
  if (classify) {
    const { state, expired } = prepareState({ protectedGate, now })
    const holder = { state }
    classifiers.unit = createClassifier({ kind: 'unit', holder, expired, runId, protectedGate })
    classifiers.e2e = createClassifier({ kind: 'e2e', holder, expired: [], runId, protectedGate })
    classifiers.holder = holder
  }
  const { results, exitCode, reports } = await runGate({ entries: plan.entries, runner: spawnRunner, classifiers })

  const ledgerMode = plan.mode !== 'quick'
  const build = buildOf(env)
  const state = classifiers.holder?.state ?? { tests: {} }
  const ledgerFile = path.join(REPO_ROOT, LEDGER_FILE)
  const budgets = ledgerMode ? withHeadroom(readBudgetFiles(runDir), previousFor(readLedger(ledgerFile), build)) : []
  const at = new Date(now).toISOString()
  let ledgerLine = null
  const repairInfo = { committed: repairs?.committed?.sha ?? null, refused: repairs?.refused ?? [] }
  const entry = buildEntry({ runId, at, mode: plan.mode === 'only' ? 'only' : 'full', protectedGate, head: headSha, branch: gitOut(['rev-parse', '--abbrev-ref', 'HEAD']), exitCode, steps: results, unit: reports.unit ?? null, e2e: reports.e2e ?? null, budgets, state, now, repair: repairInfo, build, only: extras.only ?? null, project: extras.project ?? null, shard: extras.shard ?? null })
  if (ledgerMode) ledgerLine = appendEntry(entry, ledgerFile)
  const text = renderSummary({ mode: plan.mode, at, head: headSha, protectedGate, steps: results, unit: reports.unit ?? null, e2e: reports.e2e ?? null, state, now, budgets: summaryRows(budgets), decisions: needsDecision(budgets, build), repairs, ledgerLine, stateNote: state.note })
  console.log(`\n${text}\n`)
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`)
  writeFileSync(path.join(runDir, 'summary.md'), `${text}\n`)
  copyFileSync(path.join(runDir, 'summary.md'), path.join(REPO_ROOT, '.gate', 'last-summary.md'))
  if (json) {
    const reportList = [reports.unit, reports.e2e].filter(Boolean)
    const failures = {
      real: reportList.flatMap((r) => r.real.map((x) => ({ kind: x.kind, file: x.file, title: x.title, where: x.where ?? null, assertion: x.assertion ?? null }))),
      flaky: reportList.flatMap((r) => r.flaky.map((x) => ({ kind: x.kind, file: x.file, title: x.title, quarantined: Boolean(x.quarantined), quarantinedNow: Boolean(x.quarantinedNow) }))),
      unexplained: reportList.some((r) => r.unexplained),
      tooMany: reportList.some((r) => r.tooMany),
    }
    const budgetRows = summaryRows(budgets).map((b) => ({ id: b.id, label: b.label, measured: b.measured, limit: b.limit, headroomPct: b.headroomPct, delta: b.delta }))
    const out = { v: 2, mode: plan.mode, note: plan.note, exitCode, results, build, only: entry.only, project: entry.project, shard: entry.shard, head: headSha, runId, at, tests: entry.tests, failures, budgets: budgetRows, decisions: needsDecision(budgets, build), ledgerLine }
    writeFileSync(path.resolve(json), `${JSON.stringify(out, null, 2)}\n`)
  }
  if (repairs?.committed) console.log(`The gate made a commit with mechanical fixes (${repairs.committed.sha.slice(0, 7)}).`)
  return exitCode
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main()
}
