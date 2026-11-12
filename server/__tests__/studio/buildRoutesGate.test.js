// A build without the installer answers every build route with the 403 feature_unavailable envelope first (docs/ARCHITECTURE.md,
// 'The pro seam'): before the id is read, the body is checked or the build opt-in is asked. This file mocks the flag, so it runs in
// a pro run and a public run alike; buildPublic.test.js covers what only a public build has.
import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { registerBuildRoutes } from '../../studio/buildRoutes.js';

vi.mock('../../../src/proParts.js', () => ({ PRO_PARTS: { helper: true, installer: false, licensing: true, cloud: true } }));

const SENTENCE = 'Making an installer is not in this build. Export the app instead.';
const id = crypto.randomUUID();

function app() {
  const calls = [];
  const service = new Proxy({}, { get: (_t, name) => () => calls.push(String(name)) });
  const a = express();
  a.use(express.json());
  registerBuildRoutes(a, { service, detect: async () => calls.push('detect') });
  return { a, calls };
}

describe('build routes without the installer', () => {
  const routes = [
    ['get', '/api/studio/build/toolchain'],
    ['get', `/api/studio/apps/${id}/builds`],
    ['post', `/api/studio/apps/${id}/builds`],
    ['get', `/api/studio/builds/${id}`],
    ['get', `/api/studio/builds/${id}/events`],
    ['post', `/api/studio/builds/${id}/cancel`],
    ['get', '/api/studio/apps/not-an-id/builds'],
    ['post', '/api/studio/builds/not-an-id/cancel'],
  ];

  it.each(routes)('%s %s answers 403 feature_unavailable, no-store, and touches nothing', async (method, url) => {
    const { a, calls } = app();
    const res = await request(a)[method](url).send(method === 'post' ? { baseRevision: 'x' } : undefined);
    expect(res.status).toBe(403);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ code: 'feature_unavailable', feature: 'installer', error: SENTENCE, message: SENTENCE });
    expect(typeof res.body.requestId).toBe('string');
    expect(calls).toEqual([]);
  });
});
