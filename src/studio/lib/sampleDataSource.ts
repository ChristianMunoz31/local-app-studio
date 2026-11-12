// A read-only, in-memory CatalogDataSource for the Features page previews: the sample rows of a spec, with the filter,
// search, sort, paging and stats the parts ask for computed here. Writes are refused. When the query names a page and a
// source of the spec, that source's own conditions, order and limit apply first, as the server does.
import { MAX_CHART_GROUPS } from '@/catalog/enums';
import type { CatalogDataSource, DataQuery, DataRow, FieldStats, GroupQuery, GroupRow, GroupStats, TableStats } from '@/catalog/context';
import type { AppSpec, WhereCondition } from '@local-app-studio/runtime/spec/schema';

const refuse = (): Promise<never> => Promise.reject(Object.assign(new Error('This preview shows data but does not change it.'), { code: 'read_only' }));

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a ?? '').localeCompare(String(b ?? ''));
}

// The same patterns as server/db/codec.js (not imported: it pulls the table registry and DbError into the browser bundle).
const NUM_RE = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TS_RE = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?\s*(Z|z|[+-]\d{2}(?::?\d{2})?)?$/;

/** A real calendar day as YYYY-MM-DD (no rollover such as Feb 30), or undefined. */
function realDay(day: string): string | undefined {
  if (!DATE_RE.test(day)) return undefined;
  const d = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== day ? undefined : day;
}

/** A date field stores the first 10 characters (canonicalDate), so a date written with a time still matches its day. */
function canonicalDay(v: unknown): string | undefined {
  return typeof v === 'string' ? realDay(v.trim().slice(0, 10)) : undefined;
}

