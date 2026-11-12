// Regression for the backup worker start gate (client.js finish()): a worker is never terminated before
// it posted { type: 'ready' } (or exited), waits at most READY_TIMEOUT_MS from its start, and leaves no
// listener or timer behind. Fake EventEmitter workers with fake timers.
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __setWorkerFactoryForTests,
  __setWorkerTimeoutForTests,
  drainBackupWorker,
  READY_TIMEOUT_MS,
  resumeBackupWorker,
  runBackupOp,
  TERMINATE_WAIT_MS,
} from '../backup/worker/client.js';

const READY = { type: 'ready' };

/** An EventEmitter worker that stays "starting" until the test emits the ready message. terminate() is recorded and, like a real one, then exits. */
function makeFake() {
  const w = new EventEmitter();
  w.postMessage = vi.fn();
  w.terminate = vi.fn(() => {
    queueMicrotask(() => w.emit('exit', 1));
    return Promise.resolve(1);
  });
  return w;
}

const track = (p) => {
  const out = { done: false, value: undefined, error: undefined };
  p.then(
    (v) => {
      out.done = true;
      out.value = v;
    },
    (e) => {
      out.done = true;
      out.error = e;
    },
  );
  return out;
};
const flush = () => vi.advanceTimersByTimeAsync(0);
const counts = (w) => ({ message: w.listenerCount('message'), exit: w.listenerCount('exit') });

describe('the backup worker is terminated only after it is ready', () => {
  let worker;
  let controller;
  let result;

  beforeEach(() => {
    vi.useFakeTimers();
    worker = makeFake();
    __setWorkerFactoryForTests(() => worker);
    __setWorkerTimeoutForTests(null);
    controller = new AbortController();
    result = track(runBackupOp('inspectFile', { path: 'x' }, { signal: controller.signal }));
  });

  afterEach(async () => {
    worker.emit('message', READY);
    await vi.runAllTimersAsync();
    __setWorkerFactoryForTests(null);
    resumeBackupWorker();
    vi.useRealTimers();
  });

  it('abort before ready: terminate waits, then the promise rejects with worker_cancelled', async () => {
    await flush();
    controller.abort();
    await flush();
    expect(worker.terminate).not.toHaveBeenCalled();
    expect(result.done).toBe(false);
    worker.emit('message', READY);
    await flush();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(result.done).toBe(true);
    expect(result.error).toMatchObject({ code: 'worker_cancelled' });
    expect(worker.postMessage).not.toHaveBeenCalled();
  });

  it('drainBackupWorker before ready goes through the same gate', async () => {
    await flush();
    const drained = track(drainBackupWorker({ timeoutMs: 100 }));
    await vi.advanceTimersByTimeAsync(150);
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.emit('message', READY);
    await flush();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(result.error).toMatchObject({ code: 'worker_cancelled' });
    expect(drained.done).toBe(true);
    expect(drained.value).toMatchObject({ terminated: true });
  });

  it("an 'exit' before ready releases the gate without waiting", async () => {
    await flush();
    worker.emit('exit', 1);
    await flush();
    expect(result.done).toBe(true);
    expect(result.error).toMatchObject({ code: 'worker_unavailable' });
    expect(counts(worker).exit).toBe(1);
  });

  it('a worker that never becomes ready is terminated at READY_TIMEOUT_MS, with no extra wait', async () => {
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS - 1);
    expect(worker.terminate).not.toHaveBeenCalled();
    expect(result.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(result.done).toBe(true);
    expect(result.error).toMatchObject({ code: 'worker_unavailable' });
  });

  it('abort shortly before the ready deadline waits only for the rest of the start budget', async () => {
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS - 1000);
    controller.abort();
    await vi.advanceTimersByTimeAsync(999);
    expect(worker.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(result.error).toMatchObject({ code: 'worker_cancelled' });
  });

  it('a non-ready first message still fails the start (worker_bad_message path), terminating after the gate', async () => {
    worker.emit('message', { ok: true, result: 1 });
    await flush();
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.emit('message', READY);
    await flush();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(result.error).toMatchObject({ code: 'worker_unavailable' });
  });

  it('leaves no gate listener or timer behind', async () => {
    await flush();
    controller.abort();
    await flush();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    worker.emit('message', READY);
    await flush();
    expect(result.done).toBe(true);
    // Only the client's own permanent listeners remain (message, exit); the gate's once('exit') is gone.
    expect(worker.listenerCount('exit')).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('abort before ready, then an exit during the wait: settles at once with worker_cancelled and no gate listener', async () => {
    await flush();
    controller.abort();
    await flush();
    expect(result.done).toBe(false);
    worker.emit('exit', 1);
    await flush();
    expect(result.done).toBe(true);
    expect(result.error).toMatchObject({ code: 'worker_cancelled' });
    expect(counts(worker).exit).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('abort after ready terminates without waiting', async () => {
    worker.emit('message', READY);
    await flush();
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    controller.abort();
    await flush();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(result.done).toBe(true);
    expect(result.error).toMatchObject({ code: 'worker_cancelled' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('drain where ready never comes returns after TERMINATE_WAIT_MS, terminate not called, flagged pending', async () => {
    await flush();
    const drained = track(drainBackupWorker({ timeoutMs: 100 }));
    await vi.advanceTimersByTimeAsync(100 + TERMINATE_WAIT_MS - 1);
    expect(drained.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(drained.done).toBe(true);
    expect(drained.value).toEqual({ terminated: false, dropped: 0, pending: true });
    expect(worker.terminate).not.toHaveBeenCalled();
  });
});
