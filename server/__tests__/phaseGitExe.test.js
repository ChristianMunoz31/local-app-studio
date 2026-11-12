import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { gitExe } from '../../scripts/phase/lib/processTable.js'

// gitExe is used by scripts/ci/gate.js, which CI runs on Linux: it must find `git` there, and `git.exe` on Windows.
describe('gitExe', () => {
  const root = path.resolve('/repo')
  it('finds git (not git.exe) on an absolute PATH entry on Linux', () => {
    const bin = path.resolve('/usr/bin')
    const env = { PATH: [bin].join(path.delimiter) }
    const found = gitExe(env, (p) => p === path.join(bin, 'git'), root, 'linux')
    expect(found).toBe(path.join(bin, 'git'))
  })
  it('returns null on Linux when no absolute PATH entry holds git (no Windows fallback)', () => {
    expect(gitExe({ PATH: 'relative/bin' }, () => true, root, 'linux')).toBeNull()
  })
  it('looks for git.exe on Windows and skips PATH entries inside the repo root', () => {
    const inside = path.join(root, 'node_modules', '.bin')
    const outside = path.resolve('/tools/git/cmd')
    const env = { PATH: [inside, outside].join(path.delimiter), ProgramFiles: path.resolve('/nowhere') }
    const found = gitExe(env, (p) => p.endsWith('git.exe'), root, 'win32')
    expect(found).toBe(path.join(outside, 'git.exe'))
  })
})
