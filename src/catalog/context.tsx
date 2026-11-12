// What parts read data and run actions through (docs/CATALOG.md, "Data binding to page sources"). Parts never fetch on
// their own and never build a query: they name a source of the page and these hooks talk to a CatalogDataSource that
// the runtime (HTTP, {apiBase}/data/...) or the designer provides. Without a data source or a provider every hook
// returns empty values and no-op setters, which is what the designer canvas shows.
/* eslint-disable react-refresh/only-export-components -- the contract keeps the context, its provider and the hooks in this one file */
// UI only. Zod-importing files are imported as types only, so the runtime chunk carries no zod.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AppSpec, FieldType, Table, WhereCondition, WhereOp } from '@local-app-studio/runtime/spec/schema.ts';
import type { Action } from './actions.ts';
import { ActionHost } from './ActionHost.tsx';
import type { HostRequest } from './ActionHost.tsx';
import { onDataChanged } from '../utils/dataChanged.js';
import { titleFieldOf } from '@local-app-studio/runtime/catalog/parts/format.ts';
import { ERROR_TEXT, errorText, joinSentence } from './errorText.ts';

export type DataRow = Record<string, unknown>;

export interface DataQuery {
  page?: string;
  source?: string;
  filter?: WhereCondition[];
  search?: { term: string; fields: string[] };
  sort?: { field: string; dir: 'asc' | 'desc' }[];
  limit?: number;
  offset?: number;
}

/** A group-by question for a Chart. The server groups, the part only draws. */
export interface GroupQuery extends Omit<DataQuery, 'sort' | 'limit' | 'offset'> {
  groupBy: string;
  measure: 'count' | 'sum' | 'avg';
  field?: string;
  bucket?: 'day' | 'month';
}

export interface GroupRow {
  key: string | boolean | null;
  count: number;
  value: number | null;
}

export interface GroupStats {
  table: string;
  count: number;
  groups: GroupRow[];
  /** What the shown groups leave out, or null when nothing remains. */
  other: { groups: number; count: number; value: number | null } | null;
}

export interface FieldStats {
  count: number;
  sum: number;
  avg: number | null;
  min: number | null;
  max: number | null;
}

export interface TableStats {
  table: string;
  count: number;
  fields: Record<string, FieldStats>;
}

/** Rejections are Error values with `code` and, for a record problem, `field`. */
export interface CatalogDataSource {
  list(table: string, q: DataQuery): Promise<{ rows: DataRow[]; total: number }>;
  stats(table: string, q: Omit<DataQuery, 'sort' | 'limit' | 'offset'>): Promise<TableStats>;
  /** Count, sum or avg for each value of one field. Absent where the data source cannot group (parts then say so). */
  groups?(table: string, q: GroupQuery): Promise<GroupStats>;
  get(table: string, id: string): Promise<DataRow | null>;
  create(table: string, values: DataRow): Promise<DataRow>;
  update(table: string, id: string, values: DataRow): Promise<DataRow>;
  remove(table: string, id: string): Promise<void>;
}

export interface CatalogData {
  /** `/api` in a built app, `/api/preview` in Studio Preview. */
  apiBase: string;
  /** Go to a page of the spec. Absent where navigation makes no sense (the designer canvas). */
  navigate?: (pageId: string, opts: { withRecord: boolean; recordId?: string }) => void;
  spec?: AppSpec;
  pageId?: string;
  recordId?: string | null;
  dataSource?: CatalogDataSource;
}

export const CatalogDataContext = createContext<CatalogData>({ apiBase: '/api' });

export function useCatalogData(): CatalogData {
  return useContext(CatalogDataContext);
}

export interface SourceResult {
  rows: DataRow[];
  total: number;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  offset: number;
  setOffset: (n: number) => void;
}

