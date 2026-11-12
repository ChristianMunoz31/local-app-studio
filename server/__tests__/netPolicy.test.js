// Outbound-network opt-in: everything is off by default, env can pre-enable, stored choices
// win, storage failures fall back to env only, and the gated routes make no request.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_BUILD } from './helpers/proBuild.js';
import express from 'express';
import request from 'supertest';

const h = vi.hoisted(() => ({ store: new Map(), down: false }));

vi.mock('../../loadEnv.js', () => ({}));
// A real releases repo: the shipped config is the placeholder, which is never queried.
vi.mock('../../scripts/release/releaseConfig.js', async (importOriginal) => ({
  ...(await importOriginal()),
  RELEASE_CONFIG: Object.freeze({ sourceRepo: 'acme/notes', releasesRepo: 'acme/notes-releases' }),
}));
vi.mock('node-fetch', () => ({ default: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })) }));
vi.mock('../dataAccess.js', () => {
  const unavailable = () => Object.assign(new Error('Local database is unavailable.'), { status: 503 });
  return {
    getState: vi.fn(async (key, fallback = null) => {
      if (h.down) throw unavailable();
      return h.store.has(key) ? h.store.get(key) : fallback;
    }),
    setState: vi.fn(async (key, value) => {
      if (h.down) throw unavailable();
      h.store.set(key, value);
      return { key, value };
    }),
  };
});

import fetch from 'node-fetch';
import {
  NETWORK_FEATURES,
  NetworkOptInError,
  __resetNetPolicyForTests,
  isEnabled,
  listNetworkFeatures,
  networkRequiredBody,
  requireNetwork,
  setNetworkFeature,
} from '../netPolicy.js';
import { __resetUpdateCacheForTests, checkForUpdate } from '../updateCheck.js';

const ORIGINAL_OPT_IN = process.env.APP_NETWORK_OPTIN;

beforeEach(() => {
  delete process.env.APP_NETWORK_OPTIN;
  h.store.clear();
  h.down = false;
  __resetNetPolicyForTests();
  fetch.mockClear();
});
afterEach(() => {
  if (ORIGINAL_OPT_IN === undefined) delete process.env.APP_NETWORK_OPTIN;
  else process.env.APP_NETWORK_OPTIN = ORIGINAL_OPT_IN;
  __resetNetPolicyForTests();
});

describe('defaults', () => {
  it('every feature is off', async () => {
    for (const id of ['cloudAi', 'aiLan', 'updates', 'license', 'build']) expect(await isEnabled(id)).toBe(false);
  });

  it('lists the features in fixed order with label, description and hosts', async () => {
    const { features } = await listNetworkFeatures();
    expect(features.map((f) => f.id)).toEqual(['cloudAi', 'aiLan', 'updates', 'license', 'build']);
    for (const f of features) {
      expect(f.enabled).toBe(false);
      expect(typeof f.label).toBe('string');
      expect(typeof f.description).toBe('string');
      expect(f.hosts.length).toBeGreaterThan(0);
      expect(Object.keys(f).sort()).toEqual(['available', 'description', 'enabled', 'hosts', 'id', 'label']);
      // A public build has no cloud provider (server/buildFeatures.js), so that one feature is not available in it.
      expect(f.available).toBe(!(PUBLIC_BUILD && f.id === 'cloudAi'));
    }
    expect(NETWORK_FEATURES).toHaveLength(5);
    // The license feature is the last kit feature and names both stores; only Activate and Move to another computer use it.
    expect(NETWORK_FEATURES.find((f) => f.id === 'license')).toMatchObject({
      id: 'license',
      label: 'License activation',
      hosts: ['api.gumroad.com', 'api.lemonsqueezy.com'],
    });
    expect(NETWORK_FEATURES.find((f) => f.id === 'license').description).toBe(
      'Contacts Gumroad or Lemon Squeezy only when you click Activate or Move to another computer in Settings > License. Your license key goes to the store you bought from. Clicking one of those buttons turns this on.',
    );
    // The update check reaches only GitHub.
    expect(NETWORK_FEATURES.find((f) => f.id === 'updates').hosts).toEqual(['api.github.com']);
  });

  it('an unknown id is never enabled', async () => {
    process.env.APP_NETWORK_OPTIN = 'nope';
    expect(await isEnabled('nope')).toBe(false);
  });
});

