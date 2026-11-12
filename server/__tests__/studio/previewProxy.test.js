import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requestContext } from '../../log.js';
import { createPreviewManager } from '../../studio/preview/manager.js';
import { createPreviewProxy, PREVIEW_PATH_PREFIXES } from '../../studio/preview/proxy.js';
import { starterSpec } from '../../studio/specCheck.js';

const FAKE = fileURLToPath(new URL('./fixtures/fakePreviewChild.mjs', import.meta.url));
let root;
let manager;
let target;

const buildApp = (opts = {}) => {
  const app = express();
  app.use(express.json());
  app.use('/api/preview', createPreviewProxy({ getTarget: () => target, ...opts }));
  return app;
};
let app;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'las-proxy-'));
  manager = createPreviewManager({ rootDir: root, spawnSpec: () => ({ command: process.execPath, args: [FAKE] }), startTimeoutMs: 8000, stopTimeoutMs: 1000 });
  await manager.start({ id: crypto.randomUUID(), spec: starterSpec('Crew Roster', 'crew-roster'), revision: 1 });
  target = manager.target();
  app = buildApp();
});
afterAll(async () => {
  await manager.stop();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('preview proxy', () => {
  it('forwards method, path, query and the JSON body', async () => {
    const res = await request(app).post('/api/preview/data/echo?x=1&y=a%20b').send({ name: 'Ada' });
    expect(res.status).toBe(201);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.method).toBe('POST');
    expect(res.body.url).toBe('/api/data/echo?x=1&y=a%20b');
    expect(JSON.parse(res.body.body)).toEqual({ name: 'Ada' });
  });

  it('sends the child only host, cookie, accept and body headers', async () => {
    const res = await request(app)
      .put('/api/preview/data/echo')
      .set('Cookie', 'app_desktop=browser; other=1')
      .set('Authorization', 'Bearer x')
      .set('Origin', 'http://evil.test')
      .set('Referer', 'http://evil.test/')
      .set('Accept', 'application/json')
      .send({ a: 1 });
    const seen = Object.keys(res.body.headers).sort();
    expect(seen).toEqual(['accept', 'connection', 'content-length', 'content-type', 'cookie', 'host']);
    expect(res.body.headers.cookie).toBe(`app_desktop=${target.cookie}`);
    expect(res.body.headers.host).toBe(`127.0.0.1:${target.port}`);
  });

  it('does not return the child set-cookie or CSP', async () => {
    const res = await request(app).get('/api/preview/data/echo');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  it('passes the child status through', async () => {
    const res = await request(app).get('/api/preview/data/missing');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
  });

  it('refuses paths outside the allowlist and traversal', async () => {
    const out = await request(app).get('/api/preview/settings');
    expect(out.status).toBe(404);
    expect(out.body).toMatchObject({ code: 'not_found' });
    expect((await request(app).get('/api/preview/database')).status).toBe(404);
    expect((await request(app).post('/api/preview/export').send({ tables: ['a'] })).status).toBe(404);
    expect(PREVIEW_PATH_PREFIXES).toEqual(['/data']);
    for (const p of ['/data/..%2fsettings', '/data/a%5cb', '/data/a%2Fb']) {
      const res = await request(app).get(`/api/preview${p}`);
      expect(res.status, p).toBe(400);
      expect(res.body.code).toBe('invalid_request');
    }
  });

  it('refuses a literal backslash and dot-dot segment', () => {
    const handler = createPreviewProxy({ getTarget: () => target });
    for (const url of ['/data/a\\b', '/data/../settings']) {
      const sent = {};
      const res = { set: () => res, status: (s) => ((sent.status = s), res), json: (b) => ((sent.body = b), res) };
      handler({ method: 'GET', url, headers: {} }, res);
      expect(sent.status, url).toBe(400);
    }
  });

  it('answers 415 for a non-JSON body and 405 for other methods', async () => {
    const text = await request(app).post('/api/preview/data/echo').set('Content-Type', 'text/plain').send('hello');
    expect(text.status).toBe(415);
    expect((await request(app).options('/api/preview/data/echo')).status).toBe(405);
  });

  it('answers 409 with no target', async () => {
    const saved = target;
    target = null;
    try {
      const res = await request(app).get('/api/preview/data/echo');
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'preview_not_running', message: 'Start the preview first.' });
      const starting = await request(buildApp({ isStarting: () => true })).get('/api/preview/data/echo');
      expect(starting.body.message).toMatch(/starting/);
    } finally {
      target = saved;
    }
  });

  it('answers 502 for a closed port and 504 for a slow child', async () => {
    const saved = target;
    target = { port: 1, cookie: 'x' };
    try {
      const res = await request(app).get('/api/preview/data/echo');
      expect(res.status).toBe(502);
      expect(res.body.code).toBe('preview_unavailable');
    } finally {
      target = saved;
    }
    const slow = await request(buildApp({ timeoutMs: 200 })).get('/api/preview/data/slow');
    expect(slow.status).toBe(504);
    expect(slow.body.code).toBe('preview_timeout');
  });

  it('caps the response size and does not proxy /import', async () => {
    const big = Buffer.alloc(5000, 'a');
    const upstream = http.createServer((req, res) => {
      if (req.url === '/api/data/declared') return res.writeHead(200, { 'content-type': 'text/plain', 'content-length': big.length }).end(big);
      if (req.url === '/api/data/small') return res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      res.writeHead(200, { 'content-type': 'text/plain' });
      if (req.url === '/api/data/chunked') return res.end(big);
      res.write(Buffer.alloc(600, 'a'));
      return setTimeout(() => res.end(Buffer.alloc(600, 'a')), 30);
    });
    await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const saved = target;
    target = { port: upstream.address().port, cookie: 'x' };
    try {
      const capped = buildApp({ maxResponseBytes: 1000 });
      const declared = await request(capped).get('/api/preview/data/declared');
      expect(declared.status).toBe(502);
      expect(declared.body.code).toBe('preview_failed');
      const small = await request(capped).get('/api/preview/data/small');
      expect(small.status).toBe(200);
      expect(small.text).toBe('ok');
      const chunked = await request(capped).get('/api/preview/data/chunked');
      expect(chunked.status).toBe(502);
      expect(chunked.body.code).toBe('preview_failed');
      const midway = await request(capped)
        .get('/api/preview/data/midway')
        .buffer(true)
        .then(
          (r) => r.text.length,
          () => 0,
        );
      expect(midway).toBeLessThan(1200);
      expect((await request(capped).get('/api/preview/import')).status).toBe(404);
    } finally {
      target = saved;
      upstream.closeAllConnections();
      await new Promise((resolve) => upstream.close(resolve));
    }
  });
});

describe('preview proxy request id', () => {
  const withContext = () => {
    const a = express();
    a.use(requestContext());
    a.use(express.json());
    a.use('/api/preview', createPreviewProxy({ getTarget: () => target }));
    return a;
  };

  it('forwards X-Request-Id to the child so both log lines share one id', async () => {
    const res = await request(withContext()).get('/api/preview/data/echo').set('X-Request-Id', 'abcdef0123456789');
    expect(res.headers['x-request-id']).toBe('abcdef0123456789');
    expect(res.body.headers['x-request-id']).toBe('abcdef0123456789');
  });

  it('puts the same id in its own error envelope', async () => {
    const res = await request(withContext()).get('/api/preview/settings').set('X-Request-Id', 'abcdef0123456789');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'not_found', requestId: 'abcdef0123456789' });
  });
});