export interface RecordResult {
  record: DataRow | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export type ActionResult = { ok: true } | { ok: false; message: string };

export const NOT_AVAILABLE_YET = 'Not available yet';
export const OPEN_A_RECORD = 'Open a record first.';

export const GROUPS_NOT_AVAILABLE = 'Not available here.';

export type SortChoice = { field: string; dir: 'asc' | 'desc' };

const noop = (): void => {};
const NO_ROWS: DataRow[] = [];
const NO_CONDITIONS: WhereCondition[] = [];

// ---------------------------------------------------------------------------------------------
// Spec lookups (tolerant of a spec that was not normalized)
// ---------------------------------------------------------------------------------------------

export interface SourceInfo {
  id: string;
  table: string;
  mode: 'list' | 'record';
}

function sourceOf(data: CatalogData, sourceId: string): SourceInfo | null {
  const page = data.spec?.pages.find((p) => p.id === data.pageId);
  const source = page?.sources?.find((s) => s.id === sourceId);
  return source ? { id: source.id, table: source.table, mode: source.mode ?? 'list' } : null;
}

/** The source of the current page by id, or null (no spec, no page, or no such source). */
export function useSourceInfo(sourceId: string): SourceInfo | null {
  const data = useCatalogData();
  return sourceOf(data, sourceId);
}

/** A table of the spec, or null. */
export function useTableDef(tableId: string | null): Table | null {
  const { spec } = useCatalogData();
  if (tableId === null) return null;
  return spec?.tables?.find((t) => t.id === tableId) ?? null;
}

/** Type and label of a field (the runtime columns included), or null. */
export interface FieldInfo {
  id: string;
  label: string;
  type: FieldType;
  options?: string[];
  /** For a reference field: the table it points to. */
  table?: string;
}

export function fieldInfo(table: Table | null, fieldId: string): FieldInfo | null {
  if (!table) return null;
  if (fieldId === 'created_at' || fieldId === 'updated_at') {
    return { id: fieldId, label: fieldId === 'created_at' ? 'Created' : 'Updated', type: 'datetime' };
  }
  const f = table.fields.find((x) => x.id === fieldId);
  if (!f) return null;
  if (f.type === 'select') return { id: f.id, label: f.label, type: f.type, options: f.options };
  if (f.type === 'reference') return { id: f.id, label: f.label, type: f.type, table: f.table };
  return { id: f.id, label: f.label, type: f.type };
}

// ---------------------------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------------------------

const SOURCE_KEYS = new WeakMap<CatalogDataSource, number>();
let nextSourceKey = 1;

/** One number per data source object, so a new data source loads again even when the query is the same. */
function sourceKey(ds: CatalogDataSource): number {
  let n = SOURCE_KEYS.get(ds);
  if (n === undefined) {
    n = nextSourceKey++;
    SOURCE_KEYS.set(ds, n);
  }
  return n;
}

const messageOf = (e: unknown): string => errorText(e, joinSentence(ERROR_TEXT.genericSentence, ERROR_TEXT.genericAction));

interface Settled<T> {
  key: string;
  data: T | null;
  error: string | null;
}

/**
 * Runs `load` whenever `key` changes (null: do nothing). `loading` is derived by comparing the settled key with the
 * current one, so no state is set synchronously in an effect. The last data stays while a new request is in flight.
 */
function useLoad<T>(key: string | null, load: () => Promise<T>) {
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  const fullKey = key === null ? null : `${key}#${tick}`;
  useEffect(() => {
    if (fullKey === null) return undefined;
    let live = true;
    loadRef.current().then(
      (data) => {
        if (live) setSettled({ key: fullKey, data, error: null });
      },
      (e: unknown) => {
        if (live) setSettled((prev) => ({ key: fullKey, data: prev?.data ?? null, error: messageOf(e) }));
      },
    );
    return () => {
      live = false;
    };
  }, [fullKey]);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return {
    data: settled?.data ?? null,
    error: settled !== null && settled.key === fullKey ? settled.error : null,
    loading: fullKey !== null && settled?.key !== fullKey,
    refresh,
  };
}

// ---------------------------------------------------------------------------------------------
// Page state: run-time filters and search per source, a version per table, and the action host
// ---------------------------------------------------------------------------------------------

interface SearchState {
  term: string;
  fields: string[];
}

interface PageState {
  filters: Record<string, WhereCondition[]>;
  searches: Record<string, SearchState | null>;
  sorts: Record<string, SortChoice | null>;
  versions: Record<string, number>;
  setCondition: (sourceId: string, field: string, op: WhereOp, value: unknown) => void;
  setSearch: (sourceId: string, term: string, fields: string[]) => void;
  setSort: (sourceId: string, next: SortChoice | null) => void;
  bump: (table: string) => void;
  openHost: (request: HostRequest) => void;
}

const PageStateContext = createContext<PageState | null>(null);

function PageStateProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<Record<string, WhereCondition[]>>({});
  const [searches, setSearches] = useState<Record<string, SearchState | null>>({});
  const [sorts, setSorts] = useState<Record<string, SortChoice | null>>({});
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [request, setRequest] = useState<HostRequest | null>(null);