describe('APP_NETWORK_OPTIN', () => {
  it('pre-enables the listed features and ignores unknown names', async () => {
    process.env.APP_NETWORK_OPTIN = ' updates , aiLan,bogus,github ';
    expect(await isEnabled('updates')).toBe(true);
    expect(await isEnabled('aiLan')).toBe(true);
    expect(await isEnabled('github')).toBe(false);
    expect(await isEnabled('cloudAi')).toBe(false);
    expect((await listNetworkFeatures()).features.filter((f) => f.enabled).map((f) => f.id)).toEqual(['aiLan', 'updates']);
  });

  it('is the only source when storage is unavailable', async () => {
    h.down = true;
    process.env.APP_NETWORK_OPTIN = 'updates';
    expect(await isEnabled('updates')).toBe(true);
    expect(await isEnabled('aiLan')).toBe(false);
  });
});

describe('stored choice', () => {
  it('persists under network.optIn and turns a feature on', async () => {
    await setNetworkFeature('aiLan', true);
    expect(h.store.get('network.optIn')).toEqual({ aiLan: true });
    expect(await isEnabled('aiLan')).toBe(true);
    expect(await isEnabled('updates')).toBe(false);
  });

  it('wins over the env default in both directions', async () => {
    process.env.APP_NETWORK_OPTIN = 'updates';
    await setNetworkFeature('updates', false);
    await setNetworkFeature('aiLan', true);
    expect(await isEnabled('updates')).toBe(false);
    expect(await isEnabled('aiLan')).toBe(true);
  });

  it('keeps other features when one changes, and ignores junk in storage', async () => {
    h.store.set('network.optIn', { updates: true, github: 'yes', extra: true });
    await setNetworkFeature('aiLan', true);
    expect(h.store.get('network.optIn')).toEqual({ updates: true, aiLan: true });
  });

  it('setNetworkFeature rejects when storage is down', async () => {
    h.down = true;
    await expect(setNetworkFeature('updates', true)).rejects.toMatchObject({ status: 503 });
  });
});

describe('requireNetwork middleware', () => {
  const app = () => {
    const a = express();
    for (const f of NETWORK_FEATURES) a.get(`/x/${f.id}`, requireNetwork(f.id), (req, res) => res.json({ ok: true }));
    return a;
  };

  it.each(NETWORK_FEATURES.map((f) => [f.id, f.label]))('403s %s with the contract body while off', async (id, label) => {
    const res = await request(app()).get(`/x/${id}`);
    expect(res.status).toBe(403);
    if (PUBLIC_BUILD && id === 'cloudAi') {
      // The cloud provider is not in a public build: the feature answers feature_unavailable, not the opt-in error.
      expect(res.body).toMatchObject({ code: 'feature_unavailable', feature: id });
      return;
    }
    expect(res.body).toMatchObject({
      code: 'network_opt_in_required',
      feature: id,
      error: `${label} is turned off. Enable it in Settings → Network (this calls the internet).`,
      message: `${label} is turned off. Enable it in Settings → Network (this calls the internet).`,
    });
    expect(res.body).toMatchObject({ feature: id, message: networkRequiredBody(id).message, code: networkRequiredBody(id).error });
  });

  it('lets the request through once enabled', async () => {
    await setNetworkFeature('updates', true);
    const res = await request(app()).get('/x/updates');
    expect(res.status).toBe(200);
    expect((await request(app()).get('/x/aiLan')).status).toBe(403);
  });
});

describe('the update check makes no request while gated off', () => {
  const release = {
    ok: true,
    status: 200,
    headers: new Map(),
    text: async () =>
      JSON.stringify({ tag_name: 'v9.9.9', html_url: 'https://github.com/acme/notes-releases/releases/tag/v9.9.9' }),
  };

  it('checkForUpdate throws NetworkOptInError before calling fetch', async () => {
    __resetUpdateCacheForTests();
    const fetchImpl = vi.fn(async () => release);
    await expect(checkForUpdate({ fetchImpl, currentVersion: '1.0.0', channel: 'stable' })).rejects.toBeInstanceOf(NetworkOptInError);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('calls out once updates is enabled, and only to api.github.com', async () => {
    __resetUpdateCacheForTests();
    await setNetworkFeature('updates', true);
    const fetchImpl = vi.fn(async () => release);
    const out = await checkForUpdate({ fetchImpl, currentVersion: '1.0.0', channel: 'stable' });
    expect(out.status).toBe('available');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toMatch(/^https:\/\/api\.github\.com\//);
  });
});
