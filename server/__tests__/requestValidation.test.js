// Through the real server.js: a malformed percent-escape in a route param answers 400 invalid_request, not 500.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../loadEnv.js', () => ({}));

let app;
let n = 0;
const saved = { APP_PASSWORD: process.env.APP_PASSWORD, AUTH_SECRET: process.env.AUTH_SECRET };

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  delete process.env.AUTH_SECRET;
  app = (await import('../../server.js')).default;
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('malformed percent-escapes in route params', () => {
  it('answers 400 invalid_request, not 500', async () => {
    const res = await request(app).put('/api/state/%E0%A4%A').set('X-Forwarded-For', `198.51.100.${(n += 1)}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_request');
    expect(JSON.stringify(res.body)).not.toMatch(/URIError|decode/i);
  });
});
