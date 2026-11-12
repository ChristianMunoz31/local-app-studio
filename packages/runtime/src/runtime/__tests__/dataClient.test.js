import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildQuery, createHttpDataSource, exportTables, fetchDataInfo } from '../dataClient.js';

const reply = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });

afterEach(() => vi.unstubAllGlobals());

describe('buildQuery', () => {
  it('encodes every parameter of the data API', () => {
    const text = buildQuery({
      page: 'home',
      source: 'open',
      filter: [{ field: 'status', op: 'eq', value: 'active' }],
      search: { term: 'ann', fields: ['name', 'notes'] },
      sort: [
        { field: 'name', dir: 'asc' },
        { field: 'size', dir: 'desc' },
      ],
      limit: 10,
      offset: 20,
    });
    const params = new URLSearchParams(text);
    expect(params.get('page')).toBe('home');
    expect(params.get('source')).toBe('open');
    expect(JSON.parse(params.get('filter'))).toEqual([{ field: 'status', op: 'eq', value: 'active' }]);
    expect(params.get('search')).toBe('ann');
    expect(params.get('searchFields')).toBe('name,notes');
    expect(params.get('sort')).toBe('name:asc,size:desc');
    expect(params.get('limit')).toBe('10');
    expect(params.get('offset')).toBe('20');
  });

  it('sends nothing for an empty query and never page without source', () => {
    expect(buildQuery({})).toBe('');
    expect(buildQuery({ filter: [], page: 'home' })).toBe('');
  });
});

describe('createHttpDataSource', () => {
  it('lists, gets, creates, updates and removes through /data', async () => {
    const calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init) => {
        calls.push([url, init?.method ?? 'GET', init?.body, init?.credentials]);
        return reply({ data: { rows: [], total: 0, id: 'x' } });
      }),
    );
    const ds = createHttpDataSource('/api');
    await ds.list('crews', { limit: 5 });
    await ds.stats('crews', { filter: [] });
    await ds.get('crews', 'a b');
    await ds.create('crews', { name: 'A' });
    await ds.update('crews', 'a', { name: 'B' });
    await expect(ds.remove('crews', 'a')).resolves.toBeUndefined();
    expect(calls.map((c) => [c[0], c[1]])).toEqual([
      ['/api/data/crews?limit=5', 'GET'],
      ['/api/data/crews/stats', 'GET'],
      ['/api/data/crews/a%20b', 'GET'],
      ['/api/data/crews', 'POST'],
      ['/api/data/crews/a', 'PATCH'],
      ['/api/data/crews/a', 'DELETE'],
    ]);
    expect(calls[3][2]).toBe('{"name":"A"}');
    expect(calls.every((c) => c[3] === 'same-origin')).toBe(true);
  });

  it('returns null for a row that is not found', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ error: 'No such record.', message: 'No such record.', code: 'not_found', action: 'Go back.' }, 404)));
    await expect(createHttpDataSource().get('crews', 'z')).resolves.toBeNull();
  });

  it('rejects with the server message, code and field', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ error: 'Name is required.', message: 'Name is required.', code: 'invalid_record', action: 'Fill it in.', field: 'name' }, 400)));
    await expect(createHttpDataSource().create('crews', {})).rejects.toMatchObject({
      message: 'Name is required. Fill it in.',
      code: 'invalid_record',
      action: 'Fill it in.',
      field: 'name',
    });
  });

  it('rejects with a network code when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('failed'))));
    await expect(createHttpDataSource().list('crews', {})).rejects.toMatchObject({ code: 'network_unreachable' });
  });
});

describe('fetchDataInfo and exportTables', () => {
  it('reads GET /data', async () => {
    const info = { app: null, dataDir: 'C:\\d', dbFile: 'C:\\d\\app.db', tables: [] };
    const fetchMock = vi.fn(async () => reply({ data: info }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchDataInfo('/api')).resolves.toEqual(info);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/data');
  });

  it('posts the table ids to /api/export and saves the file', async () => {
    const headers = { 'Content-Disposition': 'attachment; filename="crews.zip"', 'X-Export-Complete': '1' };
    const fetchMock = vi.fn(async () => new Response('zip', { status: 200, headers }));
    vi.stubGlobal('fetch', fetchMock);
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await expect(exportTables(['crews'])).resolves.toEqual({ filename: 'crews.zip', complete: true });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/export');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ tables: ['crews'] });
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  it('turns an export failure into a plain message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ error: 'x', code: 'export_too_large' }, 413)));
    await expect(exportTables(['crews'])).rejects.toMatchObject({
      code: 'export_too_large',
      message: 'This table is too large to export in one file. Remove rows you no longer need, then try again.',
    });
  });
});
