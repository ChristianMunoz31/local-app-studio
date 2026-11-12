// The phase gate's state transitions (scripts/phase/lib/gateRun.js, DESIGN-phase24 section 2.3) and the command over fakes
// (scripts/phase/gate.js `main`: child runner, git, clock, process list and runner liveness are injected, no real step runs).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { main } from '../../scripts/phase/gate.js'
import { buildPlan } from '../../scripts/phase/lib/gatePlan.js'
import { archiveState, classifyDirect, classifyResult, finishStep, headGuard, lastLine, makeRunId, markRunning, newState, nextStep, pendingCount, readState, reapRunner, rerun, renameRetry, setChild, statusLines, writeState } from '../../scripts/phase/lib/gateRun.js'

const HEAD = 'a'.repeat(40)
const mk = (builds = ['pro', 'public']) =>
  newState({ phase: 24, runId: 'p24-20261106-1402', createdAt: '2026-11-06T14:02:00.000Z', head: HEAD, branch: 'feat/phase24-x', options: { builds, classify: true, maxWorkers: 4, e2eShards: 1, waitFor: null, logDir: 'logs' }, steps: buildPlan({ phase: 24, builds, classify: true, maxWorkers: 4, e2eShards: 1, resultDir: 'res' }) })
const st = (state, key) => state.steps.find((s) => s.key === key)
const withStatus = (state, key, status, reason = null) => ({ ...state, steps: state.steps.map((s) => (s.key === key ? { ...s, status, reason } : s)) })
const pass = { status: 'pass', reason: null, exitCode: 0, seconds: 1, endedAt: '2026-11-06T14:03:00.000Z', head: HEAD, result: null }

describe('nextStep', () => {
  it('is the first pending step in plan order', () => {
    const s = mk()
    expect(nextStep(s).step.key).toBe('pro:hygiene-gitleaks')
    const after = finishStep(s, 'pro:hygiene-gitleaks', pass)
    expect(nextStep(after).step.key).toBe('pro:hygiene-em-dash')
  })

  it('turns a step whose need did not pass into not-run and goes on', () => {
    let s = mk(['pro'])
    for (const x of s.steps) if (x.key !== 'pro:build' && x.key !== 'pro:bundle-budget' && x.key !== 'pro:sidecar-studio') s = finishStep(s, x.key, pass)
    s = withStatus(s, 'pro:build', 'fail-real', 'exit 1')
    const r = nextStep(s)
    expect(r.step).toBeNull()
    expect(st(r.state, 'pro:bundle-budget')).toMatchObject({ status: 'not-run', reason: 'needs pro:build, which did not pass' })
    expect(st(r.state, 'pro:sidecar-studio').status).toBe('not-run')
    expect(st(s, 'pro:bundle-budget').status).toBe('pending')
  })

  it('chains: a marker whose sidecar became not-run is not-run too, and fail-flake and not-run both block', () => {
    let s = withStatus(mk(['pro']), 'pro:build', 'fail-flake')
    for (const x of s.steps) if (!['pro:bundle-budget', 'pro:sidecar-studio', 'pro:pro-marker-studio'].includes(x.key) && x.status === 'pending') s = finishStep(s, x.key, pass)
    const r = nextStep(s)
    expect(st(r.state, 'pro:pro-marker-studio')).toMatchObject({ status: 'not-run', reason: 'needs pro:sidecar-studio, which did not pass' })
  })

  it('checks the needs of a producer put back to pending by the stale check (not-run when one did not pass)', () => {
    let s = mk(['pro'])
    for (const x of s.steps) if (x.key !== 'pro:pro-marker-studio' && x.key !== 'pro:e2e-flows' && x.key !== 'pro:e2e-first-run' && x.key !== 'pro:e2e-a11y' && x.status === 'pending') s = finishStep(s, x.key, pass)
    s = { ...s, sidecarBuild: 'pro:cloud-off' }
    s = withStatus(s, 'pro:build', 'fail-flake')
    const r = nextStep(s)
    expect(r.step).toBeNull()
    expect(st(r.state, 'pro:sidecar-studio')).toMatchObject({ status: 'not-run', reason: 'needs pro:build, which did not pass' })
    expect(st(r.state, 'pro:pro-marker-studio')).toMatchObject({ status: 'not-run', reason: 'needs pro:sidecar-studio, which did not pass' })
  })

  it('is null when nothing is pending', () => {
    let s = mk(['pro'])
    for (const x of s.steps) s = finishStep(s, x.key, pass)
    expect(nextStep(s).step).toBeNull()
    expect(pendingCount(s)).toBe(0)
  })
})

