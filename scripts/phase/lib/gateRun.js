// The phase gate's state file and its pure transitions (docs/phase24/DESIGN-phase24.md, section 2.3). Every transition is
// `(state, ...) -> new state`; nothing mutates its input. The only I/O here is the atomic read and write of the state file.
import fs from 'node:fs'
import path from 'node:path'
import { pad2 } from './gatePlan.js'

const NOT_PASSED = new Set(['fail-real', 'fail-flake', 'not-run'])
const BLANK = { status: 'pending', reason: null, startedAt: null, endedAt: null, seconds: null, exitCode: null, head: null, result: null }

/** `p24-20261106-1402` (UTC) from the creating call's clock. */
export function makeRunId(phase, date) {
  const iso = date.toISOString()
  return `p${pad2(phase)}-${iso.slice(0, 10).replaceAll('-', '')}-${iso.slice(11, 16).replace(':', '')}`
}

/** A fresh state over a plan. */
export function newState({ phase, runId, createdAt, head, branch, options, steps }) {
  return { v: 1, phase, runId, createdAt, head, branch, options, runner: null, distBuild: null, sidecarBuild: null, steps }
}

const mapStep = (state, key, fn) => ({ ...state, steps: state.steps.map((s) => (s.key === key ? fn(s) : s)) })

// What a step leaves in the shared build folders. `dist/` is written by `<b>:build` and `public:public-build`; `.sidecar-build/`
// by the sidecar budget steps, `pro:cloud-off` (its vite build goes to a temp folder, but its sidecar build lands in
// `.sidecar-build/`) and `public:public-build`. A rerun of one build must not leave the other build's output under a pending pass.
const SIDECAR_PRODUCERS = new Set(['sidecar-studio', 'sidecar-runtime', 'cloud-off', 'public-build'])
const SIDECAR_CONSUMED = new Set(['sidecar-studio', 'sidecar-runtime'])
const distProducer = (step) => step.slug === 'build' || step.slug === 'public-build'

/** The state with the build folders' owners updated for a step that is about to write them. */
function recordOutputs(state, step) {
  return { ...state, distBuild: distProducer(step) ? step.build : (state.distBuild ?? null), sidecarBuild: SIDECAR_PRODUCERS.has(step.slug) ? step.key : (state.sidecarBuild ?? null) }
}

/** The key of a producer to run first because a recorded folder belongs to another build (null when the step may run). */
function staleProducer(state, step) {
  let dist = false
  let sidecar = null
  for (const k of step.needs) {
    const p = state.steps.find((x) => x.key === k)
    if (!p) continue
    if (p.slug === 'build') dist = true
    if (SIDECAR_CONSUMED.has(p.slug)) {
      dist = true
      sidecar = k
    }
  }
  if (dist && state.distBuild && state.distBuild !== step.build) return `${step.build}:build`
  if (sidecar && state.sidecarBuild && state.sidecarBuild !== sidecar) return sidecar
  return null
}

/**
 * The first pending step in plan order. A pending step whose `needs` holds a step that did not pass becomes not-run
 * (no child runs for it) and the search goes on. A step that needs a build whose output folder now holds another build's
 * output (a rerun rebuilt it) is held back: the producer goes back to pending and is returned first.
 * @returns {{ state: object, step: object | null }}
 */
