// The light flag of the phase gate plan and the scheduler rule of --next (O9, docs/PIPELINE.md "Light steps"): one light step may run
// beside one heavy step, never two heavy steps and never two light ones. Pure transitions over the real plan, then `main` over fakes.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { main } from '../../scripts/phase/gate.js'
import { LIGHT_RUN_DIR, buildPlan, dryRunLines, lightWorkers, parseArgs } from '../../scripts/phase/lib/gatePlan.js'
import { finishStep, isHeavyStep, isLight, markRunning, newState, nextPair, readState, reapRunner, setChild } from '../../scripts/phase/lib/gateRun.js'

const HEAD = 'c'.repeat(40)
const plan = (builds = ['pro']) => buildPlan({ phase: 27, builds, classify: true, maxWorkers: 4, e2eShards: 2, resultDir: 'res' })
const mk = (builds = ['pro']) =>
  newState({ phase: 27, runId: 'p27-20261107-1000', createdAt: '2026-11-07T10:00:00.000Z', head: HEAD, branch: 'feat/phase27-x', options: { builds, classify: true, maxWorkers: 4, e2eShards: 2, waitFor: null, logDir: 'logs' }, steps: plan(builds) })
const pass = { status: 'pass', reason: null, exitCode: 0, seconds: 1, endedAt: '2026-11-07T10:01:00.000Z', head: HEAD, result: null }
const done = (state, keys) => keys.reduce((s, k) => finishStep(s, k, pass), state)
const by = (state, key) => state.steps.find((s) => s.key === key)
const LIGHT = ['hygiene-gitleaks', 'hygiene-em-dash', 'hygiene-keys', 'hygiene-personal', 'check-extra', 'lint', 'typecheck', 'unit-pure']

describe('the light flag in the plan', () => {
  it('marks lint, typecheck, unit-pure and the hygiene checks light in both builds, and nothing else', () => {
    for (const build of ['pro', 'public']) {
      const light = plan(['pro', 'public']).filter((s) => s.build === build && s.light).map((s) => s.slug)
      expect(light).toEqual(LIGHT)
    }
  })

  it('keeps unit-pure waiting for a quiet machine (heavy) while it counts as light for pairing', () => {
    const pure = by(mk(), 'pro:unit-pure')
    expect(pure).toMatchObject({ heavy: true, light: true })
    expect(isLight(pure)).toBe(true)
    expect(isHeavyStep(pure)).toBe(false)
    expect(isHeavyStep(by(mk(), 'pro:unit-frontend'))).toBe(true)
    expect(isHeavyStep(by(mk(), 'pro:e2e-a11y'))).toBe(true)
  })

  it('gives a light gate step its own run folder, so it does not clear the heavy step\'s folder', () => {
    const s = mk()
    expect(by(s, 'pro:lint').env).toEqual({ GATE_RUN_DIR: LIGHT_RUN_DIR })
    expect(by(s, 'pro:unit-pure').env).toEqual({ GATE_RUN_DIR: LIGHT_RUN_DIR })
    expect(by(s, 'pro:unit-frontend').env).toEqual({})
    expect(by(s, 'pro:check-extra').env).toEqual({})
  })

  it('shows the flag in --dry-run and reads --no-overlap', () => {
    const lines = dryRunLines(plan())
    expect(lines.find((l) => l.startsWith('pro:lint'))).toContain('(light)')
    expect(lines.find((l) => l.startsWith('pro:unit-pure'))).toContain('(light, waits)')
    expect(lines.find((l) => l.startsWith('pro:unit-frontend'))).toContain('(heavy)')
    expect(parseArgs(['--next']).overlap).toBe(true)
    expect(parseArgs(['--next', '--no-overlap']).overlap).toBe(false)
  })
})

