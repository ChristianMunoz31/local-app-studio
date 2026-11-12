// The quarantine state machine of the gate (scripts/ci/gateState.js, DESIGN-phase15 section 2.3): every row of the table,
// with an injected clock.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FAIL_RUNS_TO_RELEASE,
  MAX_ENTRIES,
  QUARANTINE_DAYS,
  activeQuarantine,
  applyOutcomes,
  emptyState,
  expire,
  extractArtifact,
  main,
  makeRunId,
  pickArtifact,
  readState,
  writeState,
} from '../../scripts/ci/gateState.js';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-11-04T10:12:00.000Z');
const KEY = 'unit|src/a.test.js|A does a thing';
const outcome = (o, key = KEY) => ({ key, kind: 'unit', file: 'src/a.test.js', title: 'A does a thing', project: null, outcome: o });
const step = (state, o, at = T0, extra = {}) => applyOutcomes(state, [outcome(o)], { now: at, runId: `run-${at}`, protectedGate: false, ...extra });

const temps = [];
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-state-'));
  temps.push(dir);
  return dir;
};
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('applyOutcomes: not quarantined', () => {
  it('a pass on an unknown test changes nothing, a pass on a flaky entry removes it', () => {
    const r = step(emptyState(), 'pass');
    expect(r.state.tests).toEqual({});
    expect(r.failing).toEqual([]);
    const flaky = step(emptyState(), 'flaky').state;
    expect(flaky.tests[KEY].flakyStreak).toBe(1);
    expect(step(flaky, 'pass').state.tests).toEqual({});
  });

  it('the first flaky run fails the step and counts one', () => {
    const r = step(emptyState(), 'flaky');
    expect(r.failing).toEqual([KEY]);
    expect(r.newlyQuarantined).toEqual([]);
    expect(r.state.tests[KEY]).toMatchObject({ flakyStreak: 1, failStreak: 0, lastOutcome: 'flaky', quarantine: null });
  });

  it('flaky in 2 runs in a row quarantines for 7 days in the same run and does not fail it (D-9)', () => {
    const first = step(emptyState(), 'flaky', T0 - DAY).state;
    const r = step(first, 'flaky');
    expect(QUARANTINE_DAYS).toBe(7);
    expect(r.newlyQuarantined).toEqual([KEY]);
    expect(r.failing).toEqual([]);
    expect(r.quarantinedFailures).toEqual([KEY]);
    expect(r.state.tests[KEY].quarantine).toEqual({ since: '2026-11-04T10:12:00.000Z', until: '2026-11-11T10:12:00.000Z', runId: `run-${T0}`, reason: 'flaky in 2 runs in a row' });
    expect(r.state.tests[KEY].history.map((h) => h.outcome)).toEqual(['flaky', 'flaky']);
  });

  it('a real failure resets the flaky streak and fails the step', () => {
    const first = step(emptyState(), 'flaky').state;
    const r = step(first, 'fail');
    expect(r.failing).toEqual([KEY]);
    expect(r.state.tests[KEY]).toMatchObject({ flakyStreak: 0, failStreak: 0, quarantine: null });
    expect(step(r.state, 'flaky').state.tests[KEY].flakyStreak).toBe(1);
  });
});

