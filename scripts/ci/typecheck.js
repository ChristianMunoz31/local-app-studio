// Type check for CI and the local gate: `tsc --noEmit`, failing on any error outside src/vendor/.
// src/vendor/ is the vendored ui-builder, kept in the repo but unused; its errors are counted and printed,
// never fatal. The pure functions are exported for the unit test.
// Usage: node scripts/ci/typecheck.js
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { REPO_ROOT } from '../checks/gitFiles.js'

export const VENDOR_PREFIX = 'src/vendor/'

// `error TS18003: No inputs were found`: a global error (config, options, missing file) with no location.
const GLOBAL_ERROR_LINE = /^error (TS\d+): (.*)$/

// `src/a.ts(12,5): error TS2322: message` (tsc --pretty false). Continuation lines are indented.
const ERROR_LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/

/**
 * Reads the errors out of tsc output. Paths are normalized to repo-relative forward slashes.
 * @param {string} text
 * A location-free error is returned with `file: ''`, which never counts as vendored.
 * @returns {{ file: string, line: number, col: number, code: string, message: string }[]}
 */
export function parseTscOutput(text) {
  const errors = []
  for (const raw of text.split(/\r?\n/)) {
    const g = GLOBAL_ERROR_LINE.exec(raw)
    if (g) {
      errors.push({ file: '', line: 0, col: 0, code: g[1], message: g[2] })
      continue
    }
    const m = ERROR_LINE.exec(raw)
    if (!m) continue
    const file = m[1].replaceAll('\\', '/').replace(/^\.\//, '')
    errors.push({ file, line: Number(m[2]), col: Number(m[3]), code: m[4], message: m[5] })
  }
  return errors
}

/** Splits errors into those that fail the check and those in the vendored folder. */
export function partitionErrors(errors) {
  const vendor = errors.filter((e) => e.file.startsWith(VENDOR_PREFIX))
  const blocking = errors.filter((e) => !e.file.startsWith(VENDOR_PREFIX))
  return { blocking, vendor }
}

/**
 * Exit code for a finished tsc run. A spawn failure (`error`, `signal`, null status) always fails. Otherwise a
 * non-zero exit fails unless tsc printed at least one error and every one is under src/vendor/ (a location-free
 * `error TS` line is blocking), so an unreadable or partial result is never a pass.
 */
export function verdict({ status, output, error = null, signal = null }) {
  const { blocking, vendor } = partitionErrors(parseTscOutput(output))
  if (error || signal || status === null || status === undefined) return { code: 1, blocking, vendor }
  if (blocking.length > 0) return { code: 1, blocking, vendor }
  if (status !== 0 && vendor.length === 0) return { code: status, blocking, vendor }
  return { code: 0, blocking, vendor }
}

export function main() {
  const tsc = path.join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
  const res = spawnSync(process.execPath, [tsc, '--noEmit', '--pretty', 'false'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
  })
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`
  const result = verdict({ status: res.status, output, error: res.error, signal: res.signal })
  for (const e of result.blocking) console.error(`${e.file}(${e.line},${e.col}): error ${e.code}: ${e.message}`)
  if (res.error) console.error(`tsc could not run: ${res.error.message}`)
  if (res.signal) console.error(`tsc was stopped by ${res.signal}`)
  if (result.code !== 0 && result.blocking.length === 0) console.error(output.trim() || 'tsc failed without output')
  console.log(`typecheck: ${result.blocking.length} error(s) outside ${VENDOR_PREFIX}, ${result.vendor.length} inside (not counted)`)
  return result.code
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main()
}
