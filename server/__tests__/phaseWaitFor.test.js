// --wait-for (scripts/phase/lib/waitFor.js, DESIGN-phase24 section 2.4): the brief's process poll as a pure function over a
// fake process list, the basename boundary, the targets and the polling loop over a fake clock.
import { describe, expect, it } from 'vitest'
import { READ_CREATED, READ_PROCESSES, heavyBlockers, makeIsAlive, ownLeftovers, readCreated, namesFolder, parseProcessJson, targetsFor, waitForQuiet } from '../../scripts/phase/lib/waitFor.js'

const proc = (pid, name, cmd) => ({ pid, name, cmd })
const MAIN = 'D:\\work\\proj\\local-app-studio'
const P23 = 'D:\\work\\proj\\las-wt-phase23'
const P24 = 'D:\\work\\proj\\las-wt-phase24'

describe('namesFolder', () => {
  it('matches the basename followed by a separator, quote, space or the end', () => {
    expect(namesFolder(`node ${MAIN}\\node_modules\\vitest\\vitest.mjs`, 'local-app-studio')).toBe(true)
    expect(namesFolder('node D:/x/local-app-studio/node_modules/vite', 'local-app-studio')).toBe(true)
    expect(namesFolder(`node "${MAIN}" run`, MAIN)).toBe(true)
    expect(namesFolder(`node x ${MAIN}`, MAIN)).toBe(true)
    expect(namesFolder('NODE D:\\U\\LOCAL-APP-STUDIO\\a', 'local-app-studio')).toBe(true)
  })

  it('never lets local-app-studio match local-app-studio-workspace', () => {
    expect(namesFolder('node D:\\work\\proj\\local-app-studio-workspace\\vitest', 'local-app-studio')).toBe(false)
    expect(namesFolder('node D:\\work\\proj\\local-app-studio-workspace\\vitest', MAIN)).toBe(false)
  })

  it('treats a regex character in the name as text', () => {
    expect(namesFolder('node D:\\a\\wt.x\\vitest', 'wt.x')).toBe(true)
    expect(namesFolder('node D:\\a\\wtyx\\vitest', 'wt.x')).toBe(false)
  })
})

