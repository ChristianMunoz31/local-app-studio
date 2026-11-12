import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuildEvent, BuildRecord } from '../../buildTypes';
import { MAX_LOG_LINES, useBuild } from '../useBuild';

const api = vi.hoisted(() => ({
  listBuilds: vi.fn(),
  startBuild: vi.fn(),
  getBuild: vi.fn(),
  cancelBuild: vi.fn(),
  streamBuild: vi.fn(),
}));
vi.mock('../../services/buildApi', () => api);

const build = (over: Partial<BuildRecord> = {}): BuildRecord => ({
  id: 'b1', appId: 'a1', status: 'running', specRevision: 1, appVersion: '1.0.0', startedAt: new Date().toISOString(), finishedAt: null,
  durationMs: null, installerPath: null, installerSha256: null, installerSizeBytes: null, errorCode: null, message: null, ...over,
});
const steps = [{ id: 'toolchain' as const, label: 'Check the build tools', status: 'running' as const, startedAt: null, finishedAt: null }];

let emit: (e: BuildEvent) => void = () => undefined;
let close: () => void = () => undefined;

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.streamBuild.mockImplementation((_id: string, { onEvent }: { onEvent(e: BuildEvent): void }) => {
    emit = onEvent;
    return new Promise<void>((resolve) => {
      close = resolve;
    });
  });
});

describe('useBuild', () => {
  it('attaches to a running build and dedupes log lines by seq', async () => {
    api.listBuilds.mockResolvedValue([build()]);
    const { result } = renderHook(() => useBuild('a1'));
    await waitFor(() => expect(api.streamBuild).toHaveBeenCalled());
    act(() => emit({ type: 'snapshot', build: build(), steps, lines: [{ seq: 1, step: 'toolchain', line: 'one' }, { seq: 2, step: 'toolchain', line: 'two' }], truncated: false, live: true }));
    act(() => emit({ type: 'log', seq: 2, step: 'toolchain', line: 'two' }));
    act(() => emit({ type: 'log', seq: 3, step: 'toolchain', line: 'three' }));
    await waitFor(() => expect(result.current.live?.lines.map((l) => l.line)).toEqual(['one', 'two', 'three']));
    act(() => emit({ type: 'step', step: 'toolchain', status: 'done', at: 'now' }));
    expect(result.current.live?.steps[0].status).toBe('done');
  });

  it('replaces the row and lists again on end', async () => {
    api.listBuilds.mockResolvedValue([build()]);
    const { result } = renderHook(() => useBuild('a1'));
    await waitFor(() => expect(api.streamBuild).toHaveBeenCalled());
    const done = build({ status: 'succeeded', durationMs: 5000, installerPath: 'C:\\x\\app.exe' });
    api.listBuilds.mockResolvedValue([done]);
    act(() => emit({ type: 'end', build: done }));
    await waitFor(() => expect(result.current.builds[0].status).toBe('succeeded'));
    expect(result.current.live?.build.status).toBe('succeeded');
    act(() => close());
    expect(api.getBuild).not.toHaveBeenCalled();
  });

  it('looks at the build once when the stream drops without an end', async () => {
    api.listBuilds.mockResolvedValue([build()]);
    api.getBuild.mockResolvedValue(build({ status: 'failed', message: 'It failed.' }));
    const { result } = renderHook(() => useBuild('a1'));
    await waitFor(() => expect(api.streamBuild).toHaveBeenCalled());
    await act(async () => close());
    await waitFor(() => expect(result.current.live?.build.status).toBe('failed'));
    expect(api.getBuild).toHaveBeenCalledTimes(1);
  });

  it('batches log lines into one dispatch per frame and keeps the line cap', async () => {
    vi.useFakeTimers();
    api.listBuilds.mockResolvedValue([build()]);
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useBuild('a1');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.streamBuild).toHaveBeenCalledTimes(1);
    act(() => emit({ type: 'snapshot', build: build(), steps, lines: [], truncated: false, live: true }));
    const before = renders;
    act(() => {
      for (let seq = 1; seq <= MAX_LOG_LINES + 50; seq += 1) emit({ type: 'log', seq, step: 'toolchain', line: `l${seq}` });
    });
    expect(renders).toBe(before);
    expect(result.current.live?.lines).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(renders).toBe(before + 1);
    expect(result.current.live?.lines).toHaveLength(MAX_LOG_LINES);
    expect(result.current.live?.lines[0].seq).toBe(51);
    expect(result.current.live?.truncated).toBe(true);
  });

  it('reattaches a dropped stream while the build runs, with 1, 2 and 4 s backoff, then stops', async () => {
    vi.useFakeTimers();
    api.listBuilds.mockResolvedValue([build()]);
    api.getBuild.mockResolvedValue(build());
    renderHook(() => useBuild('a1'));
    const drop = async (advanceMs: number): Promise<void> => {
      await act(async () => {
        close();
        await vi.advanceTimersByTimeAsync(advanceMs);
      });
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.streamBuild).toHaveBeenCalledTimes(1);
    await drop(999);
    expect(api.streamBuild).toHaveBeenCalledTimes(1);
    await drop(1);
    expect(api.streamBuild).toHaveBeenCalledTimes(2);
    await drop(1999);
    expect(api.streamBuild).toHaveBeenCalledTimes(2);
    await drop(1);
    expect(api.streamBuild).toHaveBeenCalledTimes(3);
    await drop(4000);
    expect(api.streamBuild).toHaveBeenCalledTimes(4);
    await drop(60000);
    expect(api.streamBuild).toHaveBeenCalledTimes(4);
  });

  it('clears the reattach timer on unmount', async () => {
    vi.useFakeTimers();
    api.listBuilds.mockResolvedValue([build()]);
    api.getBuild.mockResolvedValue(build());
    const { unmount } = renderHook(() => useBuild('a1'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      close();
      await vi.advanceTimersByTimeAsync(0);
    });
    unmount();
    await vi.advanceTimersByTimeAsync(10000);
    expect(api.streamBuild).toHaveBeenCalledTimes(1);
  });

  it('says the build could not be reached, and that the design is safe, when a start fails without a message', async () => {
    api.listBuilds.mockResolvedValue([]);
    api.startBuild.mockRejectedValue('boom');
    const { result } = renderHook(() => useBuild('a1'));
    await waitFor(() => expect(api.listBuilds).toHaveBeenCalled());
    await act(async () => {
      await result.current.start(1);
    });
    expect(result.current.error).toBe('Could not reach the build. Your design is safe. Try again.');
  });
});
