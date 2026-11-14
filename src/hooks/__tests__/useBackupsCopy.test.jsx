import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  COPY_PENDING_LIMIT_MS,
  COPY_POLL_FAST_FOR_MS,
  COPY_POLL_MS,
  COPY_POLL_SLOWEST_MS,
  COPY_POLL_SLOW_MS,
  useBackups,
} from '../useBackups';
import * as service from '../../services/backupService';

vi.mock('../../services/backupService', () => ({
  listBackups: vi.fn(),
  getBackupStatus: vi.fn(),
  createBackup: vi.fn(),
  updateBackupSettings: vi.fn(),
  setAutoBackup: vi.fn(),
  setCopyTo: vi.fn(),
  dismissAutoReminder: vi.fn(),
}));

const list = (health) => ({
  backups: [],
  status: {},
  settings: {},
  secondCopy: { enabled: health !== 'off', folder: 'D:\\B', health },
});

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => useBackups(), { wrapper });
}

// Query results reach React through a zero-delay timer: let it run.
const settle = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });

beforeEach(() => {
  vi.useFakeTimers();
  for (const fn of Object.values(service)) fn.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useBackups second copy polling', () => {
  it('refetches while the copy is pending and stops when it is done', async () => {
    service.listBackups
      .mockResolvedValueOnce(list('pending'))
      .mockResolvedValueOnce(list('pending'))
      .mockResolvedValue(list('ok'));
    const { result } = mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.data.secondCopy.health).toBe('pending');
    expect(service.listBackups).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COPY_POLL_MS);
    });
    expect(service.listBackups).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COPY_POLL_MS);
    });
    expect(service.listBackups).toHaveBeenCalledTimes(3);
    await settle();
    expect(result.current.data.secondCopy.health).toBe('ok');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COPY_POLL_MS * 5);
    });
    expect(service.listBackups).toHaveBeenCalledTimes(3);
  });

  it('does not poll when the copy is off or ok', async () => {
    service.listBackups.mockResolvedValue(list('off'));
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COPY_POLL_MS * 5);
    });
    expect(service.listBackups).toHaveBeenCalledTimes(1);
  });

  it('backs off while pending (2 s, then 10 s, then 30 s) and gives up after the copy timeout plus a margin', async () => {
    const times = [];
    service.listBackups.mockImplementation(async () => {
      times.push(Date.now());
      return list('pending');
    });
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COPY_PENDING_LIMIT_MS + 5 * 60 * 1000);
    });
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    expect(COPY_PENDING_LIMIT_MS).toBeGreaterThan(10 * 60 * 1000);
    // Fast for the first 30 s.
    const fast = gaps.filter((_, i) => times[i] - times[0] < COPY_POLL_FAST_FOR_MS);
    expect(fast.length).toBeGreaterThan(10);
    expect(fast.every((g) => g === COPY_POLL_MS)).toBe(true);
    // Then 10 s, then 30 s, in that order, and nothing faster than that later.
    const firstSlow = gaps.indexOf(COPY_POLL_SLOW_MS);
    const firstSlowest = gaps.indexOf(COPY_POLL_SLOWEST_MS);
    expect(firstSlow).toBeGreaterThan(0);
    expect(firstSlowest).toBeGreaterThan(firstSlow);
    expect(gaps.slice(firstSlow).every((g) => g >= COPY_POLL_SLOW_MS)).toBe(true);
    expect(gaps.slice(firstSlowest).every((g) => g === COPY_POLL_SLOWEST_MS)).toBe(true);
    // The last poll is no later than the limit plus one slow step, and nothing follows.
    expect(times.at(-1) - times[0]).toBeLessThanOrEqual(COPY_PENDING_LIMIT_MS + COPY_POLL_SLOWEST_MS);
    const calls = service.listBackups.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    });
    expect(service.listBackups).toHaveBeenCalledTimes(calls);
  });

  it('polls again after the limit when the person backs up again', async () => {
    service.listBackups.mockResolvedValue(list('pending'));
    service.createBackup.mockResolvedValue({});
    const { result } = mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COPY_PENDING_LIMIT_MS + COPY_POLL_SLOWEST_MS * 2);
    });
    const stopped = service.listBackups.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });
    expect(service.listBackups).toHaveBeenCalledTimes(stopped);
    await act(async () => {
      await result.current.backUpNow();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COPY_POLL_MS * 3);
    });
    expect(service.listBackups.mock.calls.length).toBeGreaterThan(stopped + 2);
  });

  it('refetches after saving a folder and keeps going until the copy leaves pending', async () => {
    service.listBackups.mockResolvedValueOnce(list('off')).mockResolvedValueOnce(list('pending')).mockResolvedValue(list('ok'));
    service.setCopyTo.mockResolvedValue({ enabled: true, health: 'pending' });
    const { result } = mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await result.current.setCopyTo('D:\\B');
    });
    expect(service.setCopyTo).toHaveBeenCalledWith('D:\\B');
    await settle();
    expect(result.current.data.secondCopy.health).toBe('pending');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COPY_POLL_MS);
    });
    await settle();
    expect(result.current.data.secondCopy.health).toBe('ok');
  });
});
