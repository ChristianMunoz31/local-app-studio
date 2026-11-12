// Bounded manual retry around rmSync, the same logic as removeTempRoot in e2e/support/appServer.js. Node 24 rmSync ignores
// maxRetries and retryDelay for EPERM (it fails at once against a short lived holder such as an indexer or a dying child's cwd),
// so the retry is done by hand for 10 seconds on EPERM, EBUSY and ENOTEMPTY.
import fs from 'node:fs';

export const REMOVE_DEADLINE_MS = 10_000;
export const REMOVE_RETRY_MS = 200;
export const REMOVE_RETRY_CODES = Object.freeze(['EPERM', 'EBUSY', 'ENOTEMPTY']);

/**
 * Removes a folder tree, retrying a busy folder until the deadline. Throws the last error.
 * @param {string} target
 * @param {{ rm?: (p: string, o: object) => void, now?: () => number, sleep?: (ms: number) => Promise<void>, deadlineMs?: number, retryMs?: number }} [deps]
 * @returns {Promise<void>}
 */
export async function removeDir(target, { rm = fs.rmSync, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), deadlineMs = REMOVE_DEADLINE_MS, retryMs = REMOVE_RETRY_MS } = {}) {
  const deadline = now() + deadlineMs;
  for (;;) {
    try {
      rm(target, { recursive: true, force: true });
      return;
    } catch (err) {
      if (REMOVE_RETRY_CODES.includes(err?.code) && now() < deadline) {
        await sleep(retryMs);
        continue;
      }
      throw err;
    }
  }
}
