import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CatalogPageProvider, useIsLive, useSource, useSourceFilters, useSourceGroups, useSourceSort, useSourceStats } from '../context.tsx';
import type { CatalogData, GroupStats } from '../context.tsx';
import { crewAppSpec, makeFakeData } from './fakeData.ts';

afterEach(cleanup);

const GROUPS: GroupStats = {
  table: 'crews',
  count: 3,
  groups: [
    { key: 'active', count: 2, value: null },
    { key: 'paused', count: 1, value: null },
  ],
  other: null,
};

function wrapperFor(value: CatalogData) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <CatalogPageProvider value={value}>{children}</CatalogPageProvider>;
  };
}

const live = (extra: Partial<CatalogData> = {}): CatalogData => ({
  apiBase: '/api',
  spec: crewAppSpec(),
  pageId: 'home',
  recordId: null,
  dataSource: makeFakeData(),
  navigate: vi.fn(),
  ...extra,
});

const listCalls = (data: CatalogData) => (data.dataSource as ReturnType<typeof makeFakeData>).calls.filter((c) => c.method === 'list' && c.table === 'crews');

describe('useIsLive', () => {
  it('is false without a navigate handler (the canvas, previews) and true with one', () => {
    expect(renderHook(() => useIsLive()).result.current).toBe(false);
    expect(renderHook(() => useIsLive(), { wrapper: wrapperFor({ apiBase: '/api' }) }).result.current).toBe(false);
    expect(renderHook(() => useIsLive(), { wrapper: wrapperFor(live()) }).result.current).toBe(true);
  });
});

describe('useSourceSort and useSource sort', () => {
  it('has no sort and a no-op setter outside a page', () => {
    const { result } = renderHook(() => useSourceSort('open_crews'));
    expect(result.current.sort).toBeNull();
    expect(() => act(() => result.current.setSort({ field: 'name', dir: 'asc' }))).not.toThrow();
    expect(result.current.sort).toBeNull();
  });

  it('sends the sort a control set to the source, and none before', async () => {
    const data = live();
    const { result } = renderHook(() => ({ sort: useSourceSort('open_crews'), source: useSource('open_crews') }), { wrapper: wrapperFor(data) });
    await waitFor(() => expect(result.current.source.rows.map((r) => r.name)).toEqual(['Alpha', 'Gamma']));
    expect(listCalls(data).at(-1)?.arg).not.toHaveProperty('sort');
    act(() => result.current.sort.setSort({ field: 'size', dir: 'desc' }));
    await waitFor(() => expect(result.current.source.rows.map((r) => r.name)).toEqual(['Gamma', 'Alpha']));
    expect(result.current.sort.sort).toEqual({ field: 'size', dir: 'desc' });
    expect(listCalls(data).at(-1)?.arg).toMatchObject({ sort: [{ field: 'size', dir: 'desc' }] });
    act(() => result.current.sort.setSort(null));
    await waitFor(() => expect(listCalls(data).at(-1)?.arg).not.toHaveProperty('sort'));
  });

  it('lets opts.sort beat the page sort', async () => {
    const data = live();
    const { result } = renderHook(() => ({ sort: useSourceSort('open_crews'), source: useSource('open_crews', { sort: [{ field: 'name', dir: 'desc' }] }) }), {
      wrapper: wrapperFor(data),
    });
    await waitFor(() => expect(result.current.source.rows.map((r) => r.name)).toEqual(['Gamma', 'Alpha']));
    act(() => result.current.sort.setSort({ field: 'size', dir: 'asc' }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const sorts = listCalls(data).map((c) => (c.arg as { sort?: Array<{ field: string }> }).sort?.map((s) => s.field));
    expect(sorts.every((fields) => fields?.length === 1 && fields[0] === 'name')).toBe(true);
  });

  it('starts again from the first page when the sort changes', async () => {
    const crews = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, name: `Crew ${String(i).padStart(2, '0')}`, size: i, status: 'active', lead_id: null }));
    const data = live({ dataSource: makeFakeData({ people: [], crews }) });
    const { result } = renderHook(() => ({ sort: useSourceSort('open_crews'), source: useSource('open_crews', { limit: 5 }) }), { wrapper: wrapperFor(data) });
    await waitFor(() => expect(result.current.source.rows).toHaveLength(5));
    act(() => result.current.source.setOffset(5));
    await waitFor(() => expect(result.current.source.offset).toBe(5));
    act(() => result.current.sort.setSort({ field: 'name', dir: 'desc' }));
    await waitFor(() => expect(result.current.source.offset).toBe(0));
  });

  it('keeps the sort of one source from reaching another', () => {
    const { result } = renderHook(() => ({ a: useSourceSort('open_crews'), b: useSourceSort('one_crew') }), { wrapper: wrapperFor(live()) });
    act(() => result.current.a.setSort({ field: 'name', dir: 'asc' }));
    expect(result.current.a.sort).toEqual({ field: 'name', dir: 'asc' });
    expect(result.current.b.sort).toBeNull();
  });
});

