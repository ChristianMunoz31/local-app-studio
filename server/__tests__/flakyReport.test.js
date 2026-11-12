// Quarantine issues (scripts/ci/flakyReport.js quarantine-issues, DESIGN-phase15 section 3.3): one issue per newly
// quarantined test, no duplicate title, and no effect without a remote or a token.
import { describe, expect, it, vi } from 'vitest';
import { QUARANTINE_LABEL, main, newlyQuarantined, quarantineIssueBody, quarantineIssueTitle, runQuarantineIssues } from '../../scripts/ci/flakyReport.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-10T00:00:00.000Z');
const entry = (title, sinceMs, extra = {}) => ({
  kind: 'unit',
  file: 'src/a.test.js',
  title,
  history: [{ at: '2026-11-08T00:00:00.000Z', outcome: 'flaky' }, { at: '2026-11-09T00:00:00.000Z', outcome: 'flaky' }],
  quarantine: { since: new Date(sinceMs).toISOString(), until: new Date(sinceMs + 7 * DAY).toISOString(), runId: 'run-1', reason: 'flaky in 2 runs in a row' },
  ...extra,
});
const state = {
  version: 1,
  tests: {
    'unit|src/a.test.js|new one': entry('new one', NOW - DAY),
    'unit|src/a.test.js|old one': entry('old one', NOW - 9 * DAY),
    'unit|src/a.test.js|not quarantined': entry('not quarantined', NOW, { quarantine: null }),
  },
};

describe('newlyQuarantined', () => {
  it('keeps entries quarantined within the last 8 days, newest first', () => {
    expect(newlyQuarantined(state, NOW).map((x) => x.entry.title)).toEqual(['new one']);
    expect(newlyQuarantined(state, NOW - 5 * DAY).map((x) => x.entry.title)).toEqual(['new one', 'old one']);
    expect(newlyQuarantined(state, NOW + 8 * DAY)).toEqual([]);
  });
});

describe('issue text', () => {
  it('title: file and test, cut to 200 characters', () => {
    expect(quarantineIssueTitle(state.tests['unit|src/a.test.js|new one'])).toBe('Quarantined test: src/a.test.js :: new one');
    expect(quarantineIssueTitle(entry('x'.repeat(400), NOW))).toHaveLength(200);
  });

  it('body: since, until, run, reason, history and what to do', () => {
    const body = quarantineIssueBody(state.tests['unit|src/a.test.js|new one']);
    expect(body).toContain('Quarantined since 2026-11-09T00:00:00.000Z until 2026-11-16T00:00:00.000Z.');
    expect(body).toContain('Run: run-1');
    expect(body).toContain('Reason: flaky in 2 runs in a row');
    expect(body).toContain('- 2026-11-09T00:00:00.000Z: flaky');
    expect(body).toContain('Fix the race at its root cause, then remove the entry from .gate/flaky.json or let it expire.');
  });
});

describe('runQuarantineIssues', () => {
  const env = { GH_TOKEN: 't', GITHUB_REPOSITORY: 'o/r' };

  it('opens one labelled issue per new test', async () => {
    const api = { get: vi.fn(async () => []), post: vi.fn(async () => ({})) };
    const log = vi.fn();
    expect(await runQuarantineIssues(env, { api, state, now: NOW, log })).toBe(0);
    expect(api.get).toHaveBeenCalledWith(`/repos/o/r/issues?state=all&labels=${QUARANTINE_LABEL}&per_page=100&page=1`);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/repos/o/r/issues', expect.objectContaining({ title: 'Quarantined test: src/a.test.js :: new one', labels: ['quarantine'] }));
    expect(log).toHaveBeenCalledWith('Newly quarantined: 1. Issues opened: 1.');
  });

  it('skips a title that already has an open issue, and a pull request with that title', async () => {
    const title = 'Quarantined test: src/a.test.js :: new one';
    const open = { get: async () => [{ title, state: 'open' }], post: vi.fn() };
    await runQuarantineIssues(env, { api: open, state, now: NOW, log: vi.fn() });
    expect(open.post).not.toHaveBeenCalled();
    const pr = { get: async () => [{ title, pull_request: {} }], post: vi.fn(async () => ({})) };
    await runQuarantineIssues(env, { api: pr, state, now: NOW, log: vi.fn() });
    expect(pr.post).toHaveBeenCalledTimes(1);
  });

  it('does not reopen a closed issue made for this quarantine, but a closed one from an earlier quarantine does not hide it', async () => {
    const title = 'Quarantined test: src/a.test.js :: new one';
    const since = state.tests['unit|src/a.test.js|new one'].quarantine.since;
    const fresh = { get: async () => [{ title, state: 'closed', created_at: since }], post: vi.fn() };
    await runQuarantineIssues(env, { api: fresh, state, now: NOW, log: vi.fn() });
    expect(fresh.post).not.toHaveBeenCalled();
    const old = { get: async () => [{ title, state: 'closed', created_at: '2026-01-01T00:00:00.000Z' }], post: vi.fn(async () => ({})) };
    await runQuarantineIssues(env, { api: old, state, now: NOW, log: vi.fn() });
    expect(old.post).toHaveBeenCalledTimes(1);
  });

  it('reads every page of issues, not only the first 100', async () => {
    const title = 'Quarantined test: src/a.test.js :: new one';
    const filler = Array.from({ length: 100 }, (_, i) => ({ title: `other ${i}`, state: 'open' }));
    const get = vi.fn(async (route) => (route.endsWith('page=1') ? filler : [{ title, state: 'open' }]));
    const api = { get, post: vi.fn() };
    await runQuarantineIssues(env, { api, state, now: NOW, log: vi.fn() });
    expect(get).toHaveBeenCalledTimes(2);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('is a no-op without a token or a repository, and says so', async () => {
    const api = { get: vi.fn(), post: vi.fn() };
    const log = vi.fn();
    for (const e of [{}, { GH_TOKEN: 't' }, { GITHUB_REPOSITORY: 'o/r' }, { GH_TOKEN: 't', GITHUB_REPOSITORY: 'not a repo' }]) {
      expect(await runQuarantineIssues(e, { api, state, now: NOW, log })).toBe(0);
    }
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('No GitHub remote or token, so no issue was opened. Newly quarantined: 1.');
    expect(log).toHaveBeenCalledWith('- Quarantined test: src/a.test.js :: new one');
  });
});

describe('main', () => {
  it('knows the new command and still refuses an unknown one', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await main(['nope'], {})).toBe(1);
    expect(console.error).toHaveBeenCalledWith('Usage: flakyReport.js tally | report | quarantine-issues');
  });
});
