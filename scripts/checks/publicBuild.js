// `npm run check:public`: builds the public half of the open-source seam (APP_PRO_DIR=none, even when pro/ is
// present) and proves it holds no pro code (docs/ARCHITECTURE.md, 'The pro seam'):
//   1. vite build, then scripts/license/writeBuildInfo.js (the postbuild of npm run build) -> dist/
//   2. buildSidecar.js --minify --bundle-only       -> the studio bundle, copied aside
//   3. APP_MODE=runtime buildSidecar.js --minify --bundle-only (docs/BUDGETS.md, 'Runtime'; config/app-spec.json is
//      moved out of the way for the whole run, so the studio build stays studio, and put back at the end, even on failure)
//   4. proMarker.js --require-absent and cloudMarker.js --require-absent on dist/ and both bundles
// It leaves a public build in dist/ and .sidecar-build/ (run `npm run build` again for a pro build). Exit code 1 on any problem.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { PUBLIC_BUILD_ENV, REPO_ROOT } from '../lib/proDir.js'
import { main as cloudMain } from './cloudMarker.js'
import { main as proMain } from './proMarker.js'

const SPEC = path.join(REPO_ROOT, 'config', 'app-spec.json')
const BUNDLE = path.join(REPO_ROOT, '.sidecar-build', 'server.cjs')
const VITE = path.join(REPO_ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
const BUILD_INFO = path.join(REPO_ROOT, 'scripts', 'license', 'writeBuildInfo.js')
const SIDECAR = path.join(REPO_ROOT, 'scripts', 'desktop', 'buildSidecar.js')

function run(label, args, extraEnv = {}) {
  console.log(`\n== ${label}`)
  const res = spawnSync(process.execPath, args, { cwd: REPO_ROOT, stdio: 'inherit', env: { ...process.env, ...PUBLIC_BUILD_ENV, ...extraEnv } })
  if (res.status !== 0) throw new Error(`${label} failed (exit ${res.status ?? 'none'})`)
}

/** @returns {number} exit code */
export function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'las-public-build-'))
  const aside = path.join(tmp, 'app-spec.json')
  const hadSpec = fs.existsSync(SPEC)
  try {
    if (hadSpec) fs.renameSync(SPEC, aside)
    run('vite build (APP_PRO_DIR=none)', [VITE, 'build'])
    run('build info (the postbuild step of npm run build)', [BUILD_INFO])
    run('studio sidecar bundle', [SIDECAR, '--minify', '--bundle-only'], { APP_MODE: 'studio' })
    const studio = path.join(tmp, 'studio-server.cjs')
    fs.copyFileSync(BUNDLE, studio)
    run('runtime sidecar bundle', [SIDECAR, '--minify', '--bundle-only'], { APP_MODE: 'runtime' })
    const runtime = path.join(tmp, 'runtime-server.cjs')
    fs.copyFileSync(BUNDLE, runtime)
    const targets = ['--dist-dir', path.join(REPO_ROOT, 'dist'), '--bundle', studio, '--bundle', runtime]
    console.log('\n== public build checks')
    const codes = [proMain(['--require-absent', ...targets]), cloudMain(['--require-absent', ...targets])]
    return codes.some((c) => c !== 0) ? 1 : 0
  } catch (err) {
    console.error(`check:public failed: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  } finally {
    if (hadSpec && fs.existsSync(aside)) fs.renameSync(aside, SPEC)
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main()
}
