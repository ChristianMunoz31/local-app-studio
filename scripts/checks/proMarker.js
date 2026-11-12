// Proves which half of the open-source seam (docs/ARCHITECTURE.md, 'The pro seam') a build artifact came from.
// Every pro twin ends with `export const PRO_MARKER = 'las-pro-marker:<seam>:v1'` plus a side effect that keeps the
// string in a bundle; a stub carries none. Two kinds of evidence, as in cloudMarker.js:
//   markers      las-pro-marker:<seam>:v1, one per twin that reaches the artifact
//   pro text     PRO_ONLY_STRINGS, fragments that only pro/ files contain (prompt sentences, installer steps, license
//                record messages). They survive minifying, and they catch pro code that lost its marker. The list is read from
//                pro/scripts/checks/proOnlyStrings.js, so it is empty in a public tree (the markers still fail a public build).
// Modes:
//   --require-absent    a public build: no marker and none of PRO_ONLY_STRINGS
//   --require-present   a pro build: every marker the artifact kind carries (EXPECTED_SEAMS)
//   --source            the tree: every seam has a stub and a twin, twins carry their marker, stubs do not, no
//                       tracked file outside pro/ holds a PRO_ONLY_STRINGS entry, and no tracked code file outside pro/ imports
//                       a path under pro/ except a test file (use with --require-present)
// Targets (as cloudMarker.js): --bundle <file>, --binary <file>, --dist-dir <dir>; with no target flag the usual build
// outputs that exist are checked, except under --source, which scans only the targets it is given.
// A bundle or binary is a studio or a runtime artifact: --kind studio|runtime, else .sidecar-build/bundle-meta.json
// (appMode) beside the file, else unknown (the markers both kinds carry are checked). Exit code 1 on any problem.
//   node scripts/checks/proMarker.js (--require-absent | --require-present) [--source] [--kind <studio|runtime>] [--bundle <file>]... [--binary <file>]... [--dist-dir <dir>]...
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { PRO_SEAMS, resolveProDir } from '../lib/proDir.js'
import { defaultTargets } from './cloudMarker.js'
import { REPO_ROOT, listTrackedFiles } from './gitFiles.js'

export const PRO_MARKER_PREFIX = 'las-pro-marker:'
export const markerOf = (seam) => `${PRO_MARKER_PREFIX}${seam}:v1`

/**
 * Fragments found in pro/ files and in no tracked file outside pro/ (--source proves it): prompt sentences, installer step and
 * error messages, license record messages and one fragment of every other pro code file that has no marker. They are the
 * secret sauce of the helper and the store adapters, so the list lives in pro/scripts/checks/proOnlyStrings.js and is loaded
 * here only when the pro folder resolves (scripts/lib/proDir.js; APP_PRO_DIR=none or no pro/ is a public build). In a public
 * tree this is an empty frozen array and the public build check still fails on any pro marker (every twin carries one).
 * @type {readonly string[]}
 */
export const PRO_ONLY_STRINGS = await loadProOnlyStrings()

async function loadProOnlyStrings() {
  const { dir } = resolveProDir()
  const file = dir && path.join(dir, 'scripts', 'checks', 'proOnlyStrings.js')
  if (!file || !fs.existsSync(file)) return Object.freeze([])
  const mod = await import(pathToFileURL(file).href)
  return Object.freeze([...mod.PRO_ONLY_STRINGS])
}

const WEB_SEAMS = Object.freeze(['src/proParts.js', 'src/components/settings/cloudUi.js'])
// A runtime sidecar keeps the licensing, pro.js, provider and flag twins; the Studio server seams (helper, installer) are swapped out.
const RUNTIME_SEAMS = Object.freeze(['server/license/index.js', 'server/pro.js', 'server/ai/providers/openaiCompat.js', 'src/proParts.js'])
const STUDIO_SEAMS = Object.freeze([...PRO_SEAMS.filter((s) => s.startsWith('server/')), 'src/proParts.js'])

/** The seams whose markers an artifact of each kind carries in a pro build (measured on real builds; proMarker.test.js pins the lists). */
export const EXPECTED_SEAMS = Object.freeze({ web: WEB_SEAMS, studio: STUDIO_SEAMS, runtime: RUNTIME_SEAMS })

const SCANNED_EXTENSIONS = new Set(['.js', '.css', '.html', '.json', '.map'])
const MAX_OFFENDERS = 5

/**
 * @param {string | Buffer} content a sidecar bundle (text) or executable (bytes, read as latin1)
 * @param {'present' | 'absent'} expect
 * @param {'studio' | 'runtime' | null} kind null checks the markers both kinds carry
 * @returns {string[]} problems, empty when the artifact is right
 */
