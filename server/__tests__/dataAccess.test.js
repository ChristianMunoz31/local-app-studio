// Data-access function tests on a real in-memory SQLite DB: state and conversations.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { closeTestDb, createTestDb, resetDb } from './helpers/testDb.js';
import { setDbForTests } from '../db/index.js';

vi.mock('../../loadEnv.js', () => ({}));

let db;
let da;
beforeAll(async () => {
  db = createTestDb();
  da = await import('../dataAccess.js');
});
beforeEach(() => resetDb(db));
afterAll(() => closeTestDb(db));

describe('getState / setState', () => {
  it('round-trips JSON values and returns the fallback for a missing key', async () => {
    expect(await da.getState('missing.key', 'default')).toBe('default');
    expect(await da.setState('example.mode', 'compact')).toEqual({ key: 'example.mode', value: 'compact' });
    expect(await da.getState('example.mode', null)).toBe('compact');
    await da.setState('obj', { a: [1, 2], b: true });
    expect(await da.getState('obj')).toEqual({ a: [1, 2], b: true });
  });

  it('overwrites on a second set and keeps one row', async () => {
    await da.setState('k', 1);
    await da.setState('k', 2);
    expect(await da.getState('k')).toBe(2);
  });

  it('rejects null with a 400 constraint error', async () => {
    await expect(da.setState('k', null)).rejects.toMatchObject({ status: 400 });
  });
});

describe('Assistant conversations', () => {
  it('creates, appends in order, lists by recency, and round-trips tool calls', async () => {
    // Pin the clock so "a was touched after b" never ties on a same-millisecond
    // updated_at (ties correctly fall back to the newer rowid, i.e. b).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const a = await da.createConversation({ title: 'first' });
    const b = await da.createConversation({});
    expect(b.title).toBeNull();
    vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'));
    await da.appendMessage(a.id, { role: 'user', content: 'hi' });
    vi.useRealTimers();
    await da.appendMessage(a.id, { role: 'assistant', content: null, toolCalls: [{ id: 'c1', function: { name: 'x' } }] });
    await da.appendMessage(a.id, { role: 'tool', content: 'ok', toolCallId: 'c1' });
    const messages = await da.getMessages(a.id);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
    expect(messages[1].toolCalls).toEqual([{ id: 'c1', function: { name: 'x' } }]);
    expect(messages[2].toolCallId).toBe('c1');
    expect((await da.listConversations()).map((c) => c.id)[0]).toBe(a.id);
  });

  it('returns the newest N messages in chronological order', async () => {
    const c = await da.createConversation({ title: 'long' });
    for (let i = 1; i <= 12; i += 1) await da.appendMessage(c.id, { role: 'user', content: `m${i}` });
    const last5 = await da.getMessages(c.id, { limit: 5 });
    expect(last5.map((m) => m.content)).toEqual(['m8', 'm9', 'm10', 'm11', 'm12']);
    expect((await da.getMessages(c.id)).map((m) => m.content)).toHaveLength(12);
  });

  it('rejects a message for an unknown conversation', async () => {
    await expect(da.appendMessage('ghost', { role: 'user', content: 'x' })).rejects.toMatchObject({ status: 400 });
  });
});

describe('when the database is unavailable', () => {
  it('rejects with a DbError instead of hanging', async () => {
    const closed = createTestDb();
    closed.close();
    setDbForTests(closed);
    await expect(da.listConversations()).rejects.toBeTruthy();
    setDbForTests(db);
  });
});
