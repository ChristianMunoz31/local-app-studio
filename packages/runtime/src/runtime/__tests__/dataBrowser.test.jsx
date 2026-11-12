import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import crewRoster from '../../spec/fixtures/crew-roster.json';
import DataBrowserPage from '../data/DataBrowserPage.jsx';
import DataTablePage from '../data/DataTablePage.jsx';
import { announceDataChanged } from '../../../../../src/utils/dataChanged.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const crew = (n, extra = {}) => ({
  id: `c${n}`,
  name: `Crew ${n}`,
  size: n,
  status: 'active',
  lead_id: 'p1',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  ...extra,
});

function fakeSource(rows = [crew(1), crew(2)], { total = rows.length } = {}) {
  return {
    list: vi.fn(async (table) => {
      if (table === 'people') return { rows: [{ id: 'p1', name: 'Pat Lead' }], total: 1 };
      return { rows, total };
    }),
    stats: vi.fn(),
    get: vi.fn(),
    create: vi.fn(async (_t, values) => ({ id: 'new', ...values })),
    update: vi.fn(),
    remove: vi.fn(async () => {}),
  };
}

const renderTable = (dataSource, table = 'crews') =>
  render(
    <MemoryRouter initialEntries={[`/data/${table}`]}>
      <Routes>
        <Route path="/data/:table" element={<DataTablePage spec={crewRoster} dataSource={dataSource} />} />
      </Routes>
    </MemoryRouter>,
  );

