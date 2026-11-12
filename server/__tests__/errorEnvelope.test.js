// ci:always-run
// The envelope module: shape, fallbacks, status rules, extras, redaction, SSE payload, limiter handler.
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { CORE_ERROR_COPY } from '../../src/errors/copy.core.js';
import {
  AppError,
  SERVER_ERROR_CODE,
  errorBody,
  errorRow,
  isErrorCode,
  limiterHandler,
  registerErrorCopy,
  sendError,
  sendErrorFrom,
  sseError,
} from '../errors.js';
import { requestContext, resetLogForTests, setSessionDebug } from '../log.js';

const ID_RE = /^[0-9a-f]{16}$/;

function appWith(handler) {
  const app = express();
  app.use(requestContext());
  app.get('/api/x', handler);
  app.get('/page', handler);
  return app;
}

describe('errorBody', () => {
  it('uses the row sentence and action, and repeats the sentence in message', () => {
    const b = errorBody('not_found');
    expect(b.error).toBe(CORE_ERROR_COPY.not_found.sentence);
    expect(b.message).toBe(b.error);
    expect(b.code).toBe('not_found');
    expect(b.action).toBe(CORE_ERROR_COPY.not_found.action);
    expect(b.requestId).toMatch(ID_RE);
    expect(b).not.toHaveProperty('details');
  });

  it('keeps a call-site sentence (D-4) and takes the action from the table', () => {
    const b = errorBody('invalid_request', { message: 'name is required' });
    expect(b.error).toBe('name is required');
    expect(b.message).toBe('name is required');
    expect(b.action).toBe(CORE_ERROR_COPY.invalid_request.action);
  });

  it('falls back to server_error for an unknown code', () => {
    const b = errorBody('no_such_code_here');
    expect(b.code).toBe(SERVER_ERROR_CODE);
    expect(b.error).toBe(CORE_ERROR_COPY.server_error.sentence);
  });

  it('gives an owner row without a sentence the server_error sentence when the site passes none', () => {
    expect(CORE_ERROR_COPY.minute.sentence).toBeUndefined();
    expect(errorBody('minute').error).toBe(CORE_ERROR_COPY.server_error.sentence);
  });

  it('spreads extras last but never over the envelope fields', () => {
    const b = errorBody('invalid_request', {
      extra: { issues: [1], field: 'a', error: 'x', code: 'y', requestId: 'z', action: 'q', message: 'm', details: {} },
    });
    expect(b.issues).toEqual([1]);
    expect(b.field).toBe('a');
    expect(b.error).not.toBe('x');
    expect(b.code).toBe('invalid_request');
    expect(b.requestId).toMatch(ID_RE);
    expect(b.action).not.toBe('q');
    expect(b.message).toBe(b.error);
    expect(b).not.toHaveProperty('details');
  });

  it('redacts details', () => {
    const b = errorBody('server_error', { details: { apiKey: 'sk-abcdef', note: `mail me at a${'@'}b.co` } });
    expect(JSON.stringify(b.details)).not.toMatch(/sk-abcdef|a@b\.co/);
  });

  it('uses the given request id when it is well formed', () => {
    expect(errorBody('not_found', { requestId: 'abcdef0123456789' }).requestId).toBe('abcdef0123456789');
    expect(errorBody('not_found', { requestId: 'bad id!' }).requestId).toMatch(ID_RE);
  });
});

describe('registry', () => {
  it('knows core codes and refuses a different row for a taken code', () => {
    expect(isErrorCode('rate_limited')).toBe(true);
    expect(isErrorCode('nope_nope')).toBe(false);
    expect(errorRow('nope_nope')).toBe(CORE_ERROR_COPY.server_error);
    expect(() => registerErrorCopy({ not_found: { status: 404, sentence: 'x', action: 'y' } })).toThrow(/Duplicate/);
  });

  it('adds new rows once', () => {
    const row = { status: 418, sentence: 'A test pot.', action: 'Pour tea.' };
    registerErrorCopy({ test_only_teapot: row });
    registerErrorCopy({ test_only_teapot: row });
    expect(errorBody('test_only_teapot').error).toBe('A test pot.');
  });
});

