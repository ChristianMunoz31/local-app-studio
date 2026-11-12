// /api/profile and /api/settings/network contracts, plus profile storage behavior.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const h = vi.hoisted(() => ({ store: new Map(), down: false, invalid: false }));

vi.mock('../../loadEnv.js', () => ({}));
vi.mock('../../scripts/release/releaseConfig.js', async (importOriginal) => ({
  ...(await importOriginal()),
  RELEASE_CONFIG: Object.freeze({ sourceRepo: 'acme/notes', releasesRepo: 'acme/notes-releases' }),
}));
vi.mock('node-fetch', () => ({
  default: vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: new Map(),
    text: async () =>
      JSON.stringify({
        tag_name: 'v99.0.0',
        html_url: 'https://github.com/acme/notes-releases/releases/tag/v99.0.0',
        published_at: '2030-01-01T00:00:00Z',
      }),
  })),
}));
vi.mock('../dataAccess.js', async () => {
  const { DbError } = await import('../db/index.js');
  const fail = () => {
    if (h.invalid) throw new DbError('invalid_value', 'x');
    if (h.down) throw Object.assign(new Error('Local database is unavailable.'), { status: 503 });
  };
  return {
    getState: vi.fn(async (key, fallback = null) => {
      fail();
      return h.store.has(key) ? h.store.get(key) : fallback;
    }),
    setState: vi.fn(async (key, value) => {
      fail();
      h.store.set(key, value);
      return { key, value };
    }),
  };
});

import fetch from 'node-fetch';
import { registerSettingsRoutes } from '../settingsRoutes.js';
import { __resetNetPolicyForTests, networkRequiredBody } from '../netPolicy.js';
import { __resetUpdateCacheForTests } from '../updateCheck.js';
import { __resetProfileCacheForTests, getDisplayName, sanitizeDisplayName } from '../profile.js';

const app = () => {
  const a = express();
  a.use(express.json());
  registerSettingsRoutes(a);
  return a;
};

beforeEach(() => {
  h.store.clear();
  h.down = false;
  h.invalid = false;
  delete process.env.APP_NETWORK_OPTIN;
  __resetNetPolicyForTests();
  __resetProfileCacheForTests();
});

describe('GET /api/profile', () => {
  it('returns nulls for a fresh install', async () => {
    const res = await request(app()).get('/api/profile');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ displayName: null, onboardedAt: null });
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('PUT /api/profile', () => {
  it('sets a trimmed display name and stores it under app_state key profile', async () => {
    const res = await request(app()).put('/api/profile').send({ displayName: '  Sam  ' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ displayName: 'Sam', onboardedAt: null });
    expect(h.store.get('profile')).toEqual({ displayName: 'Sam', onboardedAt: null });
    expect((await request(app()).get('/api/profile')).body.displayName).toBe('Sam');
  });

  it('strips control characters and caps at 60 characters', async () => {
    const res = await request(app()).put('/api/profile').send({ displayName: `\u0000Sa\u0007m\n${'x'.repeat(100)}` });
    expect(res.body.displayName.startsWith('Sam')).toBe(true);
    expect(res.body.displayName).toHaveLength(60);
    expect([...res.body.displayName].every((c) => c.charCodeAt(0) > 31)).toBe(true);
  });

  it('turns an empty or blank name, and null, into null', async () => {
    await request(app()).put('/api/profile').send({ displayName: 'Sam' });
    for (const displayName of ['', '   ', '\u0001\u0002', null]) {
      const res = await request(app()).put('/api/profile').send({ displayName });
      expect(res.body.displayName).toBeNull();
    }
  });

  it('onboarded:true sets onboardedAt once and keeps the display name', async () => {
    await request(app()).put('/api/profile').send({ displayName: 'Sam' });
    const first = await request(app()).put('/api/profile').send({ onboarded: true });
    expect(first.status).toBe(200);
    expect(first.body.displayName).toBe('Sam');
    expect(Number.isNaN(Date.parse(first.body.onboardedAt))).toBe(false);
    const second = await request(app()).put('/api/profile').send({ onboarded: true });
    expect(second.body.onboardedAt).toBe(first.body.onboardedAt);
  });

  it.each([
    [{ displayName: 5 }],
    [{ displayName: ['a'] }],
    [{ displayName: {} }],
    [{ onboarded: false }],
    [{ onboarded: 'true' }],
    [[]],
  ])('400s on bad input %j', async (body) => {
    const res = await request(app()).put('/api/profile').send(body);
    expect(res.status).toBe(400);
    expect(h.store.has('profile')).toBe(false);
  });

  it('accepts an empty object and changes nothing', async () => {
    const res = await request(app()).put('/api/profile').send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ displayName: null, onboardedAt: null });
  });
});

