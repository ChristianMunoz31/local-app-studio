// Chart, ProgressBar, Timeline and Checklist: the pure chart model, what each part draws from the data source, and the
// one write (the Checklist PATCH). Numbers always come from the data source; the parts only place and format them.
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PART_COMPONENTS } from '../components.ts';
import { CatalogPageProvider } from '../context.tsx';
import type { CatalogData, DataRow, GroupStats } from '../context.tsx';
import { axisTicks, chartRows, dayOf, groupLabel, linePoints, niceCeil, percentOf, ratios, scaleMax, shorten } from '@local-app-studio/runtime/catalog/parts/chartModel.ts';
import { validateAppSpec } from '@local-app-studio/runtime/spec/schema.ts';
import type { AppSpec, LayoutLayer } from '@local-app-studio/runtime/spec/schema.ts';
import { makeFakeData, seed } from './fakeData.ts';
import { exampleSpec, layer } from './fixtures.ts';

afterEach(cleanup);

function taskSpec(): AppSpec {
  const result = validateAppSpec(exampleSpec());
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

const stamp = { created_at: '2026-03-01T00:00:00.000Z', updated_at: '2026-03-01T00:00:00.000Z' };
const tasks = (): DataRow[] => [
  { id: 't1', title: 'Pack', done: false, due: '2026-03-05', hours: 2, crew_id: 'c1', ...stamp },
  { id: 't2', title: 'Load', done: true, due: '2026-03-05', hours: 3, crew_id: 'c1', ...stamp },
  { id: 't3', title: 'Drive', done: false, due: '2026-03-07', hours: 5, crew_id: null, ...stamp },
  { id: 't4', title: 'Rest', done: false, due: null, hours: null, crew_id: null, ...stamp },
];

type Data = ReturnType<typeof makeFakeData>;

function Tree({ node }: { node: LayoutLayer }): ReactNode {
  const component = PART_COMPONENTS[node.type];
  return createElement(component, { ...node.props, 'data-testid': node.id }, []);
}

function mount(node: LayoutLayer, { data = makeFakeData({ ...seed(), tasks: tasks() }), live = true, recordId = null }: { data?: Data; live?: boolean; recordId?: string | null } = {}) {
  const value: CatalogData = { apiBase: '/api', spec: taskSpec(), pageId: 'crew', recordId, dataSource: data, ...(live ? { navigate: vi.fn() } : {}) };
  const view = render(
    <CatalogPageProvider value={value}>
      <Tree node={node} />
    </CatalogPageProvider>,
  );
  return { ...view, data };
}

describe('chartModel', () => {
  it('rounds the top of the scale up to 1, 2 or 5 times a power of ten', () => {
    expect([0, -3, NaN, 1, 1.2, 2, 3, 5, 6, 11, 73, 0.03].map(niceCeil)).toEqual([1, 1, 1, 1, 2, 2, 5, 5, 10, 20, 100, 0.05]);
    expect(scaleMax([3, null, 4])).toBe(5);
    expect(scaleMax([])).toBe(1);
  });

  it('gives whole ticks for small whole scales and 4 or 5 steps otherwise', () => {
    expect(axisTicks(5, true)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(axisTicks(2, true)).toEqual([0, 1, 2]);
    expect(axisTicks(20)).toEqual([0, 5, 10, 15, 20]);
    expect(axisTicks(100)).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it('turns values into shares from 0 to 1', () => {
    expect(ratios([0, 5, 10, null, -2, 20], 10)).toEqual([0, 0.5, 1, 0, 0, 1]);
    expect(ratios([1], 0)).toEqual([0]);
  });

  it('places line points across the plot, higher values higher, one point in the middle', () => {
    const box = { width: 100, height: 60, left: 10, right: 10, top: 10, bottom: 10 };
    expect(linePoints([0, 10, 5], 10, box)).toEqual([
      { x: 10, y: 50 },
      { x: 50, y: 10 },
      { x: 90, y: 30 },
    ]);
    expect(linePoints([10], 10, box)).toEqual([{ x: 50, y: 10 }]);
  });

  it('labels keys in words', () => {
    expect(groupLabel({ type: 'select', bucket: 'month' }, 'active')).toBe('active');
    expect(groupLabel({ type: 'boolean', bucket: 'month' }, true)).toBe('Yes');
    expect(groupLabel({ type: 'boolean', bucket: 'month' }, false)).toBe('No');
    expect(groupLabel({ type: 'select', bucket: 'month' }, null)).toBe('None');
    expect(groupLabel({ type: 'date', bucket: 'month' }, null)).toBe('No date');
    expect(groupLabel({ type: 'datetime', bucket: 'day' }, null)).toBe('No date');
    expect(groupLabel({ type: 'reference', bucket: 'month', titles: { a: 'Ana' } }, 'a')).toBe('Ana');
    expect(groupLabel({ type: 'reference', bucket: 'month' }, 'zzz')).toBe('zzz');
    expect(groupLabel({ type: 'date', bucket: 'month' }, '2026-03')).toBe(new Date(Date.UTC(2026, 2, 1)).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' }));
    expect(groupLabel({ type: 'date', bucket: 'day' }, '2026-03-05')).toBe(new Date(Date.UTC(2026, 2, 5)).toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' }));
    expect(groupLabel({ type: 'date', bucket: 'day' }, 'garbage')).toBe('garbage');
    expect(shorten('abcdef', 4)).toBe('abc…');
    expect(shorten('abc', 4)).toBe('abc');
  });

  it('adds one row for what the groups leave out, Other after and Earlier before', () => {
    const stats: GroupStats = { table: 't', count: 5, groups: [{ key: 'a', count: 3, value: 3 }], other: { groups: 2, count: 2, value: 2 } };
    expect(chartRows(stats, { type: 'select', bucket: 'month' })).toEqual([
      { label: 'a', value: 3 },
      { label: 'Other', value: 2 },
    ]);
    expect(chartRows({ ...stats, groups: [{ key: '2026-03', count: 3, value: 3 }] }, { type: 'date', bucket: 'month' }).map((r) => r.label)[0]).toBe('Earlier');
    expect(chartRows({ ...stats, other: null }, { type: 'select', bucket: 'month' })).toHaveLength(1);
  });
});

describe('Chart', () => {
  const chart = (props: Record<string, unknown> = {}) => layer('ch', 'Chart', { source: 'open_crews', groupBy: 'lead_id', title: 'Crews by lead', ...props });
  const tableOf = () => within(screen.getByRole('table', { hidden: true }));

  it('draws one bar for each group with the lead titles, and an accessible table', async () => {
    const { container, data } = mount(chart());
    await screen.findByRole('img', { name: 'Crews by lead' });
    await screen.findAllByText('Ana');
    expect(container.querySelectorAll('rect.fill-accent-indigo')).toHaveLength(2);
    expect(container.querySelector('figure figcaption')?.textContent).toBe('Crews by lead');
    const rows = tableOf().getAllByRole('row').slice(1).map((r) => [...r.children].map((c) => c.textContent));
    expect(rows).toEqual([['Ana', '1'], ['None', '1']]);
    const call = data.calls.find((c) => c.method === 'groups');
    expect(call?.arg).toMatchObject({ page: 'crew', source: 'open_crews', groupBy: 'lead_id', measure: 'count' });
    expect(call?.arg).not.toHaveProperty('bucket');
    expect(call?.arg).not.toHaveProperty('field');
  });

  it('draws at the measured width so the text keeps its size, and falls back to 480 where nothing is measured', async () => {
    const original = globalThis.ResizeObserver;
    // The figure measures its content box: the client width (916) minus its 8px side paddings.
    const client = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(916);
    const style = vi.spyOn(window, 'getComputedStyle').mockReturnValue({ paddingLeft: '8px', paddingRight: '8px', getPropertyValue: () => '' } as unknown as CSSStyleDeclaration);
    class Observer {
      observe(): void {}
      disconnect(): void {}
    }
    globalThis.ResizeObserver = Observer as unknown as typeof ResizeObserver;
    try {
      const { container } = mount(chart());
      await screen.findByRole('img', { name: 'Crews by lead' });
      await waitFor(() => expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 900 56'));
      expect(container.querySelector('svg text')?.getAttribute('font-size')).toBe('12');
    } finally {
      cleanup();
      client.mockRestore();
      style.mockRestore();
      globalThis.ResizeObserver = original;
    }
    const { container } = mount(chart());
    await screen.findByRole('img', { name: 'Crews by lead' });
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 480 56');
  });

  it('sums a number field and sends the field, and a line draws a polyline with points', async () => {
    const { container, data } = mount(chart({ kind: 'line', groupBy: 'status', measure: 'sum', field: 'size' }));
    await screen.findByRole('img', { name: 'Crews by lead' });
    expect(container.querySelector('polyline.stroke-accent-indigo')).toBeTruthy();
    expect(container.querySelectorAll('circle.fill-accent-indigo')).toHaveLength(1);
    expect(container.querySelector('line.stroke-slate-slate600')).toBeTruthy();
    expect(container.querySelector('text.fill-slate-slate400')).toBeTruthy();
    expect(tableOf().getByText('10')).toBeTruthy();
    expect(data.calls.find((c) => c.method === 'groups')?.arg).toMatchObject({ groupBy: 'status', measure: 'sum', field: 'size' });
  });

  it('sends a bucket for a date field only, and labels the buckets', async () => {
    const { data } = mount(chart({ source: 'open_tasks', groupBy: 'due', bucket: 'day', measure: 'sum', field: 'hours' }));
    await screen.findByRole('img', { name: 'Crews by lead' });
    expect(data.calls.find((c) => c.method === 'groups')?.arg).toMatchObject({ groupBy: 'due', bucket: 'day', measure: 'sum', field: 'hours' });
    const label = (d: string) => new Date(Date.UTC(2026, 2, Number(d))).toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' });
    const rows = tableOf().getAllByRole('row').slice(1).map((r) => [...r.children].map((c) => c.textContent));
    expect(rows).toEqual([[label('5'), '5'], [label('7'), '5'], ['No date', '0']]);
  });

  it('says so when there is nothing, when grouping is unavailable, and when the data source fails', async () => {
    const empty = mount(chart(), { data: makeFakeData({ people: [], crews: [] }) });
    expect(await screen.findByText('No records to chart yet.')).toBeTruthy();
    empty.unmount();
    const noGroups = makeFakeData();
    noGroups.groups = undefined;
    const unavailable = mount(chart(), { data: noGroups });
    expect((await screen.findByRole('alert')).textContent).toBe('Not available here.');
    unavailable.unmount();
    const failing = makeFakeData();
    failing.groups = () => Promise.reject(new Error('The data could not be read.'));
    mount(chart(), { data: failing });
    expect((await screen.findByRole('alert')).textContent).toBe('The data could not be read.');
  });

  it('names the source without data when there is no page (the canvas)', () => {
    render(<Tree node={chart()} />);
    expect(screen.getByText(/Chart of the rows of/)).toBeTruthy();
  });
});

describe('ProgressBar', () => {
  const bar = (props: Record<string, unknown> = {}) => layer('pb', 'ProgressBar', { source: 'open_crews', label: 'Crews', target: 4, ...props });

  it('clamps and rounds the percent in code', () => {
    expect([percentOf(2, 4), percentOf(5, 4), percentOf(-1, 4), percentOf(1, 3), percentOf(0, 0), percentOf(NaN, 5)]).toEqual([50, 100, 0, 33, 0, 0]);
  });

  it('shows the count of a list source against the target', async () => {
    const { container } = mount(bar());
    const meter = await screen.findByRole('progressbar', { name: 'Crews' });
    expect(meter.getAttribute('aria-valuemin')).toBe('0');
    expect(meter.getAttribute('aria-valuemax')).toBe('4');
    expect(meter.getAttribute('aria-valuenow')).toBe('2');
    expect(screen.getByText('2 of 4')).toBeTruthy();
    expect(container.querySelectorAll('[role="progressbar"] rect')[1].getAttribute('width')).toBe('50');
  });

  it('falls back to the accent fill for a prototype key such as constructor', async () => {
    const { container } = mount(bar({ tone: 'constructor' }));
    await screen.findByText('2 of 4');
    expect(container.querySelectorAll('[role="progressbar"] rect')[1].getAttribute('class')).toBe('fill-accent-indigo');
  });

  it('caps the bar at 100 percent and the value now at the target', async () => {
    const { container } = mount(bar({ stat: 'sum', field: 'size', target: 5 }));
    await screen.findByText('10 of 5');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('5');
    expect(container.querySelectorAll('[role="progressbar"] rect')[1].getAttribute('width')).toBe('100');
  });

  it('reads the number field of a record source', async () => {
    const { container } = mount(bar({ source: 'one_crew', field: 'size', target: 8 }), { recordId: 'c1' });
    await screen.findByText('4 of 8');
    expect(container.querySelectorAll('[role="progressbar"] rect')[1].getAttribute('width')).toBe('50');
  });

  it('shows zero of the goal with no data at all', () => {
    render(<Tree node={bar()} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
    expect(screen.getByText('0 of 4')).toBeTruthy();
  });
});

describe('Timeline', () => {
  const line = (props: Record<string, unknown> = {}) => layer('tl', 'Timeline', { source: 'open_tasks', dateField: 'due', titleField: 'title', ...props });

  it('keeps a date as stored and a datetime as the local day', () => {
    expect(dayOf('date', '2026-03-05')).toBe('2026-03-05');
    expect(dayOf('date', 'nope')).toBe('');
    expect(dayOf('datetime', null)).toBe('');
    const local = new Date(2026, 2, 5, 23, 30);
    expect(dayOf('datetime', local.toISOString())).toBe('2026-03-05');
  });

  it('groups by day with a heading for each, newest first by default, and asks the source to sort', async () => {
    const { data } = mount(line());
    await screen.findByText('Pack');
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    const fmt = (day: number) => new Intl.DateTimeFormat(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(2026, 2, day));
    expect(headings).toEqual([fmt(7), fmt(5), 'No date']);
    const call = [...data.calls].reverse().find((c) => c.method === 'list' && c.table === 'tasks');
    expect(call?.arg).toMatchObject({ sort: [{ field: 'due', dir: 'desc' }] });
    const day5 = screen.getByText(fmt(5)).closest('section')!;
    expect(within(day5).getAllByRole('listitem').map((l) => l.textContent)).toEqual(['Pack', 'Load']);
  });

  it('can put the oldest first, and shows the subtitle', async () => {
    const { data } = mount(line({ order: 'oldest', subtitleField: 'hours' }));
    await screen.findByText('Pack');
    expect([...data.calls].reverse().find((c) => c.method === 'list' && c.table === 'tasks')?.arg).toMatchObject({ sort: [{ field: 'due', dir: 'asc' }] });
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('says how many are shown when the source is paged, and the empty text when there are none', async () => {
    const paged = makeFakeData({ ...seed(), tasks: tasks().slice(0, 2) });
    const list = paged.list.bind(paged);
    paged.list = async (table, q) => ({ ...(await list(table, q)), total: 9 });
    const view = mount(line(), { data: paged });
    expect(await screen.findByText('Showing 2 of 9.')).toBeTruthy();
    view.unmount();
    mount(line({ emptyText: 'No dates yet' }), { data: makeFakeData({ ...seed(), tasks: [] }) });
    expect(await screen.findByText('No dates yet')).toBeTruthy();
  });
});

describe('Checklist', () => {
  const list = (props: Record<string, unknown> = {}) => layer('cl', 'Checklist', { source: 'open_tasks', field: 'done', titleField: 'title', ...props });
  const boxes = () => screen.getAllByRole('checkbox') as HTMLInputElement[];

  it('shows a box for each row, labelled by its title, ticked from the field', async () => {
    mount(list());
    await screen.findByText('Pack');
    expect(boxes().map((b) => [b.checked, b.disabled])).toEqual([[false, false], [true, false], [false, false], [false, false]]);
    expect(screen.getByRole('checkbox', { name: 'Load' })).toBeTruthy();
  });

  it('saves a tick with one PATCH of just that field, and no dialog', async () => {
    const { data } = mount(list());
    await screen.findByText('Pack');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pack' }));
    await waitFor(() => expect(data.calls.filter((c) => c.method === 'update')).toHaveLength(1));
    expect(data.calls.find((c) => c.method === 'update')).toEqual({ method: 'update', table: 'tasks', arg: { id: 't1', values: { done: true } } });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((screen.getByRole('checkbox', { name: 'Pack' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Load' }));
    await waitFor(() => expect(data.calls.filter((c) => c.method === 'update')).toHaveLength(2));
    expect(data.calls.filter((c) => c.method === 'update')[1].arg).toEqual({ id: 't2', values: { done: false } });
  });

  it('disables the boxes while saving', async () => {
    const data = makeFakeData({ ...seed(), tasks: tasks() });
    let finish: () => void = () => {};
    data.update = () => new Promise<DataRow>((resolve) => (finish = () => resolve({})));
    mount(list(), { data });
    await screen.findByText('Pack');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pack' }));
    await waitFor(() => expect(boxes().every((b) => b.disabled)).toBe(true));
    finish();
    await waitFor(() => expect(boxes().every((b) => !b.disabled)).toBe(true));
  });

  it('puts the box back and says what went wrong when the save fails', async () => {
    const data = makeFakeData({ ...seed(), tasks: tasks() });
    data.failNextWrite('Done is not allowed.', 'done');
    mount(list(), { data });
    await screen.findByText('Pack');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pack' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Done is not allowed.');
    expect((screen.getByRole('checkbox', { name: 'Pack' }) as HTMLInputElement).checked).toBe(false);
  });

  it('is disabled where the page is not live', async () => {
    const { data } = mount(list(), { live: false });
    await screen.findByText('Pack');
    expect(boxes().every((b) => b.disabled)).toBe(true);
    fireEvent.click(boxes()[0]);
    expect(data.calls.some((c) => c.method === 'update')).toBe(false);
  });

  it.each([
    ['a field that is not yes/no', { field: 'hours' }],
    ['a runtime column', { field: 'created_at' }],
    ['id', { field: 'id' }],
    ['an unknown field', { field: 'nope' }],
    ['a record source', { source: 'one_crew', field: 'done' }],
  ])('refuses %s', async (_name, props) => {
    const { data } = mount(list(props), { data: makeFakeData({ ...seed(), tasks: tasks() }) });
    expect(await screen.findByText('This list cannot be checked off here. Open a record to change it.')).toBeTruthy();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(data.calls.some((c) => c.method === 'update')).toBe(false);
  });

  it('says so when there is nothing to check off', async () => {
    mount(list({ emptyText: 'All done' }), { data: makeFakeData({ ...seed(), tasks: [] }) });
    expect(await screen.findByText('All done')).toBeTruthy();
  });
});

describe('group queries on the client', () => {
  it('keeps undated rows out of Earlier: 13 months plus undated gives Earlier for the month only, No date for the rest', async () => {
    const { groupRows } = await import('../../studio/lib/sampleDataSource.ts');
    const rows: DataRow[] = Array.from({ length: 13 }, (_, i) => ({ d: new Date(Date.UTC(2025, i, 1)).toISOString().slice(0, 10) }));
    const stats = groupRows('t', [...rows, { d: null }, { d: null }], { groupBy: 'd', measure: 'count', bucket: 'month' });
    expect(stats.other).toEqual({ groups: 1, count: 1, value: 1 });
    expect(stats.groups.at(-1)).toEqual({ key: null, count: 2, value: 2 });
    const labels = chartRows(stats, { type: 'date', bucket: 'month' }).map((r) => r.label);
    expect(labels[0]).toBe('Earlier');
    expect(labels.at(-1)).toBe('No date');
    expect(labels.filter((l) => l === 'No date')).toHaveLength(1);
  });

  it('breaks count ties by code unit like SQLite, not by locale', async () => {
    const { groupRows } = await import('../../studio/lib/sampleDataSource.ts');
    const r = groupRows('t', [{ k: 'b' }, { k: 'B' }, { k: 'a' }, { k: 'A' }], { groupBy: 'k', measure: 'count' });
    expect(r.groups.map((g) => g.key)).toEqual(['A', 'B', 'a', 'b']);
  });

  it('sends the group parameters in the stats query string', async () => {
    const { buildQuery } = await import('@local-app-studio/runtime/runtime/dataClient.js');
    expect(buildQuery({ page: 'home', source: 's', groupBy: 'status', measure: 'sum', field: 'size', bucket: 'day' })).toBe('?page=home&source=s&groupBy=status&measure=sum&field=size&bucket=day');
    expect(buildQuery({ page: 'home', source: 's' })).toBe('?page=home&source=s');
  });

  it('groups sample rows with the server rules: 12 and Other, latest 12 dates ascending', async () => {
    const { groupRows } = await import('../../studio/lib/sampleDataSource.ts');
    const rows: DataRow[] = Array.from({ length: 14 }, (_, i) => ({ k: `v${String(i).padStart(2, '0')}`, d: i < 13 ? `2025-${String((i % 12) + 1).padStart(2, '0')}-01` : null, n: i }));
    const byValue = groupRows('t', [...rows, { k: 'v00', d: null, n: 10 }], { groupBy: 'k', measure: 'sum', field: 'n' });
    expect(byValue.count).toBe(15);
    expect(byValue.groups).toHaveLength(12);
    expect(byValue.groups[0]).toEqual({ key: 'v00', count: 2, value: 10 });
    expect(byValue.other).toEqual({ groups: 2, count: 2, value: 12 + 13 });
    const byMonth = groupRows('t', rows, { groupBy: 'd', measure: 'avg', field: 'n', bucket: 'month' });
    expect(byMonth.groups.map((g) => g.key)).toEqual(['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', null]);
    expect(byMonth.groups[0].value).toBe(6);
    // 12 months plus the undated row: the undated row stays its own None bucket past the limit, nothing is left over.
    expect(byMonth.groups.at(-1)).toEqual({ key: null, count: 1, value: 13 });
    expect(byMonth.groups).toHaveLength(13);
    expect(byMonth.other).toBeNull();
    expect(groupRows('t', [{ k: true }, { k: false }, { k: true }], { groupBy: 'k', measure: 'count' }).groups).toEqual([
      { key: true, count: 2, value: 2 },
      { key: false, count: 1, value: 1 },
    ]);
    expect(groupRows('t', [{ k: 'a' }], { groupBy: 'k', measure: 'avg', field: 'n' }).groups[0].value).toBeNull();
  });
});
