// Phase 11 B2: path tricks against the preview proxy allowlist (A2.13 to A2.19). Requests go over a raw socket so the
// request line reaches the proxy byte for byte (a client library would normalize "/../" away before it is sent).
// A fake loopback child records the path it receives; the allowlist must keep every trick away from it or pass it on
// verbatim so that the child only ever sees /api/data/....
import http from 'node:http';
import net from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPreviewProxy } from '../../studio/preview/proxy.js';

let child;
let studio;
let studioPort;
let childPort;
const seen = [];

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

beforeAll(async () => {
  child = http.createServer((req, res) => {
    seen.push(req.url);
    res.setHeader('content-type', 'application/json');
    // Like the real child: only /api/data/... exists; everything else is its own 404.
    const ok = /^\/api\/data\/[^/?]+/.test(req.url) && !req.url.split('?')[0].includes('/studio');
    res.statusCode = ok ? 200 : 404;
    res.end(JSON.stringify(ok ? { data: { path: req.url } } : { error: 'unknown_table', message: 'That table does not exist.' }));
  });
  childPort = await listen(child);
  const app = express();
  app.use(express.json());
  app.use('/api/preview', createPreviewProxy({ getTarget: () => ({ port: childPort, cookie: 'c' }), timeoutMs: 2000 }));
  studio = http.createServer(app);
  studioPort = await listen(studio);
});
afterAll(async () => {
  await new Promise((r) => studio.close(r));
  await new Promise((r) => child.close(r));
});
beforeEach(() => {
  seen.length = 0;
});

/** One HTTP/1.1 request with the request target exactly as given. */
function raw(target, { method = 'GET', headers = '', body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(studioPort, '127.0.0.1');
    let data = '';
    sock.setEncoding('latin1');
    sock.on('data', (d) => (data += d));
    sock.on('error', reject);
    sock.on('close', () => {
      const [head, ...rest] = data.split('\r\n\r\n');
      const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(head)?.[1] ?? 0);
      const text = rest.join('\r\n\r\n');
      let json = null;
      try {
        json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      } catch {
        /* a non-JSON answer stays null */
      }
      resolve({ status, head, text, json });
    });
    sock.write(`${method} ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n${headers}\r\n${body}`);
  });
}

const through = (suffix, opts) => raw(`/api/preview${suffix}`, opts);

describe('A2.13 and A2.17: paths outside the /data prefix', () => {
  it.each(['//data/crews', '/data.', '/data%00', '/DATA/crews', '/Data', '/datax', '/data%20/crews', '/', '', '/dat', '/studio', '//', '/data;x/crews'])(
    '%j is 404 not_found and the child sees nothing',
    async (suffix) => {
      const res = await through(suffix);
      expect(res.status, suffix).toBe(404);
      expect(res.json).toMatchObject({ code: 'not_found' });
      expect(seen).toEqual([]);
    },
  );
});

describe('A2.14: a double slash inside the prefix', () => {
  it('/data//crews is forwarded as /api/data//crews and the child answers its own JSON 404', async () => {
    const res = await through('/data//crews');
    expect(seen).toEqual(['/api/data//crews']);
    expect(res.status).toBe(404);
    expect(res.json).toMatchObject({ error: 'unknown_table' });
  });
});

describe('A2.15: dot segments, literal and encoded', () => {
  it.each([
    '/data/../studio/apps', '/data/..', '/data/../../studio', '/data/%2e%2e/studio/apps', '/data/%2E%2E/studio/apps', '/data/.%2e/x', '/data/%2e./x',
    '/data/%2e%2E%2fx', '/data/crews/%2e%2e%2f..%2fstudio', '/data/..%2fstudio', '/data/crews/..;/studio', '/data/....//studio', '/data/crews%5c..%5cstudio',
    '/data/crews\\..\\studio', '/data/%2Fstudio', '/data/crews%2F..%2Fstudio',
  ])('%s is 400 invalid_request and never reaches the child', async (suffix) => {
    const res = await through(suffix);
    expect(res.status, suffix).toBe(400);
    expect(res.json).toMatchObject({ code: 'invalid_request' });
    expect(res.json.message).toMatch(/not valid/);
    expect(seen).toEqual([]);
  });
});

describe('A2.16: double encoding and other forms a decoder could turn into a dot', () => {
  it.each([
    '/data/%252e%252e/studio',
    '/data/%252E%252E/studio/apps',
    '/data/%c0%ae%c0%ae/studio',
    '/data/%e2%80%a4%e2%80%a4/studio',
    '/data/%ef%bc%8e%ef%bc%8e/studio',
    '/data/%zz/studio',
    '/data/%',
    '/data/%00/studio',
    '/data/./crews',
    '/data/crews/./.',
  ])('%s is forwarded verbatim and the child path never starts outside /api/data/', async (suffix) => {
    const res = await through(suffix);
    expect(res.status, suffix).toBeLessThan(500);
    expect(seen.length).toBe(1);
    expect(seen[0]).toBe(`/api${suffix}`);
    expect(seen[0].startsWith('/api/data/')).toBe(true);
    expect(seen[0].startsWith('/api/studio')).toBe(false);
    // The child answered by its own rules (a 404 JSON for an unknown table), not with another route's data.
    expect(res.json).not.toHaveProperty('data.apps');
  });

  it('a raw latin1 byte in the path is passed as text and does not crash the proxy', async () => {
    const res = await through('/data/créws');
    expect(res.status).toBeLessThan(500);
    expect(seen.length).toBeLessThanOrEqual(1);
  });
});

describe('A2.18: the query string is only passed through', () => {
  it.each(['?x=/../../studio', '?x=%2e%2e%2fstudio', '?x=..\\studio', '?', '?a=1&a=2', '?path=/api/studio/apps'])('crews%s', async (q) => {
    const res = await through(`/data/crews${q}`);
    expect(res.status).toBe(200);
    expect(seen).toEqual([`/api/data/crews${q}`]);
  });

  it('a "?" inside the path part cannot hide a trick behind it, and a trick before it is still refused', async () => {
    expect((await through('/data/crews?/../studio')).status).toBe(200);
    expect(seen).toEqual(['/api/data/crews?/../studio']);
    seen.length = 0;
    const res = await through('/data/..?/crews');
    expect(res.status).toBe(400);
    expect(seen).toEqual([]);
  });
});

describe('A2.19: methods and bodies', () => {
  it('TRACE, CONNECT-like and unknown methods are 405 and a text/plain PUT is 415', async () => {
    for (const method of ['TRACE', 'HEAD', 'OPTIONS', 'PROPFIND']) {
      const res = await through('/data', { method });
      expect(res.status, method).toBe(405);
    }
    const put = await through('/data/crews', { method: 'PUT', headers: 'Content-Type: text/plain\r\nContent-Length: 5\r\n', body: 'hello' });
    expect(put.status).toBe(415);
    expect(put.json.code).toBe('unsupported_media_type');
    expect(seen).toEqual([]);
  });

  it('a trick in the path wins over a method problem only after the method check, never reaching the child', async () => {
    const res = await through('/data/../studio', { method: 'TRACE' });
    expect(res.status).toBe(405);
    expect(seen).toEqual([]);
  });
});
