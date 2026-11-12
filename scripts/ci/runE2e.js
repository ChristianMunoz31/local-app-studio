// The CI e2e step: runs Playwright for the given projects with a JSON report, then classifies each failure like the unit
// step does (rerun once alone, flaky or real, quarantine; DESIGN-phase15 section 2.4). Playwright's own CI retry is off
// while classifying (`GATE_CLASSIFY=1`, playwright.config.js): the rerun alone replaces it.
// Usage: node scripts/ci/runE2e.js --project=flows --project=first-run [--project=a11y]
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { REPO_ROOT } from '../checks/gitFiles.js'
import { PREVIEW_START_REPORTER, RUN_DIR, createClassifier, jsonPathFor, prepareState } from './gateClassify.js'
import { makeRunId } from './gateState.js'

const PLAYWRIGHT_BIN = 'node_modules/@playwright/test/cli.js'
const PROJECT_ARG = /^--project=[a-z0-9-]+$/

/**
 * The Playwright command for the projects given. Only `--project=<name>` arguments are accepted.
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ argv: string[], env: Record<string, string>, jsonFile: string } | { error: string }}
 */
export function planE2eRun(argv, env = process.env) {
  if (argv.length === 0) return { error: 'Usage: runE2e.js --project=<name> [--project=<name> ...]' }
  const bad = argv.find((a) => !PROJECT_ARG.test(a))
  if (bad !== undefined) return { error: `runE2e.js only takes --project=<name> arguments (got "${bad}").` }
  const jsonFile = jsonPathFor('e2e')
  const reporters = env.CI ? `github,html,json,${PREVIEW_START_REPORTER}` : `list,json,${PREVIEW_START_REPORTER}`
  return {
    argv: [PLAYWRIGHT_BIN, 'test', ...argv, `--reporter=${reporters}`],
    env: { PLAYWRIGHT_JSON_OUTPUT_NAME: jsonFile, GATE_CLASSIFY: '1' },
    jsonFile,
  }
}

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @param {{ run?: (plan: { argv: string[], env: Record<string, string> }) => number, classifierOptions?: object }} [seams]
 */
export async function main(argv = process.argv.slice(2), env = process.env, { run, classifierOptions = {} } = {}) {
  const plan = planE2eRun(argv, env)
  if ('error' in plan) {
    console.error(plan.error)
    return 2
  }
  const protectedGate = env.GATE_PROTECTED === '1'
  const { state, expired } = prepareState({ protectedGate, stateFile: classifierOptions.stateFile })
  const classifier = createClassifier({ kind: 'e2e', state, expired, runId: makeRunId({ env, head: env.GITHUB_SHA ?? '' }), protectedGate, ...classifierOptions })
  const root = classifierOptions.root ?? REPO_ROOT
  mkdirSync(path.join(root, RUN_DIR), { recursive: true })
  rmSync(path.join(root, plan.jsonFile), { force: true })
  const exec = run ?? ((p) => spawnSync(process.execPath, p.argv, { cwd: root, env: { ...process.env, ...p.env }, stdio: 'inherit', shell: false }).status ?? 1)
  const code = await classifier.afterCommand(1, exec(plan))
  const report = classifier.finish()
  if (report.flaky.length > 0 || report.quarantinedFailures.length > 0) {
    console.log(`e2e: ${report.flaky.length} flaky, ${report.quarantinedFailures.length} quarantined failure(s); see the gate summary.`)
  }
  return code
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main()
}
