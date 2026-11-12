// In-process scheduler: audit prune at startup and daily, clean start/stop, and no timers that
// keep the process alive.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../loadEnv.js', () => ({}));

import { DAY_MS, isSchedulerRunning, msUntilNextHour, startScheduler, stopScheduler } from '../scheduler.js';

const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 5, 1, 12, 0, 0)); // local noon
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  stopScheduler();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const deps = (over = {}) => ({
  prune: vi.fn(async () => ({ ok: true })),
  pruneDelayMs: 1000,
  ...over,
});

describe('msUntilNextHour', () => {
  it('rolls to the next day when the hour has passed', () => {
    expect(msUntilNextHour(7, new Date(2026, 5, 1, 12, 0, 0))).toBe(19 * HOUR);
  });
  it('is later today when the hour is still ahead', () => {
    expect(msUntilNextHour(7, new Date(2026, 5, 1, 6, 0, 0))).toBe(HOUR);
  });
  it('treats exactly the hour as passed', () => {
    expect(msUntilNextHour(7, new Date(2026, 5, 1, 7, 0, 0))).toBe(DAY_MS);
  });
});

describe('start/stop', () => {
  it('starts once, reports running, and stops cleanly', () => {
    expect(isSchedulerRunning()).toBe(false);
    expect(startScheduler(deps())).toBe(true);
    expect(isSchedulerRunning()).toBe(true);
    expect(startScheduler(deps())).toBe(false);
    stopScheduler();
    expect(isSchedulerRunning()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    stopScheduler(); // safe when already stopped
  });

  it('runs nothing after stop', async () => {
    const d = deps();
    startScheduler(d);
    stopScheduler();
    await vi.advanceTimersByTimeAsync(3 * DAY_MS);
    expect(d.prune).not.toHaveBeenCalled();
  });
});

describe('audit prune', () => {
  it('runs shortly after startup and then once a day', async () => {
    const d = deps();
    startScheduler(d);
    expect(d.prune).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(d.prune).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DAY_MS);
    expect(d.prune).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(DAY_MS);
    expect(d.prune).toHaveBeenCalledTimes(3);
  });

  it('keeps running after a prune failure', async () => {
    const d = deps({ prune: vi.fn(async () => { throw new Error('boom'); }) });
    startScheduler(d);
    await vi.advanceTimersByTimeAsync(1000 + DAY_MS);
    expect(d.prune).toHaveBeenCalledTimes(2);
    expect(isSchedulerRunning()).toBe(true);
  });
});