describe('profile with storage unavailable', () => {
  it('503s with the storage-unavailable shape on GET and PUT', async () => {
    h.down = true;
    for (const res of [
      await request(app()).get('/api/profile'),
      await request(app()).put('/api/profile').send({ displayName: 'Sam' }),
    ]) {
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ code: 'db_unavailable' });
    }
  });

  it('maps an invalid-input data error to 400', async () => {
    h.invalid = true;
    const res = await request(app()).get('/api/profile');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'invalid_request' });
  });

  it('getDisplayName resolves to null instead of throwing', async () => {
    h.down = true;
    await expect(getDisplayName()).resolves.toBeNull();
  });
});

describe('getDisplayName / sanitizeDisplayName', () => {
  it('reads the stored name and caches it', async () => {
    h.store.set('profile', { displayName: 'Robin', onboardedAt: null });
    expect(await getDisplayName()).toBe('Robin');
    h.store.set('profile', { displayName: 'Changed', onboardedAt: null });
    expect(await getDisplayName()).toBe('Robin');
    __resetProfileCacheForTests();
    expect(await getDisplayName()).toBe('Changed');
  });

  it('sanitizes non-strings to null', () => {
    expect(sanitizeDisplayName(undefined)).toBeNull();
    expect(sanitizeDisplayName(12)).toBeNull();
    expect(sanitizeDisplayName(' ok ')).toBe('ok');
  });
});

describe('GET /api/settings/network', () => {
  it('lists the five features (the kit four plus the Studio build feature), all off, in fixed order', async () => {
    const res = await request(app()).get('/api/settings/network');
    expect(res.status).toBe(200);
    expect(res.body.features.map((f) => f.id)).toEqual(['cloudAi', 'aiLan', 'updates', 'license', 'build']);
    expect(res.body.features.every((f) => f.enabled === false)).toBe(true);
    expect(res.body.features[0]).toMatchObject({ id: 'cloudAi', label: 'Cloud AI provider', hosts: ['the endpoint you set in Settings > AI'] });
  });

  it('reflects APP_NETWORK_OPTIN pre-enables', async () => {
    process.env.APP_NETWORK_OPTIN = 'aiLan';
    const res = await request(app()).get('/api/settings/network');
    expect(res.body.features.find((f) => f.id === 'aiLan').enabled).toBe(true);
  });

  it('still answers (env only) when storage is down', async () => {
    h.down = true;
    const res = await request(app()).get('/api/settings/network');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/settings/updates/check', () => {
  beforeEach(() => {
    __resetUpdateCacheForTests();
    fetch.mockClear();
  });

  it('403s with the opt-in contract while off and makes no request', async () => {
    const res = await request(app()).get('/api/settings/updates/check');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'network_opt_in_required', message: networkRequiredBody('updates').message });
    expect(res.body.feature).toBe('updates');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('answers 200 { data } once enabled, with the status from GitHub', async () => {
    process.env.APP_NETWORK_OPTIN = 'updates';
    const res = await request(app()).get('/api/settings/updates/check');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data).toMatchObject({ status: 'available', latest: '99.0.0', url: 'https://github.com/acme/notes-releases/releases/tag/v99.0.0' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refresh=1 is ignored when the last upstream fetch was under 60 s ago', async () => {
    process.env.APP_NETWORK_OPTIN = 'updates';
    await request(app()).get('/api/settings/updates/check');
    await request(app()).get('/api/settings/updates/check');
    expect(fetch).toHaveBeenCalledTimes(1);
    const res = await request(app()).get('/api/settings/updates/check?refresh=1');
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('turns a 404 (private repo) into a 200 unavailable, not a 5xx', async () => {
    process.env.APP_NETWORK_OPTIN = 'updates';
    fetch.mockResolvedValueOnce({ ok: false, status: 404, headers: new Map(), text: async () => '{}' });
    const res = await request(app()).get('/api/settings/updates/check');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'unavailable', reason: 'not_found' });
  });
});

describe('PUT /api/settings/network', () => {
  it('enables and disables a feature and returns the same shape as GET', async () => {
    const on = await request(app()).put('/api/settings/network').send({ id: 'aiLan', enabled: true });
    expect(on.status).toBe(200);
    expect(on.body.features.find((f) => f.id === 'aiLan').enabled).toBe(true);
    const get = await request(app()).get('/api/settings/network');
    expect(get.body).toEqual(on.body);
    const off = await request(app()).put('/api/settings/network').send({ id: 'aiLan', enabled: false });
    expect(off.body.features.find((f) => f.id === 'aiLan').enabled).toBe(false);
  });

  it.each([
    [{ id: 'nope', enabled: true }],
    [{ id: 'aiLan', enabled: 'true' }],
    [{ id: 'aiLan', enabled: 1 }],
    [{ id: 'aiLan' }],
    [{ enabled: true }],
    [{ id: 5, enabled: true }],
    [[]],
  ])('400s on %j', async (body) => {
    const res = await request(app()).put('/api/settings/network').send(body);
    expect(res.status).toBe(400);
    expect(h.store.has('network.optIn')).toBe(false);
  });

  it('503s when storage is unavailable', async () => {
    h.down = true;
    const res = await request(app()).put('/api/settings/network').send({ id: 'aiLan', enabled: true });
    expect(res.status).toBe(503);
  });
});