  const setCondition = useCallback((sourceId: string, field: string, op: WhereOp, value: unknown) => {
    setFilters((prev) => {
      const rest = (prev[sourceId] ?? []).filter((c) => !(c.field === field && c.op === op));
      const next = value === undefined ? rest : [...rest, { field, op, value: value as WhereCondition['value'] }];
      return { ...prev, [sourceId]: next };
    });
  }, []);
  const setSearch = useCallback((sourceId: string, term: string, fields: string[]) => {
    setSearches((prev) => ({ ...prev, [sourceId]: term === '' ? null : { term, fields } }));
  }, []);
  const setSort = useCallback((sourceId: string, next: SortChoice | null) => setSorts((prev) => ({ ...prev, [sourceId]: next })), []);
  const bump = useCallback((table: string) => setVersions((prev) => ({ ...prev, [table]: (prev[table] ?? 0) + 1 })), []);
  const closeHost = useCallback(() => setRequest(null), []);
  // An approved Assistant write to a table refetches every source of that table, as a write from this page does.
  useEffect(() => onDataChanged(bump), [bump]);

  const state = useMemo<PageState>(
    () => ({ filters, searches, sorts, versions, setCondition, setSearch, setSort, bump, openHost: setRequest }),
    [filters, searches, sorts, versions, setCondition, setSearch, setSort, bump],
  );
  return (
    <PageStateContext.Provider value={state}>
      {children}
      {request && <ActionHost request={request} onClose={closeHost} />}
    </PageStateContext.Provider>
  );
}

/**
 * Provides the data and the page state (run-time filters, search, table versions) to the parts of one page, and
 * renders the modal host for open-form and delete-record. Navigating to another page resets the page state.
 */
export function CatalogPageProvider({ value, children }: { value: CatalogData; children: ReactNode }) {
  return (
    <CatalogDataContext.Provider value={value}>
      <PageStateProvider key={value.pageId ?? ''}>{children}</PageStateProvider>
    </CatalogDataContext.Provider>
  );
}

// ---------------------------------------------------------------------------------------------
// Data hooks
// ---------------------------------------------------------------------------------------------

/**
 * Rows of a list source of the current page. `limit` narrows the page size (default: the source's limit). `sort` beats the
 * sort a SortControl set on the page (see useSourceSort), which beats the source's own order.
 */
