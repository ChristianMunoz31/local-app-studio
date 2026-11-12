// The phase gate's step plan and argument parsing (docs/phase24/DESIGN-phase24.md, sections 2 and 2.1). Pure: nothing here
// reads a file, spawns a process or looks at the clock. One step is one child process; its key is `<build>:<slug>`.
import path from 'node:path'

export const BUILDS = Object.freeze(['pro', 'public'])
export const DEFAULTS = Object.freeze({ maxWorkers: 4, e2eShards: 3, unitShards: 1, waitMaxNext: 60, waitMaxAll: 1800 })

// The run folder a light step gives its gate child (GATE_RUN_DIR, scripts/ci/gateClassify.js). A gate child clears its run folder when it
// starts, so a light step beside a heavy one must not share the heavy step's folder.
export const LIGHT_RUN_DIR = '.gate/run-light'

/** Vitest workers for unit-pure when it runs beside a heavy step: half of --max-workers (at least 1), so the pair never runs 2 x max. */
export const lightWorkers = (maxWorkers) => Math.max(1, Math.floor(maxWorkers / 2))

const GATE = 'scripts/ci/gate.js'
const PRO_MARKER = 'scripts/checks/proMarker.js'

/** `7` -> `07`, `24` -> `24`. */
export const pad2 = (n) => String(n).padStart(2, '0')
export const stepKey = (build, slug) => `${build}:${slug}`
export const logFileName = (phase, build, slug) => `p${pad2(phase)}-${build}-${slug}.log`
export const resultFileName = (build, slug) => `${build}-${slug}.json`

/**
 * The phase number from the repo folder name (`las-wt-phase24`) or the branch (`feat/phase24-...`), else null.
 * @param {string} rootName basename of the repo root
 * @param {string} branch current branch name
 * @returns {number | null}
 */
export function detectPhase(rootName, branch) {
  const fromDir = /^las-wt-phase(\d+)$/i.exec(String(rootName))
  if (fromDir) return Number(fromDir[1])
  const fromBranch = /^feat\/phase(\d+)-/.exec(String(branch))
  return fromBranch ? Number(fromBranch[1]) : null
}

const gateStep = (slug, row, only, extra, flags = {}) => ({ slug, row, kind: 'gate', only, extra, ...flags })
const directStep = (slug, row, commands, flags = {}) => ({ slug, row, kind: 'direct', commands, ...flags })

/**
 * The step table of 2.1 for one build, in order. `shards` is the number of flows e2e shards.
 * `light` marks the steps that may run beside one heavy step (lint, typecheck, unit-pure, the hygiene checks): see nextPair in gateRun.js.
 * unit-pure is light and also `heavy`: a vitest run still waits for a quiet machine before it starts, but it is not counted as a heavy step when pairing.
 */
function templatesFor(build, shards, maxWorkers, unitShards = 1) {
  const pro = build === 'pro'
  const t = []
  const add = (step, when = true) => {
    if (when) t.push({ heavy: false, light: false, needs: [], ...step })
  }
  for (const [slug, id] of [
    ['hygiene-gitleaks', 'hygiene: gitleaks'],
    ['hygiene-em-dash', 'hygiene: em dash'],
    ['hygiene-keys', 'hygiene: keys'],
    ['hygiene-personal', 'hygiene: personal data'],
  ]) add(gateStep(slug, 'check', id, [], { light: true }))
  add(directStep('check-extra', 'check', [['scripts/ci/workflowCheck.js'], [PRO_MARKER, '--require-present', '--source']], { light: true }))
  add(gateStep('lint', 'lint', 'lint', [], { light: true }))
  add(gateStep('typecheck', 'tsc (outside vendor)', 'typecheck', [], { light: true }))
  for (const p of ['frontend', 'pure', 'backend']) {
    for (let i = 1; i <= unitShards; i += 1) {
      const slug = unitShards === 1 ? `unit-${p}` : `unit-${p}-${i}of${unitShards}`
      add(gateStep(slug, `vitest ${p}`, 'unit tests', ['--project', p, ...(unitShards === 1 ? [] : ['--shard', `${i}/${unitShards}`])], { heavy: true, light: p === 'pure' }))
    }
  }
  add(directStep('template-parity', 'templateParity', [['node_modules/vitest/vitest.mjs', 'run', '--project', 'backend', 'pro/server/__tests__/templateParity.test.js', `--maxWorkers=${maxWorkers}`]], { heavy: true }), pro)
  add(gateStep('build', null, 'build', [], { heavy: true }))
  const b = stepKey(build, 'build')
  add(gateStep('bundle-budget', 'bundle', 'bundle budget', [], { needs: [b] }))
  add(gateStep('sidecar-studio', 'studio sidecar', 'sidecar budget (studio)', [], { heavy: true, needs: [b] }))
  add(directStep('pro-marker-studio', 'pro marker present', [[PRO_MARKER, '--require-present', '--kind', 'studio', '--bundle', '.sidecar-build/server.cjs', '--dist-dir', 'dist']], { needs: [stepKey(build, 'sidecar-studio')] }), pro)
  add(gateStep('sidecar-runtime', 'runtime sidecar', 'sidecar budget (runtime)', [], { heavy: true, needs: [b] }))
  add(directStep('pro-marker-runtime', 'pro marker present', [[PRO_MARKER, '--require-present', '--kind', 'runtime', '--bundle', '.sidecar-build/server.cjs']], { needs: [stepKey(build, 'sidecar-runtime')] }), pro)
  add(gateStep('cloud-off', 'cloud-off build', 'cloud-off build', [], { heavy: true }), pro)
  for (let i = 1; i <= shards; i += 1) {
    const slug = shards === 1 ? 'e2e-flows' : `e2e-flows-${i}of${shards}`
    add(gateStep(slug, 'e2e', 'e2e (Playwright)', ['--project', 'flows', ...(shards === 1 ? [] : ['--shard', `${i}/${shards}`])], { heavy: true, needs: [b] }))
  }
  add(gateStep('e2e-first-run', 'e2e', 'e2e (Playwright)', ['--project', 'first-run'], { heavy: true, needs: [b] }))
  add(gateStep('e2e-a11y', 'e2e', 'e2e (Playwright)', ['--project', 'a11y'], { heavy: true, needs: [b] }))
  add(gateStep('public-build', 'check:public', 'public build', [], { heavy: true }), !pro)
  return t
}

