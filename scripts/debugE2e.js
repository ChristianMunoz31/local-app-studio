// `npm run debug:e2e -- <spec> [--project <name>] [-g <title>]`: runs ONE e2e spec headed, one worker, no retries, with a
// trace and a video, and APP_DEBUG=1 (the server logs stage timings and slow queries). Prints where the files are.
// Each spec starts its own sandboxed server (e2e/support/appServer.js), so this never touches real data.
// Needs `npm run build` first, like every e2e run.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { REPO_ROOT } from './checks/gitFiles.js'

export const USAGE = 'Usage: npm run debug:e2e -- <spec under e2e/, ending in .spec.js> [--project <name>] [-g <title>]'
const PLAYWRIGHT_BIN = 'node_modules/@playwright/test/cli.js'
const PROJECT_NAME = /^[a-z0-9-]+$/

/**
 * Plans the run. Never spawns.
 * @param {string[]} argv
 * @param {{ exists?: (relativePath: string) => boolean }} [seams]
 * @returns {{ argv: string[], env: Record<string, string>, spec: string } | { error: string }}
 */
export function planDebugE2e(argv, { exists = (p) => existsSync(path.join(REPO_ROOT, p)) } = {}) {
  const [specArg, ...rest] = argv
  if (!specArg || specArg.startsWith('-')) return { error: USAGE }
  const spec = specArg.replace(/\\/g, '/').replace(/^\.\//, '')
  if (spec.includes('..') || !spec.startsWith('e2e/') || !spec.endsWith('.spec.js')) return { error: `${USAGE}\n"${specArg}" is not a spec under e2e/.` }
  if (!exists(spec)) return { error: `${USAGE}\nThere is no file ${spec}.` }
  const extra = []
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i]
    const value = rest[i + 1]
    if (flag === '--project') {
      if (!value || !PROJECT_NAME.test(value)) return { error: `${USAGE}\n--project needs a project name such as flows.` }
      extra.push(`--project=${value}`)
      i += 1
    } else if (flag === '-g' || flag === '--grep') {
      if (!value || value.startsWith('-')) return { error: `${USAGE}\n-g needs a test title.` }
      extra.push('-g', value)
      i += 1
    } else return { error: `${USAGE}\nUnknown option ${flag}.` }
  }
  return {
    spec,
    argv: [PLAYWRIGHT_BIN, 'test', spec, '--headed', '--workers=1', '--retries=0', '--trace=on', ...extra],
    env: { APP_DEBUG: '1', PW_VIDEO: 'on' },
  }
}

export function main(argv = process.argv.slice(2), { run } = {}) {
  const plan = planDebugE2e(argv)
  if ('error' in plan) {
    console.error(plan.error)
    return 2
  }
  const exec = run ?? ((p) => spawnSync(process.execPath, p.argv, { cwd: REPO_ROOT, env: { ...process.env, ...p.env }, stdio: 'inherit', shell: false }).status ?? 1)
  const code = exec(plan)
  console.log('\nTrace, video and screenshots are in test-results/. Open a trace with: npx playwright show-trace <the trace.zip in that folder>')
  return code
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main()
}