export function nextStep(state) {
  let cur = state
  outer: for (const s of state.steps) {
    const now = cur.steps.find((x) => x.key === s.key)
    if (now.status !== 'pending') continue
    const bad = now.needs.find((k) => NOT_PASSED.has(cur.steps.find((x) => x.key === k)?.status))
    if (bad === undefined) {
      let cand = now
      const chain = [s.key]
      for (let guard = 0; guard < 8; guard += 1) {
        const stale = staleProducer(cur, cand)
        if (stale === null || stale === cand.key) return { state: cur, step: cand }
        cur = mapStep(cur, stale, (x) => ({ ...x, ...BLANK }))
        cand = cur.steps.find((x) => x.key === stale)
        chain.push(stale)
        // A producer put back to pending has its own needs: one that did not pass keeps it (and every step waiting on it) from running.
        const badNeed = cand.needs.find((k) => NOT_PASSED.has(cur.steps.find((x) => x.key === k)?.status))
        if (badNeed !== undefined) {
          const blocked = [...chain].reverse()
          cur = mapStep(cur, blocked[0], (x) => ({ ...x, status: 'not-run', reason: `needs ${badNeed}, which did not pass` }))
          for (let i = 1; i < blocked.length; i += 1) cur = mapStep(cur, blocked[i], (x) => ({ ...x, status: 'not-run', reason: `needs ${blocked[i - 1]}, which did not pass` }))
          continue outer
        }
      }
      return { state: cur, step: cand }
    }
    cur = mapStep(cur, s.key, (x) => ({ ...x, status: 'not-run', reason: `needs ${bad}, which did not pass` }))
  }
  return { state: cur, step: null }
}

/** A step that may run beside one heavy step (the plan's `light` flag). */
export const isLight = (step) => step.light === true

/** A heavy step in the pairing sense: it waits for a quiet machine and no other heavy step runs beside it. unit-pure waits too, but is light. */
export const isHeavyStep = (step) => step.heavy === true && step.light !== true

const passed = (state, key) => state.steps.find((x) => x.key === key)?.status === 'pass'

/**
 * The step `--next` runs now and, when the scheduler rule allows, one partner beside it (O9, docs/PIPELINE.md "Light steps").
 * The rule: at most one heavy step and at most one light step at a time, never two heavy steps and never two light ones.
 * The primary is nextStep's pick, so plan order, needs and the stale build folder logic are unchanged. A heavy primary gets the
 * first pending light step; a light primary gets the heavy step nextStep would pick if the light steps were not there. A step
 * that is neither (the budget and marker steps) runs alone. `overlap: false` (--no-overlap) turns the partner off.
 * @param {object} state
 * @param {{ overlap?: boolean }} [opts]
 * @returns {{ state: object, step: object | null, partner: object | null }}
 */
export function nextPair(state, { overlap = true } = {}) {
  const first = nextStep(state)
  const step = first.step
  if (!step || !overlap) return { state: first.state, step, partner: null }
  if (isHeavyStep(step)) {
    const partner = first.state.steps.find((s) => s.key !== step.key && s.status === 'pending' && isLight(s) && s.needs.every((k) => passed(first.state, k)))
    return { state: first.state, step, partner: partner ?? null }
  }
  if (!isLight(step)) return { state: first.state, step, partner: null }
  const MASK = 'masked'
  const probe = nextStep({ ...first.state, steps: first.state.steps.map((s) => (s.status === 'pending' && isLight(s) ? { ...s, status: MASK } : s)) })
  if (!probe.step || !isHeavyStep(probe.step)) return { state: first.state, step, partner: null }
  const back = { ...probe.state, steps: probe.state.steps.map((s) => (s.status === MASK ? { ...s, status: 'pending' } : s)) }
  return { state: back, step: back.steps.find((s) => s.key === step.key), partner: back.steps.find((s) => s.key === probe.step.key) }
}

/**
 * Looks at the recorded runner. The driver alive: `{ busy: pid }` (the caller exits 3). The driver gone but its child
 * (recorded right after spawn, with its creation time) still alive: busy too, `child: true` (a killed driver does not end
 * its children on Windows). Both gone: the step becomes not-run (a killed gate is reported, never restarted by itself)
 * and the runner is cleared. `isAlive(pid, created)` also compares the creation time, so a reused pid is not alive.
 * @param {object} state
 * @param {(pid: number, created?: string | null) => boolean} isAlive
 * @returns {{ state: object, busy: number | null, interrupted: string | null, interruptedAlso?: string, child?: boolean, key?: string }}
 */
