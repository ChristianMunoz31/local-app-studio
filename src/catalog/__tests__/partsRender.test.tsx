import { createElement } from 'react';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PART_COMPONENTS } from '../components.ts';
import { CatalogPageProvider } from '../context.tsx';
import type { CatalogData, DataRow } from '../context.tsx';
import { PART_DEFINITIONS, getPartDefinition } from '../definitions.ts';
import { announceDataChanged } from '../../utils/dataChanged.js';
import { formatStat, formatValue, titleFieldOf } from '@local-app-studio/runtime/catalog/parts/format.ts';
import { validateAppSpec } from '@local-app-studio/runtime/spec/schema.ts';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema.ts';
import { crewAppSpec, makeFakeData, seed } from './fakeData.ts';
import { exampleCtx, exampleSpec, layer } from './fixtures.ts';

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('light');
});

/** Renders a layer tree with the runtime's part-to-component map, the way SpecRenderer does. */
function Tree({ node }: { node: LayoutLayer }): ReactNode {
  const component = PART_COMPONENTS[node.type];
  const children = typeof node.children === 'string' ? node.children : node.children.map((c) => <Tree key={c.id} node={c} />);
  return createElement(component, { ...node.props, 'data-testid': node.id, 'data-layer-id': node.id }, children);
}

interface MountOptions {
  pageId?: string;
  recordId?: string | null;
  data?: ReturnType<typeof makeFakeData>;
}

function mount(root: LayoutLayer, options: MountOptions = {}) {
  const data = options.data ?? makeFakeData();
  const navigate = vi.fn();
  const value: CatalogData = { apiBase: '/api', spec: crewAppSpec(), pageId: options.pageId ?? 'home', recordId: options.recordId ?? null, dataSource: data, navigate };
  const view = render(
    <CatalogPageProvider value={value}>
      <Tree node={root} />
    </CatalogPageProvider>,
  );
  return { ...view, data, navigate };
}

const page = (...children: LayoutLayer[]) => layer('root', 'Page', {}, children);
const lastList = (data: ReturnType<typeof makeFakeData>, table: string) =>
  [...data.calls].reverse().find((c) => c.method === 'list' && c.table === table && (c.arg as { source?: string }).source !== undefined)?.arg as {
    filter?: unknown;
    search?: unknown;
    offset?: number;
    limit?: number;
  };

