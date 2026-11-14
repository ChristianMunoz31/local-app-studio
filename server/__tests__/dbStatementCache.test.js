// The prepared statement cache of query.js: reuse, bound, per handle, dropped on close or swap, and PRAGMA optimize on close.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDb, insert, openDb, optimizeDb, select, selectOne, setDbForTests, withTransaction } from '../db/index.js';
import {
  STATEMENT_CACHE_MAX,
  dropStatementCache,
  prepareCached,
  setStatementCacheEnabled,
  statementCacheSize,
} from '../db/statementCache.js';

const handles = [];
const open = () => {
  const db = openDb({ filename: ':memory:' });
  handles.push(db);
  return db;
};

afterEach(() => {
  setStatementCacheEnabled(true);
  setDbForTests(null);
  while (handles.length) {
    const db = handles.pop();
    try {
      db.close();
    } catch {
      // already closed
    }
  }
});

describe('prepareCached', () => {
  it('returns the same statement for the same SQL on one handle', () => {
    const db = open();
    const a = prepareCached(db, 'SELECT 1 AS n');
    expect(prepareCached(db, 'SELECT 1 AS n')).toBe(a);
    expect(prepareCached(db, 'SELECT 2 AS n')).not.toBe(a);
    expect(statementCacheSize(db)).toBe(2);
  });

  it('never shares a statement across handles', () => {
    const a = open();
    const b = open();
    expect(prepareCached(a, 'SELECT 1 AS n')).not.toBe(prepareCached(b, 'SELECT 1 AS n'));
    expect(statementCacheSize(a)).toBe(1);
    expect(statementCacheSize(b)).toBe(1);
  });

  it('is bounded and evicts the least recently used statement', () => {
    const db = open();
    const first = prepareCached(db, 'SELECT 0 AS n');
    const second = prepareCached(db, 'SELECT 1 AS n');
    for (let i = 2; i < STATEMENT_CACHE_MAX; i += 1) prepareCached(db, `SELECT ${i} AS n`);
    expect(statementCacheSize(db)).toBe(STATEMENT_CACHE_MAX);
    expect(prepareCached(db, 'SELECT 0 AS n')).toBe(first); // refreshed: now the newest, so SELECT 1 is the oldest
    prepareCached(db, 'SELECT -1 AS n');
    expect(statementCacheSize(db)).toBe(STATEMENT_CACHE_MAX);
    expect(prepareCached(db, 'SELECT 0 AS n')).toBe(first); // survived
    expect(prepareCached(db, 'SELECT 1 AS n')).not.toBe(second); // evicted, prepared again
    expect(statementCacheSize(db)).toBe(STATEMENT_CACHE_MAX);
  });

  it('caches nothing when prepare throws', () => {
    const db = open();
    expect(() => prepareCached(db, 'SELEKT nope')).toThrow();
    expect(statementCacheSize(db)).toBe(0);
  });

  it('prepares fresh every time when switched off', () => {
    const db = open();
    setStatementCacheEnabled(false);
    expect(prepareCached(db, 'SELECT 1 AS n')).not.toBe(prepareCached(db, 'SELECT 1 AS n'));
    expect(statementCacheSize(db)).toBe(0);
  });

  it('dropStatementCache forgets the statements of one handle only', () => {
    const a = open();
    const b = open();
    prepareCached(a, 'SELECT 1 AS n');
    prepareCached(b, 'SELECT 1 AS n');
    dropStatementCache(a);
    expect(statementCacheSize(a)).toBe(0);
    expect(statementCacheSize(b)).toBe(1);
  });
});

describe('query.js uses the cache', () => {
  it('reuses statements across calls and still returns fresh results', () => {
    const db = open();
    const a = insert('assistant_conversations', { title: 'one' }, { db });
    const b = insert('assistant_conversations', { title: 'two' }, { db });
    expect(statementCacheSize(db)).toBe(1);
    expect(selectOne('assistant_conversations', { where: { id: a.id }, db })?.title).toBe('one');
    expect(selectOne('assistant_conversations', { where: { id: b.id }, db })?.title).toBe('two');
    expect(select('assistant_conversations', { where: { title: 'two' }, limit: 5, db })).toHaveLength(1);
    expect(select('assistant_conversations', { where: { title: 'one' }, limit: 1, db })).toHaveLength(1);
  });

  it('survives a rolled back transaction and a schema change', () => {
    const db = open();
    insert('assistant_conversations', { title: 'kept' }, { db });
    expect(() =>
      withTransaction(() => {
        insert('assistant_conversations', { title: 'gone' }, { db });
        throw new Error('stop');
      }, db),
    ).toThrow('stop');
    db.exec('CREATE TABLE cache_probe (id INTEGER)');
    expect(select('assistant_conversations', { db }).map((r) => r.title)).toEqual(['kept']);
  });

  it('closeDb drops the cache of the singleton', () => {
    const db = open();
    setDbForTests(db);
    insert('assistant_conversations', { title: 'x' });
    expect(statementCacheSize(db)).toBeGreaterThan(0);
    closeDb();
    expect(statementCacheSize(db)).toBe(0);
  });

  it('swapping the singleton drops the old handle cache', () => {
    const a = open();
    const b = open();
    setDbForTests(a);
    insert('assistant_conversations', { title: 'x' });
    expect(statementCacheSize(a)).toBeGreaterThan(0);
    setDbForTests(b);
    expect(statementCacheSize(a)).toBe(0);
  });
});

describe('PRAGMA optimize on close', () => {
  it('closeDb runs optimize on a healthy handle, before the checkpoint', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-app-studio-opt-'));
    try {
      const db = openDb({ filename: path.join(dir, 'app.db') });
      setDbForTests(db);
      const seen = [];
      const real = db.exec.bind(db);
      db.exec = (sql) => {
        seen.push(sql);
        return real(sql);
      };
      closeDb();
      expect(seen).toContain('PRAGMA optimize');
      expect(seen.indexOf('PRAGMA optimize')).toBeLessThan(seen.indexOf('PRAGMA wal_checkpoint(TRUNCATE)'));
    } finally {
      setDbForTests(null);
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it('optimizeDb runs on an idle handle', () => {
    expect(optimizeDb(open())).toBe(true);
  });

  it('optimizeDb never runs inside a withTransaction', () => {
    const db = open();
    withTransaction(() => {
      expect(optimizeDb(db)).toBe(false);
    }, db);
  });

  it('optimizeDb never runs inside a raw BEGIN either', () => {
    const db = open();
    db.exec('BEGIN');
    expect(optimizeDb(db)).toBe(false);
    db.exec('ROLLBACK');
  });

  it('optimizeDb does not throw on a closed handle, a failing handle or null', () => {
    const db = openDb({ filename: ':memory:' });
    db.close();
    expect(() => optimizeDb(db)).not.toThrow();
    expect(optimizeDb(db)).toBe(false);
    const broken = {
      isOpen: true,
      exec: () => {
        throw new Error('malformed');
      },
    };
    expect(optimizeDb(broken)).toBe(false);
    expect(optimizeDb(null)).toBe(false);
  });

  it('closeDb skips optimize on a damaged handle and still closes', () => {
    const db = open();
    setDbForTests(db);
    const seen = [];
    const real = db.exec.bind(db);
    db.exec = (sql) => {
      seen.push(sql);
      return real(sql);
    };
    db.prepare = () => {
      throw new Error('database disk image is malformed');
    };
    expect(() => closeDb()).not.toThrow();
    expect(seen).not.toContain('PRAGMA optimize');
    expect(seen).toContain('PRAGMA wal_checkpoint(TRUNCATE)');
  });
});
