import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { baseSpec, recordOf } from '../../__tests__/fixtures';
import type { DescribeEvent, WaitingEntry } from '../../types';
import type { WorkspaceValue } from '../../types';
import { WorkspaceContext } from '../useWorkspace';
import { StudioApiError } from '../../services/studioApi';
import { REFINE_CONFLICT, useDescribe } from '../useDescribe';

const stream = vi.hoisted(() => ({
  events: [] as DescribeEvent[],
  calls: [] as Record<string, unknown>[],
  /** Set to make the stream request fail (a 400 or 409 before any event) or to hold it open. */
  reject: null as Error | null,
  hold: null as Promise<void> | null,
}));
vi.mock('../../services/describeStream', () => ({
  runDescribeStream: async (args: { onEvent(e: DescribeEvent): void }) => {
    stream.calls.push(args as unknown as Record<string, unknown>);
    if (stream.hold) await stream.hold;
    if (stream.reject) throw stream.reject;
    for (const e of stream.events) args.onEvent(e);
  },
}));
// These tests are about the helper's screens, so the helper is in the build they run in (a public run: helperNotInBuild.test.tsx, installerNotInBuild.test.tsx).
const parts = vi.hoisted(() => ({ PRO_PARTS: { helper: true, installer: true, licensing: true, cloud: true } }));
vi.mock('@/proParts.js', () => parts);
const api = vi.hoisted(() => ({ getWaiting: vi.fn(), deleteWaiting: vi.fn() }));
vi.mock('../../services/studioApi', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../services/studioApi')>()), ...api }));

const reloadMock = vi.fn();

beforeEach(() => {
  reloadMock.mockReset();
  reloadMock.mockResolvedValue(undefined);
  stream.calls = [];
  stream.reject = null;
  stream.hold = null;
  api.getWaiting.mockReset();
  api.getWaiting.mockResolvedValue(null);
  api.deleteWaiting.mockReset();
  api.deleteWaiting.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  parts.PRO_PARTS.helper = true;
});

function wrapperFor(spec: AppSpec) {
  const value = { record: recordOf(spec), spec, revision: 3, save: vi.fn(), reload: reloadMock, setDirty: vi.fn() } as unknown as WorkspaceValue;
  return ({ children }: { children: ReactNode }) => <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

type ProposalEvent = Extract<DescribeEvent, { type: 'proposal' }>;
const proposal = (spec: AppSpec, extra: Partial<ProposalEvent> = {}): ProposalEvent => ({ type: 'proposal', proposal: spec, fallbacks: [], baseRevision: 3, steps: 1, ...extra });

describe('useDescribe without the helper in the build', () => {
  it('is hydrated at once and never asks the server for a waiting design', async () => {
    parts.PRO_PARTS.helper = false;
    const { result } = renderHook(() => useDescribe('app-1'), { wrapper: wrapperFor(baseSpec()) });
    expect(result.current.hydrated).toBe(true);
    expect(result.current.phase).toBe('idle');
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.getWaiting).not.toHaveBeenCalled();
  });

  it('with the helper asks for the waiting design and is hydrated once it answers', async () => {
    const { result } = renderHook(() => useDescribe('app-1'), { wrapper: wrapperFor(baseSpec()) });
    expect(result.current.hydrated).toBe(false);
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(api.getWaiting).toHaveBeenCalledTimes(1);
  });
});

describe('useDescribe phase of an answer', () => {
  it('P-15: a design that equals the current app is unchanged, not a waiting proposal', async () => {
    stream.events = [proposal(baseSpec())];
    const { result } = renderHook(() => useDescribe('app-1'), { wrapper: wrapperFor(baseSpec()) });
    act(() => result.current.run('edit', 'Keep it'));
    await waitFor(() => expect(result.current.phase).toBe('unchanged'));
  });

  it('a design with changes is a waiting proposal', async () => {
    const next = baseSpec();
    next.pages.push({ id: 'extra', title: 'Extra', route: '/extra', sources: [], layout: { id: 'root_extra', type: 'Page', props: {}, children: [] } });
    stream.events = [proposal(next)];
    const { result } = renderHook(() => useDescribe('app-1'), { wrapper: wrapperFor(baseSpec()) });
    act(() => result.current.run('edit', 'Add a page'));
    await waitFor(() => expect(result.current.phase).toBe('proposal'));
  });
});

const withPage = (id: string): AppSpec => {
  const next = baseSpec();
  next.pages.push({ id, title: id, route: `/${id}`, sources: [], layout: { id: `root_${id}`, type: 'Page', props: {}, children: [] } });
  return next;
};
const entry = (over: Partial<WaitingEntry> = {}): WaitingEntry => ({
  mode: 'create',
  instruction: 'A roster',
  asks: [],
  proposal: withPage('extra'),
  replaced: null,
  fallbacks: [],
  baseRevision: 3,
  at: '2026-11-05T00:00:00.000Z',
  ...over,
});

describe('useDescribe waiting design kept on the server (P17-01, P17-04)', () => {
  it('hydrates the review from the server copy on mount', async () => {
    api.getWaiting.mockResolvedValue(entry({ asks: ['Add jobs'], replaced: withPage('old') }));
    const { result } = renderHook(() => useDescribe('app-1'), { wrapper: wrapperFor(baseSpec()) });
    expect(result.current.hydrated).toBe(false);
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(api.getWaiting).toHaveBeenCalledWith('app-1', expect.anything());
    expect(result.current).toMatchObject({ phase: 'proposal', instruction: 'A roster', mode: 'create', asks: ['Add jobs'], baseRevision: 3 });
    expect(result.current.proposal?.pages.map((p) => p.id)).toContain('extra');
    expect(result.current.replaced?.pages.map((p) => p.id)).toContain('old');
  });

  it('a kept design equal to the saved app is unchanged', async () => {
    api.getWaiting.mockResolvedValue(entry({ proposal: baseSpec() }));
    const { result } = renderHook(() => useDescribe('app-1'), { wrapper: wrapperFor(baseSpec()) });
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.phase).toBe('unchanged');
  });

  it('only words kept: idle with the words', async () => {
    api.getWaiting.mockResolvedValue(entry({ proposal: null }));
    const { result } = renderHook(() => useDescribe('app-1'), { wrapper: wrapperFor(baseSpec()) });
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current).toMatchObject({ phase: 'idle', proposal: null, instruction: 'A roster' });
  });

  it('a failing request means no waiting design and the hook is still hydrated', async () => {
    api.getWaiting.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useDescribe('app-1'), { wrapper: wrapperFor(baseSpec()) });
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current).toMatchObject({ phase: 'idle', proposal: null, asks: [], replaced: null });
  });

  it('refine runs an edit onto the waiting design, keeps the first words and adds the ask and the replaced design', async () => {
    const first = withPage('extra');
    api.getWaiting.mockResolvedValue(entry({ proposal: first }));
    const { result } = renderHook(() => useDescribe('app-1'), { wrapper: wrapperFor(baseSpec()) });
    await waitFor(() => expect(result.current.phase).toBe('proposal'));
    const second = withPage('extra2');
    stream.events = [{ type: 'proposal', proposal: second, fallbacks: [], baseRevision: 3, steps: 1, onto: 'waiting', replaced: first }];
    act(() => result.current.refine('Add jobs'));
    await waitFor(() => expect(result.current.asks).toEqual(['Add jobs']));
    expect(stream.calls[0]).toMatchObject({ mode: 'edit', instruction: 'Add jobs', onto: 'waiting' });
    expect(result.current).toMatchObject({ phase: 'proposal', instruction: 'A roster' });
    expect(result.current.proposal).toEqual(second);
    expect(result.current.replaced).toEqual(first);
  });

  it('refine with no waiting design sends nothing', async () => {
    const { result } = renderHook(() => useDescribe('app-1'), { wrapper: wrapperFor(baseSpec()) });
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    act(() => result.current.refine('Add jobs'));
    expect(stream.calls).toHaveLength(0);
  });

  it('a late answer from the server does not replace a run the person already started', async () => {
    let release: (e: WaitingEntry | null) => void = () => undefined;
    api.getWaiting.mockReturnValue(new Promise<WaitingEntry | null>((resolve) => (release = resolve)));
    stream.events = [proposal(withPage('mine'))];
    const { result } = renderHook(() => useDescribe('app-1'), { wrapper: wrapperFor(baseSpec()) });
    act(() => result.current.run('edit', 'Mine'));
    await waitFor(() => expect(result.current.phase).toBe('proposal'));
    await act(async () => release(entry()));
    expect(result.current.instruction).toBe('Mine');
    expect(result.current.hydrated).toBe(true);
  });

  it('discard also deletes the server copy, and a failing delete is ignored', async () => {
    api.getWaiting.mockResolvedValue(entry());
    api.deleteWaiting.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useDescribe('app-1'), { wrapper: wrapperFor(baseSpec()) });
    await waitFor(() => expect(result.current.phase).toBe('proposal'));
    act(() => result.current.discard());
    expect(api.deleteWaiting).toHaveBeenCalledWith('app-1', '2026-11-05T00:00:00.000Z');
    expect(result.current).toMatchObject({ phase: 'idle', proposal: null, asks: [] });
  });
});

