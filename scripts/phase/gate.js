// The phase gate: the hand gate list of a phase as resumable steps (docs/phase24/DESIGN-phase24.md, section 2). Each step is
// one child process in the foreground (never in-process, so a killed child leaves the state intact); the state lives in
// .gate/phase/phase-<NN>.json and every call does one step (or a heavy step with one light step beside it), so one call stays under a 600 s tool cap.
//   node scripts/phase/gate.js [--phase <N>] (--next | --all | --status | --dry-run | --reset | --rerun <key>)
//     [--both-builds | --build pro|public] [--no-classify-flakes] [--wait-for <worktree name>|any (default any)] [--wait-max <s>]
//     [--max-workers <n>] [--e2e-shards <n>] [--unit-shards <n>] [--no-overlap] [--log-dir <dir>] [--json <file>] [--md <file>] [--allow-moved-head]
// A call runs one step and, when the plan allows it, one light step beside a heavy one (the plan's `light` flag, docs/PIPELINE.md "Light steps"); --no-overlap runs one step per call.
// A heavy step (never a light one) runs under the shared heavy-step lock of wait.js, taken just before it starts and released when it ends; between calls the gate holds nothing.
// Exit codes: 0 a step ran (whatever its result) or nothing is left, 2 usage or HEAD moved, 3 another runner (the driver or its child still alive), 75 the wait ran out or the process list could not be read.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { DEFAULTS, buildPlan, commandsOf, detectPhase, dryRunLines, lightWorkers, optionsConflict, pad2, parseArgs } from './lib/gatePlan.js'
import { archiveState, classifyDirect, classifyResult, finishStep, headGuard, isHeavyStep, isLight, lastLine, makeRunId, markRunning, newState, nextPair, readState, reapRunner, rerun, secondsBetween, setChild, statusLines, writeFileAtomic, writeState } from './lib/gateRun.js'
import { renderJson, renderMarkdown } from './lib/gateRender.js'
import { GIT_NOT_FOUND, gitExe } from './lib/processTable.js'
import { baseOf, makeIsAlive, ownLeftovers, readCreated, readProcesses, sleepMs, targetsFor, waitForQuiet } from './lib/waitFor.js'
import { parseWorktreeList } from './lib/worktrees.js'
import { blockersNow, defaultLockFile, release, tryAcquire } from './wait.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const CAP_WARN_SECONDS = 540
const EXIT = { usage: 2, busy: 3, wait: 75 }

/** Default child runner: `node <argv>` with stdout and stderr appended to the log file. `onSpawn(pid)` is called right after the spawn. Resolves the exit code (null: could not start). */
function runChildDefault(argv, { cwd, env, logPath, onSpawn }) {
  const fd = fs.openSync(logPath, 'a')
  return new Promise((resolve) => {
    let done = false
    const finish = (code) => {
      if (done) return
      done = true
      fs.closeSync(fd)
      resolve(code)
    }
    const child = spawn(process.execPath, argv, { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', fd, fd] })
    child.on('error', () => finish(null))
    if (typeof child.pid === 'number' && onSpawn) onSpawn(child.pid)
    child.on('close', (code) => finish(code))
  })
}

/** The exit 3 text: the driver of another call, or the orphan child of a killed one. */
const busyText = (r) => (r.child ? `the step ${r.key} is still running in pid ${r.busy}` : `another phase gate call is running: pid ${r.busy}`)

// git by absolute path (never the bare name: libuv looks in the cwd first on Windows); throws GIT_NOT_FOUND when there is none.
const gitDefault = (root) => (args) => {
  const exe = gitExe()
  if (exe === null) throw new Error(GIT_NOT_FOUND)
  return execFileSync(exe, args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
}

/** Last `n` lines of a text file ('' when unreadable). */
function tailLines(file, n) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l, i, all) => l !== '' || i < all.length - 1).slice(-n)
  } catch {
    return []
  }
}

