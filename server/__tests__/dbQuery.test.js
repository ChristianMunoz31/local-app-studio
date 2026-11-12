import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
vi.mock('../modules/studio.data.js', (importOriginal) => import('./helpers/probeTable.js').then((m) => m.withProbeTable(importOriginal)));
import {
  count,
  insert,
  insertMany,
  op,
  remove,
  select,
  selectOne,
  update,
  updateById,
  upsert,
} from '../db/index.js';
import { closeTestDb, createTestDb, resetDb, rowsOf, seedDb } from './helpers/testDb.js';

let db;
beforeAll(() => {
  db = createTestDb();
});
beforeEach(() => resetDb(db));
afterAll(() => closeTestDb(db));

const codeOf = (fn) => {
  try {
    fn();
  } catch (e) {
    return e.code;
  }
  return null;
};

const seedItems = () =>
  seedDb(db, {
    probe_items: [
      { id: 't1', created_at: '2026-01-01T00:00:00.000Z', name: 'Alpha', unit_cost: 10, category: 'food', status: 'active' },
      { id: 't2', created_at: '2026-01-02T00:00:00.000Z', name: 'Beta', unit_cost: 20.5, category: 'misc', status: 'done' },
      { id: 't3', created_at: '2026-01-03T00:00:00.000Z', name: 'Gamma', unit_cost: 30, category: 'fun', status: 'active' },
      { id: 't4', created_at: '2026-01-03T00:00:00.000Z', name: 'Delta', unit_cost: 40, category: 'food', status: 'active' },
    ],
  });

describe('where', () => {
  beforeEach(seedItems);
  const ids = (where) => select('probe_items', { columns: ['id'], where, orderBy: [{ column: 'id' }] }).map((r) => r.id);

  it('scalar equality', () => {
    expect(ids({ category: 'food' })).toEqual(['t1', 't4']);
    expect(ids({ category: 'none' })).toEqual([]);
  });
  it('null comparisons on a nullable column', () => {
    insert('assistant_conversations', { id: 'c-null' });
    insert('assistant_conversations', { id: 'c-title', title: 'x' });
    const found = (where) => select('assistant_conversations', { columns: ['id'], where, orderBy: [{ column: 'id' }] }).map((r) => r.id);
    expect(found({ title: null })).toEqual(['c-null']);
    expect(found({ title: op.eq(null) })).toEqual(['c-null']);
    expect(found({ title: op.ne(null) })).toEqual(['c-title']);
  });
  it('operators', () => {
    expect(ids({ unit_cost: op.gt(20.5) })).toEqual(['t3', 't4']);
    expect(ids({ unit_cost: op.gte(20.5) })).toEqual(['t2', 't3', 't4']);
    expect(ids({ unit_cost: op.lt(20.5) })).toEqual(['t1']);
    expect(ids({ unit_cost: op.lte(20.5) })).toEqual(['t1', 't2']);
    expect(ids({ unit_cost: op.and(op.gt(10), op.lt(40)) })).toEqual(['t2', 't3']);
    expect(ids({ status: op.eq('done') })).toEqual(['t2']);
    expect(ids({ status: op.ne('active') })).toEqual(['t2']);
  });
  it('in, including empty', () => {
    expect(ids({ id: op.in(['t1', 't3', 'zz']) })).toEqual(['t1', 't3']);
    expect(ids({ id: op.in([]) })).toEqual([]);
  });
  it('$or combines with sibling keys', () => {
    expect(ids({ $or: [{ id: 't1' }, { id: 't3' }], category: 'food' })).toEqual(['t1']);
    expect(ids({ $or: [{ id: 't1' }, { unit_cost: op.gt(35) }] })).toEqual(['t1', 't4']);
    expect(ids({ $or: [] })).toEqual([]);
  });
  it('normalizes cursor timestamps to canonical form', () => {
    const rows = select('probe_items', { where: { created_at: op.gte('2026-01-03T00:00:00.000000+00:00') } });
    expect(rows).toHaveLength(2);
  });
  it('throws on undefined condition values', () => {
    expect(codeOf(() => select('probe_items', { where: { id: undefined } }))).toBe('invalid_query');
  });
  it('count honors where', () => {
    expect(count('probe_items')).toBe(4);
    expect(count('probe_items', { where: { category: 'food' } })).toBe(2);
  });
});

