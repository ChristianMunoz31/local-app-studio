// GET /api/app/info: version, channel, desktop flag; no-store.
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { registerAppInfoRoutes } from '../appInfoRoutes.js';
import { getAppVersion } from '../runtime.js';
import { isCloudAiInBuild } from '../buildFeatures.js';

// The cloud provider is a pro part: a public build reports it absent (docs/ARCHITECTURE.md, "The pro seam").
const CLOUD = isCloudAiInBuild() ? 'present' : 'absent';

const makeApp = () => {
  const app = express();
  registerAppInfoRoutes(app);
  return app;
};

afterEach(() => {
  delete process.env.APP_CHANNEL;
  delete process.env.APP_DESKTOP;
});

describe('GET /api/app/info', () => {
  it('answers the stable shape by default', async () => {
    const res = await request(makeApp()).get('/api/app/info');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ data: { version: getAppVersion(), channel: 'stable', desktop: false, cloudAi: CLOUD } });
  });

  it('reports the dev channel and desktop mode', async () => {
    process.env.APP_CHANNEL = 'dev';
    process.env.APP_DESKTOP = '1';
    const res = await request(makeApp()).get('/api/app/info');
    expect(res.body.data.channel).toBe('dev');
    expect(res.body.data.desktop).toBe(true);
    expect(typeof res.body.data.version).toBe('string');
  });
});