describe('a typed search narrows the list, not the totals', () => {
  it('sends the search to the list, and none to the stats or the groups; a filter still reaches all three', async () => {
    const data = live();
    const fake = data.dataSource as ReturnType<typeof makeFakeData>;
    const { result } = renderHook(
      () => ({
        filters: useSourceFilters('open_crews'),
        source: useSource('open_crews'),
        stats: useSourceStats('open_crews'),
        groups: useSourceGroups('open_crews', { groupBy: 'status', measure: 'count' }),
      }),
      { wrapper: wrapperFor(data) },
    );
    await waitFor(() => expect(result.current.stats.stats?.count).toBe(2));
    act(() => result.current.filters.setSearch('Alp', ['name']));
    await waitFor(() => expect(result.current.source.rows.map((r) => r.name)).toEqual(['Alpha']));
    expect(listCalls(data).at(-1)?.arg).toMatchObject({ search: { term: 'Alp', fields: ['name'] } });
    expect(result.current.stats.stats?.count).toBe(2);
    expect(result.current.groups.data?.count).toBe(2);
    for (const c of fake.calls.filter((x) => x.method === 'stats' || x.method === 'groups')) expect(c.arg).not.toHaveProperty('search');
    expect(fake.calls.filter((x) => x.method === 'stats')).toHaveLength(1);
    act(() => result.current.filters.setCondition('size', 'gte', '5'));
    await waitFor(() => expect(fake.calls.filter((x) => x.method === 'stats')).toHaveLength(2));
    expect(fake.calls.filter((x) => x.method === 'stats').at(-1)?.arg).toMatchObject({ filter: [{ field: 'size', op: 'gte', value: '5' }] });
  });
});

describe('useSourceGroups', () => {
  const group = { groupBy: 'status', measure: 'count' as const };

  it('asks the data source to group, with the page and source, and returns the groups', async () => {
    const groups = vi.fn().mockResolvedValue(GROUPS);
    const data = live({ dataSource: { ...makeFakeData(), groups } });
    const { result } = renderHook(() => useSourceGroups('open_crews', { ...group, measure: 'sum', field: 'size', bucket: 'month' }), { wrapper: wrapperFor(data) });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data).toEqual(GROUPS));
    expect(result.current).toMatchObject({ loading: false, error: null });
    expect(groups).toHaveBeenCalledWith('crews', { page: 'home', source: 'open_crews', groupBy: 'status', measure: 'sum', field: 'size', bucket: 'month' });
  });

  it('says "Not available here." when the data source cannot group', async () => {
    const { result } = renderHook(() => useSourceGroups('open_crews', group), { wrapper: wrapperFor(live({ dataSource: { ...makeFakeData(), groups: undefined } })) });
    await waitFor(() => expect(result.current.error).toBe('Not available here.'));
    expect(result.current.data).toBeNull();
  });

  it('shows the message of a rejection', async () => {
    const groups = vi.fn().mockRejectedValue(new Error('The data could not be read.'));
    const { result } = renderHook(() => useSourceGroups('open_crews', group), { wrapper: wrapperFor(live({ dataSource: { ...makeFakeData(), groups } })) });
    await waitFor(() => expect(result.current.error).toBe('The data could not be read.'));
  });

  it('loads nothing without a data source, or for a source of that name that the page does not have', () => {
    expect(renderHook(() => useSourceGroups('open_crews', group)).result.current).toEqual({ data: null, loading: false, error: null });
    const groups = vi.fn();
    const data = live({ dataSource: { ...makeFakeData(), groups } });
    expect(renderHook(() => useSourceGroups('nope', group), { wrapper: wrapperFor(data) }).result.current).toEqual({ data: null, loading: false, error: null });
    expect(groups).not.toHaveBeenCalled();
  });

  it('asks again when the grouping changes', async () => {
    const groups = vi.fn().mockResolvedValue(GROUPS);
    const data = live({ dataSource: { ...makeFakeData(), groups } });
    const { rerender } = renderHook((g: Parameters<typeof useSourceGroups>[1]) => useSourceGroups('open_crews', g), { wrapper: wrapperFor(data), initialProps: group });
    await waitFor(() => expect(groups).toHaveBeenCalledTimes(1));
    rerender({ ...group, groupBy: 'lead_id' });
    await waitFor(() => expect(groups).toHaveBeenCalledTimes(2));
    expect(groups).toHaveBeenLastCalledWith('crews', expect.objectContaining({ groupBy: 'lead_id' }));
  });

  it('works inside a component too (the provider supplies the page state)', async () => {
    const data = live({ dataSource: { ...makeFakeData(), groups: vi.fn().mockResolvedValue(GROUPS) } });
    function Probe() {
      const { data: stats } = useSourceGroups('open_crews', group);
      return <p>{stats === null ? 'waiting' : `${stats.groups.length} groups`}</p>;
    }
    render(
      <CatalogPageProvider value={data}>
        <Probe />
      </CatalogPageProvider>,
    );
    expect(await screen.findByText('2 groups')).toBeTruthy();
  });
});
