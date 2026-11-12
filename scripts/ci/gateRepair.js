// `gate --repair` (DESIGN-phase15 section 2.7): runs `eslint --fix` on the changed code files and commits the result as
// `chore(gate): mechanical fixes`, but only when the diff is mechanical: no string or template literal changed, and every
// changed old line lies inside a line range that eslint reported with a fix. Anything else is restored and reported.
// There is no formatter in this repo (D-8), so eslint is the only tool. CI never repairs: it does not write to the branch.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from '../checks/gitFiles.js'

export const COMMIT_SUBJECT = 'chore(gate): mechanical fixes'
export const CI_REFUSAL = '--repair never runs in CI: CI does not write to the branch.'
const ESLINT_BIN = 'node_modules/eslint/bin/eslint.js'

/** Default command runner: argv array, no shell. */
export function defaultExec(cmd, args, cwd = REPO_ROOT) {
  const res = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: false })
  return { status: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
}

/** The string and template literal text of a source file, in order (what must not change in a mechanical fix). */
export function literalTokens(ts, file, source) {
  const jsx = /\.(tsx|jsx)$/.test(file)
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, jsx ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard, source)
  const out = []
  let depth = 0
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (kind === ts.SyntaxKind.StringLiteral || kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral) out.push(scanner.getTokenValue())
    else if (kind === ts.SyntaxKind.TemplateHead) {
      depth += 1
      out.push(scanner.getTokenValue())
    } else if (depth > 0 && kind === ts.SyntaxKind.CloseBraceToken) {
      const next = scanner.reScanTemplateToken(false)
      if (next === ts.SyntaxKind.TemplateTail) {
        depth -= 1
        out.push(scanner.getTokenValue())
      } else if (next === ts.SyntaxKind.TemplateMiddle) out.push(scanner.getTokenValue())
    }
  }
  return out
}

const sameTokens = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])

/** Line (1 based) of a character offset. */
function lineAt(source, offset) {
  let line = 1
  for (let i = 0; i < offset && i < source.length; i += 1) if (source[i] === '\n') line += 1
  return line
}

/**
 * From an `eslint --format json` result, the line ranges of messages that eslint can fix, and the rule ids.
 * @returns {Map<string, { ranges: [number, number][], rules: Set<string> }>} keyed by repo-relative path
 */
export function fixableRanges(results, sources, root) {
  const map = new Map()
  for (const r of results) {
    const rel = path.relative(root, r.filePath).split(path.sep).join('/')
    const entry = { ranges: [], rules: new Set() }
    const source = sources.get(rel) ?? ''
    for (const m of r.messages ?? []) {
      if (!m.fix) continue
      const a = lineAt(source, m.fix.range[0])
      const b = lineAt(source, m.fix.range[1])
      entry.ranges.push([Math.min(m.line ?? a, a), Math.max(m.endLine ?? m.line ?? b, b)])
      if (m.ruleId) entry.rules.add(m.ruleId)
    }
    map.set(rel, entry)
  }
  return map
}

/** The old line numbers touched by `git diff -U0` output. An insertion after line n counts as lines n and n + 1. */
export function changedOldLines(diff) {
  const lines = new Set()
  for (const m of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/gm)) {
    const start = Number(m[1])
    const count = m[2] === undefined ? 1 : Number(m[2])
    if (count === 0) {
      lines.add(start)
      lines.add(start + 1)
    } else for (let n = start; n < start + count; n += 1) lines.add(n)
  }
  return [...lines]
}

/**
 * Runs the repair. Every effect goes through `exec(cmd, args)`, so tests can run it in a temp repo with a fake eslint.
 * @param {{ root?: string, targets: string[], exec?: (cmd: string, args: string[]) => { status: number, stdout: string, stderr: string },
 *   env?: Record<string, string | undefined> }} o
 * @returns {Promise<{ committed: { sha: string, files: string[], rules: string[] } | null, refused: string[], skipped: string[], exitCode: number }>}
 */
export async function repair({ root = REPO_ROOT, targets, exec = (cmd, args) => defaultExec(cmd, args, root), env = process.env }) {
  const result = { committed: null, refused: [], skipped: [], exitCode: 0 }
  if (env.CI) return { ...result, exitCode: 2, refused: [CI_REFUSAL] }
  if (exec('git', ['diff', '--cached', '--quiet']).status !== 0) {
    result.skipped.push('Skipped repair: there are staged changes.')
    return result
  }
  const files = []
  for (const t of targets) {
    if (!existsSync(path.join(root, t))) continue
    if (exec('git', ['diff', '--quiet', 'HEAD', '--', t]).status !== 0) {
      result.skipped.push(`${t} has changes that are not committed, so it was not touched.`)
      continue
    }
    files.push(t)
  }
  if (files.length === 0) return result

  const before = new Map(files.map((f) => [f, readFileSync(path.join(root, f), 'utf8')]))
  let report
  try {
    report = JSON.parse(exec(process.execPath, [ESLINT_BIN, '--format', 'json', '--no-warn-ignored', '--', ...files]).stdout || '[]')
  } catch {
    report = []
  }
  const fixable = fixableRanges(report, before, root)
  if ([...fixable.values()].every((v) => v.ranges.length === 0)) return result

  exec(process.execPath, [ESLINT_BIN, '--fix', '--no-warn-ignored', '--', ...files])
  const changed = files.filter((f) => readFileSync(path.join(root, f), 'utf8') !== before.get(f))
  if (changed.length === 0) return result

  const ts = (await import('typescript')).default
  const restore = () => {
    for (const [f, text] of before) writeFileSync(path.join(root, f), text)
  }
  for (const f of changed) {
    const after = readFileSync(path.join(root, f), 'utf8')
    const ranges = fixable.get(f)?.ranges ?? []
    const literalsSame = sameTokens(literalTokens(ts, f, before.get(f)), literalTokens(ts, f, after))
    const diff = exec('git', ['diff', '-U0', 'HEAD', '--', f]).stdout
    const old = changedOldLines(diff)
    const inside = old.length > 0 && old.every((n) => ranges.some(([a, b]) => n >= a && n <= b))
    if (!literalsSame || !inside) {
      restore()
      result.refused.push(`Not repaired: ${f} changed more than mechanical fixes, so nothing was changed.`)
      return result
    }
  }

  const rules = [...new Set(changed.flatMap((f) => [...(fixable.get(f)?.rules ?? [])]))].sort()
  exec('git', ['add', '--', ...changed])
  const body = `${changed.length} files: ${changed.join(', ')}. Rules: ${rules.join(', ')}. Revert with: git revert <sha>`
  const commit = exec('git', ['commit', '-m', COMMIT_SUBJECT, '-m', body])
  if (commit.status !== 0) {
    exec('git', ['reset', '-q', '--', ...changed])
    restore()
    result.refused.push('Not repaired: the commit was refused (a hook failed), so nothing was changed.')
    return result
  }
  const sha = exec('git', ['rev-parse', 'HEAD']).stdout.trim()
  result.committed = { sha, files: changed, rules }
  return result
}
