// Pre-commit gate (run by .githooks/pre-commit): eslint on staged JS/JSX/TS/TSX, then the em dash and
// personal-data checks against the staged content. Usage: node scripts/checks/precommit.js
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { REPO_ROOT, listStagedFiles } from './gitFiles.js'

const ESLINT_BIN = path.join(REPO_ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js')

function run(script, args) {
  return spawnSync(process.execPath, [script, ...args], { cwd: REPO_ROOT, stdio: 'inherit' }).status ?? 1
}

function main() {
  const staged = listStagedFiles()
  let failed = false

  const lintable = staged.filter((f) => /\.(js|jsx|ts|tsx)$/.test(f) && existsSync(path.join(REPO_ROOT, f)))
  if (lintable.length) {
    if (existsSync(ESLINT_BIN)) {
      if (run(ESLINT_BIN, ['--no-warn-ignored', ...lintable]) !== 0) failed = true
    } else {
      console.warn('pre-commit: eslint is not installed (run npm ci); skipping lint. CI still lints.')
    }
  }

  const checks = ['noEmDash.js', 'personalData.js', 'noPrivateKeys.js']
  for (const name of checks) {
    if (run(path.join(REPO_ROOT, 'scripts', 'checks', name), ['--staged']) !== 0) failed = true
  }

  if (failed) console.error('\npre-commit blocked the commit. Fix the issues above and commit again.')
  return failed ? 1 : 0
}

process.exitCode = main()
