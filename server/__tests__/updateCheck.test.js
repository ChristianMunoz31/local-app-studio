// Update check: semver compare in code, GitHub response handling, cache, and the opt-in gate.
// node-fetch is mocked and every request goes through an injected fetchImpl: no network.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ store: new Map() }));

vi.mock('../../loadEnv.js', () => ({}));
vi.mock('../../scripts/release/releaseConfig.js', async (importOriginal) => ({
  ...(await importOriginal()),
  RELEASE_CONFIG: Object.freeze({ sourceRepo: 'acme/notes', releasesRepo: 'acme/notes-releases' }),
}));
vi.mock('node-fetch', () => ({ default: vi.fn(async () => { throw new Error('real fetch must not be used'); }) }));
vi.mock('../dataAccess.js', () => ({
  getState: vi.fn(async (key, fallback = null) => (h.store.has(key) ? h.store.get(key) : fallback)),
  setState: vi.fn(async (key, value) => {
    h.store.set(key, value);
    return { key, value };
  }),
}));

import fetch from 'node-fetch';
import { RELEASE_CONFIG } from '../../scripts/release/releaseConfig.js';
import { NetworkOptInError, __resetNetPolicyForTests, setNetworkFeature } from '../netPolicy.js';
import {
  APP_VERSION,
  DEV_RELEASES_PAGE,
  DEV_UPDATE_REPO,
  RELEASES_PAGE,
  UPDATE_REPO,
  __resetUpdateCacheForTests,
  checkForUpdate,
  compareSemver,
} from '../updateCheck.js';

const respond = (status, body, { raw } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Map(),
  text: async () => raw ?? JSON.stringify(body),
});
const release = (over = {}) => ({
  tag_name: 'v1.2.0',
  html_url: `${RELEASES_PAGE}/tag/v1.2.0`,
  published_at: '2030-01-01T00:00:00Z',
  ...over,
});
const stub = (...responses) => {
  const fn = vi.fn();
  for (const r of responses) fn.mockImplementationOnce(async () => r);
  return fn;
};

beforeEach(async () => {
  h.store.clear();
  delete process.env.APP_NETWORK_OPTIN;
  __resetNetPolicyForTests();
  __resetUpdateCacheForTests();
  fetch.mockClear();
  await setNetworkFeature('updates', true);
});

describe('compareSemver', () => {
  it.each([
    ['1.2.3', '1.2.3', 0],
    ['v1.2.3', '1.2.3', 0],
    ['1.2.4', '1.2.3', 1],
    ['1.10.0', '1.9.0', 1],
    ['0.9.9', '1.0.0', -1],
    ['2.0.0', '1.99.99', 1],
    ['1.0.0-beta.1', '1.0.0', -1],
    ['1.0.0', '1.0.0-rc.1', 1],
    ['1.0.0-beta.2', '1.0.0-beta.10', -1],
    ['1.0.0-alpha', '1.0.0-beta', -1],
  ])('%s vs %s is %i', (a, b, expected) => {
    expect(compareSemver(a, b)).toBe(expected);
  });

  it.each([['1.2'], ['latest'], [''], ['1.2.3.4'], [null], [undefined], [12]])('null for invalid %j', (bad) => {
    expect(compareSemver(bad, '1.0.0')).toBeNull();
    expect(compareSemver('1.0.0', bad)).toBeNull();
  });

  it('reads APP_VERSION from package.json', () => {
    expect(compareSemver(APP_VERSION, APP_VERSION)).toBe(0);
  });
});

