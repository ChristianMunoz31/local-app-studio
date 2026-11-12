// Responses that carry user data or settings must not be cacheable by shared caches: a CDN
// holding `public, s-maxage` could serve them to unauthenticated clients. Data, settings, secrets,
// export, license and the Pro summary are all no-store.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../loadEnv.js', () => ({}));
vi.mock('node-fetch', () => ({
  default: vi.fn(async () => ({ ok: true, status: 200, json: async () => [] })),
}));

let app;
const saved = {
  SECRETS_ENCRYPTION_KEY: process.env.SECRETS_ENCRYPTION_KEY,
  APP_PASSWORD: process.env.APP_PASSWORD,
  AUTH_SECRET: process.env.AUTH_SECRET,
};
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

beforeAll(async () => {
  delete process.env.SECRETS_ENCRYPTION_KEY;
  delete process.env.APP_PASSWORD;
  delete process.env.AUTH_SECRET;
  app = (await import('../../server.js')).default;
});

describe('cache headers on routes that carry user data or settings', () => {
  it.each(['/api/secrets', '/api/license', '/api/settings/ai', '/api/settings/network', '/api/backups'])(
    '%s is never shared-cacheable',
    async (path) => {
      const res = await request(app).get(path);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toMatch(/no-store/);
      expect(res.headers['cache-control']).not.toMatch(/public|s-maxage/);
    },
  );

  it('an unmatched /api path is JSON and carries no public caching header', async () => {
    const res = await request(app).get('/api/not-a-route');
    expect(res.status).toBe(404);
    expect(res.headers['cache-control'] ?? '').not.toMatch(/public|s-maxage/);
  });
});
