// The phase gate's step plan and argument parsing (scripts/phase/lib/gatePlan.js, DESIGN-phase24 section 2.1): the table,
// the order, the argv of every child, the needs, the shards and the flags.
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPlan, commandsOf, detectPhase, dryRunLines, logFileName, optionsConflict, pad2, parseArgs } from '../../scripts/phase/lib/gatePlan.js'

const base = { phase: 24, builds: ['pro', 'public'], classify: true, maxWorkers: 4, e2eShards: 3, resultDir: path.join('res', 'p24') }
const keys = (steps) => steps.map((s) => s.key)
const by = (steps, key) => steps.find((s) => s.key === key)

const PRO_ORDER = [
  'hygiene-gitleaks', 'hygiene-em-dash', 'hygiene-keys', 'hygiene-personal', 'check-extra', 'lint', 'typecheck', 'unit-frontend', 'unit-pure', 'unit-backend',
  'template-parity', 'build', 'bundle-budget', 'sidecar-studio', 'pro-marker-studio', 'sidecar-runtime', 'pro-marker-runtime', 'cloud-off',
  'e2e-flows-1of3', 'e2e-flows-2of3', 'e2e-flows-3of3', 'e2e-first-run', 'e2e-a11y',
]
const PUBLIC_ORDER = PRO_ORDER.filter((s) => !['template-parity', 'pro-marker-studio', 'pro-marker-runtime', 'cloud-off'].includes(s)).concat('public-build')

describe('buildPlan', () => {
  it('is the pro table then the public table, in the order of the design', () => {
    expect(keys(buildPlan(base))).toEqual([...PRO_ORDER.map((s) => `pro:${s}`), ...PUBLIC_ORDER.map((s) => `public:${s}`)])
  })

  it('has one build when asked for one', () => {
    expect(keys(buildPlan({ ...base, builds: ['pro'] }))).toEqual(PRO_ORDER.map((s) => `pro:${s}`))
    expect(keys(buildPlan({ ...base, builds: ['public'] }))).toEqual(PUBLIC_ORDER.map((s) => `public:${s}`))
  })

  it('names the flows step e2e-flows with no shard flag for one shard, and splits into n shards otherwise', () => {
    const one = buildPlan({ ...base, builds: ['pro'], e2eShards: 1 })
    expect(by(one, 'pro:e2e-flows').argv.slice(0, 5)).toEqual(['scripts/ci/gate.js', '--only', 'e2e (Playwright)', '--project', 'flows'])
    expect(by(one, 'pro:e2e-flows').argv).not.toContain('--shard')
    const five = buildPlan({ ...base, builds: ['pro'], e2eShards: 5 })
    expect(keys(five).filter((k) => k.includes('e2e-flows'))).toEqual([1, 2, 3, 4, 5].map((i) => `pro:e2e-flows-${i}of5`))
    expect(by(five, 'pro:e2e-flows-4of5').argv).toContain('4/5')
  })

  it('gives every gate child --only, its project flag and an absolute-style --json path under the result folder', () => {
    const steps = buildPlan(base)
    expect(by(steps, 'pro:unit-frontend').argv).toEqual(['scripts/ci/gate.js', '--only', 'unit tests', '--project', 'frontend', '--json', path.join('res', 'p24', 'pro-unit-frontend.json')])
    expect(by(steps, 'pro:hygiene-personal').argv.slice(0, 3)).toEqual(['scripts/ci/gate.js', '--only', 'hygiene: personal data'])
    expect(by(steps, 'pro:sidecar-runtime').argv.slice(0, 3)).toEqual(['scripts/ci/gate.js', '--only', 'sidecar budget (runtime)'])
    expect(by(steps, 'pro:e2e-first-run').argv.slice(2, 5)).toEqual(['e2e (Playwright)', '--project', 'first-run'])
  })

  it('adds --public to every gate child of the public pass and APP_PRO_DIR=none to its direct children', () => {
    const steps = buildPlan(base)
    for (const s of steps.filter((x) => x.build === 'public' && x.kind === 'gate')) expect(s.argv.at(-1)).toBe('--public')
    for (const s of steps.filter((x) => x.build === 'pro' && x.kind === 'gate')) expect(s.argv).not.toContain('--public')
    expect(by(steps, 'public:check-extra').env).toEqual({ APP_PRO_DIR: 'none' })
    expect(by(steps, 'pro:check-extra').env).toEqual({})
  })

  it('adds --no-classify when flakes are not classified', () => {
    const steps = buildPlan({ ...base, classify: false })
    expect(by(steps, 'pro:unit-pure').argv).toContain('--no-classify')
    expect(by(steps, 'pro:check-extra').argv).not.toContain('--no-classify')
  })

  it('runs the direct steps as the design says', () => {
    const steps = buildPlan(base)
    expect(commandsOf(by(steps, 'pro:check-extra'))).toEqual([['scripts/ci/workflowCheck.js'], ['scripts/checks/proMarker.js', '--require-present', '--source']])
    expect(by(steps, 'pro:template-parity').argv).toEqual(['node_modules/vitest/vitest.mjs', 'run', '--project', 'backend', 'pro/server/__tests__/templateParity.test.js', '--maxWorkers=4'])
    expect(by(steps, 'pro:pro-marker-studio').argv).toEqual(['scripts/checks/proMarker.js', '--require-present', '--kind', 'studio', '--bundle', '.sidecar-build/server.cjs', '--dist-dir', 'dist'])
    expect(by(steps, 'pro:pro-marker-runtime').argv).toEqual(['scripts/checks/proMarker.js', '--require-present', '--kind', 'runtime', '--bundle', '.sidecar-build/server.cjs'])
    expect(buildPlan({ ...base, maxWorkers: 2 }).find((s) => s.slug === 'template-parity').argv.at(-1)).toBe('--maxWorkers=2')
  })

  it('records needs, heavy flags, rows and log names', () => {
    const steps = buildPlan(base)
    expect(by(steps, 'public:bundle-budget').needs).toEqual(['public:build'])
    expect(by(steps, 'pro:pro-marker-studio').needs).toEqual(['pro:sidecar-studio'])
    expect(by(steps, 'pro:pro-marker-runtime').needs).toEqual(['pro:sidecar-runtime'])
    expect(by(steps, 'pro:e2e-a11y').needs).toEqual(['pro:build'])
    expect(by(steps, 'pro:cloud-off').needs).toEqual([])
    expect(by(steps, 'pro:lint').heavy).toBe(false)
    expect(by(steps, 'pro:unit-backend').heavy).toBe(true)
    expect(by(steps, 'public:public-build').heavy).toBe(true)
    expect(by(steps, 'pro:build').row).toBeNull()
    expect(by(steps, 'pro:typecheck').row).toBe('tsc (outside vendor)')
    expect(by(steps, 'pro:unit-pure').log).toBe('p24-pro-unit-pure.log')
    expect(logFileName(7, 'public', 'lint')).toBe('p07-public-lint.log')
    expect(steps.every((s) => s.status === 'pending' && s.result === null)).toBe(true)
  })
})

