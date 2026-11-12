// Fails when a build artifact does not match the cloud AI mode the build meant to make. A cloud-off
// build (APP_CLOUD_AI=off) must carry no cloud provider; a default build must carry it (docs/AI.md,
// 'Building without the cloud provider'). Two markers, one per half of the product:
//   server  CLOUD_PROVIDER_MARKER, a string in server/ai/providers/openaiCompat.js (kept by --minify)
//           plus the OpenAI-compatible wire path, which only the real transport contains
//   UI      CLOUD_UI_MARKER, an attribute value in src/components/settings/CloudAiBlock.jsx
// Targets:
//   --bundle <file>    a sidecar bundle
//   --binary <file>    a sidecar executable (the bundle is embedded verbatim)
//   --dist-dir <dir>   a built UI folder (.js .css .html .json .map are scanned)
// With no target flag the usual build outputs that exist are checked: .sidecar-build/server.cjs, the SEA exe
// in .sidecar-build, every file in src-tauri/binaries (leftover binaries from earlier builds included),
// dist/ and src-tauri/resources/dist. Exit code 1 on any problem. Usage:
//   node scripts/checks/cloudMarker.js (--require-absent | --require-present) [--bundle <file>]... [--binary <file>]... [--dist-dir <dir>]...
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { sidecarBaseName } from '../lib/sidecarName.js'
import { REPO_ROOT } from './gitFiles.js'

export const CLOUD_PROVIDER_MARKER = 'cloud-provider-marker:openai-compat:v1'
export const CLOUD_UI_MARKER = 'cloud-ui-marker:v1'
/** The wire path of the OpenAI-compatible API. Written as a join so this file does not contain it. */
export const CLOUD_WIRE_TEXT = ['chat', 'completions'].join('/')

const SCANNED_EXTENSIONS = new Set(['.js', '.css', '.html', '.json', '.map'])
const MAX_OFFENDERS = 5

/**
 * @param {string | Buffer} content a sidecar bundle (text) or executable (bytes, read as latin1)
 * @param {'present' | 'absent'} expect
 * @returns {string[]} problems, empty when the artifact is right
 */
export function checkServerArtifact(content, expect) {
  const text = typeof content === 'string' ? content : content.toString('latin1')
  const problems = []
  if (expect === 'absent') {
    if (text.includes(CLOUD_PROVIDER_MARKER)) problems.push(`contains the cloud provider marker "${CLOUD_PROVIDER_MARKER}"`)
    if (text.includes(CLOUD_WIRE_TEXT)) problems.push(`contains the cloud wire path "${CLOUD_WIRE_TEXT}"`)
  } else if (!text.includes(CLOUD_PROVIDER_MARKER)) {
    problems.push(`does not contain the cloud provider marker "${CLOUD_PROVIDER_MARKER}"`)
  }
  return problems
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (SCANNED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) yield full
  }
}

/**
 * @param {string} dir a built UI folder
 * @param {'present' | 'absent'} expect
 * @returns {string[]} problems, empty when the folder is right
 */
export function checkDistDir(dir, expect) {
  const hits = []
  try {
    for (const file of walk(dir)) {
      if (fs.readFileSync(file, 'utf8').includes(CLOUD_UI_MARKER)) hits.push(file)
    }
  } catch {
    return [`the folder ${dir} could not be read`]
  }
  if (expect === 'absent') {
    if (hits.length === 0) return []
    const shown = hits.slice(0, MAX_OFFENDERS).map((f) => path.relative(dir, f).split(path.sep).join('/'))
    const more = hits.length > MAX_OFFENDERS ? ` and ${hits.length - MAX_OFFENDERS} more` : ''
    return [`contains the cloud UI marker "${CLOUD_UI_MARKER}" in ${shown.join(', ')}${more}`]
  }
  return hits.length > 0 ? [] : [`does not contain the cloud UI marker "${CLOUD_UI_MARKER}" in any file`]
}