export function checkServerArtifact(content, expect, kind = null) {
  const text = typeof content === 'string' ? content : content.toString('latin1')
  const problems = []
  if (expect === 'absent') {
    if (text.includes(PRO_MARKER_PREFIX)) problems.push(`contains a pro marker ("${PRO_MARKER_PREFIX}")`)
    for (const fragment of PRO_ONLY_STRINGS) if (text.includes(fragment)) problems.push(`contains pro-only text "${fragment}"`)
    return problems
  }
  const seams = kind === null ? RUNTIME_SEAMS : EXPECTED_SEAMS[kind]
  for (const seam of seams) if (!text.includes(markerOf(seam))) problems.push(`does not contain the pro marker "${markerOf(seam)}"`)
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
  const offenders = new Set()
  const found = new Set()
  try {
    for (const file of walk(dir)) {
      const text = fs.readFileSync(file, 'utf8')
      const rel = path.relative(dir, file).split(path.sep).join('/')
      if (text.includes(PRO_MARKER_PREFIX) || PRO_ONLY_STRINGS.some((f) => text.includes(f))) offenders.add(rel)
      for (const seam of WEB_SEAMS) if (text.includes(markerOf(seam))) found.add(seam)
    }
  } catch {
    return [`the folder ${dir} could not be read`]
  }
  if (expect === 'absent') {
    if (offenders.size === 0) return []
    const shown = [...offenders].slice(0, MAX_OFFENDERS)
    const more = offenders.size > MAX_OFFENDERS ? ` and ${offenders.size - MAX_OFFENDERS} more` : ''
    return [`contains pro markers or pro-only text in ${shown.join(', ')}${more}`]
  }
  return WEB_SEAMS.filter((s) => !found.has(s)).map((s) => `does not contain the pro marker "${markerOf(s)}" in any file`)
}

/**
 * The kind a bundle or binary was built as: the `bundle-meta.json` that sits beside it (.sidecar-build), else null.
 * @param {string} file
 * @returns {'studio' | 'runtime' | null}
 */
export function kindFromMeta(file) {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'bundle-meta.json'), 'utf8'))
    return meta?.appMode === 'studio' || meta?.appMode === 'runtime' ? meta.appMode : null
  } catch {
    return null
  }
}

const readText = (file) => fs.readFileSync(file, 'latin1')

const CODE_FILE = /\.(?:m?js|cjs|jsx|ts|tsx)$/
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"])(\.{1,2}\/[^'"\n]+)\1/g

/**
 * The one place a tracked file outside pro/ may import from pro/: a test (a path with a __tests__ folder, or a .test or .spec
 * name), which skips itself in a public build (server/__tests__/helpers/proBuild.js). Build and run code reaches a twin only
 * through the resolver (scripts/lib/proDir.js), never by a path, so a public checkout still builds and runs.
 * @param {string} rel repo-relative POSIX path
 * @returns {boolean}
 */
export const mayImportFromPro = (rel) => /(?:^|\/)__tests__\//.test(rel) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(rel)

/**
 * @param {string} rel repo-relative POSIX path of a file outside pro/
 * @param {string} text its content
 * @returns {string[]} the relative specifiers that resolve under pro/ (empty when the file may import from pro/)
 */
export function proSpecifiersIn(rel, text) {
  if (!CODE_FILE.test(rel) || mayImportFromPro(rel)) return []
  const out = []
  for (const m of text.matchAll(SPECIFIER)) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[2]))
    if (target === 'pro' || target.startsWith('pro/')) out.push(m[2])
  }
  return out
}

/**
 * The tree check behind `npm run check`.
 * @param {string} [root]
 * @returns {{ problems: string[], notes: string[] }}
 */
