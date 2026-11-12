import { describe, expect, it } from 'vitest';
import type { AppSpec, Table } from '@local-app-studio/runtime/spec/schema';
import { SAMPLE_LIMITS, checkSample, checkSampleShape, localDate, localDateTime, resolveRow, seedOrder } from '../sampleData';

const f = (id: string, type: string, extra: object = {}) => ({ id, label: id, required: false, type, ...extra });
const crews = { id: 'crews', label: 'Crews', fields: [f('name', 'text', { required: true }), f('status', 'select', { options: ['Active', 'Paused'] })] };
const people = {
  id: 'people',
  label: 'People',
  fields: [f('name', 'text'), f('crew', 'reference', { table: 'crews' }), f('started', 'date'), f('age', 'integer'), f('on', 'boolean'), f('pay', 'real')],
};
const visits = { id: 'visits', label: 'Visits', fields: [f('person', 'reference', { table: 'people' }), f('at', 'datetime')] };
const spec = { tables: [visits, people, crews] } as unknown as AppSpec;
const ok = (v: unknown) => checkSample(v, spec);

describe('checkSample', () => {
  const good = {
    v: 1,
    tables: {
      crews: [{ _id: 'c1', name: 'North', status: 'Active' }],
      people: [{ _id: 'p1', name: 'Mara', crew: 'c1', started: { $days: -3 }, age: 4, on: true, pay: 1.5 }],
      visits: [{ person: 'p1', at: { $days: 0, time: '09:30' } }],
    },
  };

  it('accepts a good sample and returns a rebuilt copy without extra keys', () => {
    const r = ok({ ...good, extra: 'dropped' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual(good);
      expect(r.value).not.toBe(good);
      expect(r.value.tables.crews[0]).not.toBe(good.tables.crews[0]);
      expect(Object.keys(r.value)).toEqual(['v', 'tables']);
    }
  });

  it('lets a same-table link point only at an earlier row', () => {
    const tree = { tables: [{ id: 'nodes', label: 'Nodes', fields: [f('name', 'text'), f('parent', 'reference', { table: 'nodes' })] }] } as unknown as AppSpec;
    const link = (rows: object[]) => checkSample({ v: 1, tables: { nodes: rows } }, tree).ok;
    expect(link([{ _id: 'a', name: 'A' }, { name: 'B', parent: 'a' }])).toBe(true);
    expect(link([{ name: 'B', parent: 'a' }, { _id: 'a', name: 'A' }])).toBe(false);
    expect(link([{ _id: 'a', name: 'A', parent: 'a' }])).toBe(false);
  });

  it('refuses structure and limits', () => {
    expect(ok(null).ok).toBe(false);
    expect(ok({ v: 2, tables: {} }).ok).toBe(false);
    expect(ok({ v: 1, tables: [] }).ok).toBe(false);
    expect(ok({ v: 1, tables: { crews: Array.from({ length: SAMPLE_LIMITS.rowsPerTable + 1 }, () => ({ name: 'a' })) } }).ok).toBe(false);
    expect(ok({ v: 1, tables: { crews: [{ name: 'a'.repeat(SAMPLE_LIMITS.textChars + 1) }] } }).ok).toBe(false);
    expect(checkSampleShape({ v: 1, tables: { crews: [{ _id: 'Bad Key' }] } })).toBeNull();
  });

  it('refuses unknown tables, fields and wrong value types', () => {
    expect(ok({ v: 1, tables: { nope: [] } }).ok).toBe(false);
    expect(ok({ v: 1, tables: { crews: [{ nope: 'x' }] } }).ok).toBe(false);
    expect(ok({ v: 1, tables: { crews: [{ status: 'Gone' }] } }).ok).toBe(false);
    expect(ok({ v: 1, tables: { people: [{ age: 1.5 }] } }).ok).toBe(false);
    expect(ok({ v: 1, tables: { people: [{ on: 'yes' }] } }).ok).toBe(false);
    expect(ok({ v: 1, tables: { crews: [{ name: 'a', status: 'Active', extra: 1 }] } }).ok).toBe(false);
  });

  it('wants tokens for dates, a time for datetimes and a whole day count in range', () => {
    expect(ok({ v: 1, tables: { people: [{ started: '2026-01-01' }] } }).ok).toBe(false);
    expect(ok({ v: 1, tables: { people: [{ started: { $days: 1, time: '09:00' } }] } }).ok).toBe(false);
    expect(ok({ v: 1, tables: { people: [{ started: { $days: 1.5 } }] } }).ok).toBe(false);
    expect(ok({ v: 1, tables: { people: [{ started: { $days: SAMPLE_LIMITS.maxDays + 1 } }] } }).ok).toBe(false);
    expect(ok({ v: 1, tables: { visits: [{ at: { $days: 0 } }] } }).ok).toBe(false);
    expect(ok({ v: 1, tables: { visits: [{ at: { $days: 0, time: '24:00' } }] } }).ok).toBe(false);
  });

  it('refuses a repeated key and a reference to a missing row', () => {
    expect(ok({ v: 1, tables: { crews: [{ _id: 'c1', name: 'a' }, { _id: 'c1', name: 'b' }] } }).ok).toBe(false);
    expect(ok({ v: 1, tables: { people: [{ crew: 'c9' }], crews: [{ _id: 'c1', name: 'a' }] } }).ok).toBe(false);
    expect(ok({ v: 1, tables: { people: [{ crew: 'c1' }] } }).ok).toBe(false);
  });
});

describe('seedOrder', () => {
  it('puts referenced tables first on a three-table chain', () => {
    expect(seedOrder(spec)).toEqual(['crews', 'people', 'visits']);
  });
  it('keeps spec order when nothing is linked', () => {
    expect(seedOrder({ tables: [crews, { ...crews, id: 'b' }] } as unknown as AppSpec)).toEqual(['crews', 'b']);
  });
});

describe('dates', () => {
  it('counts calendar days across a month end and a year end', () => {
    expect(localDate(new Date(2026, 0, 31, 23, 0), 1)).toBe('2026-02-01');
    expect(localDate(new Date(2026, 2, 1, 0, 30), -1)).toBe('2026-02-28');
    expect(localDate(new Date(2026, 11, 31, 12), 2)).toBe('2027-01-02');
  });
  it('stays on the calendar day over a daylight saving change, in any zone', () => {
    // long spans cross at least one clock change in zones that have one
    for (const days of [-200, -100, 100, 200]) {
      const d = new Date(2026, 5, 15, 12);
      const e = new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
      const want = `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, '0')}-${String(e.getDate()).padStart(2, '0')}`;
      expect(localDate(d, days)).toBe(want);
    }
  });
  it('names the instant of a local wall time', () => {
    const today = new Date(2026, 5, 15, 12);
    const at = new Date(localDateTime(today, 2, '09:30'));
    expect([at.getFullYear(), at.getMonth(), at.getDate(), at.getHours(), at.getMinutes()]).toEqual([2026, 5, 17, 9, 30]);
    expect(localDateTime(today, 0, '00:00')).toMatch(/Z$/);
  });
});

describe('resolveRow', () => {
  const today = new Date(2026, 5, 15, 12);
  const ids = new Map([['crews:c1', 'real-1']]);
  const idOf = (t: string, k: string) => ids.get(`${t}:${k}`);

  it('maps references and tokens, drops _id, unknown keys and unknown references', () => {
    const row = { _id: 'p1', name: 'Mara', crew: 'c1', started: { $days: -1 }, gone: 'x', age: 3 };
    expect(resolveRow(people as unknown as Table, row, today, idOf)).toEqual({ name: 'Mara', crew: 'real-1', started: '2026-06-14', age: 3 });
    expect(resolveRow(people as unknown as Table, { crew: 'zz' }, today, idOf)).toEqual({});
  });

  it('drops a token on a field that is no longer a date', () => {
    expect(resolveRow(crews as unknown as Table, { name: { $days: 1 } }, today, idOf)).toEqual({});
  });

  it('resolves a datetime token, defaulting the time to midnight', () => {
    const out = resolveRow(visits as unknown as Table, { at: { $days: 1 } }, today, idOf);
    const at = new Date(String(out.at));
    expect([at.getDate(), at.getHours(), at.getMinutes()]).toEqual([16, 0, 0]);
  });
});
