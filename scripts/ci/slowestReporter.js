// Vitest reporter: prints the ten slowest tests at the end of a run (DESIGN-phase15 section 9, D-15).
//   vitest run --reporter=default --reporter=./scripts/ci/slowestReporter.js
// Vitest 5 calls `onTestRunEnd(testModules)`; each module's `children.allTests()` yields test cases whose `diagnostic()`
// holds the duration in milliseconds.

export const SLOWEST_COUNT = 10

/**
 * The slowest tests of a run, longest first.
 * @param {{ relativeModuleId?: string, moduleId?: string, children: { allTests: () => Iterable<{ fullName: string, diagnostic: () => { duration: number } | undefined }> } }[]} testModules
 * @param {number} [count]
 * @returns {{ ms: number, file: string, name: string }[]}
 */
export function slowestTests(testModules, count = SLOWEST_COUNT) {
  const rows = []
  for (const mod of testModules ?? []) {
    const file = String(mod.relativeModuleId ?? mod.moduleId ?? '').replace(/\\/g, '/')
    for (const test of mod.children.allTests()) {
      const ms = test.diagnostic()?.duration
      if (typeof ms === 'number') rows.push({ ms, file, name: test.fullName })
    }
  }
  return rows.sort((a, b) => b.ms - a.ms || a.name.localeCompare(b.name)).slice(0, count)
}

/** The printed block: a heading and one line per test, e.g. `  12.31 s  server/x.test.js > a > b`. */
export function formatSlowest(rows) {
  if (rows.length === 0) return ''
  const lines = rows.map((r) => `  ${(r.ms / 1000).toFixed(2).padStart(6)} s  ${r.file} > ${r.name}`)
  return ['', 'Ten slowest tests', ...lines, ''].join('\n')
}

export default class SlowestReporter {
  /** @param {{ write?: (text: string) => void }} [options] */
  constructor(options = {}) {
    this.write = options.write ?? ((text) => process.stdout.write(`${text}\n`))
  }

  onTestRunEnd(testModules) {
    const text = formatSlowest(slowestTests(testModules))
    if (text) this.write(text)
  }
}