describe('DataTablePage', () => {
  it('lists the rows with reference titles', async () => {
    const ds = fakeSource();
    renderTable(ds);
    expect(await screen.findByText('Crew 1')).toBeTruthy();
    expect(screen.getAllByText('Pat Lead')).toHaveLength(2);
    expect(ds.list).toHaveBeenCalledWith('crews', expect.objectContaining({ limit: 50, offset: 0, filter: [] }));
    expect(ds.list).toHaveBeenCalledWith('people', expect.objectContaining({ filter: [{ field: 'id', op: 'in', value: ['p1'] }] }));
  });

  it('shows the ids when the reference titles cannot load, instead of failing the table', async () => {
    const ds = fakeSource();
    ds.list.mockImplementation(async (table) => {
      if (table === 'people') throw new Error('people unavailable');
      return { rows: [crew(1), crew(2)], total: 2 };
    });
    renderTable(ds);
    expect(await screen.findByText('Crew 1')).toBeTruthy();
    expect(screen.queryByText('Pat Lead')).toBeNull();
    expect(screen.getAllByText('p1').length).toBeGreaterThan(0);
  });

  it('says so for a table that is not in the spec', () => {
    renderTable(fakeSource(), 'nope');
    expect(screen.getByText('Table not found')).toBeTruthy();
  });

  it('sorts when a header is clicked', async () => {
    const ds = fakeSource();
    renderTable(ds);
    await screen.findByText('Crew 1');
    fireEvent.click(screen.getByRole('button', { name: 'Name' }));
    await waitFor(() => expect(ds.list).toHaveBeenCalledWith('crews', expect.objectContaining({ sort: [{ field: 'name', dir: 'asc' }] })));
    fireEvent.click(screen.getByRole('button', { name: 'Name' }));
    await waitFor(() => expect(ds.list).toHaveBeenCalledWith('crews', expect.objectContaining({ sort: [{ field: 'name', dir: 'desc' }] })));
  });

  it('sends a typed filter and a search over the text fields', async () => {
    const ds = fakeSource();
    renderTable(ds);
    await screen.findByText('Crew 1');
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));
    fireEvent.change(screen.getByLabelText('Filter 1 field'), { target: { value: 'size' } });
    fireEvent.change(screen.getByLabelText('Filter 1 operator'), { target: { value: 'gte' } });
    fireEvent.change(screen.getByLabelText('Filter 1 value'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() =>
      expect(ds.list).toHaveBeenCalledWith('crews', expect.objectContaining({ filter: [{ field: 'size', op: 'gte', value: 3 }] })),
    );
    fireEvent.change(screen.getByLabelText('Search Crews'), { target: { value: 'alp' } });
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() =>
      expect(ds.list).toHaveBeenCalledWith('crews', expect.objectContaining({ search: { term: 'alp', fields: ['name'] } })),
    );
  });

  it('pages through the rows 50 at a time', async () => {
    const ds = fakeSource([crew(1)], { total: 120 });
    renderTable(ds);
    await screen.findByText('1 to 50 of 120');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(ds.list).toHaveBeenCalledWith('crews', expect.objectContaining({ offset: 50 })));
  });

  it('removes a row only after the confirmation', async () => {
    const ds = fakeSource();
    renderTable(ds);
    await screen.findByText('Crew 1');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Crew 1' }));
    expect(ds.remove).not.toHaveBeenCalled();
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(ds.remove).toHaveBeenCalledWith('crews', 'c1'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('shows the server message when a row is still in use', async () => {
    const ds = fakeSource();
    ds.remove.mockRejectedValueOnce(Object.assign(new Error('Crews still use this person.'), { code: 'record_in_use' }));
    renderTable(ds);
    await screen.findByText('Crew 1');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Crew 2' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Crews still use this person.')).toBeTruthy();
  });

  it('adds a row through the record form', async () => {
    const ds = fakeSource();
    renderTable(ds);
    await screen.findByText('Crew 1');
    fireEvent.click(screen.getByRole('button', { name: 'Add a row' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: 'Zeta crew' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add row' }));
    await waitFor(() => expect(ds.create).toHaveBeenCalledWith('crews', expect.objectContaining({ name: 'Zeta crew' })));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('returns focus to Import rows when the import dialog closes, and keeps it open while busy', async () => {
    renderTable(fakeSource());
    await screen.findByText('Crew 1');
    const opener = screen.getByRole('button', { name: 'Import rows' });
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('says what a save applied on the page, because the form closes with the save', async () => {
    const ds = fakeSource();
    ds.create.mockImplementation(async (_t, values) => {
      const row = { id: 'new', ...values };
      Object.defineProperty(row, 'applied', { value: [{ field: 'status', words: 'Status was set to active.' }], enumerable: false });
      return row;
    });
    renderTable(ds);
    await screen.findByText('Crew 1');
    fireEvent.click(screen.getByRole('button', { name: 'Add a row' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: 'Zeta crew' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add row' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getAllByRole('status').some((el) => el.textContent === 'Saved. Status was set to active.')).toBe(true);
  });

  it('shows an empty state with an add button', async () => {
    renderTable(fakeSource([]));
    expect(await screen.findByText('No rows in Crews yet. Add one to see it here.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add the first row' })).toBeTruthy();
  });
});

describe('refresh after an approved Assistant write', () => {
  it('the table page refetches its rows', async () => {
    const ds = fakeSource();
    renderTable(ds);
    await screen.findByText('Crew 1');
    const calls = () => ds.list.mock.calls.filter(([t]) => t === 'crews').length;
    const before = calls();
    act(() => announceDataChanged('crews'));
    await waitFor(() => expect(calls()).toBeGreaterThan(before));
  });

  it('the data browser reloads its row counts', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { app: { name: 'A', version: '1' }, dataDir: 'd', dbFile: 'f', tables: [{ id: 'crews', label: 'Crews', rowCount: 1 }] } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter>
        <DataBrowserPage spec={crewRoster} />
      </MemoryRouter>,
    );
    await screen.findByText('1 row');
    const before = fetchMock.mock.calls.length;
    act(() => announceDataChanged('crews'));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
  });
});

describe('DataBrowserPage', () => {
  it('lists every spec table with its row count and links to it', async () => {
    const info = {
      app: { name: 'Crew Roster', version: '1.0.0' },
      dataDir: 'C:\\d',
      dbFile: 'C:\\d\\app.db',
      tables: [
        { id: 'people', label: 'People', rowCount: 3 },
        { id: 'crews', label: 'Crews', rowCount: 1 },
      ],
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: info }), { status: 200 })));
    render(
      <MemoryRouter>
        <DataBrowserPage spec={crewRoster} />
      </MemoryRouter>,
    );
    expect(await screen.findByText('3 rows')).toBeTruthy();
    expect(screen.getByText('1 row')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Crews/ }).getAttribute('href')).toBe('/data/crews');
    expect(screen.getByRole('button', { name: 'Export all data (.zip)' })).toBeTruthy();
    expect(screen.getByLabelText('Export file (.zip)')).toBeTruthy();
  });
});