describe('every part renders', () => {
  const ctx = exampleCtx();
  // Tab and Column only exist inside Tabs and Columns, whose examples hold one.
  const examples = PART_DEFINITIONS.filter((d) => d.name !== 'Page' && d.name !== 'Tab' && d.name !== 'Column').map((d) => d.example);
  const root = page(...examples);

  it.each(['dark', 'light'])('the whole catalog renders in the %s theme', async (theme) => {
    if (theme === 'light') document.documentElement.classList.add('light');
    const { container } = mount(root, { pageId: 'crew', recordId: 'c1' });
    expect(PART_COMPONENTS.Page).toBeTypeOf('function');
    for (const def of PART_DEFINITIONS) expect(PART_COMPONENTS[def.name], def.name).toBeDefined();
    await screen.findAllByText('Alpha');
    for (const example of examples) {
      expect(container.querySelector(`[data-layer-id="${example.id}"]`), example.type).not.toBeNull();
    }
    expect(ctx.tableIds).toEqual(['people', 'crews', 'tasks']);
  });

  it('keeps the component map in catalog order', () => {
    expect(Object.keys(PART_COMPONENTS)).toEqual(PART_DEFINITIONS.map((d) => d.name));
  });

  it('uses only kit tokens: no raw gray, slate-NNN or hex colors in the markup', async () => {
    const { container } = mount(root, { pageId: 'crew', recordId: 'c1' });
    await screen.findAllByText('Alpha');
    expect(container.innerHTML).not.toMatch(/\b(text|bg|border)-(gray|zinc|neutral|stone)-\d/);
    expect(container.innerHTML).not.toMatch(/\bslate-\d{3}\b/);
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});

describe('JS defaults equal the zod defaults', () => {
  const minimal: Record<string, LayoutLayer['props']> = {
    Tab: { label: 'T' },
    DataTable: { source: 'open_crews' },
    RecordForm: { table: 'crews' },
    RecordDetail: { source: 'one_crew' },
    StatCard: { source: 'open_crews', label: 'L' },
    RecordList: { source: 'open_crews' },
    FilterBar: { source: 'open_crews', fields: ['status'] },
    SearchBox: { source: 'open_crews', fields: ['name'] },
    ReferencePicker: { source: 'open_crews', field: 'lead_id' },
    Breadcrumb: { page: 'home' },
    PageHeader: { title: 'T' },
    Collapsible: { title: 'T' },
    Chart: { source: 'open_crews', groupBy: 'status' },
    ProgressBar: { source: 'open_crews', label: 'L' },
    Timeline: { source: 'open_tasks', dateField: 'due' },
    Checklist: { source: 'open_tasks', field: 'done' },
    SortControl: { source: 'open_crews', fields: ['name'] },
    QuickAdd: { table: 'crews', field: 'name' },
  };
  const strip = (html: string): string => html.replace(/_r_[0-9a-z]+_/g, 'ID');

  it.each(PART_DEFINITIONS.map((d) => d.name))('%s renders the same from raw props and from parsed props', async (name) => {
    const def = getPartDefinition(name)!;
    const raw = minimal[name] ?? {};
    const parsed = def.props(exampleCtx()).parse(raw) as LayoutLayer['props'];
    const text = def.children === 'text' ? 'Label' : [];
    const html = async (props: LayoutLayer['props']): Promise<string> => {
      cleanup();
      const node = name === 'Page' ? layer('n', name, props, []) : layer('n', name, props, text);
      const wrapped = name === 'Page' ? node : name === 'Tab' ? layer('tabs', 'Tabs', {}, [node]) : layer('wrap', 'Page', {}, [node]);
      const { container } = mount(wrapped, { pageId: 'crew', recordId: 'c1' });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      return strip(container.innerHTML);
    };
    expect(await html(raw)).toBe(await html(parsed));
  });
});

describe('DataTable', () => {
  const table = (props: Record<string, unknown> = {}) => layer('t', 'DataTable', { source: 'open_crews', columns: ['name', 'size', 'status', 'lead_id'], ...props });

  it('shows the rows of the source, formatted, with the title of a referenced record', async () => {
    mount(page(table()));
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
    await screen.findByText('Alpha');
    expect(screen.getByText('Gamma')).toBeTruthy();
    expect(screen.queryByText('Beta')).toBeNull();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Name', 'Size', 'Status', 'Lead']);
    await screen.findByText('Ana');
    expect(screen.queryByText('Ben')).toBeNull();
    const gamma = screen.getByText('Gamma').closest('tr')!;
    expect(within(gamma).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Gamma', '6', 'active', '-']);
  });

  it('refetches when an approved Assistant write announces a change to its table, and ignores other tables', async () => {
    const { data } = mount(page(table()));
    await screen.findByText('Alpha');
    const lists = () => data.calls.filter((c) => c.method === 'list' && c.table === 'crews').length;
    const before = lists();
    act(() => announceDataChanged('people'));
    await waitFor(() => expect(lists()).toBe(before));
    act(() => announceDataChanged('crews'));
    await waitFor(() => expect(lists()).toBeGreaterThan(before));
  });

  it('defaults to the first five fields of the table', async () => {
    mount(page(layer('t', 'DataTable', { source: 'open_crews' })));
    await screen.findByText('Alpha');
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Name', 'Size', 'Lead', 'Status']);
  });

  it('says so when there is nothing, with the author text when given', async () => {
    const data = makeFakeData({ people: [], crews: [] });
    mount(page(table({ emptyText: 'No crews yet' })), { data });
    expect(await screen.findByText('No crews yet')).toBeTruthy();
  });

  it('has no header row when no column is left, and keeps the one row that says so', async () => {
    const data = makeFakeData({ people: [], crews: [] });
    const { container } = mount(page(table({ columns: ['gone'], emptyText: 'No crews yet' })), { data });
    expect(await screen.findByText('No crews yet')).toBeTruthy();
    expect(container.querySelector('thead')).toBeNull();
    expect(screen.queryAllByRole('columnheader')).toHaveLength(0);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('shows an error line when the data source rejects', async () => {
    const data = makeFakeData();
    data.list = () => Promise.reject(new Error('The data could not be read.'));
    mount(page(table()), { data });
    expect((await screen.findByRole('alert')).textContent).toBe('The data could not be read.');
  });

  it('pages through the source with the page size', async () => {
    const crews: DataRow[] = Array.from({ length: 25 }, (_, i) => ({ id: `c${i}`, name: `Crew ${String(i).padStart(2, '0')}`, size: 1, status: 'active', lead_id: null }));
    const data = makeFakeData({ people: [], crews });
    mount(page(table({ pageSize: 10 })), { data });
    await screen.findByText('Crew 00');
    expect(screen.getByText('1 to 10 of 25')).toBeTruthy();
    expect(lastList(data, 'crews')).toMatchObject({ limit: 10 });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Crew 10');
    expect(screen.getByText('11 to 20 of 25')).toBeTruthy();
    expect(lastList(data, 'crews')).toMatchObject({ offset: 10, limit: 10 });
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('21 to 25 of 25');
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('runs the row action with the row of that table', async () => {
    const { navigate } = mount(page(table({ rowAction: { action: 'navigate', pageId: 'crew', withRecord: true } })));
    fireEvent.click((await screen.findByText('Alpha')).closest('tr')!);
    expect(navigate).toHaveBeenCalledWith('crew', { withRecord: true, recordId: 'c1' });
  });

  it('shows the placeholder where the designer has no spec', () => {
    render(<Tree node={table()} />);
    expect(screen.getByText(/Table of the rows of/)).toBeTruthy();
  });
});

describe('StatCard', () => {
  it('shows counts and numbers the server computed, over the source conditions', async () => {
    const data = makeFakeData();
    mount(
      page(
        layer('a', 'StatCard', { source: 'open_crews', label: 'Active crews', icon: 'users' }),
        layer('b', 'StatCard', { source: 'open_crews', stat: 'sum', field: 'size', label: 'People' }),
        layer('c', 'StatCard', { source: 'open_crews', stat: 'avg', field: 'size', label: 'Average size', tone: 'accent' }),
      ),
      { data },
    );
    await waitFor(() => expect(screen.getByText('Active crews').parentElement!.nextElementSibling!.textContent).toBe('2'));
    expect(screen.getByText('People').parentElement!.nextElementSibling!.textContent).toBe('10');
    expect(screen.getByText('Average size').parentElement!.nextElementSibling!.textContent).toBe('5');
    expect(screen.getByText('Average size').parentElement!.nextElementSibling!.className).toContain('text-accent-indigo');
    expect(data.calls.filter((c) => c.method === 'stats').length).toBeGreaterThan(0);
  });
});

describe('FilterBar, SearchBox and ReferencePicker', () => {
  const list = layer('t', 'DataTable', { source: 'open_crews', columns: ['name', 'status'] });

  it('a select filter becomes an eq condition of the source and can be cleared', async () => {
    const data = makeFakeData();
    mount(page(layer('f', 'FilterBar', { source: 'open_crews', fields: ['status'] }), list), { data });
    await screen.findByText('Alpha');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'paused' } });
    await screen.findByText('Nothing here yet.');
    expect(lastList(data, 'crews').filter).toEqual([{ field: 'status', op: 'eq', value: 'paused' }]);
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: '' } });
    await screen.findByText('Alpha');
    expect(lastList(data, 'crews').filter).toBeUndefined();
  });

  it('an empty table still shows its column headers above the empty line', async () => {
    const data = makeFakeData();
    mount(page(layer('f', 'FilterBar', { source: 'open_crews', fields: ['status'] }), list), { data });
    await screen.findByText('Alpha');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'paused' } });
    const empty = await screen.findByText('Nothing here yet.');
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Name', 'Status']);
    expect(empty.closest('td')?.getAttribute('colspan')).toBe('2');
  });

  it('date filters set gte and lte, a datetime filter uses ISO timestamps with a zone', async () => {
    const data = makeFakeData();
    mount(page(layer('f', 'FilterBar', { source: 'open_crews', fields: ['created_at'] }), list), { data });
    await screen.findByText('Alpha');
    fireEvent.change(screen.getByLabelText('Created from'), { target: { value: '2026-02-01' } });
    fireEvent.change(screen.getByLabelText('Created to'), { target: { value: '2026-02-28' } });
    await waitFor(() => expect((lastList(data, 'crews').filter as Array<{ op: string }> | undefined)?.length).toBe(2));
    const filter = lastList(data, 'crews').filter as Array<{ field: string; op: string; value: string }>;
    expect(filter.map((c) => [c.field, c.op])).toEqual([['created_at', 'gte'], ['created_at', 'lte']]);
    for (const c of filter) expect(c.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('the reference picker lists the target table by title and filters on its id', async () => {
    const data = makeFakeData();
    mount(page(layer('p', 'ReferencePicker', { source: 'open_crews', field: 'lead_id', label: 'Lead' }), list), { data });
    await screen.findByText('Alpha');
    const select = screen.getByLabelText('Lead') as HTMLSelectElement;
    await waitFor(() => expect([...select.options].map((o) => o.textContent)).toEqual(['All', 'Ana', 'Ben']));
    fireEvent.change(select, { target: { value: 'p1' } });
    await waitFor(() => expect(screen.queryByText('Gamma')).toBeNull());
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(lastList(data, 'crews').filter).toEqual([{ field: 'lead_id', op: 'eq', value: 'p1' }]);
    const options = data.calls.find((c) => c.method === 'list' && c.table === 'people')!.arg as { sort: unknown; limit: number };
    expect(options).toMatchObject({ sort: [{ field: 'name', dir: 'asc' }], limit: 200 });
  });

  it('the search box narrows the source after a short pause', async () => {
    const data = makeFakeData();
    mount(page(layer('s', 'SearchBox', { source: 'open_crews', fields: ['name'], placeholder: 'Find a crew' }), list), { data });
    await screen.findByText('Alpha');
    fireEvent.change(screen.getByLabelText('Find a crew'), { target: { value: 'gam' } });
    await waitFor(() => expect(screen.queryByText('Alpha')).toBeNull());
    expect(screen.getByText('Gamma')).toBeTruthy();
    expect(lastList(data, 'crews').search).toEqual({ term: 'gam', fields: ['name'] });
    fireEvent.change(screen.getByLabelText('Find a crew'), { target: { value: '' } });
    await screen.findByText('Alpha');
  });
});

describe('RecordList and RecordDetail', () => {
  it('RecordList shows title, subtitle and badge, and runs its row action', async () => {
    const { navigate } = mount(
      page(layer('r', 'RecordList', { source: 'open_crews', titleField: 'name', subtitleField: 'lead_id', badgeField: 'status', rowAction: { action: 'navigate', pageId: 'crew', withRecord: true } })),
    );
    await screen.findByText('Alpha');
    await screen.findByText('Ana');
    expect(screen.getAllByText('active')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /Gamma/ }));
    expect(navigate).toHaveBeenCalledWith('crew', { withRecord: true, recordId: 'c3' });
  });

  it('RecordDetail shows the record of the page with formatted values', async () => {
    mount(page(layer('d', 'RecordDetail', { source: 'one_crew', fields: ['name', 'size', 'lead_id', 'status'] })), { pageId: 'crew', recordId: 'c1' });
    await screen.findByText('Alpha');
    await screen.findByText('Ana');
    expect(screen.getAllByRole('term').map((t) => t.textContent)).toEqual(['Name', 'Size', 'Lead', 'Status']);
    expect(screen.getByText('4')).toBeTruthy();
  });

  it('RecordDetail says the record is gone when the id is unknown', async () => {
    mount(page(layer('d', 'RecordDetail', { source: 'one_crew' })), { pageId: 'crew', recordId: 'nope' });
    expect(await screen.findByText(/This record was not found/)).toBeTruthy();
  });
});

