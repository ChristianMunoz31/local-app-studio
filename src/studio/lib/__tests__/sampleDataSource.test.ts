import { describe, expect, it } from 'vitest';
import { sampleDataSource } from '../sampleDataSource';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';

const rows = { crews: [1, 2, 3, 4].map((n) => ({ id: `c${n}`, name: `Crew ${n}`, size: n * 3, status: n % 2 === 0 ? 'active' : 'idle' })) };

describe('sampleDataSource', () => {
  const ds = sampleDataSource(rows);

  it('filters, searches, sorts and pages in code', async () => {
    expect((await ds.list('crews', { filter: [{ field: 'status', op: 'eq', value: 'active' }] })).total).toBe(2);
    expect((await ds.list('crews', { filter: [{ field: 'size', op: 'gte', value: 6 }] })).rows.map((r) => r.id)).toEqual(['c2', 'c3', 'c4']);
    expect((await ds.list('crews', { search: { term: 'crew 3', fields: ['name'] } })).rows).toHaveLength(1);
    expect((await ds.list('crews', { sort: [{ field: 'size', dir: 'desc' }], limit: 2, offset: 1 })).rows.map((r) => r.id)).toEqual(['c3', 'c2']);
    expect((await ds.list('crews', { limit: 2 })).total).toBe(4);
  });

  it('computes stats and reads one record', async () => {
    const stats = await ds.stats('crews', {});
    expect(stats.count).toBe(4);
    expect(stats.fields.size).toMatchObject({ sum: 30, avg: 7.5, min: 3, max: 12 });
    expect((await ds.get('crews', 'c2'))?.name).toBe('Crew 2');
    expect(await ds.get('crews', 'zz')).toBeNull();
    expect((await ds.list('other', {})).rows).toEqual([]);
  });

  it('refuses writes with read_only', async () => {
    await expect(ds.create('crews', {})).rejects.toMatchObject({ code: 'read_only' });
    await expect(ds.update('crews', 'c1', {})).rejects.toMatchObject({ code: 'read_only' });
    await expect(ds.remove('crews', 'c1')).rejects.toMatchObject({ code: 'read_only' });
  });

  describe('yes or no filters, as the server reads them', () => {
    const invoices = [
      { id: 'i1', amount: 100, paid: true },
      { id: 'i2', amount: 250.5, paid: false },
      { id: 'i3', amount: 4000, paid: false },
      { id: 'i4', amount: 10 },
      { id: 'i5', amount: 20, paid: null },
    ];
    const spec = {
      tables: [{ id: 'invoices', fields: [{ id: 'amount', type: 'real' }, { id: 'paid', type: 'boolean' }] }],
      pages: [{ id: 'home', sources: [{ id: 'unpaid', table: 'invoices', where: [{ field: 'paid', op: 'eq', value: false }] }, { id: 'notpaid', table: 'invoices', where: [{ field: 'paid', op: 'ne', value: true }] }] }],
    } as unknown as AppSpec;
    const ds = sampleDataSource({ invoices }, spec);
    const ids = async (source: string) => (await ds.list('invoices', { page: 'home', source })).rows.map((r) => r.id);

    it('keeps a missing or empty yes or no under "is No" and "is not Yes"', async () => {
      expect(await ids('unpaid')).toEqual(['i2', 'i3', 'i4', 'i5']);
      expect(await ids('notpaid')).toEqual(['i2', 'i3', 'i4', 'i5']);
    });

    it('does not match a missing yes or no under "is Yes", and reads text or numbers as yes or no', async () => {
      expect((await ds.list('invoices', { filter: [{ field: 'paid', op: 'eq', value: true }] })).rows.map((r) => r.id)).toEqual(['i1']);
      expect((await ds.list('invoices', { filter: [{ field: 'paid', op: 'eq', value: 'false' }] })).total).toBe(4);
      expect((await ds.list('invoices', { filter: [{ field: 'paid', op: 'eq', value: null }] })).rows.map((r) => r.id)).toEqual(['i4', 'i5']);
    });

    it('sums a number over the filtered rows', async () => {
      const stats = await ds.stats('invoices', { page: 'home', source: 'unpaid' });
      expect(stats.count).toBe(4);
      expect(stats.fields.amount.sum).toBe(4280.5);
    });

    it('never matches a missing value on ne, in or a range for other types', async () => {
      const d = sampleDataSource({ t: [{ id: 'a', n: 5, s: 'x' }, { id: 'b' }] }, { tables: [{ id: 't', fields: [{ id: 'n', type: 'integer' }, { id: 's', type: 'text' }] }], pages: [] } as unknown as AppSpec);
      expect((await d.list('t', { filter: [{ field: 's', op: 'ne', value: 'y' }] })).rows.map((r) => r.id)).toEqual(['a']);
      expect((await d.list('t', { filter: [{ field: 'n', op: 'in', value: [5, '5'] }] })).rows.map((r) => r.id)).toEqual(['a']);
      expect((await d.list('t', { filter: [{ field: 'n', op: 'lt', value: 9 }] })).rows.map((r) => r.id)).toEqual(['a']);
    });
  });

  describe('dates, numbers and repeated conditions, as the server reads them (G-37)', () => {
    const spec = {
      tables: [{ id: 'jobs', fields: [{ id: 'due', type: 'date' }, { id: 'at', type: 'datetime' }, { id: 'n', type: 'integer' }, { id: 'r', type: 'real' }] }],
      pages: [],
    } as unknown as AppSpec;
    const jobs = [
      { id: 'a', due: '2026-01-05', at: '2026-01-05', n: 5, r: 1 },
      { id: 'b', due: '2026-01-05T23:30:00Z', at: '2026-01-05T00:00:00.000Z', n: 6, r: 2 },
      { id: 'c', due: '2026-01-06', at: '2026-01-05T10:00:00+02:00', n: 7, r: 3 },
      { id: 'd', due: 'soon', at: 'later', n: 8, r: 4 },
    ];
    const ds = sampleDataSource({ jobs }, spec);
    const ids = async (filter: Parameters<typeof ds.list>[1]['filter']) => (await ds.list('jobs', { filter })).rows.map((r) => r.id);

    it('reads a date by its day, even when written with a time', async () => {
      expect(await ids([{ field: 'due', op: 'eq', value: '2026-01-05' }])).toEqual(['a', 'b']);
      expect(await ids([{ field: 'due', op: 'eq', value: '2026-01-05T08:00:00Z' }])).toEqual(['a', 'b']);
      expect(await ids([{ field: 'due', op: 'gt', value: '2026-01-05' }])).toEqual(['c']);
      expect(await ids([{ field: 'due', op: 'eq', value: 'not a date' }])).toEqual([]);
    });

    it('reads a date and time as one moment in UTC, so a bare day equals its midnight', async () => {
      expect(await ids([{ field: 'at', op: 'eq', value: '2026-01-05T00:00:00.000Z' }])).toEqual(['a', 'b']);
      expect(await ids([{ field: 'at', op: 'eq', value: '2026-01-05' }])).toEqual(['a', 'b']);
      expect(await ids([{ field: 'at', op: 'lte', value: '2026-01-05' }])).toEqual(['a', 'b']);
      expect(await ids([{ field: 'at', op: 'lt', value: '2026-01-05' }])).toEqual([]);
    });

    it('converts an offset to UTC', async () => {
      expect(await ids([{ field: 'at', op: 'eq', value: '2026-01-05T08:00:00.000Z' }])).toEqual(['c']);
      expect(await ids([{ field: 'at', op: 'eq', value: '2026-01-05T10:00+02:00' }])).toEqual(['c']);
    });

    it('takes numbers as the server does: no leading plus, no bare dot, integers must be safe', async () => {
      expect(await ids([{ field: 'n', op: 'eq', value: '+5' }])).toEqual([]);
      expect(await ids([{ field: 'r', op: 'eq', value: '.5' }])).toEqual([]);
      expect(await ids([{ field: 'r', op: 'eq', value: '5.' }])).toEqual([]);
      expect(await ids([{ field: 'r', op: 'eq', value: '1e0' }])).toEqual(['a']);
      expect(await ids([{ field: 'n', op: 'eq', value: 5.5 }])).toEqual([]);
      expect(await ids([{ field: 'n', op: 'eq', value: '5' }])).toEqual(['a']);
      expect(await ids([{ field: 'n', op: 'eq', value: 2 ** 60 }])).toEqual([]);
    });

    it('reads a date written with surrounding spaces by its trimmed day, as validateRecord stores it', async () => {
      const spaced = sampleDataSource({ jobs: [{ id: 's', due: ' 2026-01-05 ' }] }, spec);
      expect((await spaced.list('jobs', { filter: [{ field: 'due', op: 'eq', value: '2026-01-05' }] })).rows.map((r) => r.id)).toEqual(['s']);
    });

    describe('source conditions and run-time filters', () => {
      const dated = [
        { id: 'jan', due: '2026-01-10', n: 1 },
        { id: 'feb', due: '2026-02-10', n: 2 },
        { id: 'mar', due: '2026-03-10', n: 3 },
      ];
      const withSource = (where: { field: string; op: 'gte' | 'lte'; value: string | number }[]) =>
        sampleDataSource(
          { jobs: dated },
          {
            tables: [{ id: 'jobs', fields: [{ id: 'due', type: 'date' }, { id: 'n', type: 'integer' }] }],
            pages: [{ id: 'home', sources: [{ id: 'src', table: 'jobs', where }] }],
          } as unknown as AppSpec,
        );
      const listIds = async (where: { field: string; op: 'gte' | 'lte'; value: string | number }[], filter?: { field: string; op: 'gte' | 'lte'; value: string | number }[]) =>
        (await withSource(where).list('jobs', { page: 'home', source: 'src', filter })).rows.map((r) => r.id);

      it('keeps only the last condition for a field and operator inside the source where, as the server does', async () => {
        expect(await listIds([{ field: 'n', op: 'gte', value: 1 }, { field: 'n', op: 'gte', value: 3 }])).toEqual(['mar']);
        expect(await listIds([{ field: 'n', op: 'gte', value: 2 }, { field: 'n', op: 'lte', value: 2 }])).toEqual(['feb']);
      });

      it('ANDs a run-time filter onto a source condition on the same field and operator (the intersection)', async () => {
        const where = [{ field: 'due', op: 'gte' as const, value: '2026-02-01' }];
        expect(await listIds(where, [{ field: 'due', op: 'gte', value: '2026-01-01' }])).toEqual(['feb', 'mar']);
        expect(await listIds(where, [{ field: 'due', op: 'gte', value: '2026-03-01' }])).toEqual(['mar']);
      });
    });
  });
});
