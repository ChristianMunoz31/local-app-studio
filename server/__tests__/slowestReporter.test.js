// The ten slowest tests reporter (scripts/ci/slowestReporter.js) and its wiring into every unit run (D-15).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { REPO_ROOT } from '../../scripts/checks/gitFiles.js';
import { unitReporterArgs } from '../../scripts/ci/runUnitTests.js';
import SlowestReporter, { SLOWEST_COUNT, formatSlowest, slowestTests } from '../../scripts/ci/slowestReporter.js';

const mod = (file, tests) => ({ relativeModuleId: file, children: { allTests: () => tests.map(([fullName, duration]) => ({ fullName, diagnostic: () => (duration === undefined ? undefined : { duration }) })) } });

describe('slowestTests', () => {
  it('lists the ten longest across modules, longest first, ignoring tests without a duration', () => {
    const modules = [mod('src/a.test.js', Array.from({ length: 8 }, (_, i) => [`a${i}`, 100 + i])), mod('server\\b.test.js', [['b0', 5000], ['b1', 1], ['skipped', undefined], ['b2', 90]])];
    const rows = slowestTests(modules);
    expect(SLOWEST_COUNT).toBe(10);
    expect(rows).toHaveLength(10);
    expect(rows[0]).toEqual({ ms: 5000, file: 'server/b.test.js', name: 'b0' });
    expect(rows.map((r) => r.ms)).toEqual([...rows.map((r) => r.ms)].sort((x, y) => y - x));
    expect(rows.some((r) => r.name === 'skipped')).toBe(false);
  });

  it('is empty for no modules', () => {
    expect(slowestTests([])).toEqual([]);
    expect(slowestTests(undefined)).toEqual([]);
  });
});

describe('formatSlowest and the reporter', () => {
  it('prints a heading and one line per test: seconds, file, full name', () => {
    expect(formatSlowest([{ ms: 12310, file: 'src/a.test.js', name: 'A b' }, { ms: 40, file: 'x.js', name: 'c' }])).toBe(['', 'Ten slowest tests', '   12.31 s  src/a.test.js > A b', '    0.04 s  x.js > c', ''].join('\n'));
    expect(formatSlowest([])).toBe('');
  });

  it('onTestRunEnd writes the block through the injected writer, and nothing for an empty run', () => {
    const write = vi.fn();
    const reporter = new SlowestReporter({ write });
    reporter.onTestRunEnd([mod('a.test.js', [['t', 2000]])], [], 'passed');
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toContain('2.00 s  a.test.js > t');
    reporter.onTestRunEnd([], [], 'passed');
    expect(write).toHaveBeenCalledTimes(1);
  });
});

describe('wiring', () => {
  it('unitReporterArgs adds the default reporter, the slowest reporter and a JSON report', () => {
    expect(unitReporterArgs('.gate/run/unit-1.json')).toEqual(['--reporter=default', '--reporter=./scripts/ci/slowestReporter.js', '--reporter=json', '--outputFile.json=.gate/run/unit-1.json']);
  });

  it('runUnitTests.js and the gate both build the flags through unitReporterArgs', () => {
    expect(fs.readFileSync(path.join(REPO_ROOT, 'scripts/ci/runUnitTests.js'), 'utf8')).toContain('...unitReporterArgs(json)');
    expect(fs.readFileSync(path.join(REPO_ROOT, 'scripts/ci/gate.js'), 'utf8')).toContain('...unitReporterArgs(jsonPathFor');
  });
});