describe('markRunning and reapRunner', () => {
  const alive = () => true
  const dead = () => false

  it('records the runner and the step as running', () => {
    const r = markRunning(mk(), 'pro:lint', 4242, Date.UTC(2026, 10, 6, 14, 5), alive)
    expect(r.state.runner).toEqual({ pid: 4242, key: 'pro:lint', startedAt: '2026-11-06T14:05:00.000Z' })
    expect(st(r.state, 'pro:lint')).toMatchObject({ status: 'running', startedAt: '2026-11-06T14:05:00.000Z' })
    expect(r.busy).toBeNull()
  })

  it('reports a live runner as busy and changes nothing', () => {
    const running = markRunning(mk(), 'pro:lint', 4242, 0, alive).state
    const r = markRunning(running, 'pro:typecheck', 99, 0, alive)
    expect(r.busy).toBe(4242)
    expect(r.state).toBe(running)
  })

  it('marks the step of a dead runner not-run with the interrupted reason, clears the runner and does not restart it', () => {
    const running = markRunning(mk(), 'pro:unit-frontend', 4242, 0, alive).state
    const r = markRunning(running, 'pro:unit-pure', 99, 5, dead)
    expect(r.interrupted).toBe('pro:unit-frontend')
    expect(st(r.state, 'pro:unit-frontend')).toMatchObject({ status: 'not-run', reason: 'interrupted (killed, timed out or memory reaper); not restarted, --rerun pro:unit-frontend to run it again' })
    expect(r.state.runner).toEqual({ pid: 99, key: 'pro:unit-pure', startedAt: new Date(5).toISOString() })
    expect(nextStep(reapRunner(running, dead).state).step.key).not.toBe('pro:unit-frontend')
  })

  it('has nothing to reap without a runner', () => {
    const s = mk()
    expect(reapRunner(s, dead)).toEqual({ state: s, busy: null, interrupted: null })
  })
})

describe('classifyResult', () => {
  const run = (status, extra = {}) => ({ results: [{ id: 'x', status }], ...extra })

  it('is fail-real without a readable result', () => {
    expect(classifyResult(null, 1)).toEqual({ status: 'fail-real', reason: 'no result file (exit 1)' })
    expect(classifyResult({}, 0)).toEqual({ status: 'fail-real', reason: 'no result file (exit 0)' })
    expect(classifyResult({ results: [] }, 0).status).toBe('fail-real')
  })

  it('is not-run with its reason for a skipped step', () => {
    expect(classifyResult(run('skipped', { results: [{ status: 'skipped', reason: 'gitleaks is not on PATH, CI runs it' }] }), 0)).toEqual({ status: 'not-run', reason: 'gitleaks is not on PATH, CI runs it' })
  })

  it('is pass for passed, also with quarantined failures', () => {
    expect(classifyResult(run('passed'), 0)).toEqual({ status: 'pass', reason: null })
    expect(classifyResult(run('passed (quarantined failures)'), 0).status).toBe('pass')
    expect(classifyResult(run('passed'), 1).status).toBe('fail-real')
  })

  it('is fail-flake only when every failure is flaky', () => {
    const flaky = [{ file: 'a', title: 'b' }]
    expect(classifyResult(run('FAILED', { failures: { real: [], flaky, unexplained: false, tooMany: false } }), 1)).toMatchObject({ status: 'fail-flake' })
    expect(classifyResult(run('FAILED', { failures: { real: [{}], flaky, unexplained: false, tooMany: false } }), 1).status).toBe('fail-real')
    expect(classifyResult(run('FAILED', { failures: { real: [], flaky, unexplained: true, tooMany: false } }), 1).status).toBe('fail-real')
    expect(classifyResult(run('FAILED', { failures: { real: [], flaky, unexplained: false, tooMany: true } }), 1).status).toBe('fail-real')
    expect(classifyResult(run('FAILED', { failures: { real: [], flaky: [], unexplained: false, tooMany: false } }), 1).status).toBe('fail-real')
    expect(classifyResult(run('FAILED'), 1).status).toBe('fail-real')
  })

  it('is fail-real for any other status, and direct steps follow the exit code', () => {
    expect(classifyResult(run('not run'), 1).status).toBe('fail-real')
    expect(classifyDirect(0).status).toBe('pass')
    expect(classifyDirect(3)).toEqual({ status: 'fail-real', reason: 'exit 3' })
  })
})

