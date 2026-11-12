// Fails when the sidecar grew past scripts/checks/sidecar-budget.json: the minified server bundle (raw
// and gzipped) and, when it was built after the bundle and the budget names this platform and CPU
// ("win32-arm64"), the SEA executable.
// The bundle limits are per app mode (ADR-001): the studio sidecar carries the Studio server code and the runtime server
// (the preview child runs it), a runtime sidecar only the runtime server. The mode is --mode studio|runtime, else the mode the build
// resolves (APP_MODE, else runtime when config/app-spec.json exists, else studio). buildSidecar.js records the mode it baked in .sidecar-build/bundle-meta.json, and the check fails when that
// differs from the requested mode (a runtime bundle measured against the studio limits would pass by luck).
// Run `node scripts/desktop/buildSidecar.js --minify --bundle-only` first (APP_MODE=runtime for the runtime sidecar; cloud AI on).
// Prints a markdown table (also appended to $GITHUB_STEP_SUMMARY in CI).
// Usage: node scripts/checks/sidecarBudget.js [--mode studio|runtime] [--json <file>]
// A per-module table (raw bytes in the output, apportioned gzip, top 30) follows, from .sidecar-build/metafile.json that buildSidecar.js writes next to the bundle.
// --json writes `{ mode, measured, limits, ok }` for the gate ledger; the exit code does not change.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import { APP_MODES, resolveAppMode } from '../../server/appMode.js'
import { findStraySidecars, sidecarExeName } from '../lib/sidecarName.js'
import { REPO_ROOT } from './gitFiles.js'

const OUT_DIR = path.join(REPO_ROOT, '.sidecar-build')
const BUNDLE_FILE = path.join(OUT_DIR, 'server.cjs')
const EXE_FILE = path.join(OUT_DIR, sidecarExeName({ root: REPO_ROOT }))
const BUDGET_FILE = path.join(REPO_ROOT, 'scripts', 'checks', 'sidecar-budget.json')

const kb = (bytes) => Math.round((bytes / 1024) * 100) / 100

/**
 * Sizes in KiB (two decimals).
 * @param {{ bundle: string | Buffer, exe?: number }} files `bundle` is the bundle content, `exe` the executable size in bytes
 * @returns {{ bundleKb: number, bundleGzipKb: number, exeKb?: number }}
 */
export function measure({ bundle, exe }) {
  const bytes = typeof bundle === 'string' ? Buffer.from(bundle) : bundle
  const out = { bundleKb: kb(bytes.length), bundleGzipKb: kb(gzipSync(bytes).length) }
  if (typeof exe === 'number') out.exeKb = kb(exe)
  return out
}

/**
 * The app mode to check: `--mode studio|runtime` (or `--mode=runtime`), else the mode buildSidecar.js resolves (APP_MODE,
 * else runtime when config/app-spec.json exists under `root`, else studio).
 * @param {string[]} [argv] arguments after the script name
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [root] repo root that may hold config/app-spec.json
 * @returns {'studio' | 'runtime'}
 * @throws {Error} when the value is not an app mode
 */
export function resolveCheckMode(argv = [], env = process.env, root = REPO_ROOT) {
  let raw
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--mode') raw = argv[i + 1] ?? ''
    else if (argv[i].startsWith('--mode=')) raw = argv[i].slice('--mode='.length)
  }
  if (raw !== undefined) {
    if (!APP_MODES.includes(raw)) throw new Error(`--mode must be one of ${APP_MODES.join(', ')} (got "${raw}")`)
    return raw
  }
  return resolveAppMode(env, { root })
}

/**
 * Compares measured sizes with the budget of one app mode. The exe row exists only when it was measured and the budget
 * has a number for this platform and CPU (`exeKb` is shared by both modes). Returns `{ rows, ok }`.
 * @param {{ bundleKb: number, bundleGzipKb: number, exeKb?: number }} measured
 * @param {{ studio: { bundleKb: number, bundleGzipKb: number }, runtime: { bundleKb: number, bundleGzipKb: number }, exeKb?: Record<string, number> }} budget
 * @param {string} [platform] key into `exeKb`, `${process.platform}-${process.arch}` by default
 * @param {'studio' | 'runtime'} [mode]
 */