describe('nextPair', () => {
  it('pairs a light primary with the first heavy step that could run, and never with a second light one', () => {
    const r = nextPair(mk())
    expect(r.step.key).toBe('pro:hygiene-gitleaks')
    expect(r.partner.key).toBe('pro:unit-frontend')
  })

  it('pairs a heavy primary with the first pending light step', () => {
    let s = mk()
    s = done(s, ['pro:hygiene-gitleaks', 'pro:hygiene-em-dash', 'pro:hygiene-keys', 'pro:hygiene-personal', 'pro:check-extra', 'pro:lint'])
    s = done(s, ['pro:typecheck', 'pro:unit-pure'])
    // only heavy steps are left in front: the partner is the next light one, and there is none
    expect(nextPair(s).step.key).toBe('pro:unit-frontend')
    expect(nextPair(s).partner).toBeNull()
    let t = mk()
    t = done(t, ['pro:hygiene-gitleaks'])
    t = { ...t, steps: t.steps.map((x) => (['pro:hygiene-em-dash', 'pro:hygiene-keys', 'pro:hygiene-personal', 'pro:check-extra', 'pro:lint'].includes(x.key) ? { ...x, status: 'pass' } : x)) }
    const r = nextPair(t)
    expect(r.step.key).toBe('pro:typecheck')
    expect(r.partner.key).toBe('pro:unit-frontend')
  })

  it('never pairs two heavy steps', () => {
    let s = mk()
    s = done(s, LIGHT.map((x) => `pro:${x}`))
    for (let i = 0; i < 20; i += 1) {
      const r = nextPair(s)
      if (!r.step) break
      expect(r.partner).toBeNull()
      s = finishStep(r.state, r.step.key, pass)
    }
  })

  it('never pairs two light steps or a step with itself, whatever the order of finishing', () => {
    let s = mk()
    for (let i = 0; i < 40; i += 1) {
      const r = nextPair(s)
      if (!r.step) break
      const pair = [r.step, r.partner].filter(Boolean)
      expect(pair.filter(isLight).length).toBeLessThanOrEqual(1)
      expect(pair.filter(isHeavyStep).length).toBeLessThanOrEqual(1)
      expect(new Set(pair.map((p) => p.key)).size).toBe(pair.length)
      s = r.state
      for (const p of pair) s = finishStep(s, p.key, pass)
    }
  })

  it('runs a step that is neither light nor heavy alone', () => {
    let s = mk()
    s = done(s, plan().filter((x) => x.light || x.heavy).map((x) => x.key))
    s = done(s, [])
    const r = nextPair(s)
    expect(r.step.key).toBe('pro:bundle-budget')
    expect(r.partner).toBeNull()
  })

  it('gives no partner with overlap off, and keeps nextStep order', () => {
    const r = nextPair(mk(), { overlap: false })
    expect(r.step.key).toBe('pro:hygiene-gitleaks')
    expect(r.partner).toBeNull()
  })

  it('does not pick a heavy partner whose need did not pass (it turns not-run, as nextStep does)', () => {
    let s = mk()
    s = { ...s, steps: s.steps.map((x) => (x.key === 'pro:build' ? { ...x, status: 'fail-real' } : x)) }
    s = done(s, ['pro:unit-frontend', 'pro:unit-pure', 'pro:unit-backend', 'pro:template-parity'])
    const r = nextPair(s)
    expect(r.step.key).toBe('pro:hygiene-gitleaks')
    expect(r.partner?.key).toBe('pro:cloud-off')
    expect(by(r.state, 'pro:bundle-budget').status).toBe('not-run')
  })
})

describe('the runner of a pair', () => {
  it('marks both running, keeps the partner child in the runner and reaps both when the driver died', () => {
    const r = nextPair(mk())
    let s = markRunning(r.state, r.step.key, 10, 0, () => false, null, r.partner.key).state
    expect(by(s, r.step.key).status).toBe('running')
    expect(by(s, r.partner.key).status).toBe('running')
    s = setChild(s, 11, null, r.step.key)
    s = setChild(s, 12, null, r.partner.key)
    expect(s.runner).toMatchObject({ pid: 10, childPid: 11, also: { key: r.partner.key, childPid: 12 } })
    // the driver is gone but the partner's child still runs: busy, naming that child
    expect(reapRunner(s, (p) => p === 12)).toMatchObject({ busy: 12, child: true, key: r.partner.key })
    const reaped = reapRunner(s, () => false)
    expect(reaped).toMatchObject({ busy: null, interrupted: r.step.key, interruptedAlso: r.partner.key })
    expect(by(reaped.state, r.step.key).status).toBe('not-run')
    expect(by(reaped.state, r.partner.key).status).toBe('not-run')
    expect(reaped.state.runner).toBeNull()
  })

  it('finishing the partner leaves the runner for the main step; finishing the main step clears it', () => {
    const r = nextPair(mk())
    let s = markRunning(r.state, r.step.key, 10, 0, () => false, null, r.partner.key).state
    s = finishStep(s, r.partner.key, pass)
    expect(s.runner).toMatchObject({ pid: 10, key: r.step.key })
    expect(s.runner.also).toBeUndefined()
    s = finishStep(s, r.step.key, pass)
    expect(s.runner).toBeNull()
  })
})

