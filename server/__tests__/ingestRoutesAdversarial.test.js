// Adversarial route tests for POST /api/ingest/parse: missing or odd bodies, 413 before parsing, no-store on every
// answer when wired into server.js, the sign-in gate, and the privacy of a crashed parser's stderr.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { MESSAGES } from '../ingest/index.js';
import { createParserHost } from '../ingest/parserHost.js';
import { INGEST_BODY_PATH, registerIngestRoutes } from '../ingestRoutes.js';

vi.mock('../../loadEnv.js', () => ({}));

const b64 = (buf) => Buffer.from(buf).toString('base64');
const okResult = { ok: true, kind: 'text', pages: [{ page: null, text: 'hi' }], meta: { pageCount: null, paginated: false, truncated: false } };
const makeApp = (opts) => {
  const app = express();
  registerIngestRoutes(app, opts);
  return app;
};

describe('route: odd and missing bodies', () => {
  const parse = vi.fn(async () => okResult);
  const app = makeApp({ authEnabled: true, parse });

  it('400 with no body at all and with a non-JSON content type', async () => {
    const none = await request(app).post(INGEST_BODY_PATH);
    expect([none.status, none.body.code]).toEqual([400, 'invalid_request']);
    const plain = await request(app).post(INGEST_BODY_PATH).set('content-type', 'text/plain').send(JSON.stringify({ data: b64('x') }));
    expect([plain.status, plain.body.code]).toEqual([400, 'invalid_request']);
    expect(parse).not.toHaveBeenCalled();
  });

  it.each([
    ['base64 with a newline', `${b64('hello world')}\n`],
    ['url-safe base64', '-_-_'],
    ['padding in the middle', 'AA==AA'],
    ['too much padding', 'A==='],
    ['a data URL', `data:text/plain;base64,${b64('x')}`],
  ])('400 for %s', async (_name, data) => {
    const res = await request(app).post(INGEST_BODY_PATH).send({ data });
    expect([res.status, res.body.code]).toEqual([400, 'invalid_request']);
    expect(parse).not.toHaveBeenCalled();
  });

  it.each([null, 5, '', ['text']])('400 for kind %j', async (kind) => {
    const res = await request(app).post(INGEST_BODY_PATH).send({ data: b64('x'), kind });
    expect([res.status, res.body.code]).toEqual([400, 'invalid_request']);
  });

  it('413 for an oversize document is answered before the parser is called', async () => {
    const res = await request(app)
      .post(INGEST_BODY_PATH)
      .send({ data: 'A'.repeat(40 * 1024 * 1024) });
    expect([res.status, res.body.code]).toEqual([413, 'too_large']);
    expect(res.body.message).toBe(MESSAGES.too_large);
    expect(parse).not.toHaveBeenCalled();
  }, 60_000);

  it('kind that disagrees with the bytes is 422 unsupported, with no child started', async () => {
    const res = await request(makeApp({ authEnabled: true })).post(INGEST_BODY_PATH).send({ data: b64('plain words'), kind: 'pdf' });
    expect([res.status, res.body.code]).toEqual([422, 'unsupported']);
  });
});