describe('sendError', () => {
  it('sends status, header, no-store on /api and records the code for the log line', async () => {
    let seen;
    const app = appWith((_req, res) => {
      sendError(res, 'rate_limited');
      seen = res.locals.errorCode;
    });
    const res = await request(app).get('/api/x');
    expect(res.status).toBe(429);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-request-id']).toMatch(ID_RE);
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
    expect(res.body.code).toBe('rate_limited');
    expect(seen).toBe('rate_limited');
  });

  it('does not set no-store outside /api and honors status and header overrides', async () => {
    const app = appWith((_req, res) => sendError(res, 'invalid_body', { status: 415, headers: { 'Retry-After': '5' } }));
    const res = await request(app).get('/page');
    expect(res.status).toBe(415);
    expect(res.headers['cache-control']).toBeUndefined();
    expect(res.headers['retry-after']).toBe('5');
  });

  it('keeps an incoming request id', async () => {
    const app = appWith((_req, res) => sendError(res, 'not_found'));
    const res = await request(app).get('/api/x').set('X-Request-Id', 'client-id-12345');
    expect(res.body.requestId).toBe('client-id-12345');
  });

  it('writes nothing once headers were sent', async () => {
    const app = appWith((_req, res) => {
      res.status(200).write('ok');
      const out = sendError(res, 'server_error');
      expect(out).toBe(res);
      res.end();
    });
    const res = await request(app).get('/api/x');
    expect(res.status).toBe(200);
    expect(res.text).toBe('ok');
  });

  it('answers 500 for an unknown code', async () => {
    const app = appWith((_req, res) => sendError(res, 'bogus_code'));
    const res = await request(app).get('/api/x');
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('server_error');
  });
});

describe('sendErrorFrom', () => {
  const run = (err, fallback) => request(appWith((_req, res) => sendErrorFrom(res, err, fallback))).get('/api/x');
  const mk = (name, props) => Object.assign(new Error(props.message ?? name), { name }, props);

  it('maps an AppError', async () => {
    const res = await run(new AppError('invalid_body', { status: 415, message: 'wrong type', extra: { field: 'f' } }));
    expect(res.status).toBe(415);
    expect(res.body).toMatchObject({ code: 'invalid_body', error: 'wrong type', field: 'f' });
  });

  it('maps Studio, Backup, Import and License errors by name', async () => {
    registerErrorCopy({ test_only_conflict: { status: 409, sentence: 's', action: 'a' } });
    let res = await run(mk('StudioError', { code: 'test_only_conflict', status: 409, message: 'Taken.', extra: { revision: 3 } }));
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'test_only_conflict', error: 'Taken.', revision: 3 });
    res = await run(mk('BackupError', { code: 'db_restoring', status: 503, message: 'Restoring.' }));
    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('5');
    res = await run(mk('ImportError', { code: 'import_too_large', status: 413, message: 'Big.' }));
    expect(res.status).toBe(413);
    res = await run(mk('LicenseError', { code: 'key_not_found', httpStatus: 422, publicMessage: 'No such key.' }));
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('No such key.');
  });

  it('maps AI errors with their extras', async () => {
    const res = await run(
      mk('AiUnavailableError', {
        code: 'ollama_unavailable',
        httpStatus: 503,
        publicMessage: 'Ollama did not answer.',
        reason: 'ollama_unavailable',
        hint: 'Start it.',
      }),
    );
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'ollama_unavailable', reason: 'ollama_unavailable', hint: 'Start it.' });
  });

  it('maps a DbError 503 to db_unavailable or db_restoring', async () => {
    const db = (code) => mk('DbError', { code, status: 503 });
    expect((await run(db('db_busy'))).body.code).toBe('db_unavailable');
    expect((await run(db('db_restoring'))).body.code).toBe('db_restoring');
  });

  it('maps a 4xx error that carries a known code', async () => {
    const res = await run(mk('Error', { status: 400, code: 'invalid_body' }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_body');
  });

  it('turns anything else into server_error without the message', async () => {
    const res = await run(new Error('secret path C:\\Users\\tester\\x and sk-abc123456789'));
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('server_error');
    expect(JSON.stringify(res.body)).not.toMatch(/tester|sk-abc/);
    expect(res.body).not.toHaveProperty('details');
  });

  it('adds redacted details in debug mode only', async () => {
    resetLogForTests();
    setSessionDebug(true);
    try {
      const res = await run(mk('Error', { code: 'EBOOM', message: 'boom' }));
      expect(res.body.details).toMatchObject({ errorName: 'Error', errorCode: 'EBOOM' });
      expect(JSON.stringify(res.body.details)).not.toMatch(/boom/);
    } finally {
      setSessionDebug(false);
    }
  });
});

describe('limiterHandler and sseError', () => {
  it('sends rate_limited with the given sentence and the limiter status', async () => {
    const handler = limiterHandler({ message: 'Too many login attempts.' });
    const app = appWith((req, res, next) => handler(req, res, next, { statusCode: 429 }));
    const res = await request(app).get('/api/x');
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ code: 'rate_limited', error: 'Too many login attempts.' });
  });

  it('builds an SSE payload with the envelope fields', () => {
    const p = sseError('ai_busy', { message: 'Busy.', extra: { reason: 'queue' } });
    expect(p).toMatchObject({ error: 'Busy.', code: 'ai_busy', message: 'Busy.', reason: 'queue' });
    expect(p.action).toBeTruthy();
    expect(p.requestId).toMatch(ID_RE);
  });
});