describe('useDescribe a refine that does not finish (fix round 1)', () => {
  const hydratedWithAsk = async () => {
    const first = withPage('extra');
    api.getWaiting.mockResolvedValue(entry({ proposal: first, asks: ['Add jobs'], replaced: withPage('old') }));
    const hook = renderHook(() => useDescribe('app-1'), { wrapper: wrapperFor(baseSpec()) });
    await waitFor(() => expect(hook.result.current.phase).toBe('proposal'));
    return { ...hook, first };
  };

  it('a stream error on a refine returns to the waiting design with the reason as a note, and Try again asks the same words again', async () => {
    const { result, first } = await hydratedWithAsk();
    stream.events = [{ type: 'error', code: 'could_not_generate', message: 'The helper could not do that.' }];
    act(() => result.current.refine('Add notes'));
    await waitFor(() => expect(result.current.error?.message).toBe('The helper could not do that.'));
    expect(result.current).toMatchObject({ phase: 'proposal', baseRevision: 3, asks: ['Add jobs'], instruction: 'A roster', lastAsk: 'Add notes', stopped: false });
    expect(result.current.proposal).toEqual(first);
    expect(result.current.replaced).toEqual(withPage('old'));
    // Try again is a refine of the same ask, never a plain run of the first words.
    stream.events = [{ type: 'proposal', proposal: withPage('next'), fallbacks: [], baseRevision: 3, steps: 1, onto: 'waiting', replaced: first, at: 'v2' }];
    const failedLast = result.current.lastAsk ?? '';
    act(() => result.current.refine(failedLast));
    await waitFor(() => expect(result.current.asks).toEqual(['Add jobs', 'Add notes']));
    expect(stream.calls).toHaveLength(2);
    expect(stream.calls[1]).toMatchObject({ mode: 'edit', instruction: 'Add notes', onto: 'waiting' });
    expect(result.current).toMatchObject({ phase: 'proposal', error: null, lastAsk: null, landed: 'refined', waitingAt: 'v2' });
  });

  it('a refused ask (409 waiting_stale or 400) returns to the design too', async () => {
    const { result, first } = await hydratedWithAsk();
    stream.reject = new StudioApiError('This app was saved after the waiting design was made, so it cannot be changed. Make a new design or start over.', 409, 'waiting_stale');
    act(() => result.current.refine('Add notes'));
    await waitFor(() => expect(result.current.error?.code).toBe('waiting_stale'));
    expect(result.current).toMatchObject({ phase: 'proposal', lastAsk: 'Add notes' });
    expect(result.current.proposal).toEqual(first);
    expect(result.current.asks).toEqual(['Add jobs']);
  });

  it('a refine that ends with no answer returns to the design', async () => {
    const { result } = await hydratedWithAsk();
    stream.events = [];
    act(() => result.current.refine('Add notes'));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.phase).toBe('proposal');
  });

  it('cancelling a refine leaves the waiting design as it was, with no note and no stop', async () => {
    const { result, first } = await hydratedWithAsk();
    stream.hold = new Promise<void>(() => undefined);
    act(() => result.current.refine('Add notes'));
    await waitFor(() => expect(result.current.phase).toBe('running'));
    act(() => result.current.cancel());
    expect(result.current).toMatchObject({ phase: 'proposal', error: null, lastAsk: null, stopped: false, baseRevision: 3, asks: ['Add jobs'], instruction: 'A roster' });
    expect(result.current.proposal).toEqual(first);
    expect(result.current.replaced).toEqual(withPage('old'));
  });

  it('a failed plain run keeps today\'s behaviour: the error phase, a stop and no design', async () => {
    api.getWaiting.mockResolvedValue(entry());
    const { result } = renderHook(() => useDescribe('app-1'), { wrapper: wrapperFor(baseSpec()) });
    await waitFor(() => expect(result.current.phase).toBe('proposal'));
    stream.events = [{ type: 'error', code: 'could_not_generate', message: 'Nope.' }];
    act(() => result.current.run('create', 'A roster'));
    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current).toMatchObject({ proposal: null, stopped: true, lastAsk: null });
  });
});