export function evaluate(measured, budget, platform = `${process.platform}-${process.arch}`, mode = 'studio') {
  const limits = budget[mode] ?? {}
  const pairs = [
    ['bundleKb', measured.bundleKb, limits.bundleKb],
    ['bundleGzipKb', measured.bundleGzipKb, limits.bundleGzipKb],
  ]
  const exeBudget = budget.exeKb?.[platform]
  if (typeof measured.exeKb === 'number' && typeof exeBudget === 'number') pairs.push(['exeKb', measured.exeKb, exeBudget])
  const rows = pairs.map(([key, value, limit]) => ({ key, measured: value, budget: limit, ok: typeof limit === 'number' && value <= limit }))
  return { rows, ok: rows.every((r) => r.ok) }
}

/**
 * The modules that cost the most in the bundle, from an esbuild metafile: raw bytes each input file contributes to the
 * output (`bytesInOutput`) and its gzip share. The metafile has no per-file gzip, so the share is the bundle's own gzip size
 * apportioned by raw bytes (the column adds up to the bundle gzip size). Rows are sorted by raw bytes, largest first.
 * @param {{ outputs?: Record<string, { bytes: number, inputs: Record<string, { bytesInOutput: number }> }> }} metafile
 * @param {{ gzipBytes: number, top?: number }} options `gzipBytes` is the gzip size of the bundle; `top` the row count (30 by default)
 * @returns {{ rows: { file: string, rawBytes: number, gzipBytes: number }[], totalRawBytes: number, totalGzipBytes: number, otherRawBytes: number, otherGzipBytes: number }}
 */