describe('main runs a pair at once', () => {
  const temps = []
  afterEach(() => {
    for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true })
  })

  function setup(overrides = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'las-wt-phase27-'))
    temps.push(root)
    const lines = []
    const calls = []
    const live = { n: 0, max: 0 }
    let clock = Date.UTC(2026, 10, 7, 10, 0)
    const deps = {
      root,
      lockFile: path.join(root, 'las-heavy.lock'),
      git: (args) => (args[0] === 'rev-parse' && args[1] === 'HEAD' ? HEAD : args[0] === 'rev-parse' ? 'feat/phase27-x' : ''),
      now: () => (clock += 2000),
      sleep: async (ms) => {
        clock += ms
      },
      isAlive: () => false,
      pid: 5150,
      readProcs: async () => [],
      out: (s) => lines.push(s),
      err: () => {},
      runChild: async (argv, o) => {
        calls.push({ argv, o })
        live.n += 1
        live.max = Math.max(live.max, live.n)
        await new Promise((r) => setTimeout(r, 5))
        live.n -= 1
        fs.appendFileSync(o.logPath, `ran ${argv[0]}\n`)
        const at = argv.indexOf('--json')
        if (at > 0) fs.writeFileSync(argv[at + 1], JSON.stringify({ results: [{ id: 'x', status: 'passed', seconds: 1 }] }))
        return 0
      },
      ...overrides,
    }
    return { root, lines, calls, live, deps, stateFile: path.join(root, '.gate', 'phase', 'phase-27.json') }
  }

  it('--next starts the light step and the heavy one together, records both, and reports the main step last', async () => {
    const t = setup()
    expect(await main(['--next'], t.deps)).toBe(0)
    expect(t.calls.map((c) => c.argv[2])).toEqual(['hygiene: gitleaks', 'unit tests'])
    expect(t.live.max).toBe(2)
    expect(t.calls[0].o.env.GATE_RUN_DIR).toBe(LIGHT_RUN_DIR)
    expect(t.calls[1].o.env.GATE_RUN_DIR).toBeUndefined()
    const state = readState(t.stateFile)
    expect(by(state, 'pro:hygiene-gitleaks').status).toBe('pass')
    expect(by(state, 'pro:unit-frontend').status).toBe('pass')
    expect(state.runner).toBeNull()
    expect(t.lines.at(-1)).toMatch(/^phase-gate: pro:hygiene-gitleaks pass /)
  })

  it('--no-overlap runs one step per call', async () => {
    const t = setup()
    await main(['--next', '--no-overlap'], t.deps)
    expect(t.calls).toHaveLength(1)
    expect(t.live.max).toBe(1)
  })

  it('never runs more than one heavy and one light step at a time over a whole run', async () => {
    const t = setup()
    expect(await main(['--all', '--wait-for', 'any'], t.deps)).toBe(0)
    expect(t.live.max).toBeLessThanOrEqual(2)
    const state = readState(t.stateFile)
    expect(state.steps.every((s) => s.status === 'pass')).toBe(true)
  })

  it('reports a failing partner on the last line, whichever step it is', async () => {
    const t = setup({
      runChild: async (argv, o) => {
        fs.appendFileSync(o.logPath, 'boom\n')
        return argv[2] === 'hygiene: gitleaks' ? 1 : 0
      },
    })
    await main(['--next'], t.deps)
    expect(t.lines.at(-1)).toMatch(/^phase-gate: pro:hygiene-gitleaks fail-real /)
    expect(t.lines).toContain('  | boom')
  })

  it('runs a light primary alone when its heavy partner has to wait for another worktree', async () => {
    const t = setup({ readProcs: async () => [{ pid: 999, name: 'node.exe', cmd: 'node C:/other/local-app-studio/node_modules/vitest/vitest.mjs run' }] })
    expect(await main(['--next', '--wait-for', 'any', '--wait-max', '0'], { ...t.deps, parseWorktrees: () => ({ main: 'C:/other/local-app-studio', worktrees: [] }) })).toBe(0)
    expect(t.calls.map((c) => c.argv[2])).toEqual(['hygiene: gitleaks'])
  })
})