describe('detectPhase and pad2', () => {
  it('reads the folder name first, then the branch', () => {
    expect(detectPhase('las-wt-phase24', 'main')).toBe(24)
    expect(detectPhase('local-app-studio', 'feat/phase9-grid')).toBe(9)
    expect(detectPhase('local-app-studio', 'main')).toBeNull()
    expect(detectPhase('las-wt-phase24-x', 'fix/phase3-x')).toBeNull()
    expect(pad2(7)).toBe('07')
    expect(pad2(24)).toBe('24')
  })
})

describe('parseArgs', () => {
  it('defaults to pro, classify on, 4 workers and 3 shards', () => {
    expect(parseArgs(['--next'])).toMatchObject({ command: 'next', builds: ['pro'], classify: true, maxWorkers: 4, e2eShards: 3, explicit: [], phase: null, waitFor: null })
  })

  it('reads every flag', () => {
    const a = parseArgs(['--all', '--phase', '24', '--both-builds', '--no-classify-flakes', '--wait-for', 'any', '--wait-max', '90', '--max-workers', '2', '--e2e-shards', '5', '--log-dir', 'lg', '--json', 'a.json', '--md', 'a.md', '--allow-moved-head'])
    expect(a).toMatchObject({ command: 'all', phase: 24, builds: ['pro', 'public'], classify: false, waitFor: 'any', waitMax: 90, maxWorkers: 2, e2eShards: 5, logDir: 'lg', json: 'a.json', md: 'a.md', allowMovedHead: true })
    expect(a.explicit.sort()).toEqual(['builds', 'classify', 'e2eShards', 'logDir', 'maxWorkers'])
    expect(parseArgs(['--build', 'public', '--status']).builds).toEqual(['public'])
    expect(parseArgs(['--rerun', 'public:e2e-a11y'])).toMatchObject({ command: 'rerun', rerunKey: 'public:e2e-a11y' })
    expect(parseArgs(['--dry-run']).command).toBe('dryRun')
  })

  it.each([
    [[], 'exactly one of'],
    [['--next', '--all'], 'exactly one'],
    [['--next', '--rerun', 'pro:lint'], 'exactly one'],
    [['--rerun', 'lint'], '--rerun needs a step key'],
    [['--next', '--build', 'x'], '--build needs'],
    [['--next', '--e2e-shards', '9'], '--e2e-shards needs'],
    [['--next', '--e2e-shards', '0'], '--e2e-shards needs'],
    [['--next', '--max-workers', 'a'], '--max-workers needs'],
    [['--next', '--phase'], '--phase needs'],
    [['--next', '--wait-for', 'a b'], '--wait-for needs'],
    [['--next', '--wait-for', '--json'], '--wait-for needs'],
    [['--next', '--json'], '--json needs a path'],
    [['--next', '--bogus'], 'unknown argument --bogus'],
  ])('refuses %j', (argv, text) => {
    const r = parseArgs(argv)
    expect(r.error).toContain(text)
    expect(r.error).toContain('usage: node scripts/phase/gate.js')
  })
})

