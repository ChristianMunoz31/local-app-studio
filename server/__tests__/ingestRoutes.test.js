// POST /api/ingest/parse: body validation, size caps, status mapping, headers, the sign-in guard, abort on disconnect,
// and the real wiring in server.js (own body limit, no-store). The parser itself is replaced by a stub in the
// mapping tests; two tests run the real child end to end.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { LIMITS, MESSAGES, isParserBusy } from '../ingest/index.js';
import { INGEST_BODY_PATH, registerIngestRoutes } from '../ingestRoutes.js';
import { SAMPLE_PAGES, makePdf } from './helpers/ingestDocs.js';

vi.mock('../../loadEnv.js', () => ({}));

const b64 = (buf) => Buffer.from(buf).toString('base64');

function makeApp(opts = {}, { clientIp } = {}) {
  const app = express();
  if (clientIp) {
    app.use((req, _res, next) => {
      Object.defineProperty(req, 'ip', { value: clientIp });
      next();
    });
  }
  registerIngestRoutes(app, opts);
  return app;
}

const okResult = { ok: true, kind: 'text', pages: [{ page: null, text: 'hi' }], meta: { pageCount: null, paginated: false, truncated: false } };

describe('POST /api/ingest/parse: request validation', () => {
  const app = makeApp({ authEnabled: true, parse: async () => okResult });
  const post = (body) => request(app).post(INGEST_BODY_PATH).send(body);

  it.each([
    ['a missing data field', {}],
    ['data that is not a string', { data: 5 }],
    ['an empty data string', { data: '' }],
    ['data that is not base64', { data: 'not base64!!' }],
    ['a base64 length no byte string can have', { data: 'AAAAA' }],
    ['an unknown kind', { data: b64('x'), kind: 'exe' }],
    ['an array body', [1, 2]],
  ])('400 invalid_request for %s', async (_name, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ ok: false, code: 'invalid_request' });
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });

  it('400 for a body that is not JSON, without echoing it', async () => {
    const res = await request(app).post(INGEST_BODY_PATH).set('content-type', 'application/json').send('{"data": "sk-secret-looking');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('sk-secret');
  });

  it('413 too_large for base64 over the input cap', async () => {
    const res = await post({ data: 'A'.repeat(Math.ceil(LIMITS.maxInputBytes / 3) * 4 + 8) });
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ ok: false, error: MESSAGES.too_large, code: 'too_large', message: MESSAGES.too_large });
  });

  it('413 too_large for a JSON body over the route limit', async () => {
    const res = await request(app)
      .post(INGEST_BODY_PATH)
      .set('content-type', 'application/json')
      .send(JSON.stringify({ data: 'A'.repeat(36 * 1024 * 1024) }));
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('too_large');
  }, 60_000);

  it('accepts a request at the cap and passes the decoded bytes and the kind on', async () => {
    const parse = vi.fn(async () => okResult);
    const res = await request(makeApp({ authEnabled: true, parse }))
      .post(INGEST_BODY_PATH)
      .send({ data: b64('hello'), kind: 'text' });
    expect(res.status).toBe(200);
    expect(parse).toHaveBeenCalledTimes(1);
    const [bytes, opts] = parse.mock.calls[0];
    expect(Buffer.from(bytes).toString()).toBe('hello');
    expect(opts.kind).toBe('text');
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('POST /api/ingest/parse: results and statuses', () => {
  const run = (parse) => request(makeApp({ authEnabled: true, parse })).post(INGEST_BODY_PATH).send({ data: b64('x') });

  it('200 with the contract and Cache-Control: no-store', async () => {
    const res = await run(async () => okResult);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(okResult);
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });

  it.each([
    ['unsupported', 422],
    ['encrypted', 422],
    ['empty', 422],
    ['parse_failed', 422],
    ['too_large', 413],
    ['doc_busy', 429],
    ['doc_crashed', 500],
    ['doc_unavailable', 503],
    ['doc_timeout', 504],
  ])('%s -> %i with the fixed message', async (code, status) => {
    const res = await run(async () => ({ ok: false, code, message: 'TEXT FROM A LIBRARY' }));
    expect(res.status).toBe(status);
    expect(res.body).toMatchObject({ ok: false, error: MESSAGES[code], code: code, message: MESSAGES[code] });
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });

  it('500 doc_crashed when the parser throws, with no error text', async () => {
    const res = await run(async () => {
      throw new Error('C:\\secret\\path leaked');
    });
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ ok: false, error: MESSAGES.doc_crashed, code: 'doc_crashed', message: MESSAGES.doc_crashed });
  });

  it('a client that disconnects aborts the parse', async () => {
    let seenSignal;
    let release;
    const parse = (_bytes, { signal }) => {
      seenSignal = signal;
      return new Promise((resolve) => {
        release = resolve;
      });
    };
    const server = makeApp({ authEnabled: true, parse }).listen(0, '127.0.0.1');
    try {
      await new Promise((r) => server.once('listening', r));
      const port = server.address().port;
      const ctl = new AbortController();
      const pending = fetch(`http://127.0.0.1:${port}${INGEST_BODY_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data: b64('x') }),
        signal: ctl.signal,
      }).catch(() => null);
      for (let i = 0; i < 100 && !seenSignal; i += 1) await new Promise((r) => setTimeout(r, 20));
      expect(seenSignal).toBeDefined();
      ctl.abort();
      await pending;
      for (let i = 0; i < 100 && !seenSignal.aborted; i += 1) await new Promise((r) => setTimeout(r, 20));
      expect(seenSignal.aborted).toBe(true);
      release(okResult);
    } finally {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
    }
  });
});

describe('POST /api/ingest/parse: sign-in guard', () => {
  it('without sign-in enabled, a non-loopback client is refused (fail closed)', async () => {
    const res = await request(makeApp({ authEnabled: false, parse: async () => okResult }, { clientIp: '10.1.2.3' }))
      .post(INGEST_BODY_PATH)
      .send({ data: b64('x') });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('auth_required');
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });
  it('without sign-in enabled, a loopback client is served', async () => {
    const res = await request(makeApp({ authEnabled: false, parse: async () => okResult }))
      .post(INGEST_BODY_PATH)
      .send({ data: b64('x') });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/ingest/parse: the real parser', () => {
  it('parses a PDF end to end through the child', async () => {
    const res = await request(makeApp({ authEnabled: true })).post(INGEST_BODY_PATH).send({ data: b64(makePdf(SAMPLE_PAGES)) });
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('pdf');
    expect(res.body.pages[0].runs.length).toBe(4);
  }, 60_000);

  it('422 encrypted for an encrypted PDF and 422 unsupported for binary data', async () => {
    const app = makeApp({ authEnabled: true });
    const enc = await request(app).post(INGEST_BODY_PATH).send({ data: b64(makePdf(SAMPLE_PAGES, { encrypted: true })) });
    expect([enc.status, enc.body.code]).toEqual([422, 'encrypted']);
    const bin = await request(app).post(INGEST_BODY_PATH).send({ data: b64(Buffer.from([1, 2, 0, 3])) });
    expect([bin.status, bin.body.code]).toEqual([422, 'unsupported']);
  }, 60_000);
});

describe('wired into server.js', () => {
  let app;
  beforeAll(async () => {
    app = (await import('../../server.js')).default;
  });

  it('uses its own body limit (the global 2 MB parser does not eat it) and is no-store', async () => {
    const big = Buffer.alloc(3 * 1024 * 1024, 'a');
    const res = await request(app).post(INGEST_BODY_PATH).send({ data: b64(big), kind: 'text' });
    expect(res.status).toBe(200);
    // 3 MB of text is past the 2 MB character cap: the answer is cut and says so.
    expect(res.body.pages[0].text.length).toBe(LIMITS.maxChars);
    expect(res.body.meta.truncated).toBe(true);
    expect(res.headers['cache-control']).toMatch(/no-store/);
  }, 60_000);

  it('the mapping of the route is case-insensitive like the rest (the global parser skips it too)', async () => {
    const res = await request(app).post('/API/ingest/PARSE/').send({ data: b64(Buffer.alloc(3 * 1024 * 1024, 'a')), kind: 'text' });
    expect(res.status).toBe(200);
  }, 60_000);
});

describe('queue capacity and the decoded body (M4)', () => {
  it('a full queue answers 429 doc_busy before the body is read: even malformed JSON gets doc_busy', async () => {
    const parse = vi.fn(async () => okResult);
    const app = makeApp({ authEnabled: true, parse, isBusy: () => true });
    const bad = await request(app).post(INGEST_BODY_PATH).set('content-type', 'application/json').send('{"data":');
    expect([bad.status, bad.body]).toEqual([429, expect.objectContaining({ ok: false, error: MESSAGES.doc_busy, code: 'doc_busy', message: MESSAGES.doc_busy })]);
    expect(bad.headers['cache-control']).toMatch(/no-store/);
    const good = await request(app).post(INGEST_BODY_PATH).send({ data: b64('hello'), kind: 'text' });
    expect(good.status).toBe(429);
    expect(parse).not.toHaveBeenCalled();
  });

  it('a queue with room is not rejected', async () => {
    const app = makeApp({ authEnabled: true, parse: async () => okResult, isBusy: () => false });
    const res = await request(app).post(INGEST_BODY_PATH).send({ data: b64('hello'), kind: 'text' });
    expect(res.status).toBe(200);
  });

  it('isParserBusy is true only when the slot is taken and the queue is at its cap', () => {
    const state = (busy, queued) => ({ busy: () => busy, queued: () => queued });
    expect(isParserBusy(state(true, LIMITS.maxQueued))).toBe(true);
    expect(isParserBusy(state(true, LIMITS.maxQueued - 1))).toBe(false);
    expect(isParserBusy(state(false, 0))).toBe(false);
  });

  it('the parsed body (with its base64 string) is released before the parse starts', async () => {
    let seenReq;
    let bodyDuringParse = 'unset';
    const app = express();
    app.use((req, _res, next) => {
      seenReq = req;
      next();
    });
    registerIngestRoutes(app, {
      authEnabled: true,
      parse: async (bytes) => {
        bodyDuringParse = seenReq.body;
        expect(Buffer.from(bytes).toString()).toBe('hello');
        return okResult;
      },
    });
    const res = await request(app).post(INGEST_BODY_PATH).send({ data: b64('hello'), kind: 'text' });
    expect(res.status).toBe(200);
    expect(bodyDuringParse).toBeUndefined();
  });
});
