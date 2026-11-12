import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
vi.mock('../modules/studio.data.js', (importOriginal) => import('./helpers/probeTable.js').then((m) => m.withProbeTable(importOriginal)));
import { count, insert, withTransaction } from '../db/index.js';
import { closeTestDb, createTestDb, resetDb } from './helpers/testDb.js';

let db;
beforeAll(() => {
  db = createTestDb();
});
beforeEach(() => resetDb(db));
afterAll(() => closeTestDb(db));

describe('withTransaction', () => {
  it('commits and returns the callback result', () => {
    const out = withTransaction(() => {
      insert('probe_items', { name: 'a' });
      return 42;
    });
    expect(out).toBe(42);
    expect(count('probe_items')).toBe(1);
  });

  it('rolls back and rethrows on error', () => {
    expect(() =>
      withTransaction(() => {
        insert('probe_items', { name: 'a' });
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(count('probe_items')).toBe(0);
  });

  it('nested savepoint rollback keeps the outer transaction', () => {
    withTransaction(() => {
      insert('probe_items', { name: 'outer' });
      expect(() =>
        withTransaction(() => {
          insert('probe_items', { name: 'inner' });
          throw new Error('inner fail');
        }),
      ).toThrow('inner fail');
      insert('probe_items', { name: 'outer2' });
    });
    expect(count('probe_items')).toBe(2);
    expect(count('probe_items', { where: { name: 'inner' } })).toBe(0);
  });

  it('nested success is committed with the outer transaction', () => {
    expect(() =>
      withTransaction(() => {
        withTransaction(() => insert('probe_items', { name: 'inner' }));
        throw new Error('outer fail');
      }),
    ).toThrow('outer fail');
    expect(count('probe_items')).toBe(0);
  });

  it('rejects an async callback with TypeError and rolls back', () => {
    expect(() =>
      withTransaction(async () => {
        insert('probe_items', { name: 'a' });
      }),
    ).toThrow(TypeError);
    expect(count('probe_items')).toBe(0);
    // the handle is usable afterwards (no dangling transaction)
    expect(withTransaction(() => insert('probe_items', { name: 'b' }).name)).toBe('b');
  });

  it('maps constraint failures to a constraint DbError', () => {
    try {
      insert('assistant_messages', { conversation_id: 'missing', role: 'user', content: 'x' });
      expect.unreachable();
    } catch (e) {
      expect(e.code).toBe('constraint');
      expect(e.status).toBe(400);
    }
  });
});