describe('route: a crashed parser leaks nothing', () => {
  it('doc_crashed after a child wrote stderr gives 500 with the fixed message only', async () => {
    const script = "console.error('STDERR-CANARY path-like-secret.pdf');process.exit(1);";
    const host = createParserHost({ spawnSpec: () => ({ command: process.execPath, args: ['-e', script] }) });
    const diagnostics = [];
    const hostWithDiag = createParserHost({
      spawnSpec: () => ({ command: process.execPath, args: ['-e', script] }),
      onDiagnostic: (d) => diagnostics.push(d),
    });
    const app = makeApp({ authEnabled: true, parse: (bytes, { kind, signal }) => hostWithDiag.run(bytes, kind, { signal }) });
    const res = await request(app).post(INGEST_BODY_PATH).send({ data: b64('hello'), kind: 'text' });
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ ok: false, error: MESSAGES.doc_crashed, code: 'doc_crashed', message: MESSAGES.doc_crashed });
    expect(JSON.stringify(res.body) + JSON.stringify(res.headers)).not.toContain('STDERR-CANARY');
    expect(diagnostics[0].stderr).toContain('STDERR-CANARY'); // captured for the hook only
    expect(host.busy()).toBe(false);
  }, 60_000);

  // ingestRoutes.js:73 echoes result.code into error and code even when it is not a known code (only the message is
  // swapped for the doc_crashed text). Unreachable with the real host (it validates codes); a stub or future parser
  // could leak text.
  it('a parser answer with an unknown code is reported as doc_crashed in error and code too', async () => {
    const app = makeApp({ authEnabled: true, parse: async () => ({ ok: false, code: 'leaked-path-text', message: 'leaked-path-text' }) });
    const res = await request(app).post(INGEST_BODY_PATH).send({ data: b64('x') });
    expect(res.status).toBe(500);
    expect(res.body.message).toBe(MESSAGES.doc_crashed);
    expect(JSON.stringify(res.body)).not.toContain('leaked-path');
  });
});

describe('route mounted standalone: Cache-Control on body-parser errors', () => {
  // server.js sets no-store for the whole /api/ingest prefix (checked below); the route itself only sets it once the
  // body parsed. Defense in depth: a route should not depend on its mount point for this header.
  const app = makeApp({ authEnabled: true, parse: async () => okResult });

  it('malformed JSON (400) is no-store', async () => {
    const res = await request(app).post(INGEST_BODY_PATH).set('content-type', 'application/json').send('{"data":');
    expect(res.status).toBe(400);
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });

  it('a body over the JSON limit (413) is no-store', async () => {
    const res = await request(app)
      .post(INGEST_BODY_PATH)
      .set('content-type', 'application/json')
      .send(JSON.stringify({ data: 'A'.repeat(36 * 1024 * 1024) }));
    expect(res.status).toBe(413);
    expect(res.headers['cache-control']).toMatch(/no-store/);
  }, 60_000);
});

describe('wired into server.js with sign-in enabled', () => {
  let app;
  const saved = { SECRETS_ENCRYPTION_KEY: process.env.SECRETS_ENCRYPTION_KEY, APP_PASSWORD: process.env.APP_PASSWORD, AUTH_SECRET: process.env.AUTH_SECRET };
  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  beforeAll(async () => {
    delete process.env.SECRETS_ENCRYPTION_KEY;
    process.env.APP_PASSWORD = 'sekret-pass';
    process.env.AUTH_SECRET = 'unit-test-secret';
    app = (await import('../../server.js')).default;
  });

  it('rejects an unauthenticated request exactly like another /api route, without parsing', async () => {
    const ingest = await request(app).post(INGEST_BODY_PATH).set('X-Forwarded-For', '192.0.2.60').send({ data: b64('hello'), kind: 'text' });
    const exportRes = await request(app).post('/api/export').set('X-Forwarded-For', '192.0.2.61').send({});
    expect(ingest.status).toBe(401);
    expect(ingest.body).toMatchObject({ code: 'sign_in_required' });
    expect([ingest.status, { ...ingest.body, requestId: null }]).toEqual([exportRes.status, { ...exportRes.body, requestId: null }]);
    expect(ingest.headers['cache-control']).toMatch(/no-store/);
  });

  it.each(['/API/ingest/parse', '/api/ingest/parse/', '/Api/Ingest/Parse'])('path variant %s is also 401', async (p) => {
    const res = await request(app).post(p).set('X-Forwarded-For', '192.0.2.62').send({ data: b64('hello') });
    expect(res.status).toBe(401);
  });

  it('an unauthenticated oversize body is refused 401 (or the connection is cut early), never parsed', async () => {
    // The server may answer before reading the body and close the socket: the client then sees 401 or a reset.
    const outcome = await request(app)
      .post(INGEST_BODY_PATH)
      .set('X-Forwarded-For', '192.0.2.63')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ data: 'A'.repeat(36 * 1024 * 1024) }))
      .then((res) => res.status, (err) => err.code);
    expect([401, 'ECONNRESET', 'EPIPE']).toContain(outcome);
  }, 60_000);
});
