// Body of .githooks/pre-push: runs `npm run gate -- --quick` (affected checks against what the push adds) before a push.
// Skip once with `GATE_SKIP=1 git push`. Exit code is the gate's, so a failing gate stops the push.
// The hook passes `--repair`: the gate may commit mechanical eslint fixes as "chore(gate): mechanical fixes". A commit made
// during the hook is not part of the push in progress, so the hook then stops the push and asks for another one.
// Git writes one `<local ref> <local sha> <remote ref> <remote sha>` line per pushed ref to the hook's stdin. The remote sha
// is passed to the gate as `--base`, so unpushed commits are checked even when the push is from main. When the one pushed
// local sha is not the checked-out HEAD (`git push origin other-branch`), it is passed as `--head`, so the gate diffs what
// is pushed and not what happens to be checked out.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { REPO_ROOT } from '../checks/gitFiles.js'

export const SKIP_MESSAGE = 'pre-push: gate skipped (GATE_SKIP=1)'

const HEX40 = /^[0-9a-f]{40}$/
const ZERO = /^0{40}$/

/**
 * The remote sha to diff against, from the hook's stdin; null when there is none to trust (the gate then uses origin/main,
 * then main). Deleting a ref has nothing to check. A new branch (remote sha all zeros), a line git did not format as
 * expected, or several refs at different remote shas give null, because one base cannot cover them.
 * @param {string} stdin
 * @returns {string | null}
 */
export function remoteBaseFromStdin(stdin) {
  const shas = new Set()
  for (const line of stdin.split(/\r?\n/)) {
    if (!line.trim()) continue
    const [, localSha, , remoteSha] = line.trim().split(/\s+/)
    if (!HEX40.test(localSha ?? '') || !HEX40.test(remoteSha ?? '')) return null
    if (ZERO.test(localSha)) continue
    if (ZERO.test(remoteSha)) return null
    shas.add(remoteSha)
  }
  return shas.size === 1 ? [...shas][0] : null
}

/**
 * The local sha being pushed, from the hook's stdin; null when there is not exactly one (deletes are ignored, a malformed
 * line or several different local shas give null, and the gate then diffs HEAD).
 * @param {string} stdin
 * @returns {string | null}
 */
export function localHeadFromStdin(stdin) {
  const shas = new Set()
  for (const line of stdin.split(/\r?\n/)) {
    if (!line.trim()) continue
    const [, localSha, , remoteSha] = line.trim().split(/\s+/)
    if (!HEX40.test(localSha ?? '') || !HEX40.test(remoteSha ?? '')) return null
    if (ZERO.test(localSha)) continue
    shas.add(localSha)
  }
  return shas.size === 1 ? [...shas][0] : null
}

/**
 * What the hook does for an environment. Only the exact value `1` skips, so `GATE_SKIP=0` or an empty
 * value never disables the gate by accident.
 * @param {Record<string, string | undefined>} env
 * @param {string} [stdin] what git wrote to the hook's stdin
 * @param {string | null} [currentHead] the checked-out commit; a pushed sha that differs is passed as `--head`
 * @returns {{ skip: true, message: string } | { command: string[] }}
 */
export function prePushPlan(env, stdin = '', currentHead = null) {
  if (env.GATE_SKIP === '1') return { skip: true, message: SKIP_MESSAGE }
  const base = remoteBaseFromStdin(stdin)
  const pushed = localHeadFromStdin(stdin)
  const head = pushed && pushed !== currentHead ? pushed : null
  // --repair fixes and commits the checked-out branch, so it is left out when the pushed commit is another one.
  return { command: [process.execPath, 'scripts/ci/gate.js', '--quick', ...(head ? [] : ['--repair']), ...(base ? ['--base', base] : []), ...(head ? ['--head', head] : [])] }
}

/** The checked-out commit, or null when git cannot say. */
function currentHeadSha() {
  const res = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' })
  const sha = res.status === 0 ? res.stdout.trim() : ''
  return HEX40.test(sha) ? sha : null
}

/** All of stdin, or '' when there is none (a terminal, a closed pipe). */
function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

export function main(env = process.env, stdin = env.GATE_SKIP === '1' ? '' : readStdin()) {
  const plan = prePushPlan(env, stdin, env.GATE_SKIP === '1' ? null : currentHeadSha())
  if ('skip' in plan) {
    console.log(plan.message)
    return 0
  }
  const [bin, ...args] = plan.command
  const before = currentHeadSha()
  const res = spawnSync(bin, args, { cwd: REPO_ROOT, stdio: 'inherit', shell: false, env })
  const after = currentHeadSha()
  if (res.status === 0 && before && after && before !== after) {
    console.error(`pre-push: the gate made a commit with mechanical fixes (${after.slice(0, 7)}). Push again to include it.`)
    return 1
  }
  if (res.status !== 0) console.error('pre-push: the quick gate failed, so nothing was pushed. Fix it, or skip once with GATE_SKIP=1 git push.')
  return res.status ?? 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main()
}