describe('the shared heavy-step lock (wait.js)', () => {
  const temps = []
  afterEach(() => {
    for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true })
  })

  const OTHER = 7777
  function setup(overrides = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'las-wt-phase27-lock-'))
    temps.push(root)
    const lines = []
    const calls = []
    const lockFile = path.join(root, 'las-heavy.lock')
    const seen = []
    let clock = Date.UTC(2026, 10, 7, 10, 0)
    const deps = {
      root,
      lockFile,
      git: (args) => (args[0] === 'rev-parse' && args[1] === 'HEAD' ? HEAD : args[0] === 'rev-parse' ? 'feat/phase27-x' : ''),
      now: () => (clock += 2000),
      sleep: async (ms) => {
        clock += ms
      },
      isAlive: (p) => p === OTHER,
      pid: 5150,
      readProcs: async () => [],
      out: (s) => lines.push(s),
      err: () => {},
      runChild: async (argv, o) => {
        seen.push(fs.existsSync(lockFile) ? JSON.parse(fs.readFileSync(lockFile, 'utf8')) : null)
        calls.push({ argv, o })
        fs.appendFileSync(o.logPath, `ran ${argv[0]}
`)
        const at = argv.indexOf('--json')
        if (at > 0) fs.writeFileSync(argv[at + 1], JSON.stringify({ results: [{ id: 'x', status: 'passed', seconds: 1 }] }))
        return 0
      },
      ...overrides,
    }
    return { root, lines, calls, seen, lockFile, deps, stateFile: path.join(root, '.gate', 'phase', 'phase-27.json') }
  }
  const hold = (file, pid) => fs.writeFileSync(file, JSON.stringify({ pid, created: null, owner: 'critic', cmd: 'vitest', at: 'x' }))
  // Moves the run to the first heavy step (the light ones are passed), so --next picks a heavy primary.
  const toHeavy = async (t) => {
    await main(['--next', '--no-overlap'], t.deps)
    const s = readState(t.stateFile)
    writeFileSyncState(t.stateFile, { ...s, steps: s.steps.map((x) => (x.light ? { ...x, status: 'pass' } : x)) })
  }
  const writeFileSyncState = (file, s) => fs.writeFileSync(file, `${JSON.stringify(s, null, 2)}
`)

  it('takes the lock for a heavy step, releases it afterwards and holds nothing between calls', async () => {
    const t = setup()
    await toHeavy(t)
    t.calls.length = 0
    t.seen.length = 0
    expect(await main(['--next'], t.deps)).toBe(0)
    expect(t.calls.map((c) => c.argv[2])).toEqual(['unit tests'])
    expect(t.seen[0]).toMatchObject({ pid: 5150, owner: 'phase-gate', cmd: 'pro:unit-frontend' })
    expect(fs.existsSync(t.lockFile)).toBe(false)
  })

  it('gives exit 75 for a heavy step while a live other pid holds the lock, and leaves that lock alone', async () => {
    const t = setup()
    await toHeavy(t)
    t.calls.length = 0
    hold(t.lockFile, OTHER)
    expect(await main(['--next', '--wait-max', '0'], t.deps)).toBe(75)
    expect(t.calls).toHaveLength(0)
    expect(t.lines.some((l) => l.includes(`waiting on pid ${OTHER}`))).toBe(true)
    expect(JSON.parse(fs.readFileSync(t.lockFile, 'utf8')).pid).toBe(OTHER)
  })

  it('lets a light step run alone while another pid holds the lock, and never writes the lock', async () => {
    const t = setup()
    hold(t.lockFile, OTHER)
    expect(await main(['--next', '--wait-max', '0'], t.deps)).toBe(0)
    expect(t.calls.map((c) => c.argv[2])).toEqual(['hygiene: gitleaks'])
    expect(t.seen).toEqual([{ pid: OTHER, created: null, owner: 'critic', cmd: 'vitest', at: 'x' }])
    expect(JSON.parse(fs.readFileSync(t.lockFile, 'utf8')).pid).toBe(OTHER)
  })

  it('a light step alone never creates the lock file', async () => {
    const t = setup()
    expect(await main(['--next', '--no-overlap'], t.deps)).toBe(0)
    expect(t.calls.map((c) => c.argv[2])).toEqual(['hygiene: gitleaks'])
    expect(t.seen).toEqual([null])
    expect(fs.existsSync(t.lockFile)).toBe(false)
  })

  it('takes over the lock of a dead holder', async () => {
    const t = setup()
    await toHeavy(t)
    t.calls.length = 0
    t.seen.length = 0
    hold(t.lockFile, 4242)
    expect(await main(['--next'], t.deps)).toBe(0)
    expect(t.seen[0]).toMatchObject({ pid: 5150, owner: 'phase-gate' })
    expect(fs.existsSync(t.lockFile)).toBe(false)
  })

  it('releases the lock after a failing step', async () => {
    const t = setup({
      runChild: async (argv, o) => {
        fs.appendFileSync(o.logPath, 'boom\n')
        return 1
      },
    })
    await toHeavy(t)
    expect(await main(['--next'], t.deps)).toBe(0)
    expect(by(readState(t.stateFile), 'pro:unit-frontend').status).not.toBe('pass')
    expect(fs.existsSync(t.lockFile)).toBe(false)
  })

  it('takes the lock for the heavy partner of a pair and releases it when both ended', async () => {
    const t = setup()
    expect(await main(['--next'], t.deps)).toBe(0)
    expect(t.calls.map((c) => c.argv[2])).toEqual(['hygiene: gitleaks', 'unit tests'])
    expect(t.seen.every((x) => x !== null && x.pid === 5150)).toBe(true)
    expect(fs.existsSync(t.lockFile)).toBe(false)
  })
})

