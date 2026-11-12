// The `build` network feature: listed in studio mode only, off by default, shown by the settings route, gated by
// requireNetwork, and labelled "App builds" in the network activity list.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { closeTestDb, createTestDb, resetDb } from '../helpers/testDb.js';
import { insertMany } from '../../db/index.js';

const h = vi.hoisted(() => ({ store: new Map() }));

vi.mock('../../../loadEnv.js', () => ({}));
vi.mock('../../dataAccess.js', () => ({
  getState: vi.fn(async (key, fallback = null) => (h.store.has(key) ? h.store.get(key) : fallback)),
  setState: vi.fn(async (key, value) => {
    h.store.set(key, value);
    return { key, value };
  }),
}));

import { registerSettingsRoutes } from '../../settingsRoutes.js';
import { NETWORK_FEATURES, __resetNetPolicyForTests, networkRequiredBody, requireNetwork, setNetworkFeature } from '../../netPolicy.js';
import studioData from '../../modules/studio.data.js';
import runtimeData from '../../modules/studio.data.disabled.js';
import { listNetworkActivity } from '../../networkAudit.js';

const HOSTS = [
  'registry.npmjs.org',
  'crates.io',
  'index.crates.io',
  'static.crates.io',
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
];

beforeEach(() => {
  h.store.clear();
  delete process.env.APP_NETWORK_OPTIN;
  __resetNetPolicyForTests();
});

describe('build feature declaration', () => {
  it('studio mode declares it with the design hosts', () => {
    expect(studioData.networkFeatures).toHaveLength(1);
    expect(studioData.networkFeatures[0]).toMatchObject({ id: 'build', label: 'Allow downloads for builds', hosts: HOSTS });
    expect(studioData.networkFeatures[0].description).toBe('Needed once per build. Nothing about your apps or data is sent.');
  });

  it('the runtime descriptor lists no network feature, so built apps never show it', () => {
    expect(runtimeData.networkFeatures).toEqual([]);
  });

  it('appears last in NETWORK_FEATURES, after the kit four', () => {
    expect(NETWORK_FEATURES.map((f) => f.id)).toEqual(['cloudAi', 'aiLan', 'updates', 'license', 'build']);
  });

  it('a runtime-mode load of the studio descriptor has no network feature', async () => {
    vi.resetModules();
    const saved = process.env.APP_MODE;
    process.env.APP_MODE = 'runtime';
    try {
      const mod = (await import('../../modules/studio.data.js')).default;
      expect(mod.networkFeatures).toEqual([]);
    } finally {
      if (saved === undefined) delete process.env.APP_MODE;
      else process.env.APP_MODE = saved;
      vi.resetModules();
    }
  });
});

describe('settings listing', () => {
  const app = () => {
    const a = express();
    a.use(express.json());
    registerSettingsRoutes(a);
    return a;
  };

  it('GET /api/settings/network lists build, off, available, with the hosts', async () => {
    const res = await request(app()).get('/api/settings/network');
    expect(res.status).toBe(200);
    const build = res.body.features.find((f) => f.id === 'build');
    expect(build).toEqual({
      id: 'build',
      enabled: false,
      available: true,
      label: 'Allow downloads for builds',
      description: studioData.networkFeatures[0].description,
      hosts: HOSTS,
    });
  });

  it('PUT turns it on and off', async () => {
    const on = await request(app()).put('/api/settings/network').send({ id: 'build', enabled: true });
    expect(on.status).toBe(200);
    const get = await request(app()).get('/api/settings/network');
    expect(get.body.features.find((f) => f.id === 'build').enabled).toBe(true);
  });
});

describe('requireNetwork("build")', () => {
  const app = () => {
    const a = express();
    a.post('/api/studio/apps/:id/builds', requireNetwork('build'), (req, res) => res.status(201).json({ data: {} }));
    return a;
  };

  it('403s network_opt_in_required while off', async () => {
    const res = await request(app()).post('/api/studio/apps/x/builds');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      code: 'network_opt_in_required',
      feature: 'build',
      error: 'Allow downloads for builds is turned off. Enable it in Settings → Network (this calls the internet).',
      message: 'Allow downloads for builds is turned off. Enable it in Settings → Network (this calls the internet).',
    });
    expect(res.body).toMatchObject({ feature: 'build', message: networkRequiredBody('build').message });
  });

  it('lets the request through once enabled', async () => {
    await setNetworkFeature('build', true);
    expect((await request(app()).post('/api/studio/apps/x/builds')).status).toBe(201);
  });
});

describe('network activity label', () => {
  let db;
  beforeEach(() => {
    db = createTestDb();
    resetDb(db);
  });
  afterEach(() => closeTestDb(db));

  it('reads "Allow downloads for builds" for a build row', () => {
    insertMany(
      'audit_log',
      [
        {
          created_at: new Date(Date.UTC(2026, 0, 1)).toISOString(),
          kind: 'export',
          feature: 'network_call',
          status: 'ok',
          meta: { net_feature: 'build', net_host: 'registry.npmjs.org' },
        },
      ],
      { db },
    );
    const { entries } = listNetworkActivity({ db });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ feature: 'build', label: 'Allow downloads for builds', host: 'registry.npmjs.org', result: 'ok' });
  });
});