describe('rerun', () => {
  it('sends the step and its needs back to pending, recursively', () => {
    let s = mk()
    for (const x of s.steps) s = finishStep(s, x.key, pass)
    const r = rerun(s, 'public:e2e-a11y')
    expect(st(r, 'public:e2e-a11y')).toMatchObject({ status: 'pending', result: null, seconds: null })
    expect(st(r, 'public:build').status).toBe('pending')
    expect(st(r, 'public:lint').status).toBe('pass')
    expect(st(r, 'pro:build').status).toBe('pass')
    expect(nextStep(r).step.key).toBe('public:build')
  })

  it('follows a chain of needs (a marker brings its sidecar and the build)', () => {
    let s = mk(['pro'])
    for (const x of s.steps) s = finishStep(s, x.key, pass)
    const r = rerun(s, 'pro:pro-marker-runtime')
    expect(r.steps.filter((x) => x.status === 'pending').map((x) => x.key)).toEqual(['pro:build', 'pro:sidecar-runtime', 'pro:pro-marker-runtime'])
  })

  it('is null for an unknown key', () => {
    expect(rerun(mk(), 'pro:nope')).toBeNull()
  })
})

describe('headGuard, run ids and lines', () => {
  it('refuses a moved HEAD unless allowed', () => {
    expect(headGuard(mk(), HEAD, false)).toBeNull()
    expect(headGuard(mk(), 'b'.repeat(40), false)).toBe(`head moved from ${HEAD} to ${'b'.repeat(40)}: --reset, or --allow-moved-head`)
    expect(headGuard(mk(), 'b'.repeat(40), true)).toBeNull()
  })

  it('builds the run id from the UTC clock', () => {
    expect(makeRunId(24, new Date('2026-11-06T14:02:55Z'))).toBe('p24-20261106-1402')
    expect(makeRunId(5, new Date('2026-01-02T03:04:00Z'))).toBe('p05-20260102-0304')
  })

  it('prints the machine readable last line', () => {
    const s = finishStep(mk(), 'pro:hygiene-gitleaks', { ...pass, seconds: 12.3 })
    expect(lastLine(st(s, 'pro:hygiene-gitleaks'), s)).toBe(`phase-gate: pro:hygiene-gitleaks pass 12.3s; ${s.steps.length - 1} left`)
    expect(lastLine(null, s)).toBe('phase-gate: complete')
  })

  it('lists the status lines and the next step', () => {
    const lines = statusLines(finishStep(mk(['pro']), 'pro:hygiene-gitleaks', pass))
    expect(lines[0]).toBe('pro:hygiene-gitleaks  pass  1s')
    expect(lines.at(-1)).toBe('next: pro:hygiene-em-dash')
    let done = mk(['pro'])
    for (const x of done.steps) done = finishStep(done, x.key, pass)
    expect(statusLines(done).at(-1)).toBe('next: none (run complete)')
  })
})

describe('state file', () => {
  const temps = []
  afterEach(() => {
    for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true })
  })
  const tmp = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-gate-state-'))
    temps.push(d)
    return d
  }

  it('writes atomically, reads back, and leaves no temp file', () => {
    const dir = tmp()
    const file = path.join(dir, 'sub', 'phase-24.json')
    writeState(file, mk())
    expect(readState(file)).toEqual(mk())
    expect(fs.readdirSync(path.dirname(file))).toEqual(['phase-24.json'])
    expect(readState(path.join(dir, 'none.json'))).toBeNull()
  })

  it('names a damaged file and archives the state under its run id', () => {
    const dir = tmp()
    const file = path.join(dir, 'phase-24.json')
    fs.writeFileSync(file, '{ not json')
    expect(() => readState(file)).toThrow(/damaged.*--reset/)
    writeState(file, mk())
    expect(path.basename(archiveState(file, mk()))).toBe('phase-24.p24-20261106-1402.json')
    expect(fs.existsSync(file)).toBe(false)
    expect(archiveState(file, mk())).toBeNull()
  })
})

