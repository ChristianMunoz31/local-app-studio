// Fails when the gzipped size of the built UI exceeds scripts/checks/bundle-budget.json.
// Run `npm run build` first. Prints a markdown table (also appended to $GITHUB_STEP_SUMMARY in CI).
// Usage: node scripts/checks/bundleBudget.js [--json <file>]
// --json writes `{ measured, limits, ok }` for the gate ledger; the exit code does not change.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import { REPO_ROOT } from './gitFiles.js'

const ASSETS_DIR = path.join(REPO_ROOT, 'dist', 'assets')
const BUDGET_FILE = path.join(REPO_ROOT, 'scripts', 'checks', 'bundle-budget.json')

const kb = (bytes) => Math.round((bytes / 1024) * 100) / 100

/**
 * Asset file names the browser needs before the app can start: the entry module script plus every
 * modulepreload link in `dist/index.html`. Lazy route chunks are not listed there.
 */
export function initialAssetNames(html) {
  const names = []
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
    const src = /\btype\s*=\s*["']module["']/i.test(tag) ? /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag) : null
    if (src) names.push(src[1])
  }
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const href = /\brel\s*=\s*["']modulepreload["']/i.test(tag) ? /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag) : null
    if (href) names.push(href[1])
  }
  return [...new Set(names.map((n) => path.posix.basename(n.split('?')[0])))].filter((n) => n.endsWith('.js'))
}

/**
 * Sums gzip sizes (KiB) from a list of `{ name, gzipBytes }` assets. Pass `initialNames` (from
 * initialAssetNames) to also get `initialJsGzipKb`, the gzip sum of the scripts needed at startup.
 */
export function summarize(assets, initialNames) {
  const js = assets.filter((a) => a.name.endsWith('.js'))
  const css = assets.filter((a) => a.name.endsWith('.css'))
  const total = (list) => list.reduce((sum, a) => sum + a.gzipBytes, 0)
  const summary = {
    totalJsGzipKb: kb(total(js)),
    largestJsGzipKb: kb(js.reduce((max, a) => Math.max(max, a.gzipBytes), 0)),
    totalCssGzipKb: kb(total(css)),
  }
  if (initialNames) summary.initialJsGzipKb = kb(total(js.filter((a) => initialNames.includes(a.name))))
  return summary
}

/**
 * Compares measured sizes with a budget. Returns `{ rows, ok }`. The three original keys are always
 * required; `initialJsGzipKb` is checked only when the budget file has it.
 */
export function evaluate(measured, budget) {
  const keys = ['totalJsGzipKb', 'largestJsGzipKb', 'totalCssGzipKb']
  if ('initialJsGzipKb' in budget) keys.push('initialJsGzipKb')
  const rows = keys.map((key) => ({
    key,
    measured: measured[key],
    budget: budget[key],
    ok: typeof budget[key] === 'number' && measured[key] <= budget[key],
  }))
  return { rows, ok: rows.every((r) => r.ok) }
}

export function toMarkdown(rows) {
  const lines = ['### Bundle size (gzip, KiB)', '', '| Metric | Measured | Budget | Status |', '| --- | ---: | ---: | --- |']
  for (const r of rows) lines.push(`| ${r.key} | ${r.measured} | ${r.budget} | ${r.ok ? 'ok' : 'OVER'} |`)
  return lines.join('\n')
}

export function readAssets(dir = ASSETS_DIR) {
  return readdirSync(dir)
    .filter((name) => /\.(js|css)$/.test(name))
    .map((name) => ({ name, gzipBytes: gzipSync(readFileSync(path.join(dir, name))).length }))
}

export function main(env = process.env, argv = []) {
  if (!existsSync(ASSETS_DIR)) {
    console.error('check:bundle needs a build. Run `npm run build` first.')
    return 1
  }
  const budget = JSON.parse(readFileSync(BUDGET_FILE, 'utf8'))
  const indexHtml = path.join(REPO_ROOT, 'dist', 'index.html')
  const initialNames = existsSync(indexHtml) ? initialAssetNames(readFileSync(indexHtml, 'utf8')) : undefined
  const measured = summarize(readAssets(), initialNames)
  const { rows, ok } = evaluate(measured, budget)
  const jsonAt = argv.indexOf('--json')
  if (jsonAt !== -1 && argv[jsonAt + 1]) {
    const out = path.resolve(argv[jsonAt + 1])
    mkdirSync(path.dirname(out), { recursive: true })
    writeFileSync(out, `${JSON.stringify({ measured, limits: budget, ok }, null, 2)}\n`)
  }
  const table = toMarkdown(rows)
  console.log(table)
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${table}\n`)
  if (!ok) {
    console.error('\ncheck:bundle failed: the bundle grew past its budget. Trim it, or raise scripts/checks/bundle-budget.json on purpose.')
    return 1
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.env, process.argv.slice(2))
}
