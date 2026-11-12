// groupStats: the one aggregate query. Fixed SQL templates with quoted allowlisted identifiers, a bound limit, boolean
// decoding, UTC buckets, and a refusal for anything that is not a plain column of the table.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../modules/studio.data.js', async (importOriginal) => {
  const real = (await importOriginal()).default;
  const columns = { id: 'uuid', label: 'text', done: 'boolean', due: 'date', at: 'timestamptz', qty: 'integer', amount: 'real', meta: 'jsonb' };
  return {
    default: {
      ...real,
      tables: { ...real.tables, group_probe: { primaryKey: 'id', autoNow: [], columns } },
      importOrder: ['group_probe', ...real.importOrder],
      dataTables: [
        { id: 'group_probe', label: 'Group probe', group: 'Probe', primaryKey: 'id', columns: Object.entries(columns).map(([name, type]) => ({ name, type })) },
        ...real.dataTables,
      ],
    },
  };
});
import { closeTestDb, createTestDb, resetDb } from '../helpers/testDb.js';
import { groupStats, op } from '../../db/query.js';

let db;
beforeAll(() => {
  db = createTestDb();
  db.exec(`CREATE TABLE group_probe (id TEXT PRIMARY KEY, label TEXT, done INTEGER, due TEXT, at TEXT, qty INTEGER, amount REAL, meta TEXT)`);
});
afterAll(() => closeTestDb(db));
beforeEach(() => {
  resetDb(db);
  db.exec('DELETE FROM group_probe');
});