describe('search', () => {
  it('is case-insensitive, unicode-aware, and treats wildcards literally', () => {
    seedDb(db, {
      probe_items: [
        { id: 's1', name: 'Café MUÑOZ' },
        { id: 's2', name: '50% off' },
        { id: 's3', name: 'a_b' },
        { id: 's4', name: 'back\\slash' },
        { id: 's5', name: 'plain', category: 'MuÑoz store' },
      ],
    });
    const found = (term, columns = ['name']) =>
      select('probe_items', { columns: ['id'], search: { columns, term }, orderBy: [{ column: 'id' }] }).map((r) => r.id);
    expect(found('muñoz')).toEqual(['s1']);
    expect(found('MUÑOZ', ['name', 'category'])).toEqual(['s1', 's5']);
    expect(found('%')).toEqual(['s2']);
    expect(found('_')).toEqual(['s3']);
    expect(found('\\')).toEqual(['s4']);
    expect(found('a_b')).toEqual(['s3']);
    expect(found('   ')).toHaveLength(5);
    expect(select('probe_items', { search: { columns: [], term: 'x' } })).toHaveLength(5);
    expect(count('probe_items', { search: { columns: ['name'], term: 'plain' } })).toBe(1);
  });
  it('binds the term (injection text is just text)', () => {
    seedDb(db, { probe_items: [{ id: 'i1', name: 'x' }] });
    expect(select('probe_items', { search: { columns: ['name'], term: "'; DROP TABLE items; --" } })).toEqual([]);
    expect(count('probe_items')).toBe(1);
  });
});

describe('query validation', () => {
  it('rejects a non-array orderBy and duplicate op.and operators', () => {
    seedItems();
    expect(codeOf(() => select('probe_items', { orderBy: { column: 'id' } }))).toBe('invalid_query');
    expect(codeOf(() => select('probe_items', { orderBy: 'id' }))).toBe('invalid_query');
    expect(codeOf(() => op.and(op.gt(1), op.gt(2)))).toBe('invalid_query');
  });
});

describe('orderBy / limit / offset', () => {
  beforeEach(() => {
    seedItems();
  });
  const ids = (opts) => select('probe_items', { columns: ['id'], ...opts }).map((r) => r.id);

  it('orders by a text column with an id tiebreak, asc and desc', () => {
    expect(ids({ orderBy: [{ column: 'category' }, { column: 'id' }] })).toEqual(['t1', 't4', 't3', 't2']);
    expect(ids({ orderBy: [{ column: 'category', dir: 'desc' }, { column: 'id' }] })).toEqual(['t2', 't3', 't1', 't4']);
  });
  it('mirrors PG null placement: asc nulls last, desc nulls first', () => {
    insert('assistant_conversations', { id: 'c1', title: 'b' });
    insert('assistant_conversations', { id: 'c2' });
    insert('assistant_conversations', { id: 'c3', title: 'a' });
    const order = (opts) =>
      select('assistant_conversations', { columns: ['id'], orderBy: [opts, { column: 'id' }] }).map((r) => r.id);
    expect(order({ column: 'title' })).toEqual(['c3', 'c1', 'c2']);
    expect(order({ column: 'title', dir: 'desc' })).toEqual(['c2', 'c1', 'c3']);
    expect(order({ column: 'title', nulls: 'first' })[0]).toBe('c2');
  });
  it('desc then id desc as keyset tiebreak', () => {
    expect(ids({ orderBy: [{ column: 'created_at', dir: 'desc' }, { column: 'id', dir: 'desc' }] })).toEqual(['t4', 't3', 't2', 't1']);
  });
  it('nocase sorts case-insensitively', () => {
    resetDb(db);
    seedDb(db, {
      probe_items: [
        { id: 'b1', name: 'x', category: 'banana' },
        { id: 'b2', name: 'x', category: 'Apple' },
        { id: 'b3', name: 'x', category: 'cherry' },
      ],
    });
    const cats = (nocase) => select('probe_items', { orderBy: [{ column: 'category', nocase }] }).map((r) => r.category);
    expect(cats(true)).toEqual(['Apple', 'banana', 'cherry']);
    expect(cats(false)).toEqual(['Apple', 'banana', 'cherry']);
    seedDb(db, {
      probe_items: [
        { id: 'b4', name: 'x', category: 'Zed' },
        { id: 'b5', name: 'x', category: 'apricot' },
      ],
    });
    expect(cats(true)).toEqual(['Apple', 'apricot', 'banana', 'cherry', 'Zed']);
    expect(cats(false)).toEqual(['Apple', 'Zed', 'apricot', 'banana', 'cherry']);
  });
  it('rowid tiebreak gives insertion order', () => {
    const sameDay = { created_at: '2026-01-03T00:00:00.000Z' };
    expect(ids({ where: sameDay, orderBy: [{ column: 'created_at' }, { column: 'rowid' }] })).toEqual(['t3', 't4']);
    expect(ids({ where: sameDay, orderBy: [{ column: 'rowid', dir: 'desc' }] })).toEqual(['t4', 't3']);
  });
  it('limit, offset, and offset without limit', () => {
    const order = [{ column: 'id' }];
    expect(ids({ orderBy: order, limit: 2 })).toEqual(['t1', 't2']);
    expect(ids({ orderBy: order, limit: 2, offset: 1 })).toEqual(['t2', 't3']);
    expect(ids({ orderBy: order, offset: 3 })).toEqual(['t4']);
    expect(ids({ orderBy: order, limit: 0 })).toEqual([]);
    expect(ids({ orderBy: order, limit: 2, offset: 10 })).toEqual([]);
  });
  it('rejects bad limit/offset values', () => {
    expect(codeOf(() => select('probe_items', { limit: -1 }))).toBe('invalid_query');
    expect(codeOf(() => select('probe_items', { limit: 1.5 }))).toBe('invalid_query');
    expect(codeOf(() => select('probe_items', { offset: -2 }))).toBe('invalid_query');
    expect(codeOf(() => select('probe_items', { limit: '1; DROP' }))).toBe('invalid_query');
  });
  it('selectOne returns a row or null', () => {
    expect(selectOne('probe_items', { where: { id: 't2' } }).name).toBe('Beta');
    expect(selectOne('probe_items', { where: { id: 'none' } })).toBeNull();
  });
});

