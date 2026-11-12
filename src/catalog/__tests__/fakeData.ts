// An in-memory CatalogDataSource for the component tests: just enough of the data API (section 6 of the phase 2
// contract) for filters, search, paging, stats and writes.
import type { AppSpec } from '@local-app-studio/runtime/spec/schema.ts';
import { validateAppSpec } from '@local-app-studio/runtime/spec/schema.ts';
import type { CatalogDataSource, DataQuery, DataRow, TableStats } from '../context.tsx';
import { groupRows } from '../../studio/lib/sampleDataSource.ts';
import { crewSpec } from './fixtures.ts';

export function crewAppSpec(): AppSpec {
  const result = validateAppSpec(crewSpec());
  if (!result.ok) throw new Error(`fixture invalid: ${JSON.stringify(result.issues)}`);
  return result.value;
}

export function seed(): Record<string, DataRow[]> {
  return {
    people: [
      { id: 'p1', name: 'Ana', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
      { id: 'p2', name: 'Ben', created_at: '2026-01-02T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z' },
    ],
    crews: [
      { id: 'c1', name: 'Alpha', size: 4, lead_id: 'p1', status: 'active', created_at: '2026-02-01T00:00:00.000Z', updated_at: '2026-02-01T00:00:00.000Z' },
      { id: 'c2', name: 'Beta', size: 2, lead_id: 'p2', status: 'paused', created_at: '2026-02-02T00:00:00.000Z', updated_at: '2026-02-02T00:00:00.000Z' },
      { id: 'c3', name: 'Gamma', size: 6, lead_id: null, status: 'active', created_at: '2026-02-03T00:00:00.000Z', updated_at: '2026-02-03T00:00:00.000Z' },
    ],
  };
}

export interface FakeData extends CatalogDataSource {
  tables: Record<string, DataRow[]>;
  calls: Array<{ method: string; table: string; arg?: unknown }>;
}

function matches(row: DataRow, q: DataQuery): boolean {
  if (q.source === 'open_crews' && row.status !== 'active') return false;
  for (const c of q.filter ?? []) {
    const v = row[c.field];
    const t = c.value;
    if (c.op === 'eq' && v !== t) return false;
    if (c.op === 'ne' && v === t) return false;
    if (c.op === 'in' && !(Array.isArray(t) && t.includes(v as string))) return false;
    if (c.op === 'gte' && !(typeof v === 'string' && typeof t === 'string' && v >= t)) return false;
    if (c.op === 'lte' && !(typeof v === 'string' && typeof t === 'string' && v <= t)) return false;
  }
  if (q.search) {
    const needle = q.search.term.toLowerCase();
    if (!q.search.fields.some((f) => String(row[f] ?? '').toLowerCase().includes(needle))) return false;
  }
  return true;
}

/** `rows` is the starting content of each table; `failWith` makes the next write reject with a field error. */
export function makeFakeData(rows: Record<string, DataRow[]> = seed()): FakeData & { failNextWrite: (message: string, field?: string) => void } {
  const tables = rows;
  const calls: FakeData['calls'] = [];
  let failure: { message: string; field?: string } | null = null;
  let counter = 0;
  const take = (): void => {
    if (!failure) return;
    const { message, field } = failure;
    failure = null;
    throw Object.assign(new Error(message), { code: 'invalid_record', field });
  };
  return {
    tables,
    calls,
    failNextWrite: (message, field) => {
      failure = { message, field };
    },
    async list(table, q) {
      calls.push({ method: 'list', table, arg: q });
      const all = (tables[table] ?? []).filter((r) => matches(r, q));
      const sort = q.sort?.[0];
      const sorted = sort ? [...all].sort((a, b) => String(a[sort.field]).localeCompare(String(b[sort.field])) * (sort.dir === 'asc' ? 1 : -1)) : all;
      const offset = q.offset ?? 0;
      return { rows: sorted.slice(offset, offset + (q.limit ?? 50)), total: sorted.length };
    },
    async stats(table, q) {
      calls.push({ method: 'stats', table, arg: q });
      const all = (tables[table] ?? []).filter((r) => matches(r, q));
      const fields: TableStats['fields'] = {};
      const values = all.map((r) => r.size).filter((v): v is number => typeof v === 'number');
      if (table === 'crews') {
        const sum = values.reduce((a, b) => a + b, 0);
        fields.size = { count: values.length, sum, avg: values.length ? sum / values.length : null, min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null };
      }
      return { table, count: all.length, fields };
    },
    async groups(table, q) {
      calls.push({ method: 'groups', table, arg: q });
      return groupRows(table, (tables[table] ?? []).filter((r) => matches(r, q)), q);
    },
    async get(table, id) {
      calls.push({ method: 'get', table, arg: id });
      return (tables[table] ?? []).find((r) => r.id === id) ?? null;
    },
    async create(table, values) {
      calls.push({ method: 'create', table, arg: values });
      take();
      counter += 1;
      const row = { id: `new${counter}`, created_at: '2026-03-01T00:00:00.000Z', updated_at: '2026-03-01T00:00:00.000Z', ...values };
      tables[table] = [...(tables[table] ?? []), row];
      return row;
    },
    async update(table, id, values) {
      calls.push({ method: 'update', table, arg: { id, values } });
      take();
      const current = (tables[table] ?? []).find((r) => r.id === id);
      if (!current) throw Object.assign(new Error('Not found.'), { code: 'not_found' });
      const row = { ...current, ...values };
      tables[table] = (tables[table] ?? []).map((r) => (r.id === id ? row : r));
      return row;
    },
    async remove(table, id) {
      calls.push({ method: 'remove', table, arg: id });
      tables[table] = (tables[table] ?? []).filter((r) => r.id !== id);
    },
  };
}
