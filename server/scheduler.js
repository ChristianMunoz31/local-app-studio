// In-process scheduler (no dependencies) for the app's daily jobs:
//  - audit-log prune shortly after startup and then once a day.
// Add your own recurring jobs next to the prune. A job that needs the model should check
// isAiEnabled() and (for a Pro capability) assertPro(): see server/pro.js.
// All timers are unref'd so they never keep the process alive.
// The user's automatic backups switch does not affect these jobs (it only gates the backup
// scheduler in server/backup/service.js).
import { pruneAudit } from './audit.js';

export const PRUNE_STARTUP_DELAY_MS = 30_000;
export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Milliseconds from `now` until the next occurrence of `hour`:00 local time. Handy for a job that
 * should run at a fixed time of day.
 * @param {number} hour 0-23
 * @param {Date} [now]
 * @returns {number}
 */
export function msUntilNextHour(hour, now = new Date()) {
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

let active = null; // { timers: Set<Timeout> } while running

/**
 * Start the scheduler. A second call while running is a no-op.
 * @param {{
 *   prune?: () => Promise<unknown>,
 *   pruneDelayMs?: number,
 * }} [opts] overrides exist for tests
 * @returns {boolean} true when this call started it
 */
export function startScheduler({ prune = pruneAudit, pruneDelayMs = PRUNE_STARTUP_DELAY_MS } = {}) {
  if (active) return false;
  const state = { timers: new Set() };
  active = state;

  const arm = (delayMs, job, rearm) => {
    const timer = setTimeout(async () => {
      state.timers.delete(timer);
      try {
        await job();
      } catch (err) {
        console.error('Scheduled job failed:', err?.code || err?.name || 'unknown');
      }
      if (active === state) rearm();
    }, Math.max(delayMs, 0));
    timer.unref?.();
    state.timers.add(timer);
  };

  const schedulePrune = () => arm(DAY_MS, () => prune(), schedulePrune);
  arm(pruneDelayMs, () => prune(), schedulePrune);
  return true;
}

/** Stop all timers. Safe to call when not running. */
export function stopScheduler() {
  if (!active) return;
  for (const timer of active.timers) clearTimeout(timer);
  active.timers.clear();
  active = null;
}

/** @returns {boolean} whether the scheduler is running */
export const isSchedulerRunning = () => active !== null;