describe('applyOutcomes: quarantined', () => {
  const quarantined = () => step(step(emptyState(), 'flaky', T0 - DAY).state, 'flaky').state;

  it('a pass keeps the entry, resets the streaks and fails nothing', () => {
    const r = step(quarantined(), 'pass', T0 + DAY);
    expect(r.failing).toEqual([]);
    expect(r.state.tests[KEY]).toMatchObject({ flakyStreak: 0, failStreak: 0, lastOutcome: 'pass' });
    expect(r.state.tests[KEY].quarantine).not.toBeNull();
  });

  it('flaky is reported but does not fail, and clears the fail streak', () => {
    const r = step(quarantined(), 'flaky', T0 + DAY);
    expect(r.failing).toEqual([]);
    expect(r.quarantinedFailures).toEqual([KEY]);
    expect(r.state.tests[KEY].failStreak).toBe(0);
  });

  it('fails three runs in a row: the first two are tolerated, the third releases the quarantine and fails', () => {
    expect(FAIL_RUNS_TO_RELEASE).toBe(3);
    let s = quarantined();
    for (const n of [1, 2]) {
      const r = step(s, 'fail', T0 + n * DAY);
      expect(r.failing).toEqual([]);
      expect(r.quarantinedFailures).toEqual([KEY]);
      expect(r.state.tests[KEY].failStreak).toBe(n);
      s = r.state;
    }
    const third = step(s, 'fail', T0 + 3 * DAY);
    expect(third.released).toEqual([KEY]);
    expect(third.failing).toEqual([KEY]);
    expect(third.state.tests[KEY].quarantine).toBeNull();
    expect(third.state.tests[KEY]).toMatchObject({ flakyStreak: 0, failStreak: 0 });
  });

  it('a pass between failures resets the fail streak', () => {
    let s = quarantined();
    s = step(s, 'fail', T0 + DAY).state;
    s = step(s, 'pass', T0 + 2 * DAY).state;
    s = step(s, 'fail', T0 + 3 * DAY).state;
    expect(s.tests[KEY].failStreak).toBe(1);
  });

  it('a test that did not run this time is untouched', () => {
    const before = quarantined();
    const r = applyOutcomes(before, [outcome('fail', 'unit|src/b.test.js|B')], { now: T0 + DAY, runId: 'x', protectedGate: false });
    expect(r.state.tests[KEY]).toEqual(before.tests[KEY]);
  });
});

describe('expire', () => {
  it('ends a quarantine at exactly 7 days and resets the streaks, never one millisecond sooner', () => {
    const s = step(step(emptyState(), 'flaky', T0 - DAY).state, 'flaky').state;
    const until = T0 + 7 * DAY;
    expect(expire(s, until - 1).expired).toEqual([]);
    const r = expire(s, until);
    expect(r.expired).toEqual([KEY]);
    expect(r.state.tests[KEY]).toMatchObject({ quarantine: null, flakyStreak: 0, failStreak: 0 });
    expect(activeQuarantine(s, until - 1)).toHaveLength(1);
    expect(activeQuarantine(s, until)).toHaveLength(0);
  });

  it('a test that is flaky again after expiry needs two new flaky runs', () => {
    const s = step(step(emptyState(), 'flaky', T0 - DAY).state, 'flaky').state;
    const expired = expire(s, T0 + 8 * DAY).state;
    const one = step(expired, 'flaky', T0 + 8 * DAY);
    expect(one.newlyQuarantined).toEqual([]);
    expect(one.failing).toEqual([KEY]);
  });
});