export function reapRunner(state, isAlive) {
  const r = state.runner
  if (!r) return { state, busy: null, interrupted: null }
  if (isAlive(r.pid, r.created ?? null)) return { state, busy: r.pid, interrupted: null }
  // A pair has two children: the main step's and the light partner's (runner.also).
  const kids = [[r.key, r.childPid, r.childCreated], ...(r.also ? [[r.also.key, r.also.childPid, r.also.childCreated]] : [])]
  for (const [key, pid, created] of kids) if (Number.isInteger(pid) && isAlive(pid, created ?? null)) return { state, busy: pid, interrupted: null, child: true, key }
  let next = { ...state, runner: null }
  for (const [key] of kids) {
    const reason = `interrupted (killed, timed out or memory reaper); not restarted, --rerun ${key} to run it again`
    next = mapStep(next, key, (s) => (s.status === 'running' ? { ...s, status: 'not-run', reason, endedAt: null } : s))
  }
  return { state: next, busy: null, interrupted: r.key, ...(r.also ? { interruptedAlso: r.also.key } : {}) }
}

/**
 * Marks a step running and records the runner (with this process's creation time when known) and the build folders the
 * step is about to write. Also settles a stale runner (see reapRunner). `alsoKey` is the light partner that runs beside the step.
 * @returns {{ state: object, busy: number | null, interrupted: string | null }}
 */
export function markRunning(state, key, pid, now, isAlive, created = null, alsoKey = null) {
  const reaped = reapRunner(state, isAlive)
  if (reaped.busy !== null) return reaped
  const startedAt = new Date(now).toISOString()
  const runner = { pid, key, startedAt, ...(created ? { created } : {}), ...(alsoKey ? { also: { key: alsoKey } } : {}) }
  const running = (s) => ({ ...s, status: 'running', reason: null, startedAt, endedAt: null })
  const step = reaped.state.steps.find((s) => s.key === key)
  let next = mapStep({ ...(step ? recordOutputs(reaped.state, step) : reaped.state), runner }, key, running)
  const partner = alsoKey ? next.steps.find((s) => s.key === alsoKey) : null
  if (partner) next = mapStep(recordOutputs(next, partner), alsoKey, running)
  return { state: next, busy: null, interrupted: reaped.interrupted }
}

/** Records the child process of the running step (its pid and creation time) in the runner; `key` names the light partner's step. */
export function setChild(state, childPid, childCreated, key = null) {
  if (!state.runner) return state
  if (key !== null && state.runner.also?.key === key) return { ...state, runner: { ...state.runner, also: { ...state.runner.also, childPid, ...(childCreated ? { childCreated } : {}) } } }
  return { ...state, runner: { ...state.runner, childPid, ...(childCreated ? { childCreated } : {}) } }
}

/**
 * Status and reason of a gate child from its `--json` object and exit code.
 * @param {object | null | undefined} json
 * @param {number | null} exitCode
 * @returns {{ status: 'pass' | 'fail-real' | 'fail-flake' | 'not-run', reason: string | null }}
 */
export function classifyResult(json, exitCode) {
  const first = json && typeof json === 'object' && Array.isArray(json.results) ? json.results[0] : null
  if (!first || typeof first !== 'object') return { status: 'fail-real', reason: `no result file (exit ${exitCode})` }
  if (first.status === 'skipped') return { status: 'not-run', reason: typeof first.reason === 'string' && first.reason ? first.reason : 'skipped' }
  const word = String(first.status ?? '')
  if (word.startsWith('passed') && exitCode === 0) return { status: 'pass', reason: null }
  if (word === 'FAILED') {
    const f = json.failures ?? {}
    const noReal = !Array.isArray(f.real) || f.real.length === 0
    const flaky = Array.isArray(f.flaky) && f.flaky.length > 0
    if (noReal && !f.unexplained && !f.tooMany && flaky) return { status: 'fail-flake', reason: `${f.flaky.length} flaky, passed alone` }
    return { status: 'fail-real', reason: `exit ${exitCode}` }
  }
  return { status: 'fail-real', reason: `step status ${word || 'unknown'} (exit ${exitCode})` }
}

/** A direct step: exit 0 is a pass. */
export const classifyDirect = (exitCode) => (exitCode === 0 ? { status: 'pass', reason: null } : { status: 'fail-real', reason: `exit ${exitCode}` })

