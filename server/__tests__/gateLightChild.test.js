// The shared gate files in a phase gate pair (docs/PIPELINE.md "Light steps"): the light child (GATE_LIGHT_CHILD=1) never writes
// .gate/flaky.json or .gate/ledger.jsonl, and the state file is written through a temp file of its own process with one EPERM retry.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appendEntry } from '../../scripts/ci/gateLedger.js'
import { emptyState, writeState } from '../../scripts/ci/gateState.js'

const dirs = []
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-light-child-'))
  dirs.push(d)
  return d
}
const eperm = () => Object.assign(new Error('busy'), { code: 'EPERM' })
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

describe('GATE_LIGHT_CHILD', () => {
  it('writeState writes nothing for the light child and writes for everyone else', () => {
    const file = path.join(tmp(), '.gate', 'flaky.json')
    writeState(emptyState(), file, { env: { GATE_LIGHT_CHILD: '1' } })
    expect(fs.existsSync(file)).toBe(false)
    expect(fs.existsSync(path.dirname(file))).toBe(false)
    writeState(emptyState(), file, { env: { GATE_LIGHT_CHILD: '0' } })
    expect(fs.existsSync(file)).toBe(true)
    fs.rmSync(file)
    writeState(emptyState(), file, { env: {} })
    expect(fs.existsSync(file)).toBe(true)
  })

  it('appendEntry appends nothing for the light child and appends for everyone else', () => {
    const file = path.join(tmp(), '.gate', 'ledger.jsonl')
    expect(appendEntry({ a: 1 }, file, { GATE_LIGHT_CHILD: '1' })).toBe(0)
    expect(fs.existsSync(file)).toBe(false)
    expect(appendEntry({ a: 1 }, file, {})).toBe(1)
    expect(appendEntry({ a: 2 }, file, { GATE_LIGHT_CHILD: '0' })).toBe(2)
    expect(fs.readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(2)
  })
})

describe('writeState temp file', () => {
  it('uses a temp file named for this process and leaves none behind', () => {
    const dir = tmp()
    const file = path.join(dir, 'flaky.json')
    const seen = []
    const rename = (from, to) => {
      seen.push(path.basename(from))
      fs.renameSync(from, to)
    }
    writeState(emptyState(), file, { env: {}, rename })
    expect(seen).toEqual([`flaky.json.${process.pid}.tmp`])
    expect(fs.readdirSync(dir)).toEqual(['flaky.json'])
  })

  it('retries one EPERM rename, and not a second one or another error', () => {
    const file = path.join(tmp(), 'flaky.json')
    let calls = 0
    const once = (from, to) => {
      calls += 1
      if (calls === 1) throw eperm()
      fs.renameSync(from, to)
    }
    writeState(emptyState(), file, { env: {}, rename: once })
    expect(calls).toBe(2)
    expect(fs.existsSync(file)).toBe(true)
    let twice = 0
    expect(() =>
      writeState(emptyState(), file, {
        env: {},
        rename: () => {
          twice += 1
          throw eperm()
        },
      }),
    ).toThrow(/busy/)
    expect(twice).toBe(2)
    let other = 0
    expect(() =>
      writeState(emptyState(), file, {
        env: {},
        rename: () => {
          other += 1
          throw Object.assign(new Error('no'), { code: 'EACCES' })
        },
      }),
    ).toThrow(/no/)
    expect(other).toBe(1)
  })
})
