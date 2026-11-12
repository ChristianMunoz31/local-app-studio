// Desktop gate: test vector, bootstrap, cookie, cross-site rules, APP_PASSWORD ignored; web mode unchanged.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../loadEnv.js', () => ({}));

const SECRET = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
const VECTOR_TOKEN = '8867548bb97c2a31dc8a076a4df9923b79011f6308e2b00c22399444c552c5d8';
const VECTOR_COOKIE = 'eoPsO4hP1XsPWM3d32wefuHOkdwiy_c5BW1klfm9h3g';

const ENV_KEYS = ['APP_DESKTOP', 'APP_PASSWORD', 'AUTH_SECRET', 'SECRETS_ENCRYPTION_KEY', 'APP_DIST_DIR'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('desktop auth vector', () => {
  it('matches the shared test vector', async () => {
    const auth = await import('../desktop/auth.js');
    auth.initDesktopAuth(SECRET);
    expect(auth.bootstrapToken()).toBe(VECTOR_TOKEN);
    expect(auth.cookieValue()).toBe(VECTOR_COOKIE);
  });

  it('rejects a secret that is not 32 bytes', async () => {
    const auth = await import('../desktop/auth.js');
    expect(() => auth.initDesktopAuth(Buffer.alloc(31))).toThrow(TypeError);
    expect(() => auth.initDesktopAuth('00'.repeat(32))).toThrow(TypeError);
  });
});

describe('desktop gate', () => {
  let app;
  let auth;
  beforeAll(async () => {
    vi.resetModules();
    delete process.env.SECRETS_ENCRYPTION_KEY;
    delete process.env.APP_DIST_DIR;
    process.env.APP_DESKTOP = '1';
    process.env.APP_PASSWORD = 'sekret-pass';
    process.env.AUTH_SECRET = 'unit-test-secret-unit-test-secret-1234';
    app = (await import('../../server.js')).default;
    expect(app.get('query parser')).toBe('extended');
    auth = await import('../desktop/auth.js');
    auth.initDesktopAuth(SECRET);
  });
  const cookie = `app_desktop=${VECTOR_COOKIE}`;

  it('401s every API route without the cookie, including auth status and login', async () => {
    for (const [method, url] of [
      ['get', '/api/state'],
      ['get', '/api/auth/status'],
      ['post', '/api/login'],
      ['get', '/api/not-a-route'],
    ]) {
      const res = await request(app)[method](url);
      expect(res.status, url).toBe(401);
      expect(res.body).toMatchObject({ code: 'desktop_auth_required' });
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });

  it('401s the UI without the cookie with a small static page', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Open Local App Studio from its app icon.');
    expect(res.text).not.toContain('\u2014');
  });

  it('rejects a wrong cookie', async () => {
    const res = await request(app).get('/api/state').set('Cookie', 'app_desktop=nope');
    expect(res.status).toBe(401);
  });

  it('403s a wrong or malformed bootstrap token and does not burn the real one', async () => {
    for (const t of ['0'.repeat(64), 'zz', '', VECTOR_TOKEN.toUpperCase()]) {
      const res = await request(app).get('/desktop/bootstrap').query({ token: t });
      expect(res.status, t).toBe(403);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.headers['content-security-policy']).toContain("default-src 'self'");
      expect(res.text).toContain('lost its session');
      expect(res.text).not.toContain('\u2014');
    }
    expect((await request(app).get('/desktop/bootstrap')).status).toBe(403);
  });

  it('bootstrap sets the cookie and redirects once; reuse is 403; the cookie then grants access', async () => {
    // Array, object and repeated token params (qs 'extended' parser) are rejected and do not burn the nonce.
    for (const qs of [
      `token[]=${VECTOR_TOKEN}`,
      `token[0]=${VECTOR_TOKEN}`,
      `token=${VECTOR_TOKEN}&token=${VECTOR_TOKEN}`,
      'token[toString]=x',
    ]) {
      const rejected = await request(app).get(`/desktop/bootstrap?${qs}`);
      expect(rejected.status, qs).toBe(403);
      expect(rejected.headers['set-cookie'], qs).toBeUndefined();
    }

    const res = await request(app).get('/desktop/bootstrap').query({ token: VECTOR_TOKEN });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
    expect(res.headers['cache-control']).toBe('no-store');
    const set = res.headers['set-cookie'][0];
    expect(set).toBe(`app_desktop=${VECTOR_COOKIE}; HttpOnly; SameSite=Strict; Path=/`);
    expect(set).not.toMatch(/Secure|Max-Age|Expires/i);

    const again = await request(app).get('/desktop/bootstrap').query({ token: VECTOR_TOKEN });
    expect(again.status).toBe(403);
    expect(again.headers['cache-control']).toBe('no-store');
    expect(again.text).toContain('Close Local App Studio and open it again.');

    const ok = await request(app).get('/api/state').set('Cookie', cookie);
    expect(ok.status).toBe(200);
  });

  it('ignores APP_PASSWORD: auth status is open once past the desktop gate', async () => {
    const res = await request(app).get('/api/auth/status').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false, authenticated: true });
  });

  it('403s Sec-Fetch-Site: cross-site even with the cookie', async () => {
    const res = await request(app).get('/api/state').set('Cookie', cookie).set('Sec-Fetch-Site', 'cross-site');
    expect(res.status).toBe(403);
    const same = await request(app).get('/api/state').set('Cookie', cookie).set('Sec-Fetch-Site', 'same-origin');
    expect(same.status).toBe(200);
  });

  it('403s a cross-origin POST but allows a same-origin one', async () => {
    const bad = await request(app)
      .post('/api/assistant/conversations')
      .set('Cookie', cookie)
      .set('Host', '127.0.0.1:5000')
      .set('Origin', 'http://localhost:5000')
      .send({});
    expect(bad.status).toBe(403);
    const evil = await request(app)
      .post('/api/assistant/conversations')
      .set('Cookie', cookie)
      .set('Origin', 'http://evil.example')
      .send({});
    expect(evil.status).toBe(403);
    const good = await request(app)
      .post('/api/assistant/conversations')
      .set('Cookie', cookie)
      .set('Host', '127.0.0.1:5000')
      .set('Origin', 'http://127.0.0.1:5000')
      .send({});
    expect(good.status).toBe(200);
  });

  it('keeps the host guard first (421 for a foreign Host)', async () => {
    const res = await request(app).get('/api/state').set('Host', 'evil.example.com');
    expect(res.status).toBe(421);
  });

  it('export still works behind the desktop gate', async () => {
    const res = await request(app).post('/api/export').set('Cookie', cookie).send({});
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });

  it('fails closed when no secret was installed', async () => {
    auth.resetDesktopAuth();
    const res = await request(app).get('/api/state').set('Cookie', cookie);
    expect(res.status).toBe(401);
    auth.initDesktopAuth(SECRET);
  });
});

describe('web mode is unchanged', () => {
  it('has no desktop gate and still honors APP_PASSWORD', async () => {
    vi.resetModules();
    delete process.env.APP_DESKTOP;
    process.env.APP_PASSWORD = 'sekret-pass';
    process.env.AUTH_SECRET = 'unit-test-secret-unit-test-secret-1234';
    const app = (await import('../../server.js')).default;
    const boot = await request(app).get('/desktop/bootstrap').query({ token: VECTOR_TOKEN });
    expect(boot.status).not.toBe(302);
    expect(boot.headers['set-cookie']).toBeUndefined();
    const api = await request(app).get('/api/state');
    expect(api.status).toBe(401);
    expect(api.body).toMatchObject({ code: 'sign_in_required' });
    const status = await request(app).get('/api/auth/status');
    expect(status.body).toMatchObject({ enabled: true, authenticated: false });
  });
});