/**
 * Records the end of a step and clears the runner (a light partner's end only drops its entry from the runner).
 * @param {object} state
 * @param {string} key
 * @param {{ status: string, reason: string | null, exitCode: number | null, seconds: number, endedAt: string, head: string | null, result: object | null }} r
 */
export function finishStep(state, key, r) {
  // The light partner of a pair finishes first: the runner stays for the main step.
  let keep = null
  if (state.runner?.also?.key === key) {
    keep = { ...state.runner }
    delete keep.also
  }
  return mapStep({ ...state, runner: keep }, key, (s) => ({ ...s, status: r.status, reason: r.reason, exitCode: r.exitCode, seconds: r.seconds, endedAt: r.endedAt, head: r.head, result: r.result }))
}

/** The step and, recursively, its `needs` go back to pending. Null when the key is unknown. */
export function rerun(state, key) {
  if (!state.steps.some((s) => s.key === key)) return null
  const reset = new Set()
  const walk = (k) => {
    if (reset.has(k)) return
    reset.add(k)
    for (const n of state.steps.find((s) => s.key === k)?.needs ?? []) walk(n)
  }
  walk(key)
  return { ...state, steps: state.steps.map((s) => (reset.has(s.key) ? { ...s, ...BLANK } : s)) }
}

/** Null when HEAD is where the run began (or the flag allows a move), else the refusal message. */
export function headGuard(state, head, allowMoved) {
  if (allowMoved || head === state.head) return null
  return `head moved from ${state.head} to ${head}: --reset, or --allow-moved-head`
}

export const pendingCount = (state) => state.steps.filter((s) => s.status === 'pending').length

/** The machine readable last line of --next. */
export function lastLine(step, state) {
  const left = pendingCount(state)
  if (!step) return 'phase-gate: complete'
  return `phase-gate: ${step.key} ${step.status} ${step.seconds ?? 0}s; ${left} left`
}

/** `--status`: one line per step, then the next step. */
export function statusLines(state) {
  const probe = nextStep(state)
  const lines = state.steps.map((s) => `${s.key}  ${s.status}  ${s.seconds === null ? '-' : `${s.seconds}s`}  ${s.reason ?? ''}`.trimEnd())
  lines.push(probe.step ? `next: ${probe.step.key}` : 'next: none (run complete)')
  return lines
}

/** Seconds to print for a finished step: one decimal, never negative. */
export const secondsBetween = (startMs, endMs) => Math.max(0, Math.round((endMs - startMs) / 100) / 10)

/** Reads the state file; null when it does not exist, throws on damaged JSON. */
export function readState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    if (e && e.code === 'ENOENT') return null
    throw new Error(`state file ${file} is damaged (${e instanceof Error ? e.message : 'unreadable'}): --reset`, { cause: e })
  }
}

/** Atomic write: a temp file in the same folder, then a rename. */
export function writeFileAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, text)
  renameRetry(tmp, file)
}

const RENAME_RETRY_MS = 2000

/** `fs.renameSync` that retries EPERM and EBUSY by hand for up to 2 s (Windows: another process may hold the target; Node 24 does not retry). */
export function renameRetry(from, to, { wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms), now = Date.now, rename = fs.renameSync } = {}) {
  const start = now()
  for (;;) {
    try {
      rename(from, to)
      return
    } catch (e) {
      const retry = e && (e.code === 'EPERM' || e.code === 'EBUSY') && now() - start < RENAME_RETRY_MS
      if (!retry) throw e
      wait(50)
    }
  }
}

export const writeState = (file, state) => writeFileAtomic(file, `${JSON.stringify(state, null, 2)}\n`)

/** `--reset`: renames the state to `phase-<NN>.<runId>.json`; returns the new name or null when there was none. */
export function archiveState(file, state, rename = renameRetry) {
  if (!fs.existsSync(file)) return null
  const dest = path.join(path.dirname(file), `phase-${pad2(state.phase)}.${state.runId}.json`)
  rename(file, dest)
  return dest
}