export function useSource(sourceId: string, opts: { limit?: number; sort?: SortChoice[] } = {}): SourceResult {
  const data = useCatalogData();
  const state = useContext(PageStateContext);
  const source = sourceOf(data, sourceId);
  const filter = state?.filters[sourceId] ?? NO_CONDITIONS;
  const search = state?.searches[sourceId] ?? null;
  const version = source ? (state?.versions[source.table] ?? 0) : 0;
  const pageSort = state?.sorts[sourceId] ?? null;
  const sort = opts.sort ?? (pageSort === null ? undefined : [pageSort]);
  const filterKey = JSON.stringify([filter, search, sort ?? null]);
  const [pos, setPos] = useState({ key: '', offset: 0 });
  const offset = pos.key === filterKey ? pos.offset : 0;
  const setOffset = useCallback((n: number) => setPos({ key: filterKey, offset: n }), [filterKey]);
  const ds = data.dataSource;
  const pageId = data.pageId;
  const key = ds && source && pageId ? JSON.stringify({ t: source.table, p: pageId, s: sourceId, f: filterKey, o: offset, l: opts.limit, v: version, d: sourceKey(ds) }) : null;
  const res = useLoad(key, () => {
    if (!ds || !source || !pageId) return Promise.resolve({ rows: NO_ROWS, total: 0 });
    const q: DataQuery = { page: pageId, source: sourceId };
    if (filter.length > 0) q.filter = filter;
    if (search) q.search = search;
    if (sort !== undefined) q.sort = sort;
    if (offset > 0) q.offset = offset;
    if (opts.limit !== undefined) q.limit = opts.limit;
    return ds.list(source.table, q);
  });
  return {
    rows: res.data?.rows ?? NO_ROWS,
    total: res.data?.total ?? 0,
    loading: res.loading,
    error: res.error,
    refresh: res.refresh,
    offset,
    setOffset,
  };
}

/** One record of a table by id (null while there is no id). The table's version bumps refetch it. */
export function useRecordById(table: string | null, id: string | null): RecordResult {
  const { dataSource: ds } = useCatalogData();
  const version = useContext(PageStateContext)?.versions[table ?? ''] ?? 0;
  const key = ds && table && id ? JSON.stringify({ t: table, id, v: version, d: sourceKey(ds) }) : null;
  const res = useLoad<DataRow | null>(key, () => (ds && table && id ? ds.get(table, id) : Promise.resolve(null)));
  return { record: res.data, loading: res.loading, error: res.error, refresh: res.refresh };
}

/** The row of a record source of the current page (the page's :id). */
export function useRecord(sourceId: string): RecordResult {
  const data = useCatalogData();
  const source = sourceOf(data, sourceId);
  return useRecordById(source ? source.table : null, data.recordId ?? null);
}

/** Count, sum, avg, min and max over the source's filters, computed by the server. A typed search narrows the list, not the totals. */
export function useSourceStats(sourceId: string): { stats: TableStats | null; loading: boolean; error: string | null } {
  const data = useCatalogData();
  const state = useContext(PageStateContext);
  const source = sourceOf(data, sourceId);
  const filter = state?.filters[sourceId] ?? NO_CONDITIONS;
  const version = source ? (state?.versions[source.table] ?? 0) : 0;
  const ds = data.dataSource;
  const pageId = data.pageId;
  const key = ds && source && pageId ? JSON.stringify({ t: source.table, p: pageId, s: sourceId, f: filter, v: version, d: sourceKey(ds) }) : null;
  const res = useLoad<TableStats | null>(key, () => {
    if (!ds || !source || !pageId) return Promise.resolve(null);
    const q: Omit<DataQuery, 'sort' | 'limit' | 'offset'> = { page: pageId, source: sourceId };
    if (filter.length > 0) q.filter = filter;
    return ds.stats(source.table, q);
  });
  return { stats: res.data, loading: res.loading, error: res.error };
}

/**
 * Count for each value of one field of a list source, over the source's conditions, grouped by the server. Without a
 * data source it never loads; a data source with no `groups` gives the error "Not available here.".
 */