export function checkSource(root = REPO_ROOT) {
  const problems = []
  const notes = []
  const hasPro = fs.existsSync(path.join(root, 'pro', 'server'))
  if (!hasPro) notes.push('pro/ is not present, so the twins were not checked')
  for (const seam of PRO_SEAMS) {
    const stub = path.join(root, seam)
    if (!fs.existsSync(stub)) problems.push(`${seam}: the stub is missing`)
    else if (readText(stub).includes(PRO_MARKER_PREFIX)) problems.push(`${seam}: the stub carries a pro marker`)
    if (!hasPro) continue
    const twin = path.join(root, 'pro', seam)
    if (!fs.existsSync(twin)) {
      problems.push(`pro/${seam}: the twin is missing`)
      continue
    }
    const text = readText(twin)
    if (!text.includes(`export const PRO_MARKER = '${markerOf(seam)}'`)) problems.push(`pro/${seam}: the twin does not export PRO_MARKER = '${markerOf(seam)}'`)
    if (!/__LAS_PRO__\s*\?\?=\s*\[\]\)\.push\(PRO_MARKER\)/.test(text)) problems.push(`pro/${seam}: the twin does not push PRO_MARKER to globalThis.__LAS_PRO__ (a bundler could drop the string)`)
  }
  for (const rel of listTrackedFiles(root)) {
    if (rel.startsWith('pro/')) continue
    let text
    try {
      text = readText(path.join(root, rel))
    } catch {
      continue
    }
    for (const fragment of PRO_ONLY_STRINGS) if (text.includes(fragment)) problems.push(`${rel}: contains pro-only text "${fragment}" (it belongs under pro/)`)
    for (const spec of proSpecifiersIn(rel, text)) problems.push(`${rel}: imports "${spec}", which is under pro/ (only a test may; reach a twin through the resolver, scripts/lib/proDir.js)`)
  }
  return { problems, notes }
}

function parseArgs(argv) {
  const out = { expect: null, source: false, kind: null, bundles: [], binaries: [], distDirs: [], error: null }
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
    if (flag === '--source') {
      out.source = true
      continue
    }
    if (flag !== '--bundle' && flag !== '--binary' && flag !== '--dist-dir' && flag !== '--kind') {
      out.error = `Unknown argument: ${flag}`
      return out
    }
    const value = argv[i + 1]
    if (!value || value.startsWith('--')) {
      out.error = `${flag} needs a value`
      return out
    }
    i += 1
    if (flag === '--kind') {
      if (value !== 'studio' && value !== 'runtime') {
        out.error = '--kind must be studio or runtime'
        return out
      }
      out.kind = value
    } else if (flag === '--bundle') out.bundles.push(value)
    else if (flag === '--binary') out.binaries.push(value)
    else out.distDirs.push(value)
  }
  return out
}

/**
 * @param {string[]} [argv]
 * @param {{ log?: (m: string) => void, error?: (m: string) => void, root?: string }} [io]
 * @returns {number} exit code
 */
export function main(argv = process.argv.slice(2), { log = console.log, error = console.error, root = REPO_ROOT } = {}) {
  const args = parseArgs(argv)
  if (args.error) {
    error(args.error)
    return 1
  }
  if (args.expect === null) {
    error('Pass exactly one of --require-absent and --require-present.')
    return 1
  }
  if (args.source && args.expect === 'absent') {
    error('--source checks the tree, which has twins by design: use it with --require-present.')
    return 1
  }
  let { bundles, binaries, distDirs } = args
  const explicit = bundles.length > 0 || binaries.length > 0 || distDirs.length > 0
  if (!explicit && !args.source) ({ bundles, binaries, distDirs } = defaultTargets(root))
  const scanned = bundles.length > 0 || binaries.length > 0 || distDirs.length > 0
  if (!scanned && !args.source) {
    error('Nothing to check: build first, or pass --bundle <file>, --binary <file> or --dist-dir <dir>.')
    return 1
  }
  let failed = false
  const report = (target, problems, label = '') => {
    if (problems.length === 0) {
      log(`pro marker ${args.expect} ok: ${target}${label}`)
      return
    }
    failed = true
    for (const problem of problems) error(`pro marker check failed: ${target}: ${problem}`)
  }
  if (args.source) {
    const { problems, notes } = checkSource(root)
    for (const note of notes) log(`note: ${note}`)
    if (problems.length === 0) log(`pro marker source ok: ${PRO_SEAMS.length} seams, ${PRO_ONLY_STRINGS.length} pro-only strings`)
    else failed = true
    for (const problem of problems) error(`pro marker check failed: ${problem}`)
    if (!scanned) log('No build output was scanned (--source checks the tree; pass --bundle, --binary or --dist-dir to scan a build).')
  }
  for (const file of [...bundles, ...binaries]) {
    if (!fs.existsSync(file)) {
      report(file, ['the file does not exist (a requested target must exist; build first or fix the path)'])
      continue
    }
    const kind = args.kind ?? kindFromMeta(file)
    try {
      report(file, checkServerArtifact(fs.readFileSync(file), args.expect, kind), args.expect === 'absent' ? '' : kind ? ` (${kind})` : ' (kind unknown, markers both kinds carry)')
    } catch {
      report(file, ['the file could not be read'])
    }
  }
  for (const dir of distDirs) {
    if (!fs.existsSync(dir)) report(dir, ['the folder does not exist (a requested target must exist; build first or fix the path)'])
    else report(dir, checkDistDir(dir, args.expect), ' (web)')
  }
  return failed ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main()
}