describe('checkForUpdate', () => {
  it('reports available for a newer release, with its releases url', async () => {
    const fetchImpl = stub(respond(200, release()));
    const s = await checkForUpdate({ fetchImpl, currentVersion: '1.1.0' });
    expect(s).toMatchObject({
      status: 'available',
      current: '1.1.0',
      latest: '1.2.0',
      url: `${RELEASES_PAGE}/tag/v1.2.0`,
      publishedAt: '2030-01-01T00:00:00Z',
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`https://api.github.com/repos/${RELEASE_CONFIG.releasesRepo}/releases/latest`);
    expect(init.redirect).toBe('manual');
    expect(init.size).toBe(256 * 1024);
    expect(init.headers).toEqual({ Accept: 'application/vnd.github+json', 'User-Agent': 'Local App Studio' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('asks the PUBLIC releases repo, which an installed app can read anonymously', async () => {
    expect(UPDATE_REPO).toBe(RELEASE_CONFIG.releasesRepo);
    expect(DEV_UPDATE_REPO).toBe(RELEASE_CONFIG.sourceRepo);
    const fetchImpl = stub(respond(200, release()));
    await checkForUpdate({ fetchImpl, currentVersion: '1.1.0' });
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual([
      `https://api.github.com/repos/${RELEASE_CONFIG.releasesRepo}/releases/latest`,
    ]);
    expect(RELEASES_PAGE).toBe(`https://github.com/${RELEASE_CONFIG.releasesRepo}/releases`);
    // No Authorization header is ever sent.
    expect(Object.keys(fetchImpl.mock.calls[0][1].headers)).not.toContain('Authorization');
  });

  it('compares the vX.Y.Z tag local-app-studio-releases uses against the app version', async () => {
    // publishPublic.js publishes the same tag as the private release: v0.2.0 against app 0.2.0.
    const same = await checkForUpdate({ fetchImpl: stub(respond(200, release({ tag_name: 'v0.2.0' }))), currentVersion: '0.2.0' });
    expect(same).toMatchObject({ status: 'current', latest: '0.2.0', current: '0.2.0' });
    __resetUpdateCacheForTests();
    const next = await checkForUpdate({
      fetchImpl: stub(respond(200, release({ tag_name: 'v0.3.0', html_url: `${RELEASES_PAGE}/tag/v0.3.0` }))),
      currentVersion: '0.2.0',
    });
    expect(next).toMatchObject({ status: 'available', latest: '0.3.0', url: `${RELEASES_PAGE}/tag/v0.3.0` });
  });

  it('never links to the private repo: a release page outside local-app-studio-releases falls back to the public page', async () => {
    const s = await checkForUpdate({
      fetchImpl: stub(respond(200, release({ html_url: `${DEV_RELEASES_PAGE}/tag/v1.2.0` }))),
      currentVersion: '1.1.0',
    });
    expect(s).toMatchObject({ status: 'available', url: RELEASES_PAGE });
  });

  it('reports current when equal or when local is newer', async () => {
    expect((await checkForUpdate({ fetchImpl: stub(respond(200, release())), currentVersion: '1.2.0' })).status).toBe('current');
    const newer = await checkForUpdate({ fetchImpl: stub(respond(200, release())), currentVersion: '1.3.0', refresh: true });
    expect(newer).toMatchObject({ status: 'current', latest: '1.2.0', current: '1.3.0' });
  });

  it('accepts a tag without the v prefix', async () => {
    const s = await checkForUpdate({ fetchImpl: stub(respond(200, release({ tag_name: '2.0.0' }))), currentVersion: '1.0.0' });
    expect(s).toMatchObject({ status: 'available', latest: '2.0.0' });
  });

  it('ignores draft and prerelease releases', async () => {
    for (const flag of [{ draft: true }, { prerelease: true }]) {
      __resetUpdateCacheForTests();
      const s = await checkForUpdate({ fetchImpl: stub(respond(200, release(flag))), currentVersion: '1.0.0' });
      expect(s).toMatchObject({ status: 'unavailable', reason: 'not_found' });
    }
  });

  it('maps 404 to not_found (private repo), 403 and 429 to rate_limited', async () => {
    const cases = [[404, 'not_found'], [403, 'rate_limited'], [429, 'rate_limited'], [500, 'bad_response']];
    for (const [status, reason] of cases) {
      __resetUpdateCacheForTests();
      const s = await checkForUpdate({ fetchImpl: stub(respond(status, {})), currentVersion: '1.0.0' });
      expect(s).toMatchObject({ status: 'unavailable', reason });
    }
  });

  it('treats a redirect as a bad response', async () => {
    const s = await checkForUpdate({ fetchImpl: stub(respond(302, {})), currentVersion: '1.0.0' });
    expect(s).toMatchObject({ status: 'unavailable', reason: 'bad_response' });
  });

  it('maps an abort to timeout and any other throw to network', async () => {
    const abort = vi.fn(async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); });
    expect(await checkForUpdate({ fetchImpl: abort, currentVersion: '1.0.0' })).toMatchObject({ reason: 'timeout' });
    __resetUpdateCacheForTests();
    const down = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    expect(await checkForUpdate({ fetchImpl: down, currentVersion: '1.0.0' })).toMatchObject({ reason: 'network' });
  });

  it('really times out a hanging request through the abort signal', async () => {
    const hanging = vi.fn(
      (url, { signal }) =>
        new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
    );
    const s = await checkForUpdate({ fetchImpl: hanging, currentVersion: '1.0.0', timeoutMs: 20 });
    expect(s).toMatchObject({ status: 'unavailable', reason: 'timeout' });
  });

  it('maps a bad tag, non-JSON and an oversized body to bad_response', async () => {
    const bad = [
      respond(200, release({ tag_name: 'nightly' })),
      respond(200, release({ tag_name: 42 })),
      respond(200, null, { raw: '<html>nope</html>' }),
      respond(200, null, { raw: JSON.stringify({ tag_name: 'v1.2.0', pad: 'x'.repeat(300 * 1024) }) }),
    ];
    for (const r of bad) {
      __resetUpdateCacheForTests();
      const s = await checkForUpdate({ fetchImpl: stub(r), currentVersion: '1.0.0' });
      expect(s).toMatchObject({ status: 'unavailable', reason: 'bad_response' });
    }
  });

  it('replaces a foreign html_url with the releases page and drops a bad published_at', async () => {
    const s = await checkForUpdate({
      fetchImpl: stub(respond(200, release({ html_url: 'https://evil.example/x', published_at: 'soon' }))),
      currentVersion: '1.0.0',
    });
    expect(s).toMatchObject({ status: 'available', url: RELEASES_PAGE, publishedAt: null });
  });

  it('never forwards release body text', async () => {
    const s = await checkForUpdate({ fetchImpl: stub(respond(200, release({ body: 'SECRET NOTES' }))), currentVersion: '1.0.0' });
    expect(JSON.stringify(s)).not.toContain('SECRET NOTES');
  });

  it('caches results, and refresh bypasses the cache once the last fetch is over 60 s old', async () => {
    const t0 = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(t0);
    try {
      const fetchImpl = vi.fn(async () => respond(200, release()));
      await checkForUpdate({ fetchImpl, currentVersion: '1.0.0' });
      await checkForUpdate({ fetchImpl, currentVersion: '1.0.0' });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      clock.mockReturnValue(t0 + 61_000);
      await checkForUpdate({ fetchImpl, currentVersion: '1.0.0', refresh: true });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });

  it('ignores refresh when the last upstream fetch was under 60 s ago', async () => {
    const t0 = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(t0);
    try {
      const fetchImpl = vi.fn(async () => respond(200, release()));
      await checkForUpdate({ fetchImpl, currentVersion: '1.0.0' });
      clock.mockReturnValue(t0 + 30_000);
      const again = await checkForUpdate({ fetchImpl, currentVersion: '1.0.0', refresh: true });
      expect(again.status).toBe('available');
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      clock.mockRestore();
    }
  });

  it('shares one in-flight request between concurrent calls', async () => {
    let open;
    const gate = new Promise((resolve) => {
      open = resolve;
    });
    const fetchImpl = vi.fn(async () => {
      await gate;
      return respond(200, release());
    });
    const calls = [1, 2, 3].map(() => checkForUpdate({ fetchImpl, currentVersion: '1.0.0', refresh: true }));
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    open();
    const results = await Promise.all(calls);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(results[1]).toBe(results[0]);
    expect(results[2]).toBe(results[0]);
  });

  it('caches an unavailable result too (shorter), so a private repo is not hammered', async () => {
    const fetchImpl = vi.fn(async () => respond(404, {}));
    await checkForUpdate({ fetchImpl, currentVersion: '1.0.0' });
    await checkForUpdate({ fetchImpl, currentVersion: '1.0.0' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('throws NetworkOptInError before any fetch while the feature is off', async () => {
    await setNetworkFeature('updates', false);
    const fetchImpl = vi.fn();
    await expect(checkForUpdate({ fetchImpl })).rejects.toBeInstanceOf(NetworkOptInError);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('is gated even when a cached result exists', async () => {
    const fetchImpl = vi.fn(async () => respond(200, release()));
    await checkForUpdate({ fetchImpl, currentVersion: '1.0.0' });
    await setNetworkFeature('updates', false);
    await expect(checkForUpdate({ fetchImpl, currentVersion: '1.0.0' })).rejects.toBeInstanceOf(NetworkOptInError);
  });
});