export function useSourceGroups(
  sourceId: string,
  g: Omit<GroupQuery, keyof DataQuery>,
): { data: GroupStats | null; loading: boolean; error: string | null } {
  const data = useCatalogData();
  const state = useContext(PageStateContext);
  const source = sourceOf(data, sourceId);
  const filter = state?.filters[sourceId] ?? NO_CONDITIONS;
  const version = source ? (state?.versions[source.table] ?? 0) : 0;
  const ds = data.dataSource;
  const pageId = data.pageId;
  const key =
    ds && source && pageId ? JSON.stringify({ t: source.table, p: pageId, s: sourceId, f: filter, g: [g.groupBy, g.measure, g.field ?? null, g.bucket ?? null], v: version, d: sourceKey(ds) }) : null;
  const res = useLoad<GroupStats | null>(key, () => {
    if (!ds || !source || !pageId) return Promise.resolve(null);
    if (ds.groups === undefined) return Promise.reject(new Error(GROUPS_NOT_AVAILABLE));
    const q: GroupQuery = { page: pageId, source: sourceId, groupBy: g.groupBy, measure: g.measure };
    if (filter.length > 0) q.filter = filter;
    if (g.field !== undefined) q.field = g.field;
    if (g.bucket !== undefined) q.bucket = g.bucket;
    return ds.groups(source.table, q);
  });
  return { data: res.data, loading: res.loading, error: res.error };
}

/** The sort a SortControl set for a source (null: the source's own order), and its setter. A no-op setter outside a page. */
export function useSourceSort(sourceId: string): { sort: SortChoice | null; setSort: (next: SortChoice | null) => void } {
  const state = useContext(PageStateContext);
  const setSortOf = state?.setSort;
  const setSort = useCallback((next: SortChoice | null) => setSortOf?.(sourceId, next), [setSortOf, sourceId]);
  return { sort: state?.sorts[sourceId] ?? null, setSort: state ? setSort : noop };
}

/** True where the page runs for real (a built app or Preview): the data layer can navigate. False on the canvas and in previews. */
export function useIsLive(): boolean {
  return useCatalogData().navigate !== undefined;
}

/** Run-time conditions and search of a source, for FilterBar, ReferencePicker and SearchBox. */
export function useSourceFilters(sourceId: string): {
  filters: WhereCondition[];
  setCondition: (field: string, op: WhereOp, value: unknown | undefined) => void;
  search: { term: string; fields: string[] } | null;
  setSearch: (term: string, fields: string[]) => void;
} {
  const state = useContext(PageStateContext);
  const setConditionOf = state?.setCondition;
  const setSearchOf = state?.setSearch;
  const setCondition = useCallback(
    (field: string, op: WhereOp, value: unknown) => setConditionOf?.(sourceId, field, op, value),
    [setConditionOf, sourceId],
  );
  const setSearch = useCallback((term: string, fields: string[]) => setSearchOf?.(sourceId, term, fields), [setSearchOf, sourceId]);
  return {
    filters: state?.filters[sourceId] ?? NO_CONDITIONS,
    setCondition: state ? setCondition : noop,
    search: state?.searches[sourceId] ?? null,
    setSearch: state ? setSearch : noop,
  };
}

/** Create, update and remove. Each bumps the table's version so every source of that table refetches. */
export function useMutations(): {
  create: (table: string, values: DataRow) => Promise<DataRow>;
  update: (table: string, id: string, values: DataRow) => Promise<DataRow>;
  remove: (table: string, id: string) => Promise<void>;
} {
  const { dataSource: ds } = useCatalogData();
  const bump = useContext(PageStateContext)?.bump;
  return useMemo(() => {
    const need = (): CatalogDataSource => {
      if (!ds) throw new Error(ERROR_TEXT.noDataConnected);
      return ds;
    };
    return {
      create: async (table, values) => {
        const row = await need().create(table, values);
        bump?.(table);
        return row;
      },
      update: async (table, id, values) => {
        const row = await need().update(table, id, values);
        bump?.(table);
        return row;
      },
      remove: async (table, id) => {
        await need().remove(table, id);
        bump?.(table);
      },
    };
  }, [ds, bump]);
}

