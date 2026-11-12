import { afterEach, describe, expect, it, vi } from 'vitest';
import { backUpNow, createHttpDataSource, importRows } from '../dataClient.js';

afterEach(() => vi.unstubAllGlobals());
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });

describe('create and update keep the applied words off the row', () => {
  it('attaches applied as non-enumerable, so the row still equals what the server sent', async () => {
    const applied = [{ field: 'paid_on', label: 'Paid on', to: 'today', words: 'Paid on was set to today.' }];
    vi.stubGlobal('fetch', vi.fn(async () => reply({ data: { id: 'i1', paid: true }, applied }, 201)));
    const ds = createHttpDataSource('/api');
    for (const row of [await ds.create('invoices', {}), await ds.update('invoices', 'i1', {})]) {
      expect(row.applied).toEqual(applied);
      expect(Object.keys(row)).toEqual(['id', 'paid']);
      expect(row).toEqual({ id: 'i1', paid: true });
      expect(JSON.stringify(row)).toBe('{"id":"i1","paid":true}');
    }
  });

  it('has no applied when the server sent none', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ data: { id: 'i1' } })));
    const row = await createHttpDataSource().create('invoices', {});
    expect(row.applied).toBeUndefined();
  });
});

describe('importRows and backUpNow', () => {
  it('posts the body to the table import route under the api base', async () => {
    const fetchMock = vi.fn(async () => reply({ data: { dryRun: true, lines: [] } }));
    vi.stubGlobal('fetch', fetchMock);
    await importRows('q2_sales', { csv: 'a', dryRun: true }, '/api/preview');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/preview/data/q2_sales/import');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ csv: 'a', dryRun: true });
  });

  it('rejects with the code of a failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply({ error: 'That file could not be read as rows and columns.', code: 'import_csv_invalid', action: 'Save it as CSV.' }, 400)),
    );
    await expect(importRows('invoices', { csv: '' })).rejects.toMatchObject({ code: 'import_csv_invalid' });
  });

  it('backs up with an empty JSON body and returns the time', async () => {
    const fetchMock = vi.fn(async () => reply({ data: { backup: { createdAt: '2026-11-11T09:12:00.000Z' } } }, 201));
    vi.stubGlobal('fetch', fetchMock);
    expect(await backUpNow()).toEqual({ at: '2026-11-11T09:12:00.000Z' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/backups');
    expect(init.body).toBe('{}');
  });
});