/** A date and time field stores UTC as YYYY-MM-DDTHH:MM:SS.sssZ (canonicalTimestamp): offsets are converted, a bare day is midnight UTC. */
function canonicalInstant(v: unknown): string | undefined {
  if (typeof v === 'number') return Number.isNaN(new Date(v).getTime()) ? undefined : new Date(v).toISOString();
  if (typeof v !== 'string') return undefined;
  const m = TS_RE.exec(v.trim());
  if (!m) return undefined;
  const [, day, hh = '00', mi = '00', ss = '00', frac = '', zoneRaw = 'Z'] = m;
  if (realDay(day) === undefined) return undefined;
  let zone = 'Z';
  if (zoneRaw.toUpperCase() !== 'Z') {
    const digits = zoneRaw.slice(1).replace(':', '');
    zone = `${zoneRaw[0]}${digits.slice(0, 2)}:${digits.length > 2 ? digits.slice(2, 4) : '00'}`;
  }
  const t = Date.parse(`${day}T${hh}:${mi}:${ss}.${(frac + '000').slice(0, 3)}${zone}`);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

/** What the server stores for a value of a field type (server/db/codec.js encodeValue): yes/no as 1 or 0, numbers as numbers, days and moments in their canonical text, the rest as text. Undefined when it does not fit. */
function encode(type: string | undefined, v: unknown): string | number | null | undefined {
  if (v === null || v === undefined) return null;
  if (type === 'boolean') {
    if (v === true || v === 1 || v === 'true' || v === 't' || v === '1') return 1;
    if (v === false || v === 0 || v === 'false' || v === 'f' || v === '0') return 0;
    return undefined;
  }
  if (type === 'date') return canonicalDay(v);
  if (type === 'datetime') return canonicalInstant(v);
  if (type === 'integer' || type === 'real') {
    const n = typeof v === 'number' ? v : typeof v === 'string' && NUM_RE.test(v.trim()) ? Number(v.trim()) : NaN;
    if (!Number.isFinite(n)) return undefined;
    return type === 'integer' && !Number.isSafeInteger(n) ? undefined : n;
  }
  // A field the spec does not name (a bare row set) keeps its numbers; a text field stores them as text, as the server does.
  if (type === undefined && typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  return typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : undefined;
}

// SQLite order: numbers before text, text by code unit.
function order(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'number') return -1;
  if (typeof b === 'number') return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * One condition against one row, as the server's buildCond reads it (server/db/query.js): a missing value never matches
 * eq, ne, in or a range (SQL NULL), except that a yes or no left empty reads as No, so "is No" and "is not Yes" keep it;
 * eq or ne with null tests for empty; the value is read in the field's type (yes/no, number, text).
 */
function matches(row: DataRow, c: WhereCondition, type: string | undefined): boolean {
  const stored = encode(type, row[c.field]);
  if (c.op === 'in') {
    if (!Array.isArray(c.value) || stored === undefined || stored === null) return false;
    return c.value.some((x) => encode(type, x) === stored);
  }
  if (c.value === null) return c.op === 'eq' ? stored === null : c.op === 'ne' ? stored !== null : false;
  if (Array.isArray(c.value)) return false;
  const bound = encode(type, c.value);
  if (bound === undefined || bound === null) return false;
  if (stored === undefined) return false;
  if (stored === null) return type === 'boolean' && ((c.op === 'eq' && bound === 0) || (c.op === 'ne' && bound === 1));
  const d = order(stored, bound);
  if (c.op === 'eq') return d === 0;
  if (c.op === 'ne') return d !== 0;
  if (c.op === 'gt') return d > 0;
  if (c.op === 'gte') return d >= 0;
  if (c.op === 'lt') return d < 0;
  return d <= 0;
}

function numbersOf(rows: DataRow[], field: string): number[] {
  return rows.map((r) => r[field]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
}

function statsOf(rows: DataRow[]): Record<string, FieldStats> {
  const out: Record<string, FieldStats> = {};
  const fields = new Set(rows.flatMap((r) => Object.keys(r)));
  for (const field of fields) {
    const nums = numbersOf(rows, field);
    if (nums.length === 0) continue;
    const sum = nums.reduce((a, b) => a + b, 0);
    out[field] = { count: nums.length, sum, avg: sum / nums.length, min: Math.min(...nums), max: Math.max(...nums) };
  }
  return out;
}

const BUCKET_LENGTH = { month: 7, day: 10 } as const;

/**
 * Count, sum or average for each value of one field over rows, with the rules of the server: dates (a `bucket`) keep the
 * latest 12 buckets in ascending order, others the 12 biggest groups by count then key, the rest folded into `other`.
 */
export function groupRows(table: string, rows: DataRow[], q: Pick<GroupQuery, 'groupBy' | 'measure' | 'field' | 'bucket'>): GroupStats {
  const buckets = new Map<string | boolean | null, { count: number; sum: number; n: number }>();
  for (const row of rows) {
    const raw = row[q.groupBy];
    let key: string | boolean | null = null;
    if (typeof raw === 'boolean') key = raw;
    else if (typeof raw === 'string' && raw !== '') key = q.bucket ? raw.slice(0, BUCKET_LENGTH[q.bucket]) : raw;
    const g = buckets.get(key) ?? { count: 0, sum: 0, n: 0 };
    g.count += 1;
    const v = q.field ? row[q.field] : undefined;
    if (typeof v === 'number' && Number.isFinite(v)) {
      g.sum += v;
      g.n += 1;
    }
    buckets.set(key, g);
  }
  // Plain code-unit order, as SQLite sorts text (localeCompare would order "a" and "B" differently on a count tie).
  const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  const keyText = (k: string | boolean | null): string => (k === null ? '' : String(k));
  const entries = [...buckets.entries()];
  // Dates: the "no date" group is its own row past the limit, as on the server, and never part of `other`.
  const empty = q.bucket ? entries.filter(([k]) => k === null) : [];
  const all = q.bucket ? entries.filter(([k]) => k !== null) : entries;
  all.sort(([ka, a], [kb, b]) => {
    if (q.bucket) return cmp(keyText(kb), keyText(ka));
    return b.count - a.count || (ka === null ? 1 : kb === null ? -1 : cmp(keyText(ka), keyText(kb)));
  });
  const valueOf = (count: number, sum: number, n: number): number | null => (q.measure === 'count' ? count : q.measure === 'sum' ? sum : n > 0 ? sum / n : null);
  const top = all.slice(0, MAX_CHART_GROUPS);
  const rest = all.slice(MAX_CHART_GROUPS).reduce((a, [, g]) => ({ count: a.count + g.count, sum: a.sum + g.sum, n: a.n + g.n }), { count: 0, sum: 0, n: 0 });
  const toRow = ([key, g]: [string | boolean | null, { count: number; sum: number; n: number }]): GroupRow => ({ key, count: g.count, value: valueOf(g.count, g.sum, g.n) });
  const shown: GroupRow[] = top.map(toRow);
  return {
    table,
    count: rows.length,
    groups: q.bucket ? [...shown.reverse(), ...empty.map(toRow)] : shown,
    other: all.length > top.length ? { groups: all.length - top.length, count: rest.count, value: valueOf(rest.count, rest.sum, rest.n) } : null,
  };
}

/** @param rows rows by table id (sampleRows). @param spec the spec the rows belong to, for source conditions. */
export function sampleDataSource(rows: Record<string, DataRow[]>, spec?: AppSpec): CatalogDataSource {
  const tableRows = (table: string): DataRow[] => (Object.hasOwn(rows, table) ? rows[table] : []);

  const sourceFor = (q: DataQuery) =>
    q.page && q.source ? spec?.pages.find((p) => p.id === q.page)?.sources.find((s) => s.id === q.source) : undefined;

  const select = (table: string, q: Omit<DataQuery, 'limit' | 'offset'>): DataRow[] => {
    const source = sourceFor(q);
    // The server keeps the last condition for a field and operator inside the source's own where (conditionsToWhere),
    // then ANDs every run-time filter condition onto it, so a run-time filter never replaces a source condition.
    const lastWins = new Map<string, WhereCondition>();
    for (const c of source?.where ?? []) lastWins.set(JSON.stringify([c.field, c.op]), c);
    const conditions = [...lastWins.values(), ...(q.filter ?? [])];
    const tableFields = spec?.tables.find((t) => t.id === table)?.fields ?? [];
    const typeOf = (field: string): string | undefined => tableFields.find((f) => f.id === field)?.type;
    let out = tableRows(table).filter((r) => conditions.every((c) => matches(r, c, typeOf(c.field))));
    const term = q.search?.term.trim().toLowerCase();
    if (term && q.search) {
      const fields = q.search.fields;
      out = out.filter((r) => fields.some((f) => String(r[f] ?? '').toLowerCase().includes(term)));
    }
    const order = q.sort && q.sort.length > 0 ? q.sort : (source?.orderBy ?? []);
    if (order.length > 0) {
      out = [...out].sort((a, b) => {
        for (const o of order) {
          const d = compare(a[o.field], b[o.field]);
          if (d !== 0) return o.dir === 'desc' ? -d : d;
        }
        return 0;
      });
    }
    return out;
  };

  return {
    async list(table, q) {
      const all = select(table, q);
      const offset = q.offset ?? 0;
      const limit = q.limit ?? sourceFor(q)?.limit;
      return { rows: all.slice(offset, limit === undefined ? undefined : offset + limit), total: all.length };
    },
    async stats(table, q): Promise<TableStats> {
      const all = select(table, q);
      return { table, count: all.length, fields: statsOf(all) };
    },
    async groups(table, q): Promise<GroupStats> {
      return groupRows(table, select(table, q), q);
    },
    async get(table, id) {
      return tableRows(table).find((r) => r.id === id) ?? null;
    },
    create: refuse,
    update: refuse,
    remove: refuse,
  };
}
