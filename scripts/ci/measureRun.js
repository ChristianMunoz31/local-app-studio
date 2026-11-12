// Runs one command and reports its wall time and the peak working set of its whole process tree.
// No dependency: on Windows one long-lived PowerShell samples Win32_Process every interval; elsewhere
// `ps -eo pid,ppid,rss` is read. Used for the phase 11 timing table and by `npm run gate`.
// Usage: node scripts/ci/measureRun.js [--json <file>] [--interval <ms>] -- <command> [args...]
import { spawn, spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Sums the memory of `rootPid` and every descendant.
 * @param {{ pid: number, ppid: number, bytes: number }[]} rows
 * @param {number} rootPid
 * @returns {number} bytes
 */
export function treeBytes(rows, rootPid) {
  const children = new Map()
  for (const r of rows) {
    if (!children.has(r.ppid)) children.set(r.ppid, [])
    children.get(r.ppid).push(r)
  }
  const byPid = new Map(rows.map((r) => [r.pid, r]))
  let total = 0
  const seen = new Set()
  const stack = [rootPid]
  while (stack.length > 0) {
    const pid = stack.pop()
    if (seen.has(pid)) continue
    seen.add(pid)
    const row = byPid.get(pid)
    if (row) total += row.bytes
    for (const c of children.get(pid) ?? []) if (c.pid !== pid) stack.push(c.pid)
  }
  return total
}

/** Parses `pid,ppid,bytes` lines (the sampler output); bad lines are skipped. */
export function parseRows(text) {
  const rows = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)\s*$/.exec(line)
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), bytes: Number(m[3]) })
  }
  return rows
}

/**
 * Splits one complete sample (the lines before a `--` line) off the front of the sampler output.
 * Returns `block: null` until the marker line has fully arrived, so a chunk that ends inside the
 * marker waits for more output instead of looping.
 */
export function takeBlock(buf) {
  const m = /(^|\n)--\r?\n/.exec(buf)
  if (!m) return { block: null, rest: buf }
  return { block: buf.slice(0, m.index), rest: buf.slice(m.index + m[0].length) }
}

/** Reads the argument list: options before `--`, the command after it. */
export function parseArgs(argv) {
  const sep = argv.indexOf('--')
  const opts = sep === -1 ? argv : argv.slice(0, sep)
  const command = sep === -1 ? [] : argv.slice(sep + 1)
  const get = (name) => {
    const i = opts.indexOf(name)
    return i === -1 ? undefined : opts[i + 1]
  }
  const interval = Number(get('--interval') ?? 2000)
  return { json: get('--json'), interval: Number.isFinite(interval) && interval >= 250 ? interval : 2000, command }
}

const PS_LOOP = (intervalMs) =>
  `while ($true) { Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId),$($_.ParentProcessId),$($_.WorkingSetSize)" }; "--"; Start-Sleep -Milliseconds ${intervalMs} }`

export function startSampler(rootPid, intervalMs, onPeak) {
  if (process.platform === 'win32') {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_LOOP(intervalMs)], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    let buf = ''
    ps.stdout.on('data', (d) => {
      buf += d.toString()
      for (;;) {
        const { block, rest } = takeBlock(buf)
        if (block === null) break
        onPeak(treeBytes(parseRows(block), rootPid))
        buf = rest
      }
    })
    return () => ps.kill()
  }
  const timer = setInterval(() => {
    const r = spawnSync('ps', ['-eo', 'pid=,ppid=,rss='], { encoding: 'utf8' })
    if (r.status === 0) onPeak(treeBytes(parseRows(r.stdout).map((x) => ({ ...x, bytes: x.bytes * 1024 })), rootPid))
  }, intervalMs)
  return () => clearInterval(timer)
}

async function main() {
  const { json, interval, command } = parseArgs(process.argv.slice(2))
  if (command.length === 0) {
    console.error('usage: node scripts/ci/measureRun.js [--json <file>] [--interval <ms>] -- <command> [args...]')
    process.exit(2)
  }
  const started = Date.now()
  // One command string through the shell (npx and npm are .cmd shims on Windows); quote args yourself.
  const child = spawn(command.join(' '), { stdio: 'inherit', shell: true })
  let peak = 0
  const stop = startSampler(child.pid, interval, (b) => {
    if (b > peak) peak = b
  })
  const code = await new Promise((resolve) => child.on('exit', (c, sig) => resolve(c ?? (sig ? 1 : 0))))
  stop()
  const result = { command: command.join(' '), exitCode: code, wallSeconds: Math.round((Date.now() - started) / 100) / 10, peakMB: Math.round(peak / 1048576) }
  console.log(`[measure] ${JSON.stringify(result)}`)
  if (json) writeFileSync(path.resolve(json), `${JSON.stringify(result, null, 2)}\n`)
  process.exit(code)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main()
