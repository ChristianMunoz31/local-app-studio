// Slow queries (DESIGN phase 15, section 5.6): timed only in debug mode, over SLOW_QUERY_MS, never with SQL or values.
import { performance } from 'node:perf_hooks';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SLOW_QUERY_MS, configureLog, resetLogForTests, setSessionDebug, tail } from '../log.js';
import { select } from '../db/query.js';
import { closeTestDb, createTestDb } from './helpers/testDb.js';

let db;
beforeAll(() => {
  db = createTestDb();
});
afterAll(() => closeTestDb(db));
beforeEach(() => {
  resetLogForTests();
  configureLog({ role: 'studio' });
});
afterEach(() => {
  setSessionDebug(false);
  resetLogForTests();
  vi.restoreAllMocks();
});

const slow = () => tail().filter((r) => r.event === 'db.slow_query');

/** Makes the statement look slow without sleeping: the clock jumps by 150 ms on every read. */
function fakeSlowClock() {
  let t = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => {
    t += 150;
    return t;
  });
}

describe('db.slow_query', () => {
  it('uses the 100 ms threshold from the design', () => {
    expect(SLOW_QUERY_MS).toBe(100);
  });

  it('logs op and table (and nothing else) for a slow statement in debug mode', () => {
    setSessionDebug(true);
    fakeSlowClock();
    select('app_state', { where: { key: 'secret-looking-key' } });
    const rows = slow();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ level: 'warn', op: 'select', table: 'app_state' });
    expect(rows[0].durationMs).toBeGreaterThan(100);
    expect(JSON.stringify(rows[0])).not.toMatch(/secret-looking-key|SELECT/);
  });

  it('does not time statements outside debug mode', () => {
    fakeSlowClock();
    select('app_state', {});
    expect(slow()).toEqual([]);
  });

  it('logs nothing for a fast statement in debug mode', () => {
    setSessionDebug(true);
    select('app_state', {});
    expect(slow()).toEqual([]);
  });
});
