// Fails when a tracked text file the repo owns contains an em dash (U+2014) or en dash (U+2013). In
// every file the literal characters are found anywhere, comments included (the rule is no dashes anywhere), so
// a comment scanner confused by `http://` or a regex can never hide one. In JS/TS source, entities and escapes
// are looked for outside comments only. Usage: node scripts/checks/noEmDash.js [--staged]
import { pathToFileURL } from 'node:url'
import { listStagedFiles, listTrackedFiles, readStaged, readWorking } from './gitFiles.js'

const LITERAL_PATTERNS = [/\u2014/g, /\u2013/g]
const EM_DASH_PATTERNS = [
  /&mdash;/gi,
  /&#0*8212;/g,
  /&#x0*2014;/gi,
  /\\u2014/gi,
  /\\u\{0*2014\}/gi,
  /&ndash;/gi,
  /&#0*8211;/g,
  /&#x0*2013;/gi,
  /\\u2013/gi,
  /\\u\{0*2013\}/gi,
]

/** Replaces comment text with spaces (newlines kept) so offsets and line numbers stay stable. */
export function stripComments(text) {
  const out = text.split('')
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' '
  }
  // Template literal state: each entry is the brace depth at which a `${` interpolation opened.
  const templateStack = []
  let braceDepth = 0
  let i = 0
  const n = text.length
  const scanTemplateBody = () => {
    // Positioned just after a backtick or the closing brace of an interpolation.
    while (i < n) {
      const c = text[i]
      if (c === '\\') i += 2
      else if (c === '`') {
        i += 1
        return
      } else if (c === '$' && text[i + 1] === '{') {
        templateStack.push(braceDepth)
        braceDepth += 1
        i += 2
        return
      } else i += 1
    }
  }
  while (i < n) {
    const c = text[i]
    const next = text[i + 1]
    if (c === '/' && next === '/') {
      let end = text.indexOf('\n', i)
      if (end === -1) end = n
      blank(i, end)
      i = end
    } else if (c === '/' && next === '*') {
      let end = text.indexOf('*/', i + 2)
      end = end === -1 ? n : end + 2
      blank(i, end)
      i = end
    } else if (c === '"' || c === "'") {
      // JSX text can hold a lone apostrophe, so a quoted string never runs past the end of the line.
      let j = i + 1
      while (j < n && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1
      i = j + 1
    } else if (c === '`') {
      i += 1
      scanTemplateBody()
    } else if (c === '{') {
      braceDepth += 1
      i += 1
    } else if (c === '}') {
      braceDepth -= 1
      i += 1
      if (templateStack.length && templateStack[templateStack.length - 1] === braceDepth) {
        templateStack.pop()
        scanTemplateBody()
      }
    } else i += 1
  }
  return out.join('')
}

/**
 * Returns `[{ line, col, match }]` for every dash. The literal characters are matched in the raw text, comments
 * included; entities and escapes in the text with comments blanked (when `stripCode`). 1-based.
 */
export function scanText(text, { stripCode = true } = {}) {
  const stripped = stripCode ? stripComments(text) : text
  const found = []
  const collect = (source, patterns) => {
    for (const re of patterns) {
      for (const m of source.matchAll(re)) {
        const before = source.slice(0, m.index)
        const line = before.split('\n').length
        const col = m.index - before.lastIndexOf('\n')
        found.push({ line, col, match: m[0] })
      }
    }
  }
  collect(text, LITERAL_PATTERNS)
  collect(stripped, EM_DASH_PATTERNS)
  return found.sort((a, b) => a.line - b.line || a.col - b.col)
}

const CODE_EXT = /\.(js|jsx|ts|tsx|mjs|cjs)$/i
const TEXT_EXT = /\.(json|md|ya?ml|css|html|sql|sh|toml|rs|nsh)$/i
// Verbatim third-party content, lock files, and this check's own source and tests (they spell the characters out).
const EXCLUDED = [
  /^src\/vendor\//,
  /(^|\/)package-lock\.json$/,
  /(^|\/)(LICENSE|NOTICE)[^/]*$/i,
  /(^|\/)THIRD_PARTY_NOTICES\.md$/,
  /^scripts\/checks\/noEmDash\.js$/,
  /^server\/__tests__\/noEmDashScope\.test\.js$/,
  /^server\/__tests__\/checksScripts\.test\.js$/,
]

export function isCheckedFile(file) {
  if (EXCLUDED.some((re) => re.test(file))) return false
  return CODE_EXT.test(file) || TEXT_EXT.test(file)
}

const TEST_FILE = /(^|\/)__tests__\/|\.(test|spec)\.[a-z]+$/i

/**
 * Scans one file's text. Tests (and Rust `#[cfg(test)]` modules) may spell the characters as escapes
 * (`\u2014`) to assert the rule; a literal dash or an entity is still reported there.
 */
export function scanFile(file, text) {
  const found = scanText(text, { stripCode: CODE_EXT.test(file) })
  const isEscape = (f) => f.match.startsWith('\\')
  if (TEST_FILE.test(file)) return found.filter((f) => !isEscape(f))
  if (/\.rs$/i.test(file)) {
    const at = text.indexOf('#[cfg(test)]')
    if (at === -1) return found
    const testLine = text.slice(0, at).split('\n').length
    return found.filter((f) => !(isEscape(f) && f.line >= testLine))
  }
  return found
}

export function main(argv = process.argv.slice(2)) {
  const staged = argv.includes('--staged')
  const files = (staged ? listStagedFiles() : listTrackedFiles()).filter(isCheckedFile)
  let failures = 0
  for (const file of files) {
    const text = staged ? readStaged(file) : readWorking(file)
    if (text === null || text.includes('\0')) continue
    for (const f of scanFile(file, text)) {
      failures += 1
      console.error(`${file}:${f.line}:${f.col} em or en dash`)
    }
  }
  if (failures) {
    console.error(`\ncheck:em-dash failed: ${failures} dash(es). Use a comma, colon, period or hyphen instead.`)
    return 1
  }
  console.log(`check:em-dash ok (${files.length} files)`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main()
}