describe('protected gate', () => {
  it('ignores quarantine for the effect, quarantines nothing and returns the state unchanged', () => {
    const quarantined = step(step(emptyState(), 'flaky', T0 - DAY).state, 'flaky').state;
    const r = applyOutcomes(quarantined, [outcome('flaky'), outcome('fail', 'unit|src/b.test.js|B'), outcome('pass', 'unit|src/c.test.js|C')], { now: T0 + DAY, runId: 'rel', protectedGate: true });
    expect(r.failing.sort()).toEqual([KEY, 'unit|src/b.test.js|B'].sort());
    expect(r.state).toBe(quarantined);
    expect(r.newlyQuarantined).toEqual([]);
    const fresh = applyOutcomes(step(emptyState(), 'flaky').state, [outcome('flaky')], { now: T0, runId: 'rel', protectedGate: true });
    expect(fresh.newlyQuarantined).toEqual([]);
    expect(fresh.failing).toEqual([KEY]);
  });

  it('never writes the file', () => {
    const file = path.join(tmp(), 'flaky.json');
    expect(() => writeState(emptyState(), file, { protectedGate: true })).toThrow(/protected/);
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe('the file', () => {
  it('keeps at most 500 entries: the oldest lastRunAt go first and quarantined entries never', () => {
    expect(MAX_ENTRIES).toBe(500);
    let s = emptyState();
    const keep = 'unit|src/q.test.js|kept';
    s = applyOutcomes(s, [{ ...outcome('flaky', keep), title: 'kept' }], { now: T0 - 2 * DAY, runId: 'a', protectedGate: false }).state;
    s = applyOutcomes(s, [{ ...outcome('flaky', keep), title: 'kept' }], { now: T0 - DAY, runId: 'b', protectedGate: false }).state;
    expect(s.tests[keep].quarantine).not.toBeNull();
    const many = Array.from({ length: 520 }, (_, i) => ({ ...outcome('flaky', `unit|src/m.test.js|t${i}`), title: `t${i}` }));
    const r = applyOutcomes(s, many, { now: T0 + 1000, runId: 'c', protectedGate: false });
    expect(Object.keys(r.state.tests)).toHaveLength(MAX_ENTRIES);
    expect(r.state.tests[keep]).toBeDefined();
  });

  it('a missing file is an empty state; a damaged or unknown one is empty with a note', () => {
    const dir = tmp();
    expect(readState(path.join(dir, 'none.json'))).toEqual(emptyState());
    fs.writeFileSync(path.join(dir, 'bad.json'), '{ nope');
    expect(readState(path.join(dir, 'bad.json')).note).toMatch(/could not be read/);
    fs.writeFileSync(path.join(dir, 'odd.json'), JSON.stringify({ version: 9 }));
    expect(readState(path.join(dir, 'odd.json')).note).toMatch(/unknown layout/);
  });

  it('drops every entry that looks planted: bad types, long or backdated quarantines, odd streaks, a broken history', () => {
    const quarantined = step(step(emptyState(), 'flaky', T0 - DAY).state, 'flaky').state;
    const good = quarantined.tests[KEY];
    const bad = {
      'unit|a|long': { ...good, quarantine: { ...good.quarantine, since: '2026-11-04T10:12:00.000Z', until: '2027-11-04T10:12:00.000Z' } },
      'unit|a|future': { ...good, quarantine: { ...good.quarantine, since: '2027-01-01T00:00:00.000Z', until: '2027-01-02T00:00:00.000Z' } },
      'unit|a|streak': { ...good, failStreak: 99 },
      'unit|a|float': { ...good, flakyStreak: 1.5 },
      'unit|a|history': { ...good, history: 'nope' },
      'unit|a|outcome': { ...good, history: [{ runId: 'r', at: '2026-11-04T10:12:00.000Z', outcome: 'maybe' }] },
      'unit|a|kind': { ...good, kind: 'other' },
      'unit|a|title': { ...good, title: 'two\nlines' },
      'unit|a|null': null,
    };
    const file = path.join(tmp(), 'flaky.json');
    fs.writeFileSync(file, JSON.stringify({ version: 1, updatedAt: null, tests: { [KEY]: good, ...bad } }));
    const r = readState(file, T0);
    expect(Object.keys(r.tests)).toEqual([KEY]);
    expect(r.tests[KEY]).toEqual(good);
    expect(r.note).toBe('9 entries of the quarantine file looked wrong and were ignored.');
    fs.writeFileSync(file, JSON.stringify({ version: 1, tests: [] }));
    expect(readState(file, T0).note).toMatch(/unknown layout/);
  });

  it('writes atomically, without the note, and reads it back', () => {
    const file = path.join(tmp(), 'sub', 'flaky.json');
    const s = step(emptyState(), 'flaky').state;
    writeState({ ...s, note: 'x' }, file);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).note).toBeUndefined();
    expect(readState(file).tests[KEY].flakyStreak).toBe(1);
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  });

  it('run ids: ISO time and short sha locally, run id and attempt in CI', () => {
    expect(makeRunId({ env: {}, now: T0, head: '1a2b3c4d5e6f' })).toBe('2026-11-04T10:12:00.000Z-1a2b3c4');
    expect(makeRunId({ env: { GITHUB_RUN_ID: '99', GITHUB_RUN_ATTEMPT: '2' }, now: T0 })).toBe('99-2');
  });
});

describe('CI artifacts', () => {
  it('picks the newest unexpired artifact of this repository, from the branch when asked', () => {
    const run = (head_branch, id = 5, head_repository_id = 5) => ({ head_branch, repository_id: id, head_repository_id });
    const listing = {
      artifacts: [
        { id: 1, expired: false, created_at: '2026-11-01T00:00:00Z', workflow_run: run('a') },
        { id: 2, expired: false, created_at: '2026-11-03T00:00:00Z', workflow_run: run('b') },
        { id: 3, expired: true, created_at: '2026-11-04T00:00:00Z', workflow_run: run('a') },
        { id: 4, expired: false, created_at: '2026-11-05T00:00:00Z', workflow_run: run('a', 5, 99) },
      ],
    };
    expect(pickArtifact(listing, 'a', 5).id).toBe(1);
    expect(pickArtifact(listing, undefined, '5').id).toBe(2);
    expect(pickArtifact(listing, 'zzz', 5)).toBeNull();
  });

  it('never trusts a fork artifact, and picks nothing without the repository id', () => {
    const listing = { artifacts: [{ id: 4, expired: false, created_at: '2026-11-05T00:00:00Z', workflow_run: { head_branch: 'main', repository_id: 5, head_repository_id: 99 } }] };
    expect(pickArtifact(listing, 'main', 5)).toBeNull();
    expect(pickArtifact(listing, 'main')).toBeNull();
    expect(pickArtifact(listing, 'main', 'abc')).toBeNull();
  });

  it('unzips only the two known file names', () => {
    const out = tmp();
    const zip = zipSync({ 'flaky.json': new TextEncoder().encode('{"version":1}'), 'ledger.jsonl': new TextEncoder().encode('{}\n'), '../evil.txt': new TextEncoder().encode('x') });
    expect(extractArtifact(Buffer.from(zip), out)).toEqual(['flaky.json', 'ledger.jsonl']);
    expect(fs.readdirSync(out).sort()).toEqual(['flaky.json', 'ledger.jsonl']);
  });

  it('restore does nothing without a remote or a token, and never fails the job', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await main(['restore', '--branch', 'x'], {}, { outDir: tmp() })).toBe(0);
    expect(log.mock.calls.join('\n')).toMatch(/No GitHub remote or token/);
  });

  it('restore downloads the newest artifact of the branch, then falls back to the base ref, then to nothing', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const out = tmp();
    const zip = Buffer.from(zipSync({ 'flaky.json': new TextEncoder().encode('{"version":1,"tests":{}}') }));
    const calls = [];
    const api = {
      get: async (route) => {
        calls.push(route);
        return { artifacts: [{ id: 7, expired: false, created_at: '2026-11-03T00:00:00Z', workflow_run: { head_branch: 'main', repository_id: 5, head_repository_id: 5 } }] };
      },
      getBinary: async (route) => {
        calls.push(route);
        return zip;
      },
    };
    const env = { GH_TOKEN: 't', GITHUB_REPOSITORY: 'o/r', GITHUB_REPOSITORY_ID: '5', GITHUB_BASE_REF: 'main' };
    expect(await main(['restore', '--branch', 'feature'], env, { outDir: out, createApiImpl: () => api })).toBe(0);
    expect(calls[0]).toContain('/repos/o/r/actions/artifacts?name=gate-state');
    expect(calls[1]).toBe('/repos/o/r/actions/artifacts/7/zip');
    expect(fs.existsSync(path.join(out, 'flaky.json'))).toBe(true);
    const failing = { get: async () => { throw new Error('boom'); }, getBinary: async () => zip };
    expect(await main(['restore', '--any-branch'], env, { outDir: tmp(), createApiImpl: () => failing })).toBe(0);
    expect(log.mock.calls.join('\n')).toMatch(/starting empty/);
  });

  it('save makes sure the file to upload exists', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const out = tmp();
    expect(await main(['save'], {}, { outDir: out })).toBe(0);
    expect(fs.existsSync(path.join(out, 'flaky.json'))).toBe(true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await main(['nope'], {}, { outDir: out })).toBe(2);
  });
});
