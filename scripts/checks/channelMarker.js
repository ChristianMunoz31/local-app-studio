// Fails when a build artifact is not of the channel the build meant to make. A stable release must never
// carry the dev channel, and a Local App Studio Dev build must be marked dev (docs/LICENSING.md, 'Test purchases and the Dev channel'; CONTRIBUTING.md
// "Dev channel"). Two kinds of target:
//   --bundle <file>    a sidecar bundle: its first line must be `/*! APP_CHANNEL=<expect> */`; a stable
//                      bundle must not contain the text `APP_CHANNEL=dev` anywhere
//   --binary <file>    a sidecar executable (SEA): every `/*! APP_CHANNEL=<x> */` marker found inside it must be
//                      <expect> and at least one must exist (the bundle is embedded verbatim); a stable
//                      executable must not contain the text `APP_CHANNEL=dev` anywhere
//   --dist-dir <dir>   a built UI folder: local-app-studio-build-info.json must carry channel <expect> (a missing
//                      `channel` means stable) and, for dev, a version like 0.2.0-dev.20261005.abc1234
// At least one target is required. Exit code 1 on any problem. Usage:
//   node scripts/checks/channelMarker.js --expect <stable|dev> [--bundle <file>]... [--binary <file>]... [--dist-dir <dir>]...
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BUILD_INFO_FILE } from '../../server/license/constants.js'
import { CHANNELS, DEV_VERSION_RE } from '../../server/channel.js'

const MARKER_PREFIX = '/*! APP_CHANNEL='
const DEV_TEXT = 'APP_CHANNEL=dev'
const MARKER_RE = /\/\*! APP_CHANNEL=([A-Za-z0-9_-]*) \*\//g

/**
 * @param {string} text bundle source
 * @param {'stable' | 'dev'} expect
 * @returns {string[]} problems, empty when the bundle is right
 */
export function checkBundleText(text, expect) {
  const problems = []
  const firstLine = String(text).split(/\r?\n/, 1)[0]
  const wanted = `${MARKER_PREFIX}${expect} */`
  if (firstLine !== wanted) {
    problems.push(`first line is not the channel marker ${wanted} (found: ${firstLine.slice(0, 60) || 'empty'})`)
  }
  if (expect === 'stable' && String(text).includes(DEV_TEXT)) {
    problems.push(`a stable bundle must not contain "${DEV_TEXT}"`)
  }
  return problems
}

/**
 * @param {Buffer} bytes a sidecar executable
 * @param {'stable' | 'dev'} expect
 * @returns {string[]} problems, empty when the executable carries only the expected channel marker
 */
export function checkBinaryChannel(bytes, expect) {
  const problems = []
  const text = bytes.toString('latin1')
  const found = [...text.matchAll(MARKER_RE)].map((m) => m[1])
  if (found.length === 0) problems.push('no channel marker found in the executable')
  const wrong = [...new Set(found.filter((channel) => channel !== expect))]
  if (wrong.length > 0) problems.push(`the executable carries channel "${wrong.join('", "')}", expected "${expect}"`)
  if (expect === 'stable' && text.includes(DEV_TEXT)) problems.push(`a stable executable must not contain "${DEV_TEXT}"`)
  return problems
}

/**
 * @param {unknown} info parsed local-app-studio-build-info.json
 * @param {'stable' | 'dev'} expect
 * @returns {string[]} problems, empty when the build info is right
 */
export function checkBuildInfo(info, expect) {
  if (info === null || typeof info !== 'object' || Array.isArray(info)) return ['build info is not an object']
  const problems = []
  const channel = info.channel ?? 'stable'
  if (channel !== expect) problems.push(`build info channel is "${String(channel)}", expected "${expect}"`)
  if (expect === 'dev' && !(typeof info.version === 'string' && DEV_VERSION_RE.test(info.version))) {
    problems.push(`build info version "${String(info.version)}" is not a dev version like 0.2.0-dev.20261005.abc1234`)
  }
  return problems
}

function parseArgs(argv) {
  const out = { expect: null, bundles: [], binaries: [], distDirs: [], error: null }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag !== '--expect' && flag !== '--bundle' && flag !== '--binary' && flag !== '--dist-dir') {
      out.error = `Unknown argument: ${flag}`
      return out
    }
    if (!value || value.startsWith('--')) {
      out.error = `${flag} needs a value`
      return out
    }
    i += 1
    if (flag === '--expect') out.expect = value
    else if (flag === '--bundle') out.bundles.push(value)
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
  if (!CHANNELS.includes(args.expect)) {
    error(`--expect must be one of ${CHANNELS.join(', ')}`)
    return 1
  }
  if (args.bundles.length === 0 && args.binaries.length === 0 && args.distDirs.length === 0) {
    error('Nothing to check: pass at least one --bundle <file>, --binary <file> or --dist-dir <dir>.')
    return 1
  }
  let failed = false
  const report = (target, problems) => {
    if (problems.length === 0) {
      log(`channel ok (${args.expect}): ${target}`)
      return
    }
    failed = true
    for (const problem of problems) error(`channel check failed: ${target}: ${problem}`)
  }
  for (const file of args.bundles) {
    try {
      report(file, checkBundleText(fs.readFileSync(file, 'utf8'), args.expect))
    } catch {
      report(file, ['the bundle could not be read'])
    }
  }
  for (const file of args.binaries) {
    try {
      report(file, checkBinaryChannel(fs.readFileSync(file), args.expect))
    } catch {
      report(file, ['the executable could not be read'])
    }
  }
  for (const dir of args.distDirs) {
    const file = path.join(dir, BUILD_INFO_FILE)
    try {
      report(file, checkBuildInfo(JSON.parse(fs.readFileSync(file, 'utf8')), args.expect))
    } catch {
      report(file, ['the build info file is missing or not valid JSON'])
    }
  }
  return failed ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main()
}
