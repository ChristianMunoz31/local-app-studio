// `--wait-for` of the phase gate (docs/phase24/DESIGN-phase24.md, section 2.4): wait while another worktree runs a heavy
// tool. `heavyBlockers` is the brief's process poll as code; `waitForQuiet` polls it with an injected reader, sleeper and
// clock; `readProcesses` is the live reader (one constant PowerShell command, nothing interpolated into it).
import { execFile, execFileSync } from 'node:child_process'
import path from 'node:path'

/** Constant command text: no path, pid or option is ever put into it. */
export const READ_PROCESSES = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress'

const NAME_RE = /^(node|cargo|rustc)/i
const HEAVY_RE = /vitest|playwright|vite|buildSidecar|cargo/i
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The last folder name of a path written with either separator. */
export const baseOf = (p) => String(p).split(/[\\/]/).filter(Boolean).pop() ?? ''

/**
 * Does the command line name this folder? The folder's basename followed by a separator, a quote, a space or the end
 * (case-insensitive), so `local-app-studio` never matches `local-app-studio-workspace`.
 * @param {string} cmd
 * @param {string} folder a folder name or a path (its basename is used)
 */
export function namesFolder(cmd, folder) {
  const base = baseOf(folder)
  if (!base) return false
  return new RegExp(`${escapeRe(base)}(?:[\\\\/"' ]|$)`, 'i').test(String(cmd ?? ''))
}

/**
 * The pids of heavy tools that belong to a target worktree and not to this one.
 * @param {{ pid: number, name: string, cmd: string }[]} processes
 * @param {{ self: string, targets: string[] }} o `self` is this repo root's basename
 * @returns {number[]}
 */
export function heavyBlockers(processes, { self, targets }) {
  return processes
    .filter((p) => NAME_RE.test(String(p.name ?? '')))
    .filter((p) => targets.some((t) => namesFolder(p.cmd, t)))
    .filter((p) => !namesFolder(p.cmd, self))
    .filter((p) => HEAVY_RE.test(String(p.cmd ?? '')))
    .map((p) => p.pid)
}

/**
 * Folder names to watch: one worktree name, or for `any` the main checkout and every other worktree.
 * @param {string} waitFor a worktree name or `any`
 * @param {{ main: string, worktrees: { path: string }[] }} listing from parseWorktreeList
 * @param {string} self basename of this repo root
 * @returns {string[]}
 */
export function targetsFor(waitFor, listing, self) {
  if (waitFor !== 'any') return [waitFor]
  return [listing.main, ...listing.worktrees.map((w) => w.path)].map(baseOf).filter((b) => b && b.toLowerCase() !== self.toLowerCase())
}

/**
 * Polls before a heavy step until no blocker is left or `maxMs` ran out.
 * @param {{ read: () => Promise<number[]>, sleep: (ms: number) => Promise<void>, now: () => number, pollMs?: number, maxMs: number }} o
 *   `read` returns the blocker pids (heavyBlockers over a fresh process list)
 * @returns {Promise<{ quiet: true } | { quiet: false, pids: number[] }>}
 */
export async function waitForQuiet({ read, sleep, now, pollMs = 20000, maxMs }) {
  const start = now()
  for (;;) {
    const pids = await read()
    if (pids.length === 0) return { quiet: true }
    const left = maxMs - (now() - start)
    if (left <= 0) return { quiet: false, pids }
    await sleep(Math.min(pollMs, left))
  }
}

/**
 * Heavy tools (the same name and keyword rules) that name THIS worktree and are not the gate itself: the leftovers of a step
 * whose runner was killed (its vitest, Playwright or server grandchildren outlive a killed gate child), or a dev server of this
 * worktree. The driver's own pid, its ancestors (npm, the shell) and everything below it (its just-spawned child) are excluded,
 * so the gate never blocks itself. Orphans have a dead parent, so they are not below the driver.
 * @param {{ pid: number, ppid?: number, name: string, cmd: string }[]} processes
 * @param {{ self: string, pid: number }} o `self` is this repo root's basename, `pid` the driver's pid
 * @returns {number[]}
 */