describe('useDescribe versions, landing and stopping (fix round 1)', () => {
  it('says how the newest design landed: new, in place of a waiting one, or a change to it', async () => {
    const { result } = renderHook(() => useDescribe('app-1'), { wrapper: wrapperFor(baseSpec()) });
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    stream.events = [proposal(withPage('a'), { at: 'v1' })];
    act(() => result.current.run('create', 'First'));
    await waitFor(() => expect(result.current.landed).toBe('new'));
    expect(result.current.waitingAt).toBe('v1');
    stream.events = [proposal(withPage('b'), { at: 'v2' })];
    act(() => result.current.run('create', 'Second'));
    await waitFor(() => expect(result.current.waitingAt).toBe('v2'));
    expect(result.current.landed).toBe('replaced');
    stream.events = [proposal(withPage('c'), { onto: 'waiting', replaced: withPage('b'), at: 'v3' })];
    act(() => result.current.refine('More'));
    await waitFor(() => expect(result.current.waitingAt).toBe('v3'));
    expect(result.current.landed).toBe('refined');
  });

  it('Use this discards without a second server delete, and a plain discard sends the version it holds', async () => {
    api.getWaiting.mockResolvedValue(entry({ at: 'v7' }));
    const { result } = renderHook(() => useDescribe('app-1'), { wrapper: wrapperFor(baseSpec()) });
    await waitFor(() => expect(result.current.phase).toBe('proposal'));
    expect(result.current.waitingAt).toBe('v7');
    act(() => result.current.discard({ keepServerCopy: true }));
    expect(api.deleteWaiting).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('idle');
    api.getWaiting.mockResolvedValue(entry({ at: 'v8' }));
    const second = renderHook(() => useDescribe('app-2'), { wrapper: wrapperFor(baseSpec()) });
    await waitFor(() => expect(second.result.current.waitingAt).toBe('v8'));
    act(() => second.result.current.discard());
    expect(api.deleteWaiting).toHaveBeenCalledWith('app-2', 'v8');
  });

  it('a design made on an older revision than the app has is stale and cannot be used', async () => {
    api.getWaiting.mockResolvedValue(entry({ baseRevision: 2 }));
    const old = renderHook(() => useDescribe('app-1'), { wrapper: wrapperFor(baseSpec()) });
    await waitFor(() => expect(old.result.current.phase).toBe('proposal'));
    expect(old.result.current.stale).toBe(true);
    api.getWaiting.mockResolvedValue(entry({ baseRevision: 3 }));
    const current = renderHook(() => useDescribe('app-1'), { wrapper: wrapperFor(baseSpec()) });
    await waitFor(() => expect(current.result.current.phase).toBe('proposal'));
    expect(current.result.current.stale).toBe(false);
  });

  it('words found on the server are not a stop; a cancel and an error are', async () => {
    api.getWaiting.mockResolvedValue(entry({ proposal: null, baseRevision: null }));
    const found = renderHook(() => useDescribe('app-1'), { wrapper: wrapperFor(baseSpec()) });
    await waitFor(() => expect(found.result.current.hydrated).toBe(true));
    expect(found.result.current).toMatchObject({ phase: 'idle', instruction: 'A roster', stopped: false });
    stream.hold = new Promise<void>(() => undefined);
    act(() => found.result.current.run('create', 'A roster'));
    await waitFor(() => expect(found.result.current.phase).toBe('running'));
    act(() => found.result.current.cancel());
    expect(found.result.current).toMatchObject({ phase: 'idle', instruction: 'A roster', stopped: true });
  });
});