describe('heavyBlockers', () => {
  const opts = { self: 'las-wt-phase24', targets: ['local-app-studio', 'las-wt-phase23'] }

  it('returns the heavy node, cargo and rustc processes of a target', () => {
    const list = [
      proc(1, 'node.exe', `node ${MAIN}\\node_modules\\vitest\\vitest.mjs run`),
      proc(2, 'cargo.exe', `cargo build --manifest-path ${P23}\\src-tauri\\Cargo.toml`),
      proc(3, 'rustc.exe', `rustc ${P23}\\src-tauri\\src\\main.rs cargo`),
      proc(4, 'node.exe', `node ${P23}\\node_modules\\playwright\\cli.js test`),
      proc(5, 'node.exe', `node ${P23}\\node_modules\\vite\\bin\\vite.js build`),
      proc(6, 'node.exe', `node ${P23}\\scripts\\desktop\\buildSidecar.js`),
    ]
    expect(heavyBlockers(list, opts)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('ignores light node processes, other names, other folders and this worktree', () => {
    const list = [
      proc(1, 'node.exe', `node ${P23}\\server.js`),
      proc(2, 'bash.exe', `bash ${P23}\\run vitest`),
      proc(3, 'node.exe', `node ${P24}\\node_modules\\vitest\\vitest.mjs`),
      proc(4, 'node.exe', 'node D:\\other\\project\\node_modules\\vitest\\vitest.mjs'),
      proc(5, 'node.exe', `node ${P23}\\x\\vitest ${P24}\\y`),
      proc(6, 'node.exe', 'node D:\\work\\proj\\local-app-studio-workspace\\vitest'),
      proc(7, 'node.exe', ''),
    ]
    expect(heavyBlockers(list, opts)).toEqual([])
  })

  it('matches the process name case-insensitively', () => {
    expect(heavyBlockers([proc(9, 'Node.EXE', `node ${P23}\\vitest`)], opts)).toEqual([9])
  })
})

describe('targetsFor', () => {
  const listing = { main: MAIN, worktrees: [{ path: P23 }, { path: P24 }, { path: 'D:\\w\\las-wt-phase25' }] }

  it('is the given name for a worktree name', () => {
    expect(targetsFor('las-wt-phase23', listing, 'las-wt-phase24')).toEqual(['las-wt-phase23'])
  })

  it('is the main checkout and every other worktree for any', () => {
    expect(targetsFor('any', listing, 'las-wt-phase24')).toEqual(['local-app-studio', 'las-wt-phase23', 'las-wt-phase25'])
  })
})

describe('waitForQuiet', () => {
  function fakes(readings, maxMs, pollMs = 20000) {
    let t = 0
    const slept = []
    let i = 0
    return {
      slept,
      run: () =>
        waitForQuiet({
          read: async () => readings[Math.min(i++, readings.length - 1)],
          sleep: async (ms) => {
            slept.push(ms)
            t += ms
          },
          now: () => t,
          pollMs,
          maxMs,
        }),
    }
  }

  it('is quiet at once when nothing blocks', async () => {
    const f = fakes([[]], 60000)
    expect(await f.run()).toEqual({ quiet: true })
    expect(f.slept).toEqual([])
  })

  it('polls every 20 s and goes on when the blocker leaves', async () => {
    const f = fakes([[7], [7], []], 60000)
    expect(await f.run()).toEqual({ quiet: true })
    expect(f.slept).toEqual([20000, 20000])
  })

  it('gives up with the pids when the time ran out', async () => {
    const f = fakes([[7, 8]], 50000)
    expect(await f.run()).toEqual({ quiet: false, pids: [7, 8] })
    expect(f.slept).toEqual([20000, 20000, 10000])
  })

  it('does not wait at all with a zero budget', async () => {
    const f = fakes([[7]], 0)
    expect(await f.run()).toEqual({ quiet: false, pids: [7] })
    expect(f.slept).toEqual([])
  })
})

describe('ownLeftovers', () => {
  const row = (pid, ppid, name, cmd) => ({ pid, ppid, name, cmd })
  const SELF = 'las-wt-phase24'

  it('lists a heavy orphan that names this worktree (its parent is gone)', () => {
    const procs = [row(10, 1, 'node.exe', `node ${P24}\\node_modules\\vitest\\vitest.mjs run`), row(11, 10, 'node.exe', `node ${P24}\\node_modules\\vite\\x.js`)]
    expect(ownLeftovers(procs, { self: SELF, pid: 500 })).toEqual([10, 11])
  })

  it('never lists the driver, its ancestors or anything below it (its own just-spawned child)', () => {
    const procs = [
      row(100, 1, 'cmd.exe', `cmd /c npm run phase:gate`),
      row(200, 100, 'node.exe', `node ${P24}\\node_modules\\vitest\\x.js phase gate`),
      row(500, 200, 'node.exe', `node ${P24}\\scripts\\phase\\gate.js --next vitest`),
      row(501, 500, 'node.exe', `node ${P24}\\scripts\\ci\\gate.js --only unit vitest`),
      row(502, 501, 'node.exe', `node ${P24}\\node_modules\\vitest\\vitest.mjs run`),
    ]
    expect(ownLeftovers(procs, { self: SELF, pid: 500 })).toEqual([])
  })

  it('ignores other worktrees, non-heavy commands, other names and a longer folder name', () => {
    const procs = [
      row(1, 0, 'node.exe', `node ${P23}\\node_modules\\vitest\\x.js`),
      row(2, 0, 'node.exe', `node ${P24}\\scripts\\other.js`),
      row(3, 0, 'chrome.exe', `chrome ${P24}\\vitest`),
      row(4, 0, 'node.exe', `node D:\\w\\las-wt-phase24-extra\\vitest.mjs`),
    ]
    expect(ownLeftovers(procs, { self: SELF, pid: 500 })).toEqual([])
  })
})

describe('the live reader', () => {
  it('uses one constant command with nothing to interpolate', () => {
    expect(READ_PROCESSES).toBe('Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress')
    expect(READ_PROCESSES).not.toMatch(/[$`]/)
  })

  it('parses one object, an array and an empty answer', () => {
    expect(parseProcessJson('{"ProcessId":4,"ParentProcessId":2,"Name":"node.exe","CommandLine":"node a"}')).toEqual([{ pid: 4, ppid: 2, name: 'node.exe', cmd: 'node a' }])
    expect(parseProcessJson('[{"ProcessId":4,"Name":"x","CommandLine":null},{"Name":"no pid"}]')).toEqual([{ pid: 4, ppid: 0, name: 'x', cmd: '' }])
    expect(parseProcessJson('  ')).toEqual([])
  })
})

describe('creation time', () => {
  it('reads the ticks through a constant command with the pid in the environment only', () => {
    const calls = []
    const run = (file, args, o) => {
      calls.push({ file, args, env: o.env })
      return '638000000000000000\r\n'
    }
    expect(readCreated(4242, { platform: 'win32', run })).toBe('638000000000000000')
    expect(calls[0].args).toEqual(['-NoProfile', '-NonInteractive', '-Command', READ_CREATED])
    expect(READ_CREATED).not.toMatch(/4242/)
    expect(calls[0].env.PHASE_GATE_PID).toBe('4242')
  })

  it('is null off Windows, for a bad pid, for a failed or odd answer', () => {
    const boom = () => {
      throw new Error('no such process')
    }
    expect(readCreated(1, { platform: 'linux', run: () => '1' })).toBeNull()
    expect(readCreated(-3, { platform: 'win32', run: () => '1' })).toBeNull()
    expect(readCreated(1.5, { platform: 'win32', run: () => '1' })).toBeNull()
    expect(readCreated(9, { platform: 'win32', run: boom })).toBeNull()
    expect(readCreated(9, { platform: 'win32', run: () => 'garbage' })).toBeNull()
  })
})

describe('makeIsAlive', () => {
  const killOk = () => true
  const killGone = () => {
    throw Object.assign(new Error('gone'), { code: 'ESRCH' })
  }
  it('is dead when the pid is gone', () => {
    expect(makeIsAlive(() => '1', killGone)(10, '1')).toBe(false)
  })
  it('is alive with the same creation time, and an unreadable one counts as alive', () => {
    expect(makeIsAlive(() => '77', killOk)(10, '77')).toBe(true)
    expect(makeIsAlive(() => null, killOk)(10, '77')).toBe(true)
    expect(makeIsAlive(() => '5', killOk)(10)).toBe(true)
  })
  it('is dead for a reused pid: the pid answers but the creation time differs', () => {
    expect(makeIsAlive(() => '78', killOk)(10, '77')).toBe(false)
  })
  it('counts EPERM as alive', () => {
    const eperm = () => {
      throw Object.assign(new Error('x'), { code: 'EPERM' })
    }
    expect(makeIsAlive(() => '1', eperm)(10, '1')).toBe(true)
  })
})