/** Titles of referenced records: `{ [targetTable]: ids }` in, `{ [targetTable]: { [id]: title } }` out. */
export function useReferenceTitles(requests: Record<string, string[]>): Record<string, Record<string, string>> {
  const { dataSource: ds, spec } = useCatalogData();
  const tables = Object.keys(requests)
    .filter((t) => requests[t].length > 0)
    .sort();
  const key = ds && tables.length > 0 ? JSON.stringify([sourceKey(ds), tables.map((t) => [t, [...new Set(requests[t])].sort()])]) : null;
  const res = useLoad<Record<string, Record<string, string>>>(key, async () => {
    const out: Record<string, Record<string, string>> = {};
    if (!ds) return out;
    for (const table of tables) {
      const def = spec?.tables?.find((t) => t.id === table);
      const titleField = def ? titleFieldOf(def) : 'id';
      const ids = [...new Set(requests[table])];
      const titles: Record<string, string> = {};
      for (let i = 0; i < ids.length; i += 50) {
        const chunk = ids.slice(i, i + 50);
        const { rows } = await ds.list(table, { filter: [{ field: 'id', op: 'in', value: chunk }], limit: chunk.length });
        for (const row of rows) titles[String(row.id)] = String(row[titleField] ?? row.id);
      }
      out[table] = titles;
    }
    return out;
  });
  return res.data ?? {};
}

/** Up to 200 records of a table as `{ id, title }`, sorted by title, for a drop-down. */
export function useReferenceOptions(table: string | null): { options: { id: string; title: string }[]; loading: boolean } {
  const { dataSource: ds, spec } = useCatalogData();
  const version = useContext(PageStateContext)?.versions[table ?? ''] ?? 0;
  const key = ds && table ? JSON.stringify({ t: table, v: version, d: sourceKey(ds) }) : null;
  const res = useLoad<{ id: string; title: string }[]>(key, async () => {
    if (!ds || !table) return [];
    const def = spec?.tables?.find((t) => t.id === table);
    const titleField = def ? titleFieldOf(def) : 'id';
    const { rows } = await ds.list(table, { sort: [{ field: titleField, dir: 'asc' }], limit: 200 });
    return rows.map((row) => ({ id: String(row.id), title: String(row[titleField] ?? row.id) }));
  });
  return { options: res.data ?? [], loading: res.loading };
}

// ---------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------

/**
 * Returns a function that runs a declared action. `current` is the row a rowAction was clicked on; without it,
 * open-form edit and delete-record act on the page's record (a record source of the same table on a /:id page).
 */
export function useRunAction(): (action: Action, current?: { table: string; id: string }) => ActionResult {
  const { navigate, recordId, spec, pageId } = useCatalogData();
  const openHost = useContext(PageStateContext)?.openHost;
  return useCallback(
    (action, current) => {
      if (action.action === 'navigate') {
        if (!navigate) return { ok: false, message: NOT_AVAILABLE_YET };
        // A layer carries its props as stored, so a default (withRecord false) may be missing.
        const withRecord = action.withRecord === true;
        const id = current?.id ?? recordId ?? undefined;
        if (withRecord && id === undefined) return { ok: false, message: OPEN_A_RECORD };
        navigate(action.pageId, withRecord && id !== undefined ? { withRecord: true, recordId: id } : { withRecord });
        return { ok: true };
      }
      if (!openHost) return { ok: false, message: NOT_AVAILABLE_YET };
      if (action.action === 'open-form' && action.mode !== 'edit') {
        openHost({ kind: 'form', table: action.table, recordId: null });
        return { ok: true };
      }
      let id: string | null = null;
      if (current && current.table === action.table) id = current.id;
      else if (recordId) {
        const page = spec?.pages.find((p) => p.id === pageId);
        const hasRecordSource = !spec || (page?.sources ?? []).some((s) => (s.mode ?? 'list') === 'record' && s.table === action.table);
        if (hasRecordSource) id = recordId;
      }
      if (id === null) return { ok: false, message: OPEN_A_RECORD };
      if (action.action === 'open-form') openHost({ kind: 'form', table: action.table, recordId: id });
      else openHost({ kind: 'delete', table: action.table, recordId: id, thenPageId: action.thenPageId });
      return { ok: true };
    },
    [navigate, recordId, spec, pageId, openHost],
  );
}