describe('main over fakes', () => {
  const temps = []
  afterEach(() => {
    for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true })
  })

  function setup(overrides = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'las-wt-phase24-'))
    temps.push(root)
    const lines = []
    const errs = []
    const calls = []
    let clock = Date.UTC(2026, 10, 6, 14, 2)
    const deps = {
      root,
      lockFile: path.join(root, 'las-heavy.lock'),
      git: (args) => (args[0] === 'rev-parse' && args[1] === 'HEAD' ? HEAD : args[0] === 'rev-parse' ? 'feat/phase24-x' : ''),
      now: () => (clock += 2000),
      sleep: async (ms) => {
        clock += ms
      },
      isAlive: () => false,
      pid: 5150,
      readProcs: async () => [],
      out: (s) => lines.push(s),
      err: (s) => errs.push(s),
      runChild: async (argv, o) => {
        calls.push({ argv, o })
        fs.appendFileSync(o.logPath, `ran ${argv[0]}\n`)
        const at = argv.indexOf('--json')
        if (at > 0) fs.writeFileSync(argv[at + 1], JSON.stringify({ results: [{ id: 'x', status: 'passed', seconds: 1 }] }))
        return 0
      },
      ...overrides,
    }
    return { root, lines, errs, calls, deps, stateFile: path.join(root, '.gate', 'phase', 'phase-24.json') }
  }

  it('--dry-run writes nothing', async () => {
    const t = setup()
    expect(await main(['--both-builds', '--dry-run'], t.deps)).toBe(0)
    expect(fs.existsSync(path.join(t.root, '.gate'))).toBe(false)
    expect(t.lines[0]).toContain('phase 24 (dry run')
    expect(t.lines.some((l) => l.startsWith('public:public-build'))).toBe(true)
  })

  it('--status without a run says so and creates nothing', async () => {
    const t = setup()
    expect(await main(['--status'], t.deps)).toBe(0)
    expect(t.lines).toEqual(['no run yet for phase 24: --next, --all or --dry-run'])
    expect(fs.existsSync(path.join(t.root, '.gate'))).toBe(false)
  })

  it('--next creates the run, runs one gate child with the env, and records the pass', async () => {
    const t = setup()
    expect(await main(['--no-overlap', '--next', '--max-workers', '2', '--json', 'out.json', '--md', 'out.md'], t.deps)).toBe(0)
    expect(t.calls).toHaveLength(1)
    expect(t.calls[0].argv.slice(0, 3)).toEqual(['scripts/ci/gate.js', '--only', 'hygiene: gitleaks'])
    expect(t.calls[0].o.env).toMatchObject({ GATE_MAX_WORKERS: '2', VITEST_MAX_WORKERS: '2' })
    expect(t.calls[0].o.cwd).toBe(t.root)
    expect(t.lines.at(-1)).toMatch(/^phase-gate: pro:hygiene-gitleaks pass \d+(\.\d)?s; \d+ left$/)
    const state = readState(t.stateFile)
    expect(state.runId).toBe('p24-20261106-1402')
    expect(state.runner).toBeNull()
    expect(state.steps[0]).toMatchObject({ status: 'pass', exitCode: 0 })
    expect(path.basename(t.calls[0].o.logPath)).toBe('p24-pro-hygiene-gitleaks.log')
    expect(fs.existsSync(path.join(t.root, 'out.json'))).toBe(true)
    expect(fs.readFileSync(path.join(t.root, 'out.md'), 'utf8')).toContain('Gates by scripts/phase/gate.js, run p24-20261106-1402 at aaaaaaa, pro,')
  })

  it('a second --next goes on with the next step; a changed plan option exits 2 naming --reset', async () => {
    const t = setup()
    await main(['--no-overlap', '--next'], t.deps)
    await main(['--no-overlap', '--next'], t.deps)
    expect(t.calls.map((c) => c.argv[2])).toEqual(['hygiene: gitleaks', 'hygiene: em dash'])
    expect(await main(['--no-overlap', '--next', '--both-builds'], t.deps)).toBe(2)
    expect(t.errs.at(-1)).toContain('--reset')
  })

  it('exits 2 when HEAD moved, unless allowed, and then records the step head', async () => {
    const t = setup()
    await main(['--no-overlap', '--next'], t.deps)
    const moved = { ...t.deps, git: (args) => (args[1] === 'HEAD' ? 'b'.repeat(40) : 'feat/phase24-x') }
    expect(await main(['--no-overlap', '--next'], moved)).toBe(2)
    expect(t.errs.at(-1)).toContain('head moved from')
    expect(await main(['--no-overlap', '--next', '--allow-moved-head'], moved)).toBe(0)
    expect(readState(t.stateFile).steps[1].head).toBe('b'.repeat(40))
  })

  it('exits 3 when a live runner is recorded, and reports a dead one without restarting it', async () => {
    const t = setup()
    await main(['--no-overlap', '--next'], t.deps)
    const state = readState(t.stateFile)
    writeState(t.stateFile, markRunning(state, 'pro:hygiene-em-dash', 777, 0, () => false).state)
    expect(await main(['--no-overlap', '--next'], { ...t.deps, isAlive: () => true })).toBe(3)
    expect(t.errs.at(-1)).toBe('another phase gate call is running: pid 777')
    t.calls.length = 0
    expect(await main(['--no-overlap', '--next'], t.deps)).toBe(0)
    expect(t.calls[0].argv[2]).toBe('hygiene: keys')
    expect(readState(t.stateFile).steps[1]).toMatchObject({ key: 'pro:hygiene-em-dash', status: 'not-run' })
  })

  it('records a failing child with its exit code, tails the log and skips what needs it', async () => {
    const t = setup({
      runChild: async (argv, o) => {
        fs.appendFileSync(o.logPath, 'boom\n')
        return 1
      },
    })
    expect(await main(['--no-overlap', '--next'], t.deps)).toBe(0)
    expect(readState(t.stateFile).steps[0]).toMatchObject({ status: 'fail-real', reason: 'no result file (exit 1)' })
    expect(t.lines).toContain('  | boom')
  })

  it('records a child that could not start as exit 127', async () => {
    const t = setup({ runChild: async () => null })
    await main(['--no-overlap', '--next'], t.deps)
    expect(readState(t.stateFile).steps[0].exitCode).toBe(127)
  })

  it('runs a direct step as its commands in order and stops at the first failure', async () => {
    const t = setup({
      runChild: async (argv) => {
        t.calls.push({ argv })
        return argv[0] === 'scripts/ci/workflowCheck.js' ? 1 : 0
      },
    })
    for (let i = 0; i < 5; i += 1) await main(['--no-overlap', '--next'], t.deps)
    const direct = t.calls.filter((c) => !c.argv.includes('--only')).map((c) => c.argv[0])
    expect(direct).toEqual(['scripts/ci/workflowCheck.js'])
    expect(readState(t.stateFile).steps[4]).toMatchObject({ key: 'pro:check-extra', status: 'fail-real', result: { exitCode: 1 } })
  })

  it('waits for another worktree before a heavy step: exit 75, state unchanged, no child', async () => {
    const t = setup({ readProcs: async () => [{ pid: 91, name: 'node.exe', cmd: 'node C:\\x\\las-wt-phase23\\node_modules\\vitest\\vitest.mjs' }] })
    // run the light steps first, then reach unit-frontend
    for (let i = 0; i < 7; i += 1) await main(['--no-overlap', '--next'], t.deps)
    const before = fs.readFileSync(t.stateFile, 'utf8')
    t.calls.length = 0
    expect(await main(['--no-overlap', '--next', '--wait-for', 'las-wt-phase23', '--wait-max', '0'], t.deps)).toBe(75)
    expect(t.lines.at(-1)).toBe('phase-gate: waiting on pid 91; run --next again')
    expect(t.calls).toHaveLength(0)
    expect(fs.readFileSync(t.stateFile, 'utf8')).toBe(before)
  })

  it('does not wait before a light step', async () => {
    const t = setup({ readProcs: async () => [{ pid: 91, name: 'node.exe', cmd: 'node C:\\x\\las-wt-phase23\\vitest' }] })
    expect(await main(['--no-overlap', '--next', '--wait-for', 'las-wt-phase23', '--wait-max', '0'], t.deps)).toBe(0)
  })

  it('--all runs every step to the end, then prints complete; --rerun puts a step back', async () => {
    const t = setup()
    expect(await main(['--no-overlap', '--all', '--build', 'public', '--e2e-shards', '1'], t.deps)).toBe(0)
    const state = readState(t.stateFile)
    expect(state.steps.every((s) => s.status === 'pass')).toBe(true)
    expect(t.lines.at(-1)).toBe('phase-gate: complete')
    expect(t.lines).toContain('dist/ holds a public build: npm run build before a pro e2e')
    expect(await main(['--rerun', 'public:e2e-a11y'], t.deps)).toBe(0)
    expect(t.lines.at(-1)).toBe('rerun: public:build, public:e2e-a11y back to pending')
    expect(await main(['--rerun', 'public:nope'], t.deps)).toBe(2)
  })

  it('--reset keeps the old state under its run id and allows a new plan', async () => {
    const t = setup()
    await main(['--no-overlap', '--next'], t.deps)
    expect(await main(['--reset'], t.deps)).toBe(0)
    expect(fs.existsSync(t.stateFile)).toBe(false)
    expect(fs.existsSync(path.join(path.dirname(t.stateFile), 'phase-24.p24-20261106-1402.json'))).toBe(true)
    expect(await main(['--no-overlap', '--next', '--both-builds'], t.deps)).toBe(0)
    expect(readState(t.stateFile).options.builds).toEqual(['pro', 'public'])
  })

  it('refuses a usage error and an unknown phase with exit 2', async () => {
    const t = setup({ git: () => '' })
    expect(await main(['--bogus'], t.deps)).toBe(2)
    const nameless = setup({ root: path.join(os.tmpdir(), 'plain-folder-xyz'), git: () => '' })
    expect(await main(['--no-overlap', '--next'], nameless.deps)).toBe(2)
    expect(nameless.errs.at(-1)).toContain('pass --phase')
  })

  it('records the child pid and creation time right after the spawn and clears them with the runner', async () => {
    const t = setup({ readCreated: (p) => `c${p}` })
    let seen = null
    const deps = {
      ...t.deps,
      runChild: async (argv, o) => {
        o.onSpawn(9001)
        seen = readState(t.stateFile).runner
        return 0
      },
    }
    expect(await main(['--no-overlap', '--next'], deps)).toBe(0)
    expect(seen).toMatchObject({ pid: 5150, created: 'c5150', childPid: 9001, childCreated: 'c9001', key: 'pro:hygiene-gitleaks' })
    expect(readState(t.stateFile).runner).toBeNull()
  })

  it('exits 3 while the child of a killed driver lives, and only then marks the step interrupted', async () => {
    const t = setup()
    await main(['--no-overlap', '--next'], t.deps)
    let state = markRunning(readState(t.stateFile), 'pro:hygiene-em-dash', 777, 0, () => false, 'd777').state
    state = setChild(state, 888, 'c888')
    writeState(t.stateFile, state)
    const asked = []
    const orphan = (pid, created) => {
      asked.push([pid, created])
      return pid === 888
    }
    expect(await main(['--no-overlap', '--next'], { ...t.deps, isAlive: orphan })).toBe(3)
    expect(t.errs.at(-1)).toBe('the step pro:hygiene-em-dash is still running in pid 888')
    expect(asked).toEqual([[777, 'd777'], [888, 'c888']])
    expect(readState(t.stateFile).steps[1].status).toBe('running')
    expect(await main(['--no-overlap', '--next'], t.deps)).toBe(0)
    expect(t.lines.some((l) => l.startsWith('interrupted: pro:hygiene-em-dash'))).toBe(true)
  })

  it('after an interrupted heavy step, a heavy orphan naming this worktree blocks the next heavy step (exit 75, leftover line)', async () => {
    const t = setup()
    await main(['--no-overlap', '--next'], t.deps)
    let state = readState(t.stateFile)
    const heavy = state.steps.find((s) => s.heavy).key
    for (const s of state.steps) {
      if (s.key === heavy) break
      state = finishStep(state, s.key, pass)
    }
    state = markRunning(state, heavy, 777, 0, () => false, null).state
    state = setChild(state, 888, null)
    writeState(t.stateFile, state)
    const self = path.basename(t.root)
    const procs = [
      { pid: 5150, ppid: 40, name: 'node.exe', cmd: `node ${t.root}\\scripts\\phase\\gate.js --next vitest` },
      { pid: 5151, ppid: 5150, name: 'node.exe', cmd: `node ${t.root}\\node_modules\\vitest\\vitest.mjs run` },
      { pid: 9090, ppid: 888, name: 'node.exe', cmd: `node ${t.root}\\node_modules\\vitest\\vitest.mjs run --project backend` },
    ]
    expect(self.startsWith('las-wt-phase24')).toBe(true)
    expect(await main(['--no-overlap', '--next', '--wait-max', '0', '--wait-for', 'nothing-else'], { ...t.deps, readProcs: async () => procs })).toBe(75)
    expect(t.lines.some((l) => l === 'phase-gate: waiting on pid 9090; run --next again')).toBe(true)
    expect(t.lines.some((l) => l.includes('pid 9090 are leftovers of this worktree'))).toBe(true)
    expect(readState(t.stateFile).runner).not.toBeNull()
    // without an interruption in the call, the same table does not block (the dev-server case is only checked after a killed step)
    const fresh = setup()
    expect(await main(['--no-overlap', '--next', '--wait-max', '0', '--wait-for', 'nothing-else'], { ...fresh.deps, readProcs: async () => procs })).toBe(0)
  })

  it('takes APP_PRO_DIR out of the env of a pro step and keeps none for a public direct step', async () => {
    const t = setup({ env: { APP_PRO_DIR: 'none', PATH: 'p' } })
    await main(['--no-overlap', '--next'], t.deps)
    expect(t.calls[0].o.env.APP_PRO_DIR).toBeUndefined()
    expect(t.calls[0].o.env.PATH).toBe('p')
    const pub = setup({ env: { APP_PRO_DIR: 'somewhere' } })
    for (let i = 0; i < 5; i += 1) await main(['--no-overlap', '--next', '--build', 'public'], pub.deps)
    const direct = pub.calls.find((c) => c.argv[0] === 'scripts/ci/workflowCheck.js')
    expect(direct.o.env.APP_PRO_DIR).toBe('none')
  })

  it('exits 75 when the process list cannot be read before a heavy step, and runs nothing', async () => {
    const t = setup({
      readProcs: async () => {
        throw new Error('powershell failed')
      },
    })
    // seven light steps, then unit-frontend is heavy
    for (let i = 0; i < 7; i += 1) expect(await main(['--no-overlap', '--next'], t.deps)).toBe(0)
    const ran = t.calls.length
    expect(await main(['--no-overlap', '--next'], t.deps)).toBe(75)
    expect(t.lines.at(-1)).toBe('phase-gate: cannot read the process list; run --next again')
    expect(t.calls.length).toBe(ran)
    expect(readState(t.stateFile).steps.find((x) => x.key === 'pro:unit-frontend').status).toBe('pending')
  })

  it('waits for any other worktree by default', async () => {
    const t = setup({
      git: (args) => (args[0] === 'worktree' ? 'worktree C:/x/main\nHEAD a\nbranch refs/heads/main\n\nworktree C:/x/las-wt-phase23\nHEAD a\nbranch refs/heads/b\n' : args[1] === 'HEAD' ? HEAD : 'feat/phase24-x'),
      readProcs: async () => [{ pid: 91, name: 'node.exe', cmd: 'node C:\\x\\las-wt-phase23\\node_modules\\vitest\\vitest.mjs' }],
    })
    for (let i = 0; i < 7; i += 1) await main(['--no-overlap', '--next'], t.deps)
    expect(await main(['--no-overlap', '--next', '--wait-max', '0'], t.deps)).toBe(75)
    expect(t.lines.at(-1)).toBe('phase-gate: waiting on pid 91; run --next again')
  })

  it('plans unit shards from --unit-shards', async () => {
    const t = setup()
    await main(['--dry-run', '--unit-shards', '2'], t.deps)
    expect(t.lines.some((l) => l.startsWith('pro:unit-frontend-1of2') && l.includes('--shard 1/2'))).toBe(true)
    expect(t.lines.find((l) => l.startsWith('options:'))).toContain('unitShards=2')
  })
})

