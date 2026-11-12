// Update check while config/release.json still has the template placeholder owner: it must never query GitHub.
// init-app:keep (the placeholder literals below are the point of this file; init-app must not rename them)
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ store: new Map() }));

vi.mock('../../loadEnv.js', () => ({}));
vi.mock('node-fetch', () => ({ default: vi.fn(async () => { throw new Error('real fetch must not be used'); }) }));
vi.mock('../../scripts/release/releaseConfig.js', async (importOriginal) => ({
  ...(await importOriginal()),
  RELEASE_CONFIG: Object.freeze({ sourceRepo: 'your-github-user/your-app', releasesRepo: 'your-github-user/your-app-releases' }),
}));
vi.mock('../dataAccess.js', () => ({
  getState: vi.fn(async (key, fallback = null) => (h.store.has(key) ? h.store.get(key) : fallback)),
  setState: vi.fn(async (key, value) => {
    h.store.set(key, value);
    return { key, value };
  }),
}));

import { PLACEHOLDER_REPO_OWNER, isPlaceholderRepo } from '../../scripts/release/releaseConfig.js';
import { __resetNetPolicyForTests, setNetworkFeature } from '../netPolicy.js';
import { __resetUpdateCacheForTests, checkForUpdate } from '../updateCheck.js';

beforeEach(async () => {
  h.store.clear();
  delete process.env.APP_NETWORK_OPTIN;
  __resetNetPolicyForTests();
  __resetUpdateCacheForTests();
  await setNetworkFeature('updates', true);
});

describe('isPlaceholderRepo', () => {
  it.each([
    [`${PLACEHOLDER_REPO_OWNER}/anything`, true],
    ['YOUR-GITHUB-USER/x', true],
    ['acme/notes-releases', false],
    ['acme/your-github-user', false],
    [undefined, false],
    [42, false],
  ])('%j is %s', (repo, expected) => {
    expect(isPlaceholderRepo(repo)).toBe(expected);
  });
});

describe('checkForUpdate with a placeholder repo', () => {
  it('stable: answers not_configured and never calls fetch', async () => {
    const fetchImpl = vi.fn();
    const s = await checkForUpdate({ fetchImpl, currentVersion: '1.0.0', channel: 'stable' });
    expect(s).toMatchObject({ status: 'unavailable', reason: 'not_configured', channel: 'stable', current: '1.0.0' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('dev: answers not_configured and never calls fetch', async () => {
    const fetchImpl = vi.fn();
    const s = await checkForUpdate({ fetchImpl, currentVersion: '1.0.0-dev', channel: 'dev' });
    expect(s).toMatchObject({ status: 'unavailable', reason: 'not_configured', channel: 'dev' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('still refuses first while the updates opt-in is off', async () => {
    await setNetworkFeature('updates', false);
    const fetchImpl = vi.fn();
    await expect(checkForUpdate({ fetchImpl, currentVersion: '1.0.0' })).rejects.toMatchObject({ name: 'NetworkOptInError' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
