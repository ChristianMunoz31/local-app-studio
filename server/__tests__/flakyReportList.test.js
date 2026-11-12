// `flakyReport.js list` (DESIGN-phase24 section 1.5): read only, active quarantines and the watch list.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listQuarantine, main, renderList } from '../../scripts/ci/flakyReport.js';

const NOW = Date.parse('2026-11-06T14:02:00.000Z');
const entry = (kind, file, title, extra = {}) => ({
  kind,
  file,
  title,
  project: null,
  flakyStreak: 0,
  failStreak: 0,
  lastOutcome: null,
  lastRunId: null,
  lastRunAt: null,
  history: [],
  quarantine: null,
  ...extra,
});
const q = (since, until) => ({ since, until, runId: 'r1', reason: 'flaky in 2 runs in a row' });
const state = {
  version: 1,
  tests: {
    'unit|src/studio/pages/__tests__/DataTab.test.tsx|DataTab keeps the edited cell': entry('unit', 'src/studio/pages/__tests__/DataTab.test.tsx', 'DataTab keeps the edited cell', { quarantine: q('2026-11-06T10:12:00.000Z', '2026-11-13T10:12:00.000Z') }),
    'e2e|e2e/flows/journeyNewApp.spec.js|[flows] journey new app ends clean': entry('e2e', 'e2e/flows/journeyNewApp.spec.js', 'journey new app ends clean', { project: 'flows', failStreak: 1, quarantine: q('2026-11-05T09:40:00.000Z', '2026-11-12T09:40:00.000Z') }),
    'e2e|e2e/flows/design.spec.js|[flows] design drags a tile': entry('e2e', 'e2e/flows/design.spec.js', 'design drags a tile', { project: 'flows', flakyStreak: 1, lastRunAt: '2026-11-06T11:00:00.000Z' }),
    'unit|src/old.test.js|ended': entry('unit', 'src/old.test.js', 'ended', { quarantine: q('2026-10-20T00:00:00.000Z', '2026-10-27T00:00:00.000Z') }),
    'unit|src/clean.test.js|clean': entry('unit', 'src/clean.test.js', 'clean'),
  },
};

describe('listQuarantine', () => {
  it('active: quarantine not ended, oldest since first; watch: no quarantine and a streak', () => {
    const list = listQuarantine(state, NOW);
    expect(list.active.map((e) => e.title)).toEqual(['journey new app ends clean', 'DataTab keeps the edited cell']);
    expect(list.active[0].key).toBe('e2e|e2e/flows/journeyNewApp.spec.js|[flows] journey new app ends clean');
    expect(list.watch.map((e) => e.title)).toEqual(['design drags a tile']);
  });

  it('an empty or missing state gives two empty lists', () => {
    expect(listQuarantine({ tests: {} }, NOW)).toEqual({ active: [], watch: [] });
    expect(listQuarantine({}, NOW)).toEqual({ active: [], watch: [] });
  });
});

describe('renderList', () => {
  it('prints the design example', () => {
    expect(renderList(listQuarantine(state, NOW), { file: '.gate/flaky.json', now: NOW }).split('\n')).toEqual([
      'Quarantined tests in .gate/flaky.json (2, read 2026-11-06 14:02 UTC):',
      '- e2e | e2e/flows/journeyNewApp.spec.js | [flows] journey new app ends clean | since 2026-11-05 09:40 UTC | until 2026-11-12 09:40 UTC | failing runs in a row: 1 of 3',
      '- unit | src/studio/pages/__tests__/DataTab.test.tsx | DataTab keeps the edited cell | since 2026-11-06 10:12 UTC | until 2026-11-13 10:12 UTC | failing runs in a row: 0 of 3',
      'Flaky once, not quarantined yet (1):',
      '- e2e | e2e/flows/design.spec.js | [flows] design drags a tile | last 2026-11-06 11:00 UTC | flaky runs in a row: 1 of 2',
    ]);
  });

  it('no file and empty cases', () => {
    expect(renderList(null, { file: '.gate/flaky.json', now: NOW })).toBe('No .gate/flaky.json yet: no gate run here has classified a test.');
    expect(renderList({ active: [], watch: [] }, { file: '.gate/flaky.json', now: NOW })).toBe('No quarantined tests in .gate/flaky.json.');
  });
});

describe('main list', () => {
  const dirs = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });
  const tmp = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'flaky-list-'));
    dirs.push(d);
    return d;
  };

  it('no file: the no-file line, exit 0, and nothing is created', async () => {
    const file = path.join(tmp(), 'flaky.json');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await main(['list', '--file', file], {})).toBe(0);
    expect(log.mock.calls.flat().join('\n')).toMatch(/^No .* yet: no gate run here has classified a test\.$/);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('--json prints file, at, active and watch with the key', async () => {
    const file = path.join(tmp(), 'flaky.json');
    const t = Date.now();
    const iso = (ms) => new Date(ms).toISOString();
    const body = { version: 1, updatedAt: iso(t), tests: { 'unit|src/a.test.js|x': entry('unit', 'src/a.test.js', 'x', { quarantine: q(iso(t - 3600000), iso(t + 86400000)) }) } };
    fs.writeFileSync(file, JSON.stringify(body));
    const before = fs.readFileSync(file, 'utf8');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await main(['list', '--file', file, '--json'], {})).toBe(0);
    const out = JSON.parse(log.mock.calls.flat().join('\n'));
    expect(Object.keys(out)).toEqual(['file', 'at', 'active', 'watch']);
    expect(out.active[0]).toMatchObject({ key: 'unit|src/a.test.js|x', title: 'x' });
    expect(out.watch).toEqual([]);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  it('an unknown flag is exit 2, a bare --file too', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await main(['list', '--bogus'], {})).toBe(2);
    expect(await main(['list', '--file'], {})).toBe(2);
    expect(err).toHaveBeenCalled();
  });
});
