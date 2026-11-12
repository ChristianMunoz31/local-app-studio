// Write confirmation for Assistant. When ASSISTANT_CONFIRM_WRITES=1 (the default), a write tool
// call is parked here instead of running; the user approves or declines it with
// POST /api/assistant/actions/:token. Tokens are 128-bit, single-use, in memory, expire after
// ten minutes, and are bound to the conversation they came from.
import { randomBytes } from 'node:crypto';
import { getAppSpec, getCompiledSpec } from '../spec/source.js';
import { isDesktopMode } from '../runtime.js';
import { parseRuntimeToolName } from '@local-app-studio/runtime/server/toolNames.js';

export const ACTION_TTL_MS = 10 * 60 * 1000;
export const MAX_PENDING_ACTIONS = 100;
export const TOKEN_RE = /^[a-f0-9]{32}$/;

// What the stored tool result of a parked call says once the person answered, so a later turn never reads a declined save as data.
export const DECLINED_TOOL_RESULT = 'The person declined this save. Nothing was saved.';
export const APPROVED_TOOL_RESULT = 'Saved.';
export const FAILED_SAVE_TOOL_RESULT = 'The save could not be done. Nothing was saved.';

/** @type {Map<string, { conversationId: string|null, name: string, args: object, callId: string, ctx: object, expiresAt: number }>} */
const pending = new Map();

/**
 * @returns {boolean} Whether writes need confirmation: always in desktop mode, else ASSISTANT_CONFIRM_WRITES (default on).
 */
export const confirmWritesEnabled = (env = process.env) =>
  isDesktopMode(env) || (env.ASSISTANT_CONFIRM_WRITES ?? '1').trim() !== '0';

function sweep(now = Date.now()) {
  for (const [token, entry] of pending) if (entry.expiresAt <= now) pending.delete(token);
  while (pending.size >= MAX_PENDING_ACTIONS) pending.delete(pending.keys().next().value);
}

/**
 * Park a write call and return its confirmation token.
 * @param {{ conversationId: string|null, name: string, args: object, callId: string, ctx: { writeCount?: number, writeCap?: number } }} action
 * `ctx` is the run's write counter, shared so confirmed writes count toward its cap.
 * @returns {string}
 */
export function createPendingAction({ conversationId, name, args, callId, ctx }) {
  sweep();
  const token = randomBytes(16).toString('hex');
  pending.set(token, {
    conversationId: conversationId || null,
    name,
    args: args || {},
    callId,
    ctx: ctx || { writeCount: 0, writeCap: 3 },
    expiresAt: Date.now() + ACTION_TTL_MS,
  });
  return token;
}

/**
 * Take (consume) a pending action. A token from another conversation is left in place
 * and reported as not found.
 * @param {unknown} token
 * @param {string|null|undefined} conversationId
 * @returns {{ conversationId: string|null, name: string, args: object, callId: string, ctx: object } | null}
 */
export function takePendingAction(token, conversationId) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
  const entry = pending.get(token);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    pending.delete(token);
    return null;
  }
  if (entry.conversationId !== (conversationId || null)) return null;
  pending.delete(token);
  return entry;
}

/**
 * Put a consumed action back (for example when the write cap refused it), keeping its expiry.
 * @param {string} token
 * @param {object} entry
 */
export function restorePendingAction(token, entry) {
  if (entry && entry.expiresAt > Date.now()) pending.set(token, entry);
}

// Conversations with an approved action not yet seen by a turn (key: conversation id or null). Kept in memory and capped.
const approved = new Set();
const MAX_APPROVED = 100;

/**
 * Record that a pending action of this conversation was approved and ran.
 * @param {string|null|undefined} conversationId
 */
export function noteApproval(conversationId) {
  const key = conversationId || null;
  approved.delete(key);
  while (approved.size >= MAX_APPROVED) approved.delete(approved.values().next().value);
  approved.add(key);
}

/**
 * Whether an action of this conversation was approved since the previous turn took this answer. Reading it clears it,
 * so each approval is seen by exactly one turn (the next one).
 * @param {string|null|undefined} conversationId
 * @returns {boolean}
 */
export const takeApprovalSinceLastTurn = (conversationId) => approved.delete(conversationId || null);

/** Number of parked actions (for tests and run.done). */
export const pendingActionCount = () => pending.size;

/**
 * One-line, user-facing description of a write.
 * @param {string} name
 * @param {Record<string, unknown>} args
 * @returns {string}
 */
export function describeWrite(name, args = {}) {
  const q = (v) => `"${String(v ?? '').slice(0, 120)}"`;
  // Runtime mode: a canonical save_record__<table> call. Studio mode has no write tool.
  const parsed = parseRuntimeToolName(name, Object.keys(getCompiledSpec()?.tables ?? {}));
  if (parsed?.verb === 'save_record') {
    const label = getAppSpec()?.tables?.find((t) => t.id === parsed.table)?.label ?? parsed.table;
    const title = typeof args.title === 'string' && args.title ? args.title : '(untitled)';
    return args.id === undefined ? `Add to ${label}: ${q(title)}` : `Change in ${label}: ${q(title)}`;
  }
  return `Run ${name}`;
}

/** Test hook. */
export function __resetPendingActionsForTests() {
  pending.clear();
  approved.clear();
}