let n = 0;
function add(row) {
  n += 1;
  const r = { id: `r${n}`, label: null, done: null, due: null, at: null, qty: null, amount: null, meta: null, ...row };
  db.prepare('INSERT INTO group_probe (id, label, done, due, at, qty, amount, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(r.id, r.label, r.done, r.due, r.at, r.qty, r.amount, r.meta);
}

describe('groupStats SQL', () => {
  it('uses the fixed templates with quoted identifiers and a bound limit', () => {
    add({ label: 'a', qty: 1 });
    const spy = vi.spyOn(db, 'prepare');
    groupStats('group_probe', { column: 'label', limit: 12, db });
    groupStats('group_probe', { column: 'label', measureColumn: 'qty', where: { done: true }, search: { term: 'x', columns: ['label'] }, limit: 5, db });
    groupStats('group_probe', { column: 'due', bucket: 'month', order: 'key-desc', limit: 12, db });
    groupStats('group_probe', { column: 'at', bucket: 'day', measureColumn: 'amount', order: 'key-desc', limit: 12, db });
    const texts = spy.mock.calls.map((c) => c[0]);
    spy.mockRestore();
    expect(texts).toEqual([
      'SELECT "label" AS k, COUNT(*) AS c, 0 AS s, 0 AS n FROM "group_probe" GROUP BY 1 ORDER BY 2 DESC, 1 ASC NULLS LAST LIMIT ?',
      'SELECT COUNT(*) AS c, 0 AS s, 0 AS n, COUNT(DISTINCT "label") + (COUNT(*) > COUNT("label")) AS g FROM "group_probe"',
      'SELECT "label" AS k, COUNT(*) AS c, SUM("qty") AS s, COUNT("qty") AS n FROM "group_probe" WHERE "done" = ? AND (app_icontains("label", ?)) GROUP BY 1 ORDER BY 2 DESC, 1 ASC NULLS LAST LIMIT ?',
      'SELECT COUNT(*) AS c, SUM("qty") AS s, COUNT("qty") AS n, COUNT(DISTINCT "label") + (COUNT(*) > COUNT("label")) AS g FROM "group_probe" WHERE "done" = ? AND (app_icontains("label", ?))',
      'SELECT substr("due", 1, 7) AS k, COUNT(*) AS c, 0 AS s, 0 AS n FROM "group_probe" WHERE substr("due", 1, 7) IS NOT NULL GROUP BY 1 ORDER BY 1 DESC LIMIT ?',
      'SELECT substr("due", 1, 7) AS k, COUNT(*) AS c, 0 AS s, 0 AS n FROM "group_probe" WHERE substr("due", 1, 7) IS NULL HAVING COUNT(*) > 0',
      'SELECT COUNT(*) AS c, 0 AS s, 0 AS n, COUNT(DISTINCT substr("due", 1, 7)) + (COUNT(*) > COUNT(substr("due", 1, 7))) AS g FROM "group_probe"',
      'SELECT substr("at", 1, 10) AS k, COUNT(*) AS c, SUM("amount") AS s, COUNT("amount") AS n FROM "group_probe" WHERE substr("at", 1, 10) IS NOT NULL GROUP BY 1 ORDER BY 1 DESC LIMIT ?',
      'SELECT substr("at", 1, 10) AS k, COUNT(*) AS c, SUM("amount") AS s, COUNT("amount") AS n FROM "group_probe" WHERE substr("at", 1, 10) IS NULL HAVING COUNT(*) > 0',
      'SELECT COUNT(*) AS c, SUM("amount") AS s, COUNT("amount") AS n, COUNT(DISTINCT substr("at", 1, 10)) + (COUNT(*) > COUNT(substr("at", 1, 10))) AS g FROM "group_probe"',
    ]);
  });

  it('binds the limit as the last parameter', () => {
    add({ label: 'a' });
    const real = db.prepare.bind(db);
    const stmts = [];
    const spy = vi.spyOn(db, 'prepare').mockImplementation((sql) => {
      const s = real(sql);
      const all = s.all.bind(s);
      s.all = (...args) => {
        stmts.push(args);
        return all(...args);
      };
      return s;
    });
    groupStats('group_probe', { column: 'label', where: { label: 'a' }, limit: 7, db });
    spy.mockRestore();
    expect(stmts).toEqual([['a', 7]]);
  });
});

describe('groupStats results', () => {
  it('counts by value, orders by count then key with nulls last, and decodes booleans', () => {
    add({ label: 'b', done: 1 });
    add({ label: 'a', done: 0 });
    add({ label: 'b', done: 1 });
    add({ label: null });
    add({ label: 'c' });
    const text = groupStats('group_probe', { column: 'label', limit: 10, db });
    expect(text.groups.map((g) => [g.key, g.count])).toEqual([['b', 2], ['a', 1], ['c', 1], [null, 1]]);
    expect(text.total).toEqual({ count: 5, sum: 0, n: 0, groups: 4 });
    const bool = groupStats('group_probe', { column: 'done', limit: 10, db });
    expect(bool.groups.map((g) => [g.key, g.count])).toEqual([[true, 2], [null, 2], [false, 1]]);
  });

  it('adds up a number column and counts the rows that have one', () => {
    add({ label: 'a', amount: 1.5 });
    add({ label: 'a', amount: 2 });
    add({ label: 'a' });
    add({ label: 'b' });
    const r = groupStats('group_probe', { column: 'label', measureColumn: 'amount', limit: 10, db });
    expect(r.groups).toEqual([
      { key: 'a', count: 3, sum: 3.5, n: 2 },
      { key: 'b', count: 1, sum: 0, n: 0 },
    ]);
    expect(r.total).toEqual({ count: 4, sum: 3.5, n: 2, groups: 2 });
  });

  it('buckets dates and timestamps by UTC month or day, latest first with key-desc', () => {
    add({ due: '2026-01-05', at: '2026-01-05T23:30:00.000Z' });
    add({ due: '2026-01-20', at: '2026-01-06T00:10:00.000Z' });
    add({ due: '2026-03-01', at: '2026-03-01T10:00:00.000Z' });
    add({});
    const byMonth = groupStats('group_probe', { column: 'due', bucket: 'month', order: 'key-desc', limit: 2, db });
    expect(byMonth.groups.map((g) => [g.key, g.count])).toEqual([['2026-03', 1], ['2026-01', 2], [null, 1]]);
    expect(byMonth.total.groups).toBe(3);
    const byDay = groupStats('group_probe', { column: 'at', bucket: 'day', order: 'key-desc', limit: 10, db });
    expect(byDay.groups.map((g) => g.key)).toEqual(['2026-03-01', '2026-01-06', '2026-01-05', null]);
  });

  it('keeps the no-date group past the limit and out of the leftover count, with where applied to both', () => {
    for (let m = 1; m <= 13; m += 1) add({ due: new Date(Date.UTC(2025, m - 1, 1)).toISOString().slice(0, 10), qty: m, done: 1 });
    add({ qty: 100, done: 1 });
    add({ qty: 1000, done: 0 });
    const r = groupStats('group_probe', { column: 'due', bucket: 'month', measureColumn: 'qty', order: 'key-desc', limit: 12, db });
    expect(r.groups).toHaveLength(13);
    expect(r.groups.at(-1)).toEqual({ key: null, count: 2, sum: 1100, n: 2 });
    expect(r.groups[0].key).toBe('2026-01');
    expect(r.total.groups).toBe(14);
    const w = groupStats('group_probe', { column: 'due', bucket: 'month', order: 'key-desc', where: { done: true }, limit: 12, db });
    expect(w.groups.at(-1)).toEqual({ key: null, count: 1, sum: 0, n: 0 });
    expect(groupStats('group_probe', { column: 'due', bucket: 'month', order: 'key-desc', where: { done: false }, limit: 12, db }).groups).toEqual([
      { key: null, count: 1, sum: 0, n: 0 },
    ]);
  });

  it('honors where and search', () => {
    add({ label: 'alpha', done: 1 });
    add({ label: 'beta', done: 0 });
    add({ label: 'alpine', done: 1 });
    expect(groupStats('group_probe', { column: 'label', where: { done: true }, limit: 10, db }).total.count).toBe(2);
    expect(groupStats('group_probe', { column: 'label', where: { qty: op.gt(3) }, limit: 10, db }).groups).toEqual([]);
    const term = { term: 'ALP', columns: ['label'] };
    expect(groupStats('group_probe', { column: 'label', search: term, limit: 10, db }).total.count).toBe(2);
  });
});

describe('groupStats refusals', () => {
  it.each([
    ['unknown column', { column: 'nope' }],
    ['injection in the column', { column: 'label"; DROP TABLE group_probe; --' }],
    ['prototype key', { column: '__proto__' }],
    ['a column type that cannot group', { column: 'meta' }],
    ['a number column', { column: 'qty' }],
    ['a bucket on text', { column: 'label', bucket: 'month' }],
    ['an unknown bucket', { column: 'due', bucket: 'year' }],
    ['an unknown measure column', { column: 'label', measureColumn: 'nope' }],
    ['a text measure column', { column: 'label', measureColumn: 'label' }],
    ['an unknown order', { column: 'label', order: 'count; DROP' }],
    ['a limit of 0', { column: 'label', limit: 0 }],
    ['a limit above 50', { column: 'label', limit: 51 }],
    ['a text limit', { column: 'label', limit: '5' }],
    ['an object column', { column: { a: 1 } }],
  ])('refuses %s', (_name, opts) => {
    expect(() => groupStats('group_probe', { limit: 5, db, ...opts })).toThrow(expect.objectContaining({ code: expect.stringMatching(/^(invalid_query|unknown_column)$/) }));
  });

  it('refuses a missing limit', () => {
    expect(() => groupStats('group_probe', { column: 'label', db })).toThrow(expect.objectContaining({ code: expect.stringMatching(/^(invalid_query|unknown_column)$/) }));
  });

  it('refuses a table that is not registered', () => {
    expect(() => groupStats('nope', { column: 'x', limit: 5, db })).toThrow();
  });
});