/**
 * The whole plan: the pro table, then the public table (when both builds are asked for).
 * @param {{ phase: number, builds: string[], classify: boolean, maxWorkers: number, e2eShards: number, unitShards?: number, resultDir: string }} o
 * @returns {object[]} steps in state shape (status pending)
 */
export function buildPlan(o) {
  const steps = []
  for (const build of BUILDS.filter((x) => o.builds.includes(x))) {
    for (const t of templatesFor(build, o.e2eShards, o.maxWorkers, o.unitShards ?? 1)) {
      let argv
      let then = []
      if (t.kind === 'gate') {
        argv = [GATE, '--only', t.only, ...t.extra, '--json', path.join(o.resultDir, resultFileName(build, t.slug))]
        if (build === 'public') argv.push('--public')
        if (!o.classify) argv.push('--no-classify')
      } else {
        argv = t.commands[0]
        then = t.commands.slice(1)
      }
      steps.push({
        key: stepKey(build, t.slug), build, slug: t.slug, row: t.row, kind: t.kind, heavy: t.heavy, needs: t.needs, argv, then,
        light: t.light === true,
        env: { ...(t.kind === 'direct' && build === 'public' ? { APP_PRO_DIR: 'none' } : {}), ...(t.kind === 'gate' && t.light ? { GATE_RUN_DIR: LIGHT_RUN_DIR } : {}) },
        status: 'pending', reason: null, startedAt: null, endedAt: null, seconds: null, exitCode: null, head: null,
        log: logFileName(o.phase, build, t.slug), result: null,
      })
    }
  }
  return steps
}

/** The commands of one step, each the argv after `node` (a gate child gets the pro and public flags from `--public`). */
export const commandsOf = (step) => [step.argv, ...(step.then ?? [])]

const USAGE =
  'usage: node scripts/phase/gate.js [--phase <N>] (--next | --all | --status | --dry-run | --reset | --rerun <key>) [--both-builds | --build pro|public] [--no-classify-flakes] [--wait-for <worktree name>|any (default any)] [--wait-max <s>] [--max-workers <n>] [--e2e-shards <n>] [--unit-shards <n>] [--no-overlap] [--log-dir <dir>] [--json <file>] [--md <file>] [--allow-moved-head]'
const ONE_COMMAND = 'give exactly one of --next, --all, --status, --dry-run, --reset, --rerun'
const PLAN_KEYS = ['builds', 'classify', 'maxWorkers', 'e2eShards', 'unitShards', 'logDir']
const SIMPLE = { '--next': 'next', '--all': 'all', '--status': 'status', '--reset': 'reset', '--dry-run': 'dryRun' }

/**
 * Reads the argv. `explicit` lists the plan options the call really gave, so a later call without them is not a change.
 * @param {string[]} argv
 * @returns {{ error: string } | { command: string, rerunKey: string | null, phase: number | null, builds: string[], classify: boolean, maxWorkers: number,
 *   e2eShards: number, unitShards: number, waitFor: string | null, waitMax: number | null, logDir: string | null, json: string | null, md: string | null,
 *   allowMovedHead: boolean, overlap: boolean, explicit: string[] }}
 */
