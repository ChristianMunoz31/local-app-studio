// server/net/fetch.js against real loopback servers on ephemeral ports (the network guard allows those).
// The built-in path and the agent path (node:http with a caller-supplied agent) must behave the same.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getEventListeners } from 'node:events';
import http from 'node:http';
import https from 'node:https';
import fetch from '../net/fetch.js';

let server;
let seen;
let port;

const listen = (srv) => new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv.address().port)));
const close = (srv) => new Promise((resolve) => srv.close(resolve));
const fresh = () => ({ agent: new http.Agent({ keepAlive: false }) });

beforeEach(async () => {
  const mine = { requests: [], closed: 0 };
  seen = mine;
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      mine.requests.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      if (req.url === '/json') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ hello: 'world' }));
      } else if (req.url === '/redirect') {
        res.statusCode = 302;
        res.setHeader('location', '/json');
        res.end('moved');
      } else if (req.url === '/big') {
        res.end('x'.repeat(5000));
      } else if (req.url === '/hang') {
        res.on('close', () => {
          mine.closed += 1;
        });
        res.write('first\n');
      } else if (req.url === '/stream') {
        res.write('a\n');
        setTimeout(() => res.end('b\n'), 10);
      } else if (req.url === '/missing') {
        res.statusCode = 404;
        res.statusMessage = 'Nope';
        res.end('gone');
      } else {
        res.end('ok');
      }
    });
  });
  port = await listen(server);
});

afterEach(async () => {
  server.closeAllConnections();
  await close(server);
});

const url = (p) => `http://127.0.0.1:${port}${p}`;