describe('useDescribe fix round 2 (G1)', () => {
  const hydrated = async () => {
    api.getWaiting.mockResolvedValue(entry({ at: 'v7' }));
    const hook = renderHook(() => useDescribe('app-1'), { wrapper: wrapperFor(baseSpec()) });
    await waitFor(() => expect(hook.result.current.phase).toBe('proposal'));
    return hook;
  };

  it('N1: cancelling a refine restores the design with landed null, so nothing is announced and no focus moves', async () => {
    const { result } = await hydrated();
    stream.events = [proposal(withPage('b'), { onto: 'waiting', replaced: withPage('extra'), at: 'v8' })];
    act(() => result.current.refine('More'));
    await waitFor(() => expect(result.current.landed).toBe('refined'));
    stream.events = [];
    stream.hold = new Promise<void>(() => undefined);
    act(() => result.current.refine('Again'));
    await waitFor(() => expect(result.current.phase).toBe('running'));
    act(() => result.current.cancel());
    expect(result.current).toMatchObject({ phase: 'proposal', landed: null, error: null });
  });

  it('N2: a refine refused with 409 revision_conflict reloads the app and shows the stale design', async () => {
    const { result } = await hydrated();
    expect(result.current.stale).toBe(false);
    stream.reject = new StudioApiError('This app changed in another window. Reload it and try again.', 409, 'revision_conflict');
    act(() => result.current.refine('Add notes'));
    await waitFor(() => expect(result.current.error?.message).toBe(REFINE_CONFLICT));
    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(result.current.stale).toBe(true);
    expect(result.current.phase).toBe('proposal');
  });

  it('N2: a refine refused with waiting_stale switches to the stale design even when the revisions agree here', async () => {
    const { result } = await hydrated();
    expect(result.current.baseRevision).toBe(3);
    stream.reject = new StudioApiError('This app was saved after the waiting design was made.', 409, 'waiting_stale');
    act(() => result.current.refine('Add notes'));
    await waitFor(() => expect(result.current.stale).toBe(true));
    expect(reloadMock).not.toHaveBeenCalled();
    // A new plain run clears it.
    stream.reject = null;
    stream.events = [proposal(withPage('n'), { at: 'v9' })];
    act(() => result.current.run('edit', 'Fresh'));
    await waitFor(() => expect(result.current.landed).toBe('replaced'));
    expect(result.current.stale).toBe(false);
  });

  it('N2: a conflict on a plain run does not reload or mark the design stale', async () => {
    const { result } = await hydrated();
    stream.reject = new StudioApiError('This app changed in another window. Reload it and try again.', 409, 'revision_conflict');
    act(() => result.current.run('edit', 'Words'));
    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('L1: discarding during a plain run sends no server delete; during a refine it still sends the held version', async () => {
    const { result } = await hydrated();
    stream.hold = new Promise<void>(() => undefined);
    act(() => result.current.run('create', 'New words'));
    await waitFor(() => expect(result.current.phase).toBe('running'));
    act(() => result.current.discard());
    expect(api.deleteWaiting).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('idle');

    const second = await hydrated();
    stream.hold = new Promise<void>(() => undefined);
    act(() => second.result.current.refine('More'));
    await waitFor(() => expect(second.result.current.phase).toBe('running'));
    act(() => second.result.current.discard());
    expect(api.deleteWaiting).toHaveBeenCalledWith('app-1', 'v7');
  });
});
