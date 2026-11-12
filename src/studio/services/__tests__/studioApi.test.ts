import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteWaiting, errorFromResponse, importApp, saveSpec } from '../studioApi';

const reply = (body: unknown, status = 400) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('errorFromResponse', () => {
  it('ends the message with the next action, so every place that shows .message shows it', async () => {
    const err = await errorFromResponse(reply({ error: 'That name is taken.', code: 'name_taken', action: 'Pick another name.', message: 'That name is taken.' }));
    expect(err.message).toBe('That name is taken. Pick another name.');
    expect(err.action).toBe('Pick another name.');
  });

  it('does not repeat an action the sentence already ends with', async () => {
    const err = await errorFromResponse(reply({ error: 'Could not save. Try again.', code: 'server_error', action: 'try again.' }));
    expect(err.message).toBe('Could not save. Try again.');
  });

  it('keeps the sentence alone when the body has no action', async () => {
    const err = await errorFromResponse(reply({ error: 'Nope.', code: 'server_error' }, 500));
    expect(err.message).toBe('Nope.');
    expect(err.action).toBeNull();
  });
});

describe('the waiting design versions', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { id: 'a' } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };
  const sent = (fetchMock: ReturnType<typeof stub>): { url: string; init: RequestInit } => {
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    return { url, init };
  };

  it('DELETE of the waiting design carries ?at= only when a version is held', async () => {
    const withAt = stub();
    await deleteWaiting('a', 'v 1');
    expect(sent(withAt).url).toMatch(/\/apps\/a\/waiting\?at=v%201$/);
    expect(sent(withAt).init.method).toBe('DELETE');
    const plain = stub();
    await deleteWaiting('a', null);
    expect(sent(plain).url).toMatch(/\/apps\/a\/waiting$/);
  });

  it('a save with clearWaiting sends waitingAt when held, and a plain save sends neither', async () => {
    const used = stub();
    await saveSpec('a', { x: 1 }, 3, { clearWaiting: true, waitingAt: 'v9' });
    expect(JSON.parse(sent(used).init.body as string)).toEqual({ spec: { x: 1 }, baseRevision: 3, clearWaiting: true, waitingAt: 'v9' });
    const noVersion = stub();
    await saveSpec('a', { x: 1 }, 3, { clearWaiting: true, waitingAt: null });
    expect(JSON.parse(sent(noVersion).init.body as string)).toEqual({ spec: { x: 1 }, baseRevision: 3, clearWaiting: true });
    const plain = stub();
    await saveSpec('a', { x: 1 }, 3, { waitingAt: 'v9' });
    expect(JSON.parse(sent(plain).init.body as string)).toEqual({ spec: { x: 1 }, baseRevision: 3 });
  });
});

describe('importApp', () => {
  afterEach(() => vi.unstubAllGlobals());
  const sent = async (...args: Parameters<typeof importApp>): Promise<unknown> => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { id: 'a' } }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await importApp(...args);
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toContain('/apps/import');
    return JSON.parse(String(calls[0][1].body));
  };

  it('sends only the spec when there is no sample', async () => {
    expect(await sent({ app: { name: 'A' } })).toEqual({ spec: { app: { name: 'A' } } });
  });

  it('sends the sample next to the spec when given', async () => {
    const sample = { v: 1, tables: {} };
    expect(await sent({ app: { name: 'A' } }, sample)).toEqual({ spec: { app: { name: 'A' } }, sample });
  });
});
