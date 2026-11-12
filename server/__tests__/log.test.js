// server/log.js: record shape, levels, redaction, ring, stages, debug mode.
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  RING_SIZE,
  configureLog,
  currentRequestId,
  debugState,
  isDebug,
  log,
  logger,
  ownFrame,
  resetLogForTests,
  setSessionDebug,
  startStage,
  tail,
  withRequestId,
} from '../log.js';

beforeEach(() => resetLogForTests());
afterEach(() => resetLogForTests());

describe('record shape', () => {
  it('orders the fields: level, time, requestId, event, lead fields, the rest, role', () => {
    configureLog({ role: 'studio', env: {} });
    withRequestId('abcd1234ef', () =>
      log('warn', 'http.request', { stage: 'x', durationMs: 12.4, code: 'revision_conflict', status: 409, route: 'PUT /api/studio/apps/:id' }),
    );
    const [rec] = tail();
    expect(Object.keys(rec)).toEqual(['level', 'time', 'requestId', 'event', 'route', 'status', 'code', 'durationMs', 'stage', 'role']);
    expect(rec).toMatchObject({ level: 'warn', requestId: 'abcd1234ef', event: 'http.request', status: 409, role: 'studio' });
    expect(new Date(rec.time).toISOString()).toBe(rec.time);
  });

  it('has a null request id outside a request', () => {
    configureLog({ env: {} });
    logger.info('startup');
    expect(tail()[0].requestId).toBeNull();
    expect(currentRequestId()).toBeNull();
  });

  it('drops bad keys and non-scalar values, caps the field count and the string length', () => {
    configureLog({ env: {} });
    const fields = { 'bad key': 1, ok: 'yes', obj: { a: 1 }, arr: [1], fn: () => 1, nan: Number.NaN, nul: null, flag: true, long: 'x'.repeat(500) };
    for (let i = 0; i < 30; i += 1) fields[`k${i}`] = i;
    log('info', 'many', fields);
    const rec = tail()[0];
    expect(rec).not.toHaveProperty('bad key');
    for (const dropped of ['obj', 'arr', 'fn', 'nan']) expect(rec).not.toHaveProperty(dropped);
    expect(rec).toMatchObject({ ok: 'yes', nul: null, flag: true });
    expect(rec.long.length).toBeLessThanOrEqual(303);
    const extra = Object.keys(rec).filter((k) => !['level', 'time', 'requestId', 'event'].includes(k));
    expect(extra.length).toBeLessThanOrEqual(20);
  });

  it('redacts secrets, sensitive keys and paths', () => {
    configureLog({ env: {} });
    log('info', 'leak', { note: 'Bearer abc123def456', apiKey: 'plain', where: `failed at C:${'\\'}Us${'ers'}${'\\'}sam${'\\'}AppData${'\\'}x.db now`, unix: `see /ho${'me'}/sam/x` });
    const rec = tail()[0];
    expect(rec.note).toBe('[redacted]');
    expect(rec.apiKey).toBe('[redacted]');
    expect(rec.where).toBe('failed at <path>/x.db now');
    expect(rec.unix).toBe('see <path>/x');
  });

  it('goes through redactText: a home folder with a space, an e-mail address and a long value', () => {
    configureLog({ env: {} });
    const home = os.homedir();
    log('info', 'text', { where: `opened ${home}${path.sep}My Docs${path.sep}a.db now`, mail: 'sent to jo.doe@example.com today', long: 'x'.repeat(400) });
    const rec = tail()[0];
    expect(rec.where).toBe(`opened <home>${path.sep}My Docs${path.sep}a.db now`);
    expect(rec.mail).toBe('sent to [redacted] today');
    expect(rec.long).toHaveLength(303);
  });

  it('ownFrame is repo relative and never carries a user folder', () => {
    const err = new Error('boom C:/x/y.js:1:1');
    err.stack = ['Error: boom C:/x/y.js:1:1', '    at node:internal/a (node:internal/a:1:1)', '    at f (D:\\people\\John Smith\\proj\\server\\routes.js:12:3)'].join('\n');
    expect(ownFrame(err)).toBe('server/routes.js:12:3');
    expect(ownFrame({ stack: 'Error: only a message x.js:1:2' })).toBeNull();
    expect(ownFrame(null)).toBeNull();
  });

  it('never throws', () => {
    expect(() => log('info', undefined, null)).not.toThrow();
    expect(() => log('nope', 'x', { a: 1n })).not.toThrow();
  });
});

describe('levels and debug mode', () => {
  it('keeps info and above, and debug only in debug mode', () => {
    configureLog({ env: {} });
    log('debug', 'quiet');
    log('info', 'loud');
    expect(tail().map((r) => r.event)).toEqual(['loud']);
    configureLog({ env: { APP_DEBUG: '1' } });
    log('debug', 'now kept');
    expect(tail().map((r) => r.event)).toEqual(['loud', 'now kept']);
  });

  it('the session toggle turns debug on and cannot turn off an env-set mode', () => {
    configureLog({ env: {} });
    expect(debugState()).toEqual({ env: false, session: false, on: false });
    setSessionDebug(true);
    expect(isDebug()).toBe(true);
    expect(debugState()).toEqual({ env: false, session: true, on: true });
    setSessionDebug(false);
    expect(isDebug()).toBe(false);
    configureLog({ env: { APP_DEBUG: '1' } });
    setSessionDebug(false);
    expect(debugState()).toEqual({ env: true, session: false, on: true });
  });
});

describe('ring and tail', () => {
  it('keeps the last 500 records, newest last', () => {
    configureLog({ env: {} });
    for (let i = 0; i < RING_SIZE + 25; i += 1) log('info', 'n', { i });
    const all = tail({ limit: 1000 });
    expect(all).toHaveLength(RING_SIZE);
    expect(all.at(-1).i).toBe(RING_SIZE + 24);
    expect(all[0].i).toBe(25);
  });

  it('limits and filters by level', () => {
    configureLog({ env: {} });
    log('info', 'a');
    log('warn', 'b');
    log('error', 'c');
    expect(tail({ limit: 2 }).map((r) => r.event)).toEqual(['b', 'c']);
    expect(tail({ minLevel: 'error' }).map((r) => r.event)).toEqual(['c']);
    expect(tail({ limit: 0 })).toEqual([]);
  });

  it('returns copies', () => {
    configureLog({ env: {} });
    log('info', 'a');
    tail()[0].event = 'changed';
    expect(tail()[0].event).toBe('a');
  });
});

describe('startStage', () => {
  it('logs a stage record with the duration and both field sets under the request id', async () => {
    configureLog({ env: {} });
    await withRequestId('req-0001-aaaa', async () => {
      const end = startStage('describe.tables', { calls: 1 });
      await new Promise((r) => setTimeout(r, 5));
      const ms = end({ fallbacks: 0 });
      expect(ms).toBeGreaterThanOrEqual(4);
    });
    const rec = tail()[0];
    expect(rec).toMatchObject({ level: 'info', event: 'stage', requestId: 'req-0001-aaaa', stage: 'describe.tables', calls: 1, fallbacks: 0 });
    expect(rec.durationMs).toBeGreaterThanOrEqual(4);
    expect(Object.keys(rec).indexOf('durationMs')).toBeLessThan(Object.keys(rec).indexOf('stage'));
  });
});