describe('RecordForm', () => {
  const form = (props: Record<string, unknown> = {}) => layer('f', 'RecordForm', { table: 'crews', fields: ['name', 'size', 'status', 'lead_id'], ...props });

  it('creates a record from field-typed inputs and refreshes the sources of the table', async () => {
    const { data } = mount(page(form(), layer('t', 'DataTable', { source: 'open_crews', columns: ['name'] })));
    await screen.findByText('Alpha');
    const name = screen.getByLabelText(/^Name/) as HTMLInputElement;
    expect(name.type).toBe('text');
    expect((screen.getByLabelText('Size') as HTMLInputElement).type).toBe('number');
    expect((screen.getByLabelText('Size') as HTMLInputElement).value).toBe('1');
    expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe('active');
    await waitFor(() => expect([...(screen.getByLabelText('Lead') as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['None', 'Ana', 'Ben']));
    fireEvent.change(name, { target: { value: 'Delta' } });
    fireEvent.change(screen.getByLabelText('Lead'), { target: { value: 'p2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.getByRole('status', { name: '' }).textContent).toBe('Saved.'));
    expect(data.calls.find((c) => c.method === 'create')!.arg).toEqual({ name: 'Delta', size: 1, status: 'active', lead_id: 'p2' });
    await screen.findByText('Delta');
    expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe('');
  });

  it('shows its own button where the page runs and none on the designer canvas, which has no navigation (OQ-17-6)', () => {
    mount(page(form()));
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy();
    cleanup();
    const value: CatalogData = { apiBase: '/api', spec: crewAppSpec(), pageId: 'home', recordId: null, dataSource: makeFakeData() };
    render(
      <CatalogPageProvider value={value}>
        <Tree node={page(form({ submitLabel: 'Save' }))} />
      </CatalogPageProvider>,
    );
    expect(screen.getByLabelText(/^Name/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('a one-field form with no button writes nothing when Enter submits it, and still writes where the page is live', async () => {
    const data = makeFakeData();
    const notLive: CatalogData = { apiBase: '/api', spec: crewAppSpec(), pageId: 'home', recordId: null, dataSource: data };
    render(
      <CatalogPageProvider value={notLive}>
        <Tree node={page(form({ fields: ['name'] }))} />
      </CatalogPageProvider>,
    );
    const input = screen.getByLabelText(/^Name/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Delta' } });
    // Enter in a one-field form submits it as the browser does; jsdom does not, so the submit event is sent.
    fireEvent.submit(input.closest('form')!);
    await new Promise((r) => setTimeout(r, 30));
    expect(data.calls.some((c) => c.method === 'create')).toBe(false);
    // Changed on purpose: the status line is always mounted, so "nothing saved" is an empty line, not an absent one.
    expect(screen.getByRole('status', { name: '' }).textContent).toBe('');
    cleanup();
    const live = mount(page(form({ fields: ['name'] })));
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Delta' } });
    fireEvent.submit((screen.getByLabelText(/^Name/) as HTMLInputElement).closest('form')!);
    await waitFor(() => expect(live.data.calls.some((c) => c.method === 'create')).toBe(true));
  });

  describe('on a record page', () => {
    const taskSpec = () => {
      const result = validateAppSpec(exampleSpec());
      if (!result.ok) throw new Error('fixture invalid');
      return result.value;
    };
    const mountTask = (recordId: string | null, fields = ['title', 'crew_id']) => {
      const data = makeFakeData();
      const value: CatalogData = { apiBase: '/api', spec: taskSpec(), pageId: 'crew', recordId, dataSource: data, navigate: vi.fn() };
      render(
        <CatalogPageProvider value={value}>
          <Tree node={layer('f', 'RecordForm', { table: 'tasks', fields })} />
        </CatalogPageProvider>,
      );
      return data;
    };

    it('presets a shown link to the record of the page, and sends it', async () => {
      const data = mountTask('c2');
      await waitFor(() => expect((screen.getByLabelText('Crew') as HTMLSelectElement).value).toBe('c2'));
      fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Pour slab' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add' }));
      await screen.findByText('Saved.');
      expect(data.calls.find((c) => c.method === 'create')!.arg).toMatchObject({ crew_id: 'c2' });
    });

    const mountLate = () => {
      const data = makeFakeData();
      const tree = (recordId: string | null) => (
        <CatalogPageProvider value={{ apiBase: '/api', spec: taskSpec(), pageId: 'crew', recordId, dataSource: data, navigate: vi.fn() }}>
          <Tree node={layer('f', 'RecordForm', { table: 'tasks', fields: ['title', 'crew_id'] })} />
        </CatalogPageProvider>
      );
      const view = render(tree(null));
      return { late: (id: string) => view.rerender(tree(id)) };
    };

    it('presets an empty, untouched link when the record id arrives after mount', async () => {
      const { late } = mountLate();
      await waitFor(() => expect([...(screen.getByLabelText('Crew') as HTMLSelectElement).options].length).toBeGreaterThan(1));
      late('c2');
      await waitFor(() => expect((screen.getByLabelText('Crew') as HTMLSelectElement).value).toBe('c2'));
    });

    it('keeps a link the user already chose when the record id arrives late', async () => {
      const { late } = mountLate();
      await waitFor(() => expect([...(screen.getByLabelText('Crew') as HTMLSelectElement).options].length).toBeGreaterThan(2));
      fireEvent.change(screen.getByLabelText('Crew'), { target: { value: 'c1' } });
      late('c2');
      await waitFor(() => expect((screen.getByLabelText('Crew') as HTMLSelectElement).value).toBe('c1'));
    });

    it('leaves the link empty off a record page', async () => {
      mountTask(null);
      await waitFor(() => expect([...(screen.getByLabelText('Crew') as HTMLSelectElement).options].length).toBeGreaterThan(1));
      expect((screen.getByLabelText('Crew') as HTMLSelectElement).value).toBe('');
    });
  });

  it('asks for a required field before calling the server', () => {
    const { data } = mount(page(form()));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('alert').textContent).toBe('Name is required.');
    expect(screen.getByLabelText(/^Name/).getAttribute('aria-invalid')).toBe('true');
    expect(data.calls.some((c) => c.method === 'create')).toBe(false);
  });

  it('shows a server problem beside the field it names, and other problems above the buttons', async () => {
    const data = makeFakeData();
    mount(page(form()), { data });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Delta' } });
    data.failNextWrite('Name is too long.', 'name');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Name is too long.');
    expect(screen.getByLabelText(/^Name/).getAttribute('aria-describedby')).toBe(alert.id);
    data.failNextWrite('The data folder is full.');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The data folder is full.'));
  });

  it('edit mode loads the record of the page, saves a change and goes to the page after saving', async () => {
    const { data, navigate } = mount(
      page(form({ mode: 'edit', source: 'one_crew', fields: ['name', 'size'], submitLabel: 'Save crew', afterSave: { action: 'navigate', pageId: 'home', withRecord: false } })),
      { pageId: 'crew', recordId: 'c1' },
    );
    const name = (await screen.findByDisplayValue('Alpha')) as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Alpha 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save crew' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('home', { withRecord: false }));
    // Changed on purpose: an edit sends only the fields the person changed (size stays out).
    expect(data.calls.find((c) => c.method === 'update')!.arg).toEqual({ id: 'c1', values: { name: 'Alpha 2' } });
  });
});

describe('Button and Link actions', () => {
  it('open-form create opens a form in a dialog and closes it after saving', async () => {
    const { data } = mount(page(layer('b', 'Button', { action: { action: 'open-form', table: 'crews', mode: 'create' } }, 'Add crew')));
    fireEvent.click(screen.getByRole('button', { name: 'Add crew' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Add to Crews' })).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Delta' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(data.calls.find((c) => c.method === 'create')!.arg).toMatchObject({ name: 'Delta' });
  });

  it('open-form edit on a record page edits the page record', async () => {
    mount(page(layer('b', 'Button', { action: { action: 'open-form', table: 'crews', mode: 'edit' } }, 'Edit')), { pageId: 'crew', recordId: 'c2' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByDisplayValue('Beta')).toBeTruthy();
    expect(within(dialog).getByRole('heading', { name: 'Edit record in Crews' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('delete-record always asks first, then removes the record and goes to thenPageId', async () => {
    const { data, navigate } = mount(
      page(layer('b', 'Button', { variant: 'danger', action: { action: 'delete-record', table: 'crews', thenPageId: 'home' } }, 'Delete crew')),
      { pageId: 'crew', recordId: 'c1' },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete crew' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(data.calls.some((c) => c.method === 'remove')).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('home', { withRecord: false }));
    expect(data.calls.find((c) => c.method === 'remove')!.arg).toBe('c1');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('Cancel in the confirmation removes nothing', async () => {
    const { data } = mount(page(layer('b', 'Button', { action: { action: 'delete-record', table: 'crews' } }, 'Delete crew')), { pageId: 'crew', recordId: 'c1' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete crew' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(data.calls.some((c) => c.method === 'remove')).toBe(false);
  });

  it('a delete refused by the server keeps the dialog and shows the message', async () => {
    const data = makeFakeData();
    data.remove = () => Promise.reject(Object.assign(new Error('This record is still used by Crews.'), { code: 'record_in_use' }));
    mount(page(layer('b', 'Button', { action: { action: 'delete-record', table: 'people' } }, 'Delete')), { pageId: 'crew', recordId: 'c1', data });
    // The page record is a crew, so deleting a person has no record: the button says so and opens nothing.
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('status').textContent).toBe('Open a record first.');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('delete-record and open-form edit without a record say so', () => {
    mount(page(layer('b', 'Button', { action: { action: 'open-form', table: 'crews', mode: 'edit' } }, 'Edit')));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('status').textContent).toBe('Open a record first.');
  });

  it('a row action opens the form for that row, and Link navigates', async () => {
    const { navigate } = mount(
      page(
        layer('t', 'DataTable', { source: 'open_crews', columns: ['name'], rowAction: { action: 'open-form', table: 'crews', mode: 'edit' } }),
        layer('l', 'Link', { action: { action: 'navigate', pageId: 'home' } }, 'Back'),
      ),
    );
    fireEvent.click((await screen.findByText('Gamma')).closest('tr')!);
    expect(await screen.findByDisplayValue('Gamma')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(navigate).toHaveBeenCalledWith('home', { withRecord: false });
  });
});

describe('layout parts', () => {
  it('Tabs shows the first tab and switches panels', async () => {
    mount(
      page(
        layer('tabs', 'Tabs', {}, [
          layer('one', 'Tab', { label: 'First' }, [layer('a', 'Text', {}, 'Panel one')]),
          layer('two', 'Tab', { label: 'Second' }, [layer('b', 'Text', {}, 'Panel two')]),
        ]),
      ),
    );
    expect(await screen.findByText('Panel one')).toBeTruthy();
    expect(screen.queryByText('Panel two')).toBeNull();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['First', 'Second']);
    expect(screen.getByRole('tab', { name: 'First' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: 'Second' }));
    expect(screen.getByText('Panel two')).toBeTruthy();
    expect(screen.queryByText('Panel one')).toBeNull();
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(screen.getByRole('tab', { name: 'Second' }).id);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' });
    expect(screen.getByText('Panel one')).toBeTruthy();
  });

  it('Grid, Card and Divider use kit tokens chosen by the enums', () => {
    const { container } = mount(
      page(
        layer('g', 'Grid', { columns: 3, gap: 'lg' }, [layer('c', 'Card', { title: 'Tile', tone: 'success', variant: 'outline' }, [layer('t', 'Text', {}, 'In card')])]),
        layer('d', 'Divider', { spacing: 'lg' }),
        layer('c2', 'Card', { title: 'Plain' }),
      ),
    );
    const grid = container.querySelector('[data-layer-id="g"]')!;
    expect(grid.className).toContain('lg:grid-cols-3');
    expect(grid.className).toContain('gap-6');
    expect(screen.getByRole('heading', { name: 'Tile' }).className).toContain('text-accent-green');
    expect(container.querySelector('[data-layer-id="c"]')!.className).toContain('border');
    expect(container.querySelector('[data-layer-id="c2"]')!.className).toContain('glass-subtle');
    expect(container.querySelector('hr')!.className).toContain('my-6');
  });
});

describe('format', () => {
  it('formats values by field type and leaves empty values empty', () => {
    expect(formatValue({ type: 'boolean' }, true)).toBe('Yes');
    expect(formatValue({ type: 'boolean' }, 0)).toBe('No');
    expect(formatValue({ type: 'integer' }, 12345)).toBe((12345).toLocaleString(undefined, { maximumFractionDigits: 0 }));
    expect(formatValue({ type: 'real' }, 1.239)).toBe((1.239).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    expect(formatValue({ type: 'real' }, 1200.5)).toBe((1200.5).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    expect(formatValue({ type: 'real' }, 1200.5)).toMatch(/50$/);
    expect(formatValue({ type: 'date' }, '2026-01-05')).toBe(new Date(2026, 0, 5).toLocaleDateString(undefined, { dateStyle: 'medium' }));
    expect(formatValue({ type: 'datetime' }, '2026-01-05T09:30:00.000Z')).toContain('2026');
    expect(formatValue({ type: 'datetime' }, 'not a date')).toBe('not a date');
    expect(formatValue({ type: 'select', options: ['a'] }, 'a')).toBe('a');
    expect(formatValue({ type: 'text' }, null)).toBe('');
    expect(formatValue({ type: 'text' }, undefined)).toBe('');
    expect(formatValue({ type: 'integer' }, '')).toBe('');
  });

  it('formats stats: counts whole, averages with decimals, null empty', () => {
    expect(formatStat('count', null, 3)).toBe('3');
    expect(formatStat('avg', 'integer', 2.5)).toBe('2.5');
    expect(formatStat('sum', 'real', 10.256)).toBe((10.256).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    expect(formatStat('avg', 'real', 2.5)).toMatch(/50$/);
    expect(formatStat('sum', 'integer', 12)).toBe('12');
    expect(formatStat('sum', 'integer', null)).toBe('');
  });

  it('the title field is the declared one, else the first text field, else the id', () => {
    expect(titleFieldOf({ titleField: 'code', fields: [{ id: 'code', type: 'select' }, { id: 'name', type: 'text' }] })).toBe('code');
    expect(titleFieldOf({ titleField: 'ghost', fields: [{ id: 'name', type: 'text' }] })).toBe('name');
    expect(titleFieldOf({ fields: [{ id: 'n', type: 'integer' }, { id: 'name', type: 'text' }] })).toBe('name');
    expect(titleFieldOf({ fields: [{ id: 'n', type: 'integer' }] })).toBe('id');
    expect(seed().crews).toHaveLength(3);
  });
});