describe('insert / insertMany', () => {
  it('autofills id and timestamps and decodes the result', () => {
    const row = insert('probe_items', { name: 'hi' });
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(row.quantity).toBe(1);
    expect(row.status).toBe('active');
  });
  it('round-trips json, numbers and text', () => {
    const s = insert('app_state', { key: 'k', value: { a: [1, 2] } });
    expect(s.value).toEqual({ a: [1, 2] });
    const t = insert('probe_items', { name: 't', quantity: 3, unit_cost: 2.5 });
    expect(t.quantity).toBe(3);
    expect(t.unit_cost).toBe(2.5);
  });
  it('insertMany is atomic and returns rows in order', () => {
    const rows = insertMany('probe_items', [{ name: 'a' }, { name: 'b' }]);
    expect(rows.map((r) => r.name)).toEqual(['a', 'b']);
    expect(insertMany('probe_items', [])).toEqual([]);
    expect(() => insertMany('probe_items', [{ name: 'c' }, { name: null }])).toThrow();
    expect(rowsOf(db, 'probe_items')).toHaveLength(2);
  });
  it('surfaces constraint and invalid-value errors', () => {
    expect(codeOf(() => insert('probe_items', { name: null }))).toBe('constraint');
    expect(codeOf(() => insert('probe_items', { name: 't', quantity: 1.5 }))).toBe('invalid_value');
    expect(codeOf(() => insert('probe_items', { id: 'x', name: 'x', created_at: 'garbage' }))).toBe('invalid_value');
  });
});

describe('update / updateById', () => {
  it('updates matching rows and returns them decoded', () => {
    const n = insert('probe_items', { name: 'a' });
    const out = update('probe_items', { status: 'done' }, { where: { id: n.id } });
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('done');
    expect(updateById('probe_items', n.id, { name: 'b' }).name).toBe('b');
    expect(updateById('probe_items', 'missing', { name: 'b' })).toBeNull();
  });
  it('quotes reserved column names', () => {
    // `key` is an SQL keyword and the app_state primary key.
    insert('app_state', { key: 'k', value: 1 });
    expect(update('app_state', { value: 5 }, { where: { key: 'k' } })[0].value).toBe(5);
    expect(select('app_state', { orderBy: [{ column: 'key' }] })).toHaveLength(1);
    expect(select('app_state', { where: { key: 'other' } })).toEqual([]);
  });
  it('an empty patch is a no-op that returns the rows', () => {
    const n = insert('probe_items', { name: 'a' });
    expect(update('probe_items', {}, { where: { id: n.id } })[0].name).toBe('a');
    expect(update('probe_items', { name: undefined }, { where: { id: n.id } })[0].name).toBe('a');
  });
  it('requires a where clause', () => {
    expect(codeOf(() => update('probe_items', { name: 'x' }))).toBe('invalid_query');
    expect(codeOf(() => update('probe_items', { name: 'x' }, { where: {} }))).toBe('invalid_query');
  });
});

