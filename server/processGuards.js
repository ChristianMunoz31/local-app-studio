// Process guards (DESIGN phase 15, section 6). An unhandled rejection never ends the process. An uncaught exception
// ends it (exit 5) only when the state is unsafe; otherwise the request in context gets `server_error` and the
// server keeps running. Before startup finished the old behavior stays (exit 1), and the parser child exits 1.
import v8 from 'node:v8';
import { currentRequest, flushLogSync, log, openResponses, ownFrame } from './log.js';

export const EXIT_UNSAFE = 5;
const EXIT_STARTUP = 1;
const REPEAT_WINDOW_MS = 60_000;
const HEAP_LIMIT_RATIO = 0.9;
const STOP_CAP_MS = 2000;
const ENTRY_GUARD = Symbol.for('las.entryGuard');
const DAMAGED_RE = /^SQLITE_(CORRUPT|NOTADB|IOERR|CANTOPEN)/;
// SQLite primary result codes: IOERR 10, CORRUPT 11, CANTOPEN 14, NOTADB 26 (extended codes keep them in the low byte).
const DAMAGED_CODES = new Set([10, 11, 14, 26]);

function causeChain(err) {
  const out = [];
  for (let e = err, i = 0; e && typeof e === 'object' && i < 6; e = e.cause, i += 1) out.push(e);
  return out;
}

function isDatabaseDamaged(err) {
  return causeChain(err).some((e) => {
    if (typeof e.code === 'string' && DAMAGED_RE.test(e.code)) return true;
    if (typeof e.errstr === 'string' && /malformed|not a database|disk i\/o|unable to open/i.test(e.errstr)) return true;
    return Number.isInteger(e.errcode) && DAMAGED_CODES.has(e.errcode & 0xff);
  });
}

function isStackOverflow(err) {
  return err instanceof RangeError && /Maximum call stack size exceeded/.test(err.message);
}

/**
 * Decides whether an uncaught exception ends the process. Pure.
 * @param {unknown} err
 * @param {{ inTransaction?: boolean, heapRatio?: number, lastUncaughtAt?: number | null, now?: number,
 *   startupDone?: boolean, role?: string }} ctx
 * @returns {{ exit: boolean, reason: 'transaction_open' | 'database_damaged' | 'out_of_memory' | 'stack_overflow' | 'repeat' | 'startup' | 'parser' | null }}
 */
export function classifyUncaught(err, { inTransaction = false, heapRatio = 0, lastUncaughtAt = null, now = Date.now(), startupDone = true, role = 'studio' } = {}) {
  if (role === 'parser') return { exit: true, reason: 'parser' };
  if (!startupDone) return { exit: true, reason: 'startup' };
  if (inTransaction) return { exit: true, reason: 'transaction_open' };
  if (isDatabaseDamaged(err)) return { exit: true, reason: 'database_damaged' };
  if (isStackOverflow(err)) return { exit: true, reason: 'stack_overflow' };
  if (err?.code === 'ERR_OUT_OF_MEMORY' || heapRatio > HEAP_LIMIT_RATIO) return { exit: true, reason: 'out_of_memory' };
  // ERR_HTTP_HEADERS_SENT is the follow-up of a request that was already answered (after a rejection finished its response),
  // not a second fault, so it never counts as the "repeat".
  if (err?.code !== 'ERR_HTTP_HEADERS_SENT' && typeof lastUncaughtAt === 'number' && now - lastUncaughtAt < REPEAT_WINDOW_MS) return { exit: true, reason: 'repeat' };
  return { exit: false, reason: null };
}

function errorFields(err) {
  return {
    name: typeof err?.name === 'string' ? err.name : 'unknown',
    ...(typeof err?.code === 'string' ? { errorCode: err.code } : {}),
    ...(ownFrame(err) ? { at: ownFrame(err) } : {}),
  };
}

/**
 * @param {{ sendError?: Function, sseError?: Function } | undefined} errors the server/errors.js helpers
 * @param {import('node:http').ServerResponse} res
 */
function finishResponse(errors, res) {
  try {
    if (res.writableEnded || res.destroyed) return;
    if (!res.headersSent) {
      if (errors?.sendError) {
        errors.sendError(res, 'server_error');
      } else {
        const requestId = String(res.getHeader('X-Request-Id') ?? '');
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'server_error', code: 'server_error', action: '', requestId }));
      }
      return;
    }
    if (String(res.getHeader('Content-Type') ?? '').startsWith('text/event-stream')) {
      const payload = errors?.sseError ? errors.sseError('server_error') : { code: 'server_error' };
      res.write(`event: error\ndata: ${JSON.stringify(payload)}\n\n`);
      res.end();
      return;
    }
    res.destroy();
  } catch {
    try {
      res.destroy();
    } catch {
      // already gone
    }
  }
}