// Output folders: a rerun of one build must not leave a pass running on the other build's dist/ or .sidecar-build/.
describe('shared build folders', () => {
  const never = () => false
  const runOne = (state) => {
    const picked = nextStep(state)
    if (!picked.step) return { state: picked.state, key: null }
    const marked = markRunning(picked.state, picked.step.key, 1, 0, never).state
    return { state: finishStep(marked, picked.step.key, pass), key: picked.step.key }
  }
  const runUntil = (state, stopKey) => {
    let cur = state
    for (let i = 0; i < 200; i += 1) {
      if (nextStep(cur).step?.key === stopKey) return cur
      cur = runOne(cur).state
    }
    throw new Error(`never reached ${stopKey}`)
  }

  it('records which build wrote dist/ and which step wrote .sidecar-build/', () => {
    let s = mk()
    expect(s).toMatchObject({ distBuild: null, sidecarBuild: null })
    s = runUntil(s, 'pro:bundle-budget')
    expect(s.distBuild).toBe('pro')
    s = runUntil(s, 'pro:pro-marker-studio')
    expect(s.sidecarBuild).toBe('pro:sidecar-studio')
    s = runUntil(s, 'pro:e2e-flows')
    expect(s.sidecarBuild).toBe('pro:cloud-off')
    expect(s.distBuild).toBe('pro')
    s = runUntil(s, 'public:bundle-budget')
    expect(s.distBuild).toBe('public')
  })

  it('rebuilds the public build before a public e2e that follows a pro rerun', () => {
    let s = runUntil(mk(), 'public:e2e-flows')
    expect(s.distBuild).toBe('public')
    s = rerun(s, 'pro:e2e-a11y')
    expect(st(s, 'pro:build').status).toBe('pending')
    let step = runOne(s)
    expect(step.key).toBe('pro:build')
    expect(step.state.distBuild).toBe('pro')
    step = runOne(step.state)
    expect(step.key).toBe('pro:e2e-a11y')
    // plan order says public:e2e-flows next, but dist/ is the pro build now
    const held = nextStep(step.state)
    expect(held.step.key).toBe('public:build')
    expect(st(held.state, 'public:build').status).toBe('pending')
    step = runOne(step.state)
    expect(step.key).toBe('public:build')
    expect(step.state.distBuild).toBe('public')
    expect(runOne(step.state).key).toBe('public:e2e-flows')
  })

  it('also reruns a sidecar step whose bundle was overwritten (the cloud-off build writes .sidecar-build/)', () => {
    let s = runUntil(mk(['pro']), 'pro:e2e-flows')
    s = withStatus(s, 'pro:pro-marker-studio', 'pending')
    const held = nextStep(s)
    expect(held.step.key).toBe('pro:sidecar-studio')
    expect(st(held.state, 'pro:sidecar-studio').status).toBe('pending')
    const sidecar = runOne(s)
    expect(sidecar.key).toBe('pro:sidecar-studio')
    expect(runOne(sidecar.state).key).toBe('pro:pro-marker-studio')
  })

  it('does not hold anything back for a state without a record (an older run)', () => {
    const s = { ...mk(['pro']) }
    delete s.distBuild
    delete s.sidecarBuild
    expect(nextStep(runUntil(s, 'pro:bundle-budget')).step.key).toBe('pro:bundle-budget')
  })
})

