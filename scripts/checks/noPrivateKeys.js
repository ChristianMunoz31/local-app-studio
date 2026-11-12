// Fails when a tracked or staged text file looks like it holds a private key: a PEM private key block.
// The pattern is built from fragments so this file never matches itself.
// Findings print the file and line only, never the matched text.
// Usage: node scripts/checks/noPrivateKeys.js [--staged]
import { pathToFileURL } from 'node:url'
import { listStagedFiles, listTrackedFiles, readStaged, readWorking } from './gitFiles.js'

const SKIP_EXT = /\.(svg|png|jpe?g|gif|webp|ico|icns|woff2?|ttf|otf|eot|zip|gz|pdf|db|sqlite|bak|mp3|mp4|wasm)$/i

// Excluded by exact path: this file and its test, which spell the pattern out.
export const EXCLUDED_FILES = new Set([
  'scripts/checks/noPrivateKeys.js',
  'server/__tests__/license/noPrivateKeys.test.js',
])

export const PATTERNS = Object.freeze([
  { kind: 'pem-private-key', re: new RegExp(`-----BEGIN (?:[A-Z0-9]+ )*PRIVATE` + ` KEY-----`) },
])

/**
 * @param {string} text
 * @returns {{ line: number, kind: string }[]}
 */
export function scanText(text) {
  const found = []
  for (const { kind, re } of PATTERNS) {
    const m = re.exec(text)
    if (m) found.push({ line: text.slice(0, m.index).split('\n').length, kind })
  }
  return found
}

export function isCheckedFile(file) {
  return !EXCLUDED_FILES.has(file) && !SKIP_EXT.test(file)
}

export function main(argv = process.argv.slice(2)) {
  const staged = argv.includes('--staged')
  const files = (staged ? listStagedFiles() : listTrackedFiles()).filter(isCheckedFile)
  let failures = 0
  for (const file of files) {
    const text = staged ? readStaged(file) : readWorking(file)
    if (text === null) continue
    for (const f of scanText(text)) {
      failures += 1
      console.error(`${file}:${f.line} looks like a private key (${f.kind})`)
    }
  }
  if (failures) {
    console.error(`\ncheck:keys failed: ${failures} possible private key(s). Remove them and rotate the key if it was real.`)
    return 1
  }
  console.log(`check:keys ok (${files.length} files)`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main()
}