let lastRecoveredAt = null;

/** @returns {string | null} ISO time of the last uncaught error the server survived (Diagnostics shows it) */
export function lastRecovered() {
  return lastRecoveredAt;
}

/**
 * Installs the `uncaughtException` and `unhandledRejection` handlers. Removes the early entry guard of server/entry.js.
 * Startup counts as done once `stop` is known: pass it here, or call `uninstall.markReady(stop)` after startServer resolves.
 * @param {{ role: 'studio' | 'runtime' | 'preview' | 'parser', getDb?: () => ({ isTransaction?: boolean } | null) (must only peek: never open or migrate the database),
 *   exit?: (code: number) => void, now?: () => number, stop?: () => (Promise<void> | void),
 *   errors?: { sendError: Function, sseError: Function } }} opts
 * @returns {(() => void) & { markReady: (stop: () => (Promise<void> | void)) => void }} uninstall
 */
export function installProcessGuards({ role, getDb, exit = process.exit, now = Date.now, stop, errors } = {}) {
  let stopFn = typeof stop === 'function' ? stop : null;
  let lastUncaughtAt = null;
  let exiting = false;

  const earlyGuard = globalThis[ENTRY_GUARD];
  if (typeof earlyGuard === 'function' && role !== 'parser') {
    process.off('uncaughtException', earlyGuard);
    delete globalThis[ENTRY_GUARD];
  }

  const inTransaction = () => {
    try {
      return Boolean(getDb?.()?.isTransaction);
    } catch {
      return false;
    }
  };

  async function exitNow(reason, code) {
    if (exiting) return;
    exiting = true;
    log('fatal', 'process.exit_unsafe', { reason, exit: code });
    flushLogSync();
    for (const res of [...openResponses()]) finishResponse(errors, res);
    // One tick so the finished responses reach their sockets before the server closes.
    await new Promise((resolve) => setImmediate(resolve));
    if (stopFn && code === EXIT_UNSAFE) {
      let timer;
      try {
        await Promise.race([
          Promise.resolve().then(stopFn),
          new Promise((resolve) => {
            timer = setTimeout(resolve, STOP_CAP_MS);
          }),
        ]);
      } catch {
        // the stop itself failed: exit anyway
      } finally {
        clearTimeout(timer);
      }
    }
    flushLogSync();
    exit(code);
  }

  function onUncaught(err) {
    try {
      const heap = v8.getHeapStatistics();
      const verdict = classifyUncaught(err, {
        inTransaction: inTransaction(),
        heapRatio: heap.heap_size_limit > 0 ? heap.used_heap_size / heap.heap_size_limit : 0,
        lastUncaughtAt,
        now: now(),
        startupDone: stopFn !== null,
        role,
      });
      if (err?.code !== 'ERR_HTTP_HEADERS_SENT') lastUncaughtAt = now();
      log('error', 'process.uncaught', { code: 'server_error', ...errorFields(err), exit: verdict.exit });
      if (verdict.exit) {
        const code = verdict.reason === 'startup' || verdict.reason === 'parser' ? EXIT_STARTUP : EXIT_UNSAFE;
        void exitNow(verdict.reason, code);
        return;
      }
      lastRecoveredAt = new Date(now()).toISOString();
      const res = currentRequest()?.res;
      if (res) finishResponse(errors, res);
    } catch {
      flushLogSync();
      exit(EXIT_UNSAFE);
    }
  }

  function onRejection(reason) {
    try {
      log('error', 'process.unhandled_rejection', { code: 'server_error', ...errorFields(reason) });
      const res = currentRequest()?.res;
      if (res && !res.headersSent) finishResponse(errors, res);
    } catch {
      // never exit on a rejection
    }
  }

  // EPIPE on stdout or stderr (a closed pipe) is ignored; any other stream error goes the uncaught way.
  const onStreamError = (err) => {
    if (err?.code === 'EPIPE') return;
    onUncaught(err);
  };

  process.on('uncaughtException', onUncaught);
  process.on('unhandledRejection', onRejection);
  process.stdout.on('error', onStreamError);
  process.stderr.on('error', onStreamError);

  const uninstall = () => {
    process.off('uncaughtException', onUncaught);
    process.off('unhandledRejection', onRejection);
    process.stdout.off('error', onStreamError);
    process.stderr.off('error', onStreamError);
  };
  uninstall.markReady = (fn) => {
    if (typeof fn === 'function') stopFn = fn;
  };
  return uninstall;
}
