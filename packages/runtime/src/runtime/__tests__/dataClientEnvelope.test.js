import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpDataSource, exportTables } from '../dataClient.js';

const reply = (body, status = 400, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

afterEach(() => vi.unstubAllGlobals());

describe('dataClient reads the error envelope', () => {
  it('keeps code, action and requestId, and the message is the sentence then the action', async () => {
    const body = {
      error: 'That name is already used.',
      message: 'That name is already used.',
      code: 'duplicate_value',
      action: 'Pick a different name.',
      requestId: 'abcdef0123456789',
      field: 'name',
    };
    vi.stubGlobal('fetch', vi.fn(async () => reply(body, 409)));
    await expect(createHttpDataSource().create('crews', {})).rejects.toMatchObject({
      message: 'That name is already used. Pick a different name.',
      code: 'duplicate_value',
      action: 'Pick a different name.',
      requestId: 'abcdef0123456789',
      field: 'name',
    });
  });

  it('leaves the action out when the sentence already ends with it', async () => {
    const body = { error: 'Could not save. Try again.', code: 'server_error', action: 'Try again.', requestId: 'r1' };
    vi.stubGlobal('fetch', vi.fn(async () => reply(body, 500)));
    await expect(createHttpDataSource().list('crews', {})).rejects.toMatchObject({ message: 'Could not save. Try again.' });
  });

  it('falls back to the X-Request-Id header', async () => {
    const body = { error: 'Nope.', code: 'server_error', action: 'Try again.' };
    vi.stubGlobal('fetch', vi.fn(async () => reply(body, 500, { 'X-Request-Id': 'h1' })));
    await expect(createHttpDataSource().list('crews', {})).rejects.toMatchObject({ requestId: 'h1' });
  });

  it('still reads the older body { error: code, message }', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ error: 'invalid_record', message: 'Name is required.' })));
    await expect(createHttpDataSource().create('crews', {})).rejects.toMatchObject({
      message: 'Name is required.',
      code: 'invalid_record',
    });
  });

  it('turns an unreachable app into network_unreachable with a next step', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(createHttpDataSource().list('crews', {})).rejects.toMatchObject({
      code: 'network_unreachable',
      message: 'The app did not answer. Check that it is still running, then try again.',
    });
  });

  it('uses a generic sentence with its action when the body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 502 })));
    await expect(createHttpDataSource().list('crews', {})).rejects.toMatchObject({
      code: 'server_error',
      message: 'Something went wrong. Try again.',
    });
  });

  it('exports keep the envelope pieces for a code with no fixed message', async () => {
    const body = { error: 'The export stopped.', code: 'export_failed', action: 'Try again later.', requestId: 'e1' };
    vi.stubGlobal('fetch', vi.fn(async () => reply(body, 500)));
    await expect(exportTables(['crews'])).rejects.toMatchObject({
      code: 'export_failed',
      message: 'The export stopped. Try again later.',
      requestId: 'e1',
    });
  });

  it('shows one next step when the body has no sentence', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ code: 'server_error', action: 'Restart the app.' }, 500)));
    await expect(createHttpDataSource().list('crews')).rejects.toMatchObject({ message: 'Something went wrong. Restart the app.', action: 'Restart the app.' });
    vi.stubGlobal('fetch', vi.fn(async () => reply({}, 500)));
    await expect(createHttpDataSource().list('crews')).rejects.toMatchObject({ message: 'Something went wrong. Try again.' });
  });

  it('exports through the given apiBase and says the app did not answer when the file drops', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, headers: new Headers(), blob: () => Promise.reject(new TypeError('terminated')) }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(exportTables(['crews'], '/other')).rejects.toMatchObject({ code: 'network_unreachable' });
    expect(fetchMock.mock.calls[0][0]).toBe('/other/export');
  });
});
