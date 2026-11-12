import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { baseSpec, json, recordOf } from '../../__tests__/fixtures';
import { useWorkspaceLoader } from '../useWorkspace';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

interface Put {
  id: string;
  baseRevision: number;
  spec: AppSpec;
  answer(response: Response): void;
}

/** GET answers at once with the app's record; every PUT waits until the test answers it. */
function mockServer(): { puts: Put[]; gets: string[] } {
  const puts: Put[] = [];
  const gets: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const id = /\/apps\/([^/?]+)/.exec(url)?.[1] ?? '';
      if ((init?.method ?? 'GET') === 'GET') {
        gets.push(id);
        return json(200, { data: { ...recordOf(baseSpec(), { revision: 3 }), id, name: id === A ? 'Crew Roster' : 'Other app' } });
      }
      const body = JSON.parse(init?.body as string) as { spec: AppSpec; baseRevision: number };
      return new Promise<Response>((resolve) => puts.push({ id, baseRevision: body.baseRevision, spec: body.spec, answer: resolve }));
    }),
  );
  return { puts, gets };
}

const changed = (label: string): AppSpec => ({ ...baseSpec(), app: { ...baseSpec().app, description: label } });
const saved = (id: string, spec: AppSpec, revision: number): Response => json(200, { data: { ...recordOf(spec, { revision }), id } });

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('useWorkspaceLoader saves', () => {
  it('runs saves one at a time, each with the revision its caller built it from (V-1, V3-5)', async () => {
    const server = mockServer();
    const { result } = renderHook(() => useWorkspaceLoader(A));
    await waitFor(() => expect(result.current.state.kind).toBe('ready'));
    if (result.current.state.kind !== 'ready') return;
    const { save } = result.current.state.value;

    let first: ReturnType<typeof save> | undefined;
    let second: ReturnType<typeof save> | undefined;
    act(() => {
      first = save(changed('one'), { baseRevision: 3 });
      // A draft that saves again builds its second save from the revision its first one returned.
      second = save(changed('two'), { baseRevision: 4 });
    });
    expect(result.current.saving).toBe(true);
    // Only the first request is out; the second waits for it.
    await waitFor(() => expect(server.puts).toHaveLength(1));
    expect(server.puts[0].baseRevision).toBe(3);
    await act(async () => {
      server.puts[0].answer(saved(A, server.puts[0].spec, 4));
      await first;
    });
    await waitFor(() => expect(server.puts).toHaveLength(2));
    expect(server.puts[1].baseRevision).toBe(4);
    expect(server.puts[1].spec.app.description).toBe('two');
    await act(async () => {
      server.puts[1].answer(saved(A, server.puts[1].spec, 5));
      await second;
    });
    expect(await first).toMatchObject({ ok: true });
    expect(await second).toMatchObject({ ok: true });
    expect(server.gets).toEqual([A]);
    await waitFor(() => expect(result.current.saving).toBe(false));
    expect(result.current.state.kind === 'ready' && result.current.state.value.revision).toBe(5);
  });

  it('idle resolves when every save has finished', async () => {
    const server = mockServer();
    const { result } = renderHook(() => useWorkspaceLoader(A));
    await waitFor(() => expect(result.current.state.kind).toBe('ready'));
    if (result.current.state.kind !== 'ready') return;
    const { save } = result.current.state.value;
    let done = false;
    act(() => {
      void save(changed('one'), { baseRevision: 3 });
      void result.current.idle().then(() => (done = true));
    });
    await waitFor(() => expect(server.puts).toHaveLength(1));
    expect(done).toBe(false);
    await act(async () => {
      server.puts[0].answer(saved(A, server.puts[0].spec, 4));
      await result.current.idle();
    });
    expect(done).toBe(true);
  });

  it('ignores the answer of a save for an app that is no longer open, and does not reload it (V-4)', async () => {
    const server = mockServer();
    const { result, rerender } = renderHook(({ id }) => useWorkspaceLoader(id), { initialProps: { id: A } });
    await waitFor(() => expect(result.current.state.kind).toBe('ready'));
    if (result.current.state.kind !== 'ready') return;
    const { save } = result.current.state.value;

    let first: ReturnType<typeof save> | undefined;
    act(() => {
      first = save(changed('one'), { baseRevision: 3 });
    });
    await waitFor(() => expect(server.puts).toHaveLength(1));
    rerender({ id: B });
    await waitFor(() => expect(result.current.state.kind === 'ready' && result.current.state.value.record.id).toBe(B));

    // A save that finishes now must not put the old app into the new workspace.
    await act(async () => {
      server.puts[0].answer(saved(A, server.puts[0].spec, 4));
      await first;
    });
    const state = result.current.state;
    expect(state.kind === 'ready' && state.value.record.id).toBe(B);
    expect(state.kind === 'ready' && state.value.record.name).toBe('Other app');
    expect(state.kind === 'ready' && state.value.revision).toBe(3);

    // A conflict for the old app loads nothing for it.
    let second: ReturnType<typeof save> | undefined;
    const { result: again, rerender: rerenderAgain } = renderHook(({ id }) => useWorkspaceLoader(id), { initialProps: { id: A } });
    await waitFor(() => expect(again.current.state.kind).toBe('ready'));
    if (again.current.state.kind !== 'ready') return;
    const saveA = again.current.state.value.save;
    act(() => {
      second = saveA(changed('two'), { baseRevision: 3 });
    });
    await waitFor(() => expect(server.puts).toHaveLength(2));
    rerenderAgain({ id: B });
    await waitFor(() => expect(again.current.state.kind === 'ready' && again.current.state.value.record.id).toBe(B));
    const getsBefore = server.gets.length;
    await act(async () => {
      server.puts[1].answer(json(409, { error: 'revision_conflict', message: 'changed', revision: 9 }));
      await second;
    });
    expect(await second).toMatchObject({ ok: false, code: 'revision_conflict' });
    expect(server.gets.length).toBe(getsBefore);
    expect(server.gets.filter((id) => id === A)).toHaveLength(2);
  });

  it('sends a save for an app that is no longer open to its own app, from the revision the caller gives (V2-1)', async () => {
    const server = mockServer();
    const { result, rerender } = renderHook(({ id }) => useWorkspaceLoader(id), { initialProps: { id: A } });
    await waitFor(() => expect(result.current.state.kind).toBe('ready'));
    if (result.current.state.kind !== 'ready') return;
    const saveA = result.current.state.value.save;
    rerender({ id: B });
    await waitFor(() => expect(result.current.state.kind === 'ready' && result.current.state.value.record.id).toBe(B));
    let late: ReturnType<typeof saveA> | undefined;
    act(() => {
      late = saveA(changed('late'), { baseRevision: 3 });
    });
    await waitFor(() => expect(server.puts).toHaveLength(1));
    expect(server.puts[0].id).toBe(A);
    expect(server.puts[0].baseRevision).toBe(3);
    await act(async () => {
      server.puts[0].answer(saved(A, server.puts[0].spec, 4));
      await late;
    });
    expect(await late).toMatchObject({ ok: true });
    // The answer is for the old app: the one on screen and its save flags stay as they were.
    const state = result.current.state;
    expect(state.kind === 'ready' && state.value.record.id).toBe(B);
    expect(result.current.lastSaveOk).toBeNull();
    expect(result.current.savedCount()).toBe(0);
    await waitFor(() => expect(result.current.saving).toBe(false));
  });
});