describe('optionsConflict', () => {
  const stored = { builds: ['pro', 'public'], classify: true, maxWorkers: 4, e2eShards: 3, logDir: '/l' }

  it('accepts a call that gives no plan option', () => {
    expect(optionsConflict(stored, { ...parseArgs(['--next']), logDir: null })).toBeNull()
  })

  it('accepts the same options and refuses a changed one, naming --reset', () => {
    expect(optionsConflict(stored, { ...parseArgs(['--next', '--both-builds', '--e2e-shards', '3']), logDir: null })).toBeNull()
    const msg = optionsConflict(stored, { ...parseArgs(['--next', '--build', 'pro', '--e2e-shards', '2']), logDir: null })
    expect(msg).toContain('builds, e2eShards')
    expect(msg).toContain('--reset')
  })
})

describe('dryRunLines', () => {
  it('prints each key with its argv, heavy marks and needs', () => {
    const lines = dryRunLines(buildPlan({ ...base, builds: ['public'] }))
    expect(lines[0]).toMatch(/^public:hygiene-gitleaks \(light\): node scripts\/ci\/gate\.js --only hygiene: gitleaks --json .*--public \[env GATE_RUN_DIR=\.gate\/run-light\]$/)
    expect(lines.find((l) => l.startsWith('public:check-extra'))).toBe('public:check-extra (light): node scripts/ci/workflowCheck.js ; then node scripts/checks/proMarker.js --require-present --source [env APP_PRO_DIR=none]')
    expect(lines.find((l) => l.startsWith('public:bundle-budget'))).toContain('needs public:build')
    expect(lines.find((l) => l.startsWith('public:unit-pure'))).toContain('(light, waits)')
  })
})

describe('unit shards', () => {
  it('splits each unit step into <i>of<n> steps that run the gate with --shard', () => {
    const steps = buildPlan({ ...base, builds: ['pro'], unitShards: 2 })
    const unit = keys(steps).filter((k) => k.includes(':unit-'))
    expect(unit).toEqual(['pro:unit-frontend-1of2', 'pro:unit-frontend-2of2', 'pro:unit-pure-1of2', 'pro:unit-pure-2of2', 'pro:unit-backend-1of2', 'pro:unit-backend-2of2'])
    expect(by(steps, 'pro:unit-pure-2of2').argv).toEqual(['scripts/ci/gate.js', '--only', 'unit tests', '--project', 'pure', '--shard', '2/2', '--json', path.join('res', 'p24', 'pro-unit-pure-2of2.json')])
    expect(by(steps, 'pro:unit-pure-2of2')).toMatchObject({ row: 'vitest pure', heavy: true })
  })

  it('keeps the unsharded names at the default of 1', () => {
    expect(keys(buildPlan({ ...base, builds: ['pro'] }))).toContain('pro:unit-backend')
    expect(parseArgs(['--next'])).toMatchObject({ unitShards: 1 })
  })

  it('parses --unit-shards from 1 to 8 and treats a missing stored value as 1', () => {
    expect(parseArgs(['--next', '--unit-shards', '4'])).toMatchObject({ unitShards: 4, explicit: ['unitShards'] })
    expect('error' in parseArgs(['--next', '--unit-shards', '9'])).toBe(true)
    expect('error' in parseArgs(['--next', '--unit-shards', '0'])).toBe(true)
    const stored = { builds: ['pro'], classify: true, maxWorkers: 4, e2eShards: 3, logDir: 'l' }
    expect(optionsConflict(stored, { ...stored, unitShards: 1, explicit: ['unitShards'] })).toBeNull()
    expect(optionsConflict(stored, { ...stored, unitShards: 2, explicit: ['unitShards'] })).toContain('unitShards')
  })
})