function readJsonOrNull(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/**
 * The command. Every effect goes through `deps`, so tests run it over fakes.
 * @param {string[]} argv
 * @param {Partial<{ root: string, git: (args: string[]) => string, runChild: Function, now: () => number, sleep: (ms: number) => Promise<void>, readProcs: () => Promise<{ pid: number, name: string, cmd: string }[]>,
 *   isAlive: (pid: number, created?: string | null) => boolean, lockFile: string, readCreated: (pid: number) => string | null, env: NodeJS.ProcessEnv, pid: number, parseWorktrees: Function, out: (s: string) => void, err: (s: string) => void, pollMs: number }>} [deps]
 * @returns {Promise<number>} the exit code
 */
export async function main(argv, deps = {}) {
  const root = deps.root ?? REPO_ROOT
  const git = deps.git ?? gitDefault(root)
  const runChild = deps.runChild ?? runChildDefault
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? sleepMs
  const readProcs = deps.readProcs ?? readProcesses
  const pid = deps.pid ?? process.pid
  // Tests that fake the pid or the liveness check get no live creation-time reader (it would ask Windows about a made-up pid).
  const created = deps.readCreated ?? (deps.isAlive || deps.pid !== undefined ? () => null : readCreated)
  const isAlive = deps.isAlive ?? makeIsAlive(created)
  const baseEnv = deps.env ?? process.env
  const lockFile = deps.lockFile ?? defaultLockFile()
  const parseWorktrees = deps.parseWorktrees ?? parseWorktreeList
  const out = deps.out ?? ((s) => console.log(s))
  const err = deps.err ?? ((s) => console.error(s))

  const args = parseArgs(argv)
  if ('error' in args) {
    err(args.error)
    return EXIT.usage
  }
  let branch
  try {
    branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
  } catch {
    branch = ''
  }
  const phase = args.phase ?? detectPhase(baseOf(root), branch)
  if (phase === null) {
    err('cannot tell the phase from the folder or branch name: pass --phase <N>')
    return EXIT.usage
  }
  const nn = pad2(phase)
  const phaseDir = path.join(root, '.gate', 'phase')
  const stateFile = path.join(phaseDir, `phase-${nn}.json`)
  const resultDir = path.join(phaseDir, `p${nn}`)
  const logDirFor = (given) => (given ? path.resolve(root, given) : path.join(resultDir, 'logs'))

  const planFor = (o) => buildPlan({ phase, builds: o.builds, classify: o.classify, maxWorkers: o.maxWorkers, e2eShards: o.e2eShards, unitShards: o.unitShards, resultDir })
  const optionsLine = (o) => `options: builds=${o.builds.join('+')} classify=${o.classify} maxWorkers=${o.maxWorkers} e2eShards=${o.e2eShards} unitShards=${o.unitShards} logDir=${o.logDir}`

  const emit = (state) => {
    if (args.json) writeFileAtomic(path.resolve(root, args.json), `${JSON.stringify(renderJson(state), null, 2)}\n`)
    if (args.md) writeFileAtomic(path.resolve(root, args.md), renderMarkdown(state))
  }

  if (args.command === 'dryRun') {
    const options = { builds: args.builds, classify: args.classify, maxWorkers: args.maxWorkers, e2eShards: args.e2eShards, unitShards: args.unitShards, logDir: logDirFor(args.logDir) }
    const existing = readStateSafe(stateFile)
    out(`phase ${phase} (dry run, nothing is written)${existing.state ? `; a run exists: ${existing.state.runId}` : ''}`)
    out(optionsLine(options))
    for (const l of dryRunLines(planFor(options))) out(l)
    return 0
  }

  const loaded = readStateSafe(stateFile)

  if (args.command === 'reset') {
    if (!fs.existsSync(stateFile)) {
      out(`no run to reset for phase ${phase}`)
      return 0
    }
    const info = loaded.state ?? { phase, runId: `damaged-${new Date(now()).toISOString().replace(/\D/g, '').slice(0, 12)}` }
    const dest = archiveState(stateFile, info)
    out(`reset: ${path.relative(root, stateFile)} kept as ${path.relative(root, dest)}`)
    return 0
  }

  if (loaded.error) {
    err(loaded.error)
    return EXIT.usage
  }
  let state = loaded.state

  if (args.command === 'status') {
    if (!state) {
      out(`no run yet for phase ${phase}: --next, --all or --dry-run`)
      return 0
    }
    for (const l of statusLines(state)) out(l)
    emit(state)
    return 0
  }

  if (args.command === 'rerun') {
    if (!state) {
      err(`no run yet for phase ${phase}`)
      return EXIT.usage
    }
    const reaped = reapRunner(state, isAlive)
    if (reaped.busy !== null) {
      err(busyText(reaped))
      return EXIT.busy
    }
    const next = rerun(reaped.state, args.rerunKey)
    if (!next) {
      err(`unknown step ${args.rerunKey}: --status lists the keys`)
      return EXIT.usage
    }
    const back = next.steps.filter((s, i) => s.status === 'pending' && reaped.state.steps[i].status !== 'pending').map((s) => s.key)
    writeState(stateFile, next)
    out(`rerun: ${back.join(', ') || args.rerunKey} back to pending`)
    emit(next)
    return 0
  }

  // --next and --all
  let head
  try {
    head = git(['rev-parse', 'HEAD'])
  } catch (e) {
    err(e instanceof Error && e.message === GIT_NOT_FOUND ? GIT_NOT_FOUND : 'git rev-parse HEAD failed: is this a git checkout?')
    return EXIT.usage
  }
  if (!state) {
    const options = { builds: args.builds, classify: args.classify, maxWorkers: args.maxWorkers, e2eShards: args.e2eShards, unitShards: args.unitShards, waitFor: args.waitFor, logDir: logDirFor(args.logDir) }
    state = newState({ phase, runId: makeRunId(phase, new Date(now())), createdAt: new Date(now()).toISOString(), head, branch, options, steps: planFor(options) })
    writeState(stateFile, state)
    out(`new run ${state.runId} at ${head.slice(0, 7)}`)
    out(optionsLine(options))
  } else {
    const conflict = optionsConflict(state.options, { ...args, logDir: args.logDir ? logDirFor(args.logDir) : null })
    if (conflict) {
      err(conflict)
      return EXIT.usage
    }
    const moved = headGuard(state, head, args.allowMovedHead)
    if (moved) {
      err(moved)
      return EXIT.usage
    }
  }

  const waitFor = args.waitFor ?? state.options.waitFor ?? 'any'
  const waitMax = (args.waitMax ?? (args.command === 'all' ? DEFAULTS.waitMaxAll : DEFAULTS.waitMaxNext)) * 1000
  const self = baseOf(root)

  let checkOwn = false
  let leftovers = []
  let interruptedKey = ''
  // Throws when the process list (or the worktree list for `any`) cannot be read: the caller exits 75 and never starts a heavy step blind.
  const readBlockers = async () => {
    const targets = targetsFor(waitFor, waitFor === 'any' ? parseWorktrees(git(['worktree', 'list', '--porcelain'])) : { main: '', worktrees: [] }, self)
    const procs = await readProcs()
    // After an interrupted step its grandchildren may outlive it and name this worktree: they block too (see ownLeftovers).
    leftovers = checkOwn ? ownLeftovers(procs, { self, pid }) : []
    return [...new Set([...blockersNow({ procs, self, targets, lockFile, isAlive, pid }).pids, ...leftovers])]
  }

  const finishCall = (s, step) => {
    emit(s)
    if (!step) {
      if (s.options.builds.includes('public') && s.steps.some((x) => x.key === 'public:build' && x.status === 'pass')) out('dist/ holds a public build: npm run build before a pro e2e')
    }
    out(lastLine(step, s))
  }

  for (;;) {
    const reaped = reapRunner(state, isAlive)
    if (reaped.busy !== null) {
      err(busyText(reaped))
      return EXIT.busy
    }
    if (reaped.interrupted) {
      checkOwn = true
      interruptedKey = reaped.interrupted
    }
    for (const k of [reaped.interrupted, reaped.interruptedAlso]) if (k) out(`interrupted: ${k} was not restarted, --rerun ${k} to run it again`)
    const picked = nextPair(reaped.state, { overlap: args.overlap })
    state = picked.state
    if (!picked.step) {
      writeState(stateFile, state)
      finishCall(state, null)
      return 0
    }
    const step = picked.step
    // The light partner (O9): one light step runs beside one heavy step. A light primary whose heavy partner cannot start yet runs alone.
    let partner = picked.partner

    if (waitFor && (step.heavy || partner?.heavy)) {
      let waited
      try {
        waited = await waitForQuiet({ read: readBlockers, sleep, now, pollMs: deps.pollMs ?? 20000, maxMs: waitMax })
      } catch (e) {
        if (!step.heavy) {
          partner = null
          waited = { quiet: true, pids: [] }
        } else {
          err(`could not read the process list (${e instanceof Error ? e.message : 'error'})`)
          out('phase-gate: cannot read the process list; run --next again')
          return EXIT.wait
        }
      }
      if (!waited.quiet && !step.heavy) {
        out(`phase-gate: ${partner.key} waits on pid ${waited.pids.join(', ')}; ${step.key} runs alone`)
        partner = null
      } else if (!waited.quiet) {
        out(`phase-gate: waiting on pid ${waited.pids.join(', ')}; run --next again`)
        if (leftovers.length > 0) out(`phase-gate: pid ${leftovers.join(', ')} are leftovers of this worktree (an orphan of the killed step ${interruptedKey} or a dev server of this worktree): read the command line, then stop them by PID, or wait`)
        return EXIT.wait
      }
    }

    // The shared heavy-step lock (wait.js) is taken for a heavy step after the quiet check, also for unit-pure (heavy: true) when it runs
    // alone; a light PARTNER of a heavy step never takes it and never waits on it (the heavy primary holds it).
    let locked = false
    if (step.heavy === true || (partner && isHeavyStep(partner))) {
      const got = tryAcquire(lockFile, { pid, created: created(pid), owner: 'phase-gate', cmd: step.heavy === true ? step.key : partner.key, at: new Date(now()).toISOString() }, isAlive)
      if (got.ok) {
        locked = true
      } else if (step.heavy === true) {
        out(`phase-gate: waiting on pid ${got.holder.pid ?? '?'}; run --next again`)
        return EXIT.wait
      } else {
        out(`phase-gate: ${partner.key} waits on pid ${got.holder.pid ?? '?'}; ${step.key} runs alone`)
        partner = null
      }
    }

    let ran
    try {
      const marked = markRunning(state, step.key, pid, now(), isAlive, created(pid), partner?.key ?? null)
      if (marked.busy !== null) {
        err(busyText(marked))
        return EXIT.busy
      }
      state = marked.state
      writeState(stateFile, state)

      const logDir = state.options.logDir
      fs.mkdirSync(logDir, { recursive: true })
      fs.mkdirSync(resultDir, { recursive: true })

      // One step's child commands in the foreground of this call; a pair runs its two steps at once (one heavy, one light).
      const runOne = async (one) => {
        const logPath = path.join(logDir, one.log)
        fs.writeFileSync(logPath, '')
        const jsonPath = one.kind === 'gate' ? one.argv[one.argv.indexOf('--json') + 1] : null
        if (jsonPath) fs.rmSync(jsonPath, { force: true })
        // In a pair the light step is the partner: it runs vitest on half the workers (so the pair never runs 8) and leaves the shared
        // .gate/flaky.json and ledger to the other step (GATE_LIGHT_CHILD, scripts/ci/gateState.js and gateLedger.js).
        const lightInPair = partner !== null && isLight(one)
        const workers = lightInPair && one.heavy === true ? lightWorkers(state.options.maxWorkers) : state.options.maxWorkers
        const env = { ...baseEnv, GATE_MAX_WORKERS: String(workers), VITEST_MAX_WORKERS: String(workers), ...(lightInPair ? { GATE_LIGHT_CHILD: '1' } : {}), ...one.env }
        // A pro step builds with pro/: an APP_PRO_DIR left in the shell (for example `none`) must not turn it into a public one.
        if (one.build === 'pro') delete env.APP_PRO_DIR
        // The child's pid and creation time go into the state right after the spawn, so a call after a killed driver still sees the orphan.
        const onSpawn = (childPid) => {
          state = setChild(state, childPid, created(childPid), one.key)
          writeState(stateFile, state)
        }
        const started = now()
        let exitCode = 0
        for (const cmd of commandsOf(one)) {
          const code = await runChild(cmd, { cwd: root, env, logPath, onSpawn })
          exitCode = code === null ? 127 : code
          if (exitCode !== 0) break
        }
        const seconds = secondsBetween(started, now())
        const result = one.kind === 'gate' ? readJsonOrNull(jsonPath) : { exitCode }
        const verdict = one.kind === 'gate' ? classifyResult(result, exitCode) : classifyDirect(exitCode)
        return { one, logPath, exitCode, seconds, result, verdict, endedAt: new Date(now()).toISOString() }
      }
      ran = await Promise.all([step, ...(partner ? [partner] : [])].map(runOne))
    } finally {
      if (locked) release(lockFile, pid)
    }

    // The partner is recorded first: finishing the main step clears the runner.
    const dones = []
    for (const r of [...ran].reverse()) {
      state = finishStep(state, r.one.key, { ...r.verdict, exitCode: r.exitCode, seconds: r.seconds, endedAt: r.endedAt, head, result: r.result })
      writeState(stateFile, state)
      const done = state.steps.find((x) => x.key === r.one.key)
      dones.unshift(done)
    }
    for (const [i, r] of ran.entries()) {
      const done = dones[i]
      out(`${done.key} ${done.status} ${r.seconds}s${done.reason ? ` (${done.reason})` : ''}`)
      if (done.status !== 'pass') for (const l of tailLines(r.logPath, 30)) out(`  | ${l}`)
      if (r.seconds > CAP_WARN_SECONDS) out(`warning: ${done.key} took ${r.seconds} s, close to the 600 s cap: raise --e2e-shards, or run it with --all at a terminal`)
    }
    // The line a caller reads last is the first step of the call that did not pass, else the main step.
    const done = dones.find((d) => d.status !== 'pass') ?? dones[0]

    if (args.command === 'next') {
      finishCall(state, done)
      return 0
    }
    emit(state)
    out(lastLine(done, state))
  }
}

/** Reads the state file; a damaged file is an error text, a missing one is no state. */
function readStateSafe(file) {
  try {
    return { state: readState(file), error: null }
  } catch (e) {
    return { state: null, error: e instanceof Error ? e.message : 'state file unreadable' }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (e) => {
      console.error(e instanceof Error ? e.message : String(e))
      process.exitCode = 1
    },
  )
}