describe('runner liveness', () => {
  const dead = () => false
  it('records the creation time of the driver and of its child', () => {
    const r = markRunning(mk(), 'pro:lint', 42, 0, dead, 'd42')
    expect(r.state.runner).toEqual({ pid: 42, key: 'pro:lint', startedAt: new Date(0).toISOString(), created: 'd42' })
    expect(setChild(r.state, 43, 'c43').runner).toMatchObject({ childPid: 43, childCreated: 'c43' })
    expect(setChild(mk(), 43, 'c43').runner).toBeNull()
  })

  it('passes the stored creation time to isAlive: a reused driver pid is not the runner', () => {
    const running = setChild(markRunning(mk(), 'pro:lint', 42, 0, dead, 'd42').state, 43, 'c43')
    const reused = reapRunner(running, (pid, created) => pid === 42 && created === 'other')
    expect(reused.busy).toBeNull()
    expect(reused.interrupted).toBe('pro:lint')
    const live = reapRunner(running, (pid, created) => pid === 43 && created === 'c43')
    expect(live).toMatchObject({ busy: 43, child: true, key: 'pro:lint', interrupted: null })
    expect(live.state).toBe(running)
  })
})

describe('archiveState', () => {
  it('renames through renameRetry (a busy target is retried, not thrown)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'las-wt-phase24-arch-'))
    try {
      const file = path.join(dir, 'phase-24.json')
      fs.writeFileSync(file, '{}')
      const calls = []
      const dest = archiveState(file, { phase: 24, runId: 'p24-x' }, (from, to) => calls.push([from, to]))
      expect(dest).toBe(path.join(dir, 'phase-24.p24-x.json'))
      expect(calls).toEqual([[file, dest]])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('renameRetry', () => {
  const eperm = () => Object.assign(new Error('locked'), { code: 'EPERM' })
  it('retries EPERM until the rename works', () => {
    let tries = 0
    let clock = 0
    const rename = () => {
      tries += 1
      if (tries < 4) throw eperm()
    }
    renameRetry('a', 'b', { rename, now: () => clock, wait: (ms) => { clock += ms } })
    expect(tries).toBe(4)
  })
  it('gives up after 2 s and throws the EPERM', () => {
    let clock = 0
    const rename = () => {
      throw eperm()
    }
    expect(() => renameRetry('a', 'b', { rename, now: () => clock, wait: (ms) => { clock += ms } })).toThrow('locked')
    expect(clock).toBeGreaterThanOrEqual(2000)
  })
  it('does not retry another error', () => {
    let tries = 0
    const rename = () => {
      tries += 1
      throw Object.assign(new Error('x'), { code: 'ENOENT' })
    }
    expect(() => renameRetry('a', 'b', { rename, now: () => 0, wait: () => {} })).toThrow('x')
    expect(tries).toBe(1)
  })
})