describe('useWorkspaceLoader clearWaiting (P17-01)', () => {
  it('sends clearWaiting only when asked, so Use this drops the server copy in the same save', async () => {
    const server = mockServer();
    const bodies: Record<string, unknown>[] = [];
    const base = globalThis.fetch;
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') bodies.push(JSON.parse(init.body as string) as Record<string, unknown>);
      return base(url, init);
    });
    const { result } = renderHook(() => useWorkspaceLoader(A));
    await waitFor(() => expect(result.current.state.kind).toBe('ready'));
    if (result.current.state.kind !== 'ready') return;
    const { save } = result.current.state.value;
    act(() => void save(changed('one'), { baseRevision: 3 }));
    await waitFor(() => expect(server.puts).toHaveLength(1));
    server.puts[0].answer(saved(A, changed('one'), 4));
    act(() => void save(changed('two'), { baseRevision: 4, clearWaiting: true }));
    await waitFor(() => expect(server.puts).toHaveLength(2));
    server.puts[1].answer(saved(A, changed('two'), 5));
    expect(bodies[0]).not.toHaveProperty('clearWaiting');
    expect(bodies[1]).toMatchObject({ baseRevision: 4, clearWaiting: true });
  });
});

describe('useWorkspaceLoader errors', () => {
  it('never shows the not-found error of the previous app for the next one while it loads (QA tracked 11)', async () => {
    let releaseA: (r: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const id = /\/apps\/([^/?]+)/.exec(url)?.[1] ?? '';
        if (id === B) return json(404, { error: 'That app does not exist. It may have been deleted.', code: 'app_not_found' });
        return new Promise<Response>((resolve) => {
          releaseA = resolve;
        });
      }),
    );
    const { result, rerender } = renderHook(({ id }: { id: string }) => useWorkspaceLoader(id), { initialProps: { id: B } });
    await waitFor(() => expect(result.current.state).toMatchObject({ kind: 'error', notFound: true }));
    rerender({ id: A });
    // A is still loading: the error of B must not show (or redirect) for it.
    expect(result.current.state.kind).toBe('loading');
    await act(async () => {
      releaseA(json(200, { data: { ...recordOf(baseSpec(), { revision: 3 }), id: A } }));
    });
    await waitFor(() => expect(result.current.state.kind).toBe('ready'));
  });
});
