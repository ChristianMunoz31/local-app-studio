// One backup or restore at a time, plus the request gate that holds back /api traffic while a
// restore swaps the database file.
import { sendError } from '../errors.js';
import { BackupError, backupMessage } from './errors.js';

/** @type {'backup' | 'restore' | null} */
let current = null;
let gateClosed = false;
let inFlight = 0;

/**
 * @param {'backup' | 'restore'} op
 * @returns {(() => void) | null} release function, or null when another operation holds the lock
 */
export function tryAcquire(op) {
  if (current !== null) return null;
  current = op;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    current = null;
  };
}

/** @returns {'backup' | 'restore' | null} */
export const currentOp = () => current;

/** Error to throw when tryAcquire returned null. */
export const busyError = () => new BackupError(current === 'restore' ? 'db_restoring' : 'backup_busy');

export function closeGate() {
  gateClosed = true;
}
export function openGate() {
  gateClosed = false;
}
export const isGateClosed = () => gateClosed;
export const inFlightCount = () => inFlight;

const normalize = (p) => String(p).toLowerCase().replace(/\/+$/, '');

/**
 * Mounted at /api. While the gate is closed every request gets 503 db_restoring except
 * GET /api/backups/status. Open-gate requests are counted until they finish, except the restore
 * request itself and POST /api/backups/stable-copy, so a restore can wait for the others to drain.
 * @type {import('express').RequestHandler}
 */
export function restoreGateMiddleware(req, res, next) {
  const path = normalize(req.path);
  if (gateClosed) {
    if (req.method === 'GET' && path === '/backups/status') return next();
    res.set('Cache-Control', 'no-store');
    return sendError(res, 'db_restoring', {
      message: backupMessage('db_restoring'),
      headers: { 'Retry-After': '5' },
    });
  }
  // The restore request itself, and the copy from the stable Local App Studio (it ends in a restore): counting
  // either would make the restore wait for its own request.
  if (req.method === 'POST' && (path === '/backups/restore' || path === '/backups/stable-copy')) return next();
  // The toolchain check only spawns tools and reads the toolchain folders (never the database or the data
  // folder) and can take a minute on a loaded PC, so a restore must not wait for it.
  if (req.method === 'GET' && path === '/studio/build/toolchain') return next();
  // The doctor spawns the same tools (up to a minute) and reads the machine plus a helper probe, so it is exempt too
  // (DESIGN-phase15 8.3). Its one write is a temp file in the data folder, which it skips while currentOp() is
  // 'restore' (doctor.js dataLine). Not exempt: info (reads the helper settings) and report (lists the
  // apps from the database); logs is an instant read of the in-memory ring, so counting it costs nothing.
  if (req.method === 'GET' && path === '/studio/diagnostics/doctor') return next();
  inFlight += 1;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    inFlight = Math.max(0, inFlight - 1);
  };
  res.once('finish', finish);
  res.once('close', finish);
  return next();
}

/**
 * Waits until no counted request is in flight, or the wall-clock deadline (`timeoutMs` from the call) passes.
 * The deadline is real time, not a count of polls: a poll that sleeps longer than asked (a loaded PC) still
 * ends the wait on time.
 * @param {{ timeoutMs?: number, sleep?: (ms: number) => Promise<void>, pollMs?: number, now?: () => number }} [opts]
 * @returns {Promise<boolean>} true when drained, false on timeout
 */
export async function waitForDrain({
  timeoutMs = 10_000,
  pollMs = 25,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
} = {}) {
  const deadline = now() + timeoutMs;
  while (inFlight > 0) {
    if (now() >= deadline) return false;
    await sleep(pollMs);
  }
  return true;
}

/** Test hook: forget all lock and gate state. */
export function __resetLockForTests() {
  current = null;
  gateClosed = false;
  inFlight = 0;
}