describe.each([
  ['built-in fetch', () => ({})],
  ['agent transport', fresh],
])('server/net/fetch.js (%s)', (_name, extra) => {
  it('returns ok, status, statusText, headers.get, text and json', async () => {
    const res = await fetch(url('/json'), extra());
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('x-missing')).toBeNull();
    expect(await res.json()).toEqual({ hello: 'world' });
    const bad = await fetch(url('/missing'), extra());
    expect(bad.ok).toBe(false);
    expect(bad.status).toBe(404);
    expect(bad.statusText).toBe('Nope');
    expect(await bad.text()).toBe('gone');
  });

  it('sends the method, headers and a string body', async () => {
    const res = await fetch(url('/echo'), { ...extra(), method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Test': '1' }, body: '{"a":1}' });
    await res.text();
    expect(seen.requests[0]).toMatchObject({ method: 'POST', url: '/echo', body: '{"a":1}' });
    expect(seen.requests[0].headers['x-test']).toBe('1');
    expect(seen.requests[0].headers['content-type']).toBe('application/json');
  });

  it('sends a URLSearchParams body as a form', async () => {
    const res = await fetch(url('/form'), { ...extra(), method: 'POST', body: new URLSearchParams({ k: 'v w' }) });
    await res.text();
    expect(seen.requests[0].body).toBe('k=v+w');
    expect(seen.requests[0].headers['content-type']).toMatch(/^application\/x-www-form-urlencoded/);
  });

  it('streams the body as an async iterable', async () => {
    const res = await fetch(url('/stream'), extra());
    let text = '';
    for await (const chunk of res.body) text += Buffer.from(chunk).toString('utf8');
    expect(text).toBe('a\nb\n');
  });

  it('refuses a redirect for redirect: error, returns it for redirect: manual', async () => {
    await expect(fetch(url('/redirect'), { ...extra(), redirect: 'error' })).rejects.toThrow();
    const res = await fetch(url('/redirect'), { ...extra(), redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.ok).toBe(false);
    expect(res.headers.get('location')).toBe('/json');
    res.body?.destroy?.();
  });

  it('caps text() and json() with size', async () => {
    const res = await fetch(url('/big'), { ...extra(), size: 100 });
    await expect(res.text()).rejects.toMatchObject({ code: 'ERR_BODY_TOO_LARGE' });
    const ok = await fetch(url('/json'), { ...extra(), size: 100 });
    expect(await ok.json()).toEqual({ hello: 'world' });
  });

  it('rejects with AbortError on an abort signal, a pre-aborted signal and a timeout signal', async () => {
    const ctl = new AbortController();
    const pending = fetch(url('/hang'), { ...extra(), signal: ctl.signal }).then((r) => r.text());
    setTimeout(() => ctl.abort(), 30);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    const done = new AbortController();
    done.abort();
    await expect(fetch(url('/json'), { ...extra(), signal: done.signal })).rejects.toMatchObject({ name: 'AbortError' });

    const res = await fetch(url('/hang'), { ...extra(), signal: AbortSignal.timeout(30) });
    await expect(res.text()).rejects.toMatchObject({ name: expect.stringMatching(/AbortError|TimeoutError/) });
  });

  it('body.destroy() stops the request so the server sees the connection close', async () => {
    const res = await fetch(url('/hang'), extra());
    const it = res.body[Symbol.asyncIterator]();
    expect(Buffer.from((await it.next()).value).toString('utf8')).toBe('first\n');
    res.body.destroy();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(seen.closed).toBe(1);
  });
});

describe('server/net/fetch.js agent transport keeps the agent connect-time lookup', () => {
  it('runs the agent lookup for a named host and uses its answer', async () => {
    const names = [];
    const agent = new http.Agent({
      keepAlive: false,
      lookup: (hostname, options, cb) => {
        names.push(hostname);
        if (options?.all) cb(null, [{ address: '127.0.0.1', family: 4 }]);
        else cb(null, '127.0.0.1', 4);
      },
    });
    const res = await fetch(`http://localhost:${port}/json`, { agent });
    expect(await res.json()).toEqual({ hello: 'world' });
    expect(names).toEqual(['localhost']);
  });

  it('a refusing lookup fails the request before any connection (the cloud SSRF guard)', async () => {
    let looked = 0;
    const agent = new https.Agent({
      keepAlive: false,
      lookup: (hostname, _options, cb) => {
        looked += 1;
        cb(Object.assign(new Error('not public'), { code: 'ECLOUDPRIVATE' }));
      },
    });
    await expect(fetch(`https://localhost:${port}/v1/chat`, { agent, method: 'POST', body: '{}' })).rejects.toMatchObject({ code: 'ECLOUDPRIVATE' });
    expect(looked).toBe(1);
  });

  it('rejects a protocol it cannot speak', async () => {
    await expect(fetch('ftp://example.test/', { agent: new http.Agent() })).rejects.toThrow(/protocol/i);
  });
});

describe('server/net/fetch.js leaves nothing on the caller signal', () => {
  const listeners = (signal) => getEventListeners(signal, 'abort').length;
  const settled = () => new Promise((resolve) => setTimeout(resolve, 20));

  it('built-in: the abort listener is removed once the body is read, iterated, destroyed or the request fails', async () => {
    const long = new AbortController();
    const base = listeners(long.signal);

    await (await fetch(url('/json'), { signal: long.signal })).json();
    expect(listeners(long.signal)).toBe(base);

    await (await fetch(url('/json'), { signal: long.signal, size: 1000 })).text();
    expect(listeners(long.signal)).toBe(base);

    const streamed = await fetch(url('/stream'), { signal: long.signal });
    for await (const chunk of streamed.body) expect(chunk.length).toBeGreaterThan(0);
    expect(listeners(long.signal)).toBe(base);

    const hanging = await fetch(url('/hang'), { signal: long.signal });
    const it = hanging.body[Symbol.asyncIterator]();
    await it.next();
    hanging.body.destroy();
    await settled();
    expect(listeners(long.signal)).toBe(base);

    const read = await fetch(url('/stream'), { signal: long.signal });
    const reader = read.body.getReader();
    while (!(await reader.read()).done);
    expect(listeners(long.signal)).toBe(base);

    const dead = await new Promise((resolve) => {
      const probe = http.createServer();
      probe.listen(0, '127.0.0.1', () => {
        const closedPort = probe.address().port;
        probe.close(() => resolve(closedPort));
      });
    });
    await expect(fetch(`http://127.0.0.1:${dead}/`, { signal: long.signal })).rejects.toThrow();
    expect(listeners(long.signal)).toBe(base);

    // and a live signal still aborts a request that is in flight
    const pending = fetch(url('/hang'), { signal: long.signal }).then((r) => r.text());
    setTimeout(() => long.abort(), 30);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('agent: an abort after the response resolved and before the body is read is no unhandled error, and iteration sees it', async () => {
    const ctl = new AbortController();
    const res = await fetch(url('/hang'), { ...fresh(), signal: ctl.signal });
    ctl.abort();
    await settled();
    await expect(
      (async () => {
        for await (const chunk of res.body) void chunk;
      })(),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(listeners(ctl.signal)).toBe(0);
  });

  it('agent: text() after such an abort rejects with AbortError', async () => {
    const ctl = new AbortController();
    const res = await fetch(url('/hang'), { ...fresh(), signal: ctl.signal });
    ctl.abort();
    await settled();
    await expect(res.text()).rejects.toMatchObject({ name: 'AbortError' });
  });
});
