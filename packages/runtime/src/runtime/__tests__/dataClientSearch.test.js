// The global search call of the HTTP data source: GET {apiBase}/data/_search?q=<term>, the term encoded, the failure
// envelope read like every other data call.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpDataSource } from '../dataClient.js';

const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe('createHttpDataSource search', () => {
  it('asks /data/_search with the term encoded and returns the groups as sent', async () => {
    const groups = [{ table: 'crews', label: 'Crews', pageId: 'crew_page', total: 7, rows: [{ id: 'c1', title: 'Alpha' }] }];
    const fetchMock = vi.fn(async () => reply({ data: { groups } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await createHttpDataSource('/api').search('a "b" & c/d?é');
    expect(result).toEqual({ groups });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/data/_search?q=a%20%22b%22%20%26%20c%2Fd%3F%C3%A9');
    expect(new URL(url, 'http://x').searchParams.get('q')).toBe('a "b" & c/d?é');
    expect(init).toMatchObject({ credentials: 'same-origin' });
    expect(init.method).toBeUndefined();
  });

  it('uses the api base of Studio Preview', async () => {
    const fetchMock = vi.fn(async () => reply({ data: { groups: [] } }));
    vi.stubGlobal('fetch', fetchMock);
    await createHttpDataSource('/api/preview').search('x');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/preview/data/_search?q=x');
  });

  it('sends an empty term as an empty q', async () => {
    const fetchMock = vi.fn(async () => reply({ data: { groups: [] } }));
    vi.stubGlobal('fetch', fetchMock);
    await createHttpDataSource().search('');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/data/_search?q=');
  });

  it('rejects with the code, the field and the next action of the error envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply({ error: 'That request could not be understood.', code: 'invalid_query', action: 'Shorten the search.', field: 'q', requestId: 'r1' }, 400)),
    );
    await expect(createHttpDataSource('/api').search('x')).rejects.toMatchObject({ code: 'invalid_query', field: 'q', action: 'Shorten the search.', requestId: 'r1' });
  });

  it('rejects with network_unreachable when the request cannot be made', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('failed'))));
    await expect(createHttpDataSource('/api').search('x')).rejects.toMatchObject({ code: 'network_unreachable' });
  });
});
