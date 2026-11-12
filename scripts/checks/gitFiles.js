// Shared git helpers for the repo checks. Uses spawnSync without a shell and fixed arguments.
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function git(args, cwd = REPO_ROOT) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (res.error || res.status !== 0) {
    throw new Error(`git ${args[0]} failed${res.stderr ? `: ${res.stderr.trim()}` : ''}`)
  }
  return res.stdout
}

const lines = (out) => out.split(/\r?\n/).filter(Boolean)

// The no-git walk mirrors the root .gitignore with a fixed list (no pattern parser): keep both in sync.
// Directory names skipped at any depth.
const SKIP_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  'test-results',
  'playwright-report',
  'blob-report',
  '.sidecar-build',
  '.dev-build',
  'logs',
  '.idea',
])
// Repo-relative directories skipped.
const SKIP_DIR_PATHS = new Set(['data', 'src-tauri/target', 'src-tauri/binaries', 'src-tauri/resources', 'src-tauri/gen'])
// Repo-relative files skipped.
// THIRD_PARTY_NOTICES.md is generated into the kit ZIP by package:kit; it holds third-party authors' emails and
// a buyer's first commit tracks it. Applied to the folder walk, the git file list and staged files alike.
const SKIP_FILE_PATHS = new Set(['src-tauri/tauri.dev.build.json', 'THIRD_PARTY_NOTICES.md'])
// Data and editor files the .gitignore keeps out (the .gitignore itself is the source of truth).
const SKIP_FILE_EXT = /\.(log|db|db-wal|db-shm|bak|csv|tsv|xlsx|suo|sln)$/i

function skipDir(name, relPath) {
  return SKIP_DIR_NAMES.has(name) || name.startsWith('dist-') || SKIP_DIR_PATHS.has(relPath)
}

function skipFile(name, relPath = name) {
  if (name === '.env.example') return false
  // .vscode/* is ignored except extensions.json
  if (relPath.startsWith('.vscode/') && relPath !== '.vscode/extensions.json') return true
  return (
    SKIP_FILE_PATHS.has(relPath) ||
    SKIP_FILE_EXT.test(name) ||
    name === 'secrets.key' ||
    name === 'nul' ||
    name === 'logs' ||
    name === '.env' ||
    name.startsWith('.env.') ||
    name === '.personal-denylist' ||
    name === '.DS_Store' ||
    name === 'settings.local.json' ||
    name === 'CLAUDE.local.md' ||
    name.endsWith('.local') ||
    name.endsWith('.private.pem') ||
    /^license-(clock|trial|activation)\.json$/.test(name)
  )
}

/** True for repo-relative paths the checks never scan, whatever the mode (generated or build-local files). */
export function isSkippedPath(relPath) {
  return SKIP_FILE_PATHS.has(relPath)
}

let noGitNoted = false

/** True when `root` is the top of a git work tree (false without git, or when nested in a foreign repo). */
export function isGitCheckout(root = REPO_ROOT) {
  const res = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' })
  if (res.error || res.status !== 0) return false
  try {
    return realpathSync.native(res.stdout.trim()).toLowerCase() === realpathSync.native(root).toLowerCase()
  } catch {
    return false
  }
}

/**
 * Filesystem walk used when there is no git checkout (a buyer's unzipped copy). Returns sorted
 * repo-relative, forward-slash paths, skipping what the root .gitignore keeps out of a checkout.
 */
export function walkFiles(root = REPO_ROOT) {
  const out = []
  const visit = (rel) => {
    let entries
    try {
      entries = readdirSync(path.join(root, rel), { withFileTypes: true })
    } catch (err) {
      console.error(`warning: skipped unreadable folder ${rel || '.'}: ${err instanceof Error ? err.message : String(err)}`)
      return
    }
    for (const entry of entries) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!skipDir(entry.name, relPath)) visit(relPath)
      } else if (entry.isFile() && !skipFile(entry.name, relPath)) {
        out.push(relPath)
      }
    }
  }
  visit('')
  return out.sort()
}

/** Repo-relative, forward-slash paths of every tracked file (a folder walk when there is no git checkout). */
export function listTrackedFiles(root = REPO_ROOT) {
  if (isGitCheckout(root)) return lines(git(['ls-files'], root)).filter((f) => !isSkippedPath(f))
  if (!noGitNoted) {
    noGitNoted = true
    console.error('note: git not found or not a git checkout, so the check scanned the folder instead of tracked files.')
  }
  return walkFiles(root)
}

/** Repo-relative paths added, copied or modified in the index. */
export function listStagedFiles(root = REPO_ROOT) {
  if (!isGitCheckout(root)) {
    console.error('--staged needs a git checkout (git not found or this folder is not a repository).')
    process.exit(1)
  }
  return lines(git(['diff', '--cached', '--name-only', '--diff-filter=ACM'], root)).filter((f) => !isSkippedPath(f))
}

/** Content of a file as staged in the index, or null if unreadable. */
export function readStaged(file) {
  try {
    return git(['show', `:${file}`])
  } catch {
    return null
  }
}

/** Working-tree content, or null if the file is missing. */
export function readWorking(file) {
  try {
    return readFileSync(path.join(REPO_ROOT, file), 'utf8')
  } catch {
    return null
  }
}