export function ownLeftovers(processes, { self, pid }) {
  const byPid = new Map(processes.map((p) => [p.pid, p]))
  const skip = new Set([pid])
  for (let cur = byPid.get(pid)?.ppid, n = 0; cur && n < 32 && !skip.has(cur); n += 1) {
    skip.add(cur)
    cur = byPid.get(cur)?.ppid
  }
  const below = new Set([pid])
  for (let grew = true; grew; ) {
    grew = false
    for (const p of processes) {
      if (!below.has(p.pid) && below.has(p.ppid ?? 0)) {
        below.add(p.pid)
        grew = true
      }
    }
  }
  return processes
    .filter((p) => !skip.has(p.pid) && !below.has(p.pid))
    .filter((p) => NAME_RE.test(String(p.name ?? '')))
    .filter((p) => namesFolder(p.cmd, self))
    .filter((p) => HEAVY_RE.test(String(p.cmd ?? '')))
    .map((p) => p.pid)
}

/** Parses the reader's JSON (one object or an array) into `{ pid, name, cmd }[]`. */
export function parseProcessJson(text) {
  const t = String(text ?? '').trim()
  if (!t) return []
  const data = JSON.parse(t)
  return (Array.isArray(data) ? data : [data])
    .filter((r) => r && Number.isInteger(r.ProcessId))
    .map((r) => ({ pid: r.ProcessId, ppid: Number.isInteger(r.ParentProcessId) ? r.ParentProcessId : 0, name: String(r.Name ?? ''), cmd: String(r.CommandLine ?? '') }))
}

/** Live reader: the Windows process table, or an empty list elsewhere. */
export function readProcesses() {
  if (process.platform !== 'win32') return Promise.resolve([])
  return new Promise((resolve, reject) => {
    execFile(powershellPath(), ['-NoProfile', '-NonInteractive', '-Command', READ_PROCESSES], { shell: false, windowsHide: true, timeout: 60000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err)
      try {
        resolve(parseProcessJson(stdout))
      } catch (e) {
        reject(e)
      }
    })
  })
}

/** Constant command text for the creation time of one process; the pid arrives in the environment as a validated integer. */
export const READ_CREATED = '(Get-Process -Id ([int]$env:PHASE_GATE_PID) -ErrorAction Stop).StartTime.ToUniversalTime().Ticks'

// PowerShell by absolute path, so a planted powershell.exe on PATH or in the cwd is never run.
const powershellPath = () => path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

/**
 * The creation time of a process as a string of ticks, or null (not Windows, no such process, unreadable). Compared with a
 * stored value it tells a live process from a reused pid.
 * @param {number} pid
 * @param {{ platform?: string, run?: typeof execFileSync }} [o]
 * @returns {string | null}
 */
export function readCreated(pid, { platform = process.platform, run = execFileSync } = {}) {
  if (platform !== 'win32' || !Number.isInteger(pid) || pid <= 0) return null
  try {
    const out = String(run(powershellPath(), ['-NoProfile', '-NonInteractive', '-Command', READ_CREATED], { env: { ...process.env, PHASE_GATE_PID: String(pid) }, shell: false, windowsHide: true, timeout: 15000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).trim()
    return /^\d+$/.test(out) ? out : null
  } catch {
    return null
  }
}

/**
 * Builds the liveness check: the pid answers signal 0 and, when a creation time is stored and readable, the process has the
 * same creation time (a reused pid is a different process). An unreadable creation time counts as alive.
 * @param {(pid: number) => string | null} [read]
 * @param {(pid: number, signal: number) => unknown} [kill]
 * @returns {(pid: number, created?: string | null) => boolean}
 */
export function makeIsAlive(read = readCreated, kill = process.kill.bind(process)) {
  return (pid, created = null) => {
    try {
      kill(pid, 0)
    } catch (e) {
      if (!(e && e.code === 'EPERM')) return false
    }
    if (!created) return true
    const now = read(pid)
    return now === null || now === created
  }
}

export const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms))