export function parseArgs(argv) {
  const o = { command: null, rerunKey: null, phase: null, builds: ['pro'], classify: true, maxWorkers: DEFAULTS.maxWorkers, e2eShards: DEFAULTS.e2eShards, unitShards: DEFAULTS.unitShards, waitFor: null, waitMax: null, logDir: null, json: null, md: null, allowMovedHead: false, overlap: true, explicit: [] }
  const fail = (m) => ({ error: `${m}\n${USAGE}` })
  const intIn = (v, lo, hi) => (v !== null && /^\d+$/.test(v) && Number(v) >= lo && Number(v) <= hi ? Number(v) : null)
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    const value = () => {
      const v = argv[i + 1]
      if (v === undefined || v.startsWith('--')) return null
      i += 1
      return v
    }
    if (SIMPLE[a]) {
      if (o.command && o.command !== SIMPLE[a]) return fail(ONE_COMMAND)
      o.command = SIMPLE[a]
    } else if (a === '--rerun') {
      const v = value()
      if (!v || !/^(pro|public):[a-z0-9-]+$/.test(v)) return fail('--rerun needs a step key like pro:unit-frontend')
      if (o.command) return fail(ONE_COMMAND)
      o.command = 'rerun'
      o.rerunKey = v
    } else if (a === '--phase') {
      const v = intIn(value(), 1, 999)
      if (v === null) return fail('--phase needs a number')
      o.phase = v
    } else if (a === '--both-builds') {
      o.builds = ['pro', 'public']
      o.explicit.push('builds')
    } else if (a === '--build') {
      const v = value()
      if (v !== 'pro' && v !== 'public') return fail('--build needs pro or public')
      o.builds = [v]
      o.explicit.push('builds')
    } else if (a === '--no-classify-flakes') {
      o.classify = false
      o.explicit.push('classify')
    } else if (a === '--wait-for') {
      const v = value()
      if (!v || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(v)) return fail('--wait-for needs a worktree name or any')
      o.waitFor = v
    } else if (a === '--wait-max') {
      const v = intIn(value(), 0, 86400)
      if (v === null) return fail('--wait-max needs a number of seconds')
      o.waitMax = v
    } else if (a === '--max-workers') {
      const v = intIn(value(), 1, 32)
      if (v === null) return fail('--max-workers needs a number from 1 to 32')
      o.maxWorkers = v
      o.explicit.push('maxWorkers')
    } else if (a === '--e2e-shards') {
      const v = intIn(value(), 1, 8)
      if (v === null) return fail('--e2e-shards needs a number from 1 to 8')
      o.e2eShards = v
      o.explicit.push('e2eShards')
    } else if (a === '--unit-shards') {
      const v = intIn(value(), 1, 8)
      if (v === null) return fail('--unit-shards needs a number from 1 to 8')
      o.unitShards = v
      o.explicit.push('unitShards')
    } else if (a === '--log-dir') {
      const v = value()
      if (!v) return fail('--log-dir needs a path')
      o.logDir = v
      o.explicit.push('logDir')
    } else if (a === '--json' || a === '--md') {
      const v = value()
      if (!v) return fail(`${a} needs a path`)
      o[a.slice(2)] = v
    } else if (a === '--no-overlap') {
      o.overlap = false
    } else if (a === '--allow-moved-head') {
      o.allowMovedHead = true
    } else {
      return fail(`unknown argument ${a}`)
    }
  }
  if (!o.command) return fail(ONE_COMMAND)
  return o
}

/**
 * A later call must not change the plan options of a run that exists. Returns the message, or null.
 * @param {{ builds: string[], classify: boolean, maxWorkers: number, e2eShards: number, logDir: string }} stored
 * @param {{ builds: string[], classify: boolean, maxWorkers: number, e2eShards: number, logDir: string | null, explicit: string[] }} given
 * @returns {string | null}
 */
export function optionsConflict(stored, given) {
  const diff = PLAN_KEYS.filter((k) => given.explicit.includes(k) && JSON.stringify(given[k]) !== JSON.stringify(stored[k] ?? DEFAULTS[k]))
  return diff.length === 0 ? null : `the plan options of this run are fixed (${diff.join(', ')} differ): run --reset to start a new run`
}

/** One line per step with its child argv, for --dry-run. */
export function dryRunLines(steps) {
  return steps.map((s) => {
    const env = Object.entries(s.env ?? {}).map(([k, v]) => `${k}=${v}`)
    const cmds = commandsOf(s).map((c) => `node ${c.join(' ')}`).join(' ; then ')
    return `${s.key}${s.light ? (s.heavy ? ' (light, waits)' : ' (light)') : s.heavy ? ' (heavy)' : ''}${s.needs.length ? ` needs ${s.needs.join(', ')}` : ''}: ${cmds}${env.length ? ` [env ${env.join(' ')}]` : ''}`
  })
}