export function moduleTable(metafile, { gzipBytes, top = 30 }) {
  const byFile = new Map()
  for (const output of Object.values(metafile?.outputs ?? {})) {
    for (const [file, info] of Object.entries(output.inputs ?? {})) {
      if (info.bytesInOutput > 0) byFile.set(file, (byFile.get(file) ?? 0) + info.bytesInOutput)
    }
  }
  const totalRawBytes = [...byFile.values()].reduce((sum, n) => sum + n, 0)
  const share = (raw) => (totalRawBytes === 0 ? 0 : (gzipBytes * raw) / totalRawBytes)
  const sorted = [...byFile.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const rows = sorted.slice(0, Math.max(0, top)).map(([file, rawBytes]) => ({ file, rawBytes, gzipBytes: share(rawBytes) }))
  const otherRawBytes = totalRawBytes - rows.reduce((sum, r) => sum + r.rawBytes, 0)
  return { rows, totalRawBytes, totalGzipBytes: gzipBytes, otherRawBytes, otherGzipBytes: share(otherRawBytes) }
}

/**
 * Markdown for a `moduleTable` result: one row per module (KiB, two decimals), a row for the rest and the totals.
 * @param {ReturnType<typeof moduleTable>} table
 */
export function moduleTableToMarkdown(table) {
  const lines = [`### Top ${table.rows.length} modules by raw bytes in the bundle (KiB; gzip is apportioned by raw share)`, '', '| Module | Raw | Gzip |', '| --- | ---: | ---: |']
  for (const r of table.rows) lines.push(`| ${r.file} | ${kb(r.rawBytes)} | ${kb(r.gzipBytes)} |`)
  lines.push(`| (all other inputs) | ${kb(table.otherRawBytes)} | ${kb(table.otherGzipBytes)} |`)
  lines.push(`| total of inputs | ${kb(table.totalRawBytes)} | ${kb(table.totalGzipBytes)} |`)
  return lines.join('\n')
}

export function toMarkdown(rows) {
  const lines = ['### Sidecar size (KiB)', '', '| Metric | Measured | Budget | Status |', '| --- | ---: | ---: | --- |']
  for (const r of rows) lines.push(`| ${r.key} | ${r.measured} | ${r.budget} | ${r.ok ? 'ok' : 'OVER'} |`)
  return lines.join('\n')
}

/**
 * The app mode buildSidecar.js recorded for the bundle, or null when there is no (readable) record.
 * @param {string} metaFile
 * @returns {string | null}
 */
function recordedMode(metaFile) {
  try {
    const mode = JSON.parse(readFileSync(metaFile, 'utf8'))?.appMode
    return typeof mode === 'string' ? mode : null
  } catch {
    return null
  }
}

export function main(env = process.env, { bundleFile = BUNDLE_FILE, exeFile = EXE_FILE, metaFile = path.join(path.dirname(bundleFile), 'bundle-meta.json'), argv = [] } = {}) {
  let mode
  try {
    mode = resolveCheckMode(argv, env)
  } catch (error) {
    console.error(`check:sidecar: ${error.message}`)
    return 1
  }
  if (!existsSync(bundleFile)) {
    console.error('check:sidecar needs a bundle. Run node scripts/desktop/buildSidecar.js --minify --bundle-only first.')
    return 1
  }
  const built = recordedMode(metaFile)
  if (built !== null && built !== mode) {
    console.error(`check:sidecar: the bundle was built in ${built} mode but ${mode} was requested. Rebuild it (APP_MODE=${mode} node scripts/desktop/buildSidecar.js --minify --bundle-only) or pass --mode ${built}.`)
    return 1
  }
  const strays = findStraySidecars(path.dirname(exeFile), path.basename(exeFile))
  if (!existsSync(exeFile) && strays.length > 0) {
    console.error(`check:sidecar expected ${path.basename(exeFile)} (package.json name + "-server") but found ${strays.join(', ')}. Rebuild the sidecar or fix package.json "name".`)
    return 1
  }
  const budget = JSON.parse(readFileSync(BUDGET_FILE, 'utf8'))
  const hasExe = existsSync(exeFile)
  const stale = hasExe && statSync(exeFile).mtimeMs < statSync(bundleFile).mtimeMs
  const measured = measure({ bundle: readFileSync(bundleFile), exe: hasExe && !stale ? statSync(exeFile).size : undefined })
  const { rows, ok } = evaluate(measured, budget, undefined, mode)
  const table = toMarkdown(rows)
  const jsonAt = argv.indexOf('--json')
  if (jsonAt !== -1 && argv[jsonAt + 1]) {
    const out = path.resolve(argv[jsonAt + 1])
    mkdirSync(path.dirname(out), { recursive: true })
    writeFileSync(out, `${JSON.stringify({ mode, measured, limits: budget[mode] ?? {}, ok }, null, 2)}\n`)
  }
  console.log(`app mode: ${mode}`)
  console.log(table)
  const metafileFile = path.join(path.dirname(bundleFile), 'metafile.json')
  if (existsSync(metafileFile)) {
    try {
      const gzipBytes = gzipSync(readFileSync(bundleFile)).length
      console.log(`\n${moduleTableToMarkdown(moduleTable(JSON.parse(readFileSync(metafileFile, 'utf8')), { gzipBytes }))}\n`)
    } catch (error) {
      console.log(`module table: metafile.json could not be read (${error.message})`)
    }
  }
  if (built === null) console.log('note: no bundle-meta.json next to the bundle, so its app mode could not be checked against the requested one')
  if (stale) console.log('exe: older than the bundle, skipped (rebuild without --bundle-only to measure it)')
  else if (!rows.some((r) => r.key === 'exeKb')) console.log(`exe: not built or no budget for ${process.platform}-${process.arch}, skipped`)
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${table}\n`)
  if (!ok) {
    console.error('\ncheck:sidecar failed: the sidecar grew past its budget. Trim it, or raise scripts/checks/sidecar-budget.json on purpose.')
    return 1
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.env, { argv: process.argv.slice(2) })
}