describe('workers and shared files of a pair, and the lock for unit-pure alone', () => {
  const temps = []
  afterEach(() => {
    for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true })
  })

  function setup(extra = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'las-wt-phase27-pair-'))
    temps.push(root)
    const calls = []
    const seen = []
    const lockFile = path.join(root, 'las-heavy.lock')
    let clock = Date.UTC(2026, 10, 7, 10, 0)
    const deps = {
      root,
      lockFile,
      git: (args) => (args[0] === 'rev-parse' && args[1] === 'HEAD' ? HEAD : args[0] === 'rev-parse' ? 'feat/phase27-x' : ''),
      now: () => (clock += 2000),
      sleep: async (ms) => {
        clock += ms
      },
      isAlive: () => false,
      pid: 5150,
      readProcs: async () => [],
      out: () => {},
      err: () => {},
      runChild: async (argv, o) => {
        calls.push({ argv, o })
        seen.push(fs.existsSync(lockFile) ? JSON.parse(fs.readFileSync(lockFile, 'utf8')) : null)
        fs.appendFileSync(o.logPath, 'ran\n')
        const at = argv.indexOf('--json')
        if (at > 0) fs.writeFileSync(argv[at + 1], JSON.stringify({ results: [{ id: 'x', status: 'passed', seconds: 1 }] }))
        return 0
      },
      ...extra,
    }
    return { root, calls, seen, deps, lockFile, stateFile: path.join(root, '.gate', 'phase', 'phase-27.json') }
  }
  const only = (t, name) => t.calls.find((c) => c.argv[2] === name)

  // Marks steps passed in the state file of a run that already exists.
  const advanceTo = (t, passKeys) => {
    const s = readState(t.stateFile)
    fs.writeFileSync(t.stateFile, `${JSON.stringify({ ...s, steps: s.steps.map((x) => (passKeys.includes(x.key) ? { ...x, status: 'pass' } : x)) }, null, 2)}\n`)
  }
  const allBut = (t, key) => readState(t.stateFile).steps.filter((x) => x.key !== key).map((x) => x.key)

  it('gives unit-pure half the workers (at least 1) beside a heavy step, and the heavy step all of them', async () => {
    expect(lightWorkers(4)).toBe(2)
    expect(lightWorkers(5)).toBe(2)
    expect(lightWorkers(1)).toBe(1)
    expect(lightWorkers(8)).toBe(4)
    const t = setup()
    await main(['--next', '--no-overlap'], t.deps)
    advanceTo(t, LIGHT.filter((k) => k !== 'unit-pure').map((k) => `pro:${k}`))
    t.calls.length = 0
    expect(await main(['--next'], t.deps)).toBe(0)
    // unit-frontend (heavy, primary) pairs with unit-pure (light, heavy: true)
    const heavy = t.calls.find((c) => c.argv.includes('frontend'))
    const pure = t.calls.find((c) => c.argv.includes('pure'))
    expect(heavy.o.env.GATE_MAX_WORKERS).toBe('4')
    expect(heavy.o.env.VITEST_MAX_WORKERS).toBe('4')
    expect(pure.o.env.GATE_MAX_WORKERS).toBe('2')
    expect(pure.o.env.VITEST_MAX_WORKERS).toBe('2')
  })

  it('marks only the light step of a pair GATE_LIGHT_CHILD, and nothing when a step runs alone', async () => {
    const t = setup()
    await main(['--next'], t.deps)
    expect(only(t, 'hygiene: gitleaks').o.env.GATE_LIGHT_CHILD).toBe('1')
    expect(only(t, 'unit tests').o.env.GATE_LIGHT_CHILD).toBeUndefined()
    const alone = setup()
    await main(['--next', '--no-overlap'], alone.deps)
    expect(alone.calls[0].o.env.GATE_LIGHT_CHILD).toBeUndefined()
  })

  it('unit-pure running alone takes the lock', async () => {
    const t = setup()
    await main(['--next', '--no-overlap'], t.deps)
    advanceTo(t, allBut(t, 'pro:unit-pure'))
    t.calls.length = 0
    t.seen.length = 0
    expect(await main(['--next'], t.deps)).toBe(0)
    expect(t.calls).toHaveLength(1)
    expect(t.calls[0].argv.includes('pure')).toBe(true)
    expect(t.seen[0]).toMatchObject({ pid: 5150, owner: 'phase-gate', cmd: 'pro:unit-pure' })
    expect(fs.existsSync(t.lockFile)).toBe(false)
  })

  it('unit-pure alone waits (exit 75) while another live pid holds the lock', async () => {
    const t = setup({ isAlive: (p) => p === 7777 })
    await main(['--next', '--no-overlap'], t.deps)
    advanceTo(t, allBut(t, 'pro:unit-pure'))
    t.calls.length = 0
    fs.writeFileSync(t.lockFile, JSON.stringify({ pid: 7777, created: null, owner: 'critic', cmd: 'vitest', at: 'x' }))
    expect(await main(['--next', '--wait-max', '0'], t.deps)).toBe(75)
    expect(t.calls).toHaveLength(0)
  })

  it('a light partner beside a heavy primary runs under the one lock the primary holds', async () => {
    const t = setup()
    await main(['--next', '--no-overlap'], t.deps)
    advanceTo(t, LIGHT.filter((k) => k !== 'unit-pure').map((k) => `pro:${k}`))
    t.calls.length = 0
    t.seen.length = 0
    await main(['--next'], t.deps)
    expect(t.seen).toHaveLength(2)
    expect(t.seen.every((x) => x !== null && x.pid === 5150 && x.cmd === 'pro:unit-frontend')).toBe(true)
  })
})