/**
 * The build outputs that exist right now.
 * @param {string} [root]
 * @returns {{ bundles: string[], binaries: string[], distDirs: string[] }}
 */
export function defaultTargets(root = REPO_ROOT) {
  const out = { bundles: [], binaries: [], distDirs: [] }
  const sidecarDir = path.join(root, '.sidecar-build')
  const bundle = path.join(sidecarDir, 'server.cjs')
  if (fs.existsSync(bundle)) out.bundles.push(bundle)
  const base = sidecarBaseName(root)
  for (const name of [`${base}.exe`, base]) {
    const exe = path.join(sidecarDir, name)
    if (fs.existsSync(exe) && fs.statSync(exe).isFile()) out.binaries.push(exe)
  }
  const binDir = path.join(root, 'src-tauri', 'binaries')
  if (fs.existsSync(binDir)) {
    for (const entry of fs.readdirSync(binDir, { withFileTypes: true })) {
      if (entry.isFile()) out.binaries.push(path.join(binDir, entry.name))
    }
  }
  const dist = path.join(root, 'dist')
  if (fs.existsSync(dist)) out.distDirs.push(dist)
  const bundledDist = path.join(root, 'src-tauri', 'resources', 'dist')
  if (fs.existsSync(bundledDist)) out.distDirs.push(bundledDist)
  return out
}

function parseArgs(argv) {
  const out = { expect: null, bundles: [], binaries: [], distDirs: [], error: null }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === '--require-absent' || flag === '--require-present') {
      const expect = flag === '--require-absent' ? 'absent' : 'present'
      if (out.expect !== null && out.expect !== expect) {
        out.error = 'Pass exactly one of --require-absent and --require-present.'
        return out
      }
      out.expect = expect
      continue
    }
    if (flag !== '--bundle' && flag !== '--binary' && flag !== '--dist-dir') {
      out.error = `Unknown argument: ${flag}`
      return out
    }
    const value = argv[i + 1]
    if (!value || value.startsWith('--')) {
      out.error = `${flag} needs a value`
      return out
    }
    i += 1
    if (flag === '--bundle') out.bundles.push(value)
    else if (flag === '--binary') out.binaries.push(value)
    else out.distDirs.push(value)
  }
  return out
}

/**
 * @param {string[]} [argv]
 * @param {{ log?: (m: string) => void, error?: (m: string) => void }} [io]
 * @returns {number} exit code
 */
export function main(argv = process.argv.slice(2), { log = console.log, error = console.error } = {}) {
  const args = parseArgs(argv)
  if (args.error) {
    error(args.error)
    return 1
  }
  if (args.expect === null) {
    error('Pass exactly one of --require-absent and --require-present.')
    return 1
  }
  let { bundles, binaries, distDirs } = args
  if (bundles.length === 0 && binaries.length === 0 && distDirs.length === 0) {
    ;({ bundles, binaries, distDirs } = defaultTargets())
  }
  if (bundles.length === 0 && binaries.length === 0 && distDirs.length === 0) {
    error('Nothing to check: build first, or pass --bundle <file>, --binary <file> or --dist-dir <dir>.')
    return 1
  }
  let failed = false
  const report = (target, problems) => {
    if (problems.length === 0) {
      log(`cloud ${args.expect} ok: ${target}`)
      return
    }
    failed = true
    for (const problem of problems) error(`cloud marker check failed: ${target}: ${problem}`)
  }
  for (const file of [...bundles, ...binaries]) {
    if (!fs.existsSync(file)) {
      report(file, ['the file does not exist (a requested target must exist; build first or fix the path)'])
      continue
    }
    try {
      report(file, checkServerArtifact(fs.readFileSync(file), args.expect))
    } catch {
      report(file, ['the file could not be read'])
    }
  }
  for (const dir of distDirs) {
    if (!fs.existsSync(dir)) report(dir, ['the folder does not exist (a requested target must exist; build first or fix the path)'])
    else report(dir, checkDistDir(dir, args.expect))
  }
  return failed ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main()
}