describe('upsert', () => {
  it('inserts then updates and returns the row', () => {
    const a = upsert('app_state', { key: 'theme', value: 'dark' });
    expect(a.value).toBe('dark');
    const first = a.updated_at;
    const b = upsert('app_state', { key: 'theme', value: 'light', updated_at: '2030-01-01T00:00:00.000Z' }, { conflict: ['key'] });
    expect(b.value).toBe('light');
    expect(b.updated_at).toBe('2030-01-01T00:00:00.000Z');
    expect(first).not.toBe(b.updated_at);
    expect(count('app_state')).toBe(1);
  });
  it('does not overwrite autofilled timestamps when not passed', () => {
    const a = upsert('app_state', { key: 'k', value: 1 });
    const b = upsert('app_state', { key: 'k', value: 2 });
    expect(b.value).toBe(2);
    expect(b.updated_at).toBe(a.updated_at);
  });
  it('with no updatable columns still returns the row', () => {
    const a = upsert('assistant_conversations', { id: 'c1' });
    const b = upsert('assistant_conversations', { id: 'c1' });
    expect(b.id).toBe('c1');
    expect(b.created_at).toBe(a.created_at);
    expect(count('assistant_conversations')).toBe(1);
  });
  it('supports a custom conflict target', () => {
    const n = upsert('app_secrets', { name: 'EXAMPLE_API_KEY', ciphertext: 'a', iv: 'b', auth_tag: 'c', last4: '1234' });
    const m = upsert('app_secrets', { name: 'EXAMPLE_API_KEY', ciphertext: 'z', iv: 'b', auth_tag: 'c', last4: '9999' }, { conflict: ['name'] });
    expect(n.name).toBe(m.name);
    expect(m.last4).toBe('9999');
  });
});

describe('remove', () => {
  it('returns the number of deleted rows', () => {
    seedItems();
    expect(remove('probe_items', { where: { id: op.in(['t1', 't2', 'none']) } })).toBe(2);
    expect(remove('probe_items', { where: { id: 'none' } })).toBe(0);
    expect(count('probe_items')).toBe(2);
  });
  it('requires a where clause', () => {
    expect(codeOf(() => remove('probe_items'))).toBe('invalid_query');
    expect(codeOf(() => remove('probe_items', { where: {} }))).toBe('invalid_query');
  });
  it('cascades through foreign keys', () => {
    const c = insert('assistant_conversations', { title: 'c' });
    insert('assistant_messages', { conversation_id: c.id, role: 'user', content: 'hi' });
    remove('assistant_conversations', { where: { id: c.id } });
    expect(count('assistant_messages')).toBe(0);
  });
});

describe('identifier allowlist', () => {
  it('rejects unknown tables before any SQL runs', () => {
    for (const t of ['__proto__', 'constructor', 'toString', 'nope', 'items; DROP TABLE items', 'schema_version', '']) {
      expect(codeOf(() => select(t))).toBe('unknown_table');
    }
    expect(codeOf(() => count(undefined))).toBe('unknown_table');
    expect(codeOf(() => insert('nope', {}))).toBe('unknown_table');
  });
  it('rejects unknown columns in every position', () => {
    const bad = ['__proto__', 'constructor', '"x"; DROP TABLE items', 'nope', 'rowid'];
    for (const c of bad) {
      expect(codeOf(() => select('probe_items', { where: { [c]: 'x' } }))).toBe('unknown_column');
      expect(codeOf(() => select('probe_items', { columns: [c] }))).toBe('unknown_column');
      expect(codeOf(() => select('probe_items', { search: { columns: [c], term: 'x' } }))).toBe('unknown_column');
      expect(codeOf(() => insert('probe_items', { name: 'x', [c]: 1 }))).toBe('unknown_column');
      expect(codeOf(() => upsert('probe_items', { name: 'x' }, { conflict: [c] }))).toBe('unknown_column');
    }
    for (const c of ['__proto__', 'constructor', 'nope', '"x"; DROP']) {
      expect(codeOf(() => select('probe_items', { orderBy: [{ column: c }] }))).toBe('unknown_column');
    }
    expect(count('probe_items')).toBe(0);
  });
  it('rejects invalid operators, directions and null placement', () => {
    expect(codeOf(() => select('probe_items', { where: { name: { like: 'x' } } }))).toBe('invalid_query');
    expect(codeOf(() => select('probe_items', { orderBy: [{ column: 'name', dir: 'asc; DROP' }] }))).toBe('invalid_query');
    expect(codeOf(() => select('probe_items', { orderBy: [{ column: 'name', nulls: 'sometimes' }] }))).toBe('invalid_query');
    expect(codeOf(() => select('probe_items', { columns: [] }))).toBe('invalid_query');
  });
});

describe('parameter binding', () => {
  it('stores hostile strings as data', () => {
    const evil = `x'); DROP TABLE items; --`;
    const n = insert('probe_items', { name: evil });
    expect(selectOne('probe_items', { where: { name: evil } }).id).toBe(n.id);
    expect(count('probe_items', { where: { name: op.in([evil, "' OR '1'='1"]) } })).toBe(1);
    expect(count('probe_items', { where: { name: "' OR '1'='1" } })).toBe(0);
  });
});
