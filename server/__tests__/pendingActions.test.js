// Write confirmation tokens (server/agents/pendingActions.js).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTION_TTL_MS,
  MAX_PENDING_ACTIONS,
  __resetPendingActionsForTests,
  confirmWritesEnabled,
  createPendingAction,
  describeWrite,
  noteApproval,
  pendingActionCount,
  restorePendingAction,
  takeApprovalSinceLastTurn,
  takePendingAction,
} from '../agents/pendingActions.js';

const action = (over = {}) => ({ conversationId: 'conv-1', name: 'add_item', args: { name: 'Buy milk' }, callId: 'call_0', ctx: { writeCount: 0, writeCap: 3 }, ...over });

beforeEach(() => __resetPendingActionsForTests());
afterEach(() => vi.useRealTimers());

describe('pending actions', () => {
  it('issues 128-bit hex tokens that are single-use', () => {
    const token = createPendingAction(action());
    expect(token).toMatch(/^[a-f0-9]{32}$/);
    expect(takePendingAction(token, 'conv-1')).toMatchObject({ name: 'add_item', args: { name: 'Buy milk' }, callId: 'call_0' });
    expect(takePendingAction(token, 'conv-1')).toBeNull();
  });

  it('is bound to its conversation and a mismatch does not consume it', () => {
    const token = createPendingAction(action());
    expect(takePendingAction(token, 'conv-2')).toBeNull();
    expect(takePendingAction(token, null)).toBeNull();
    expect(takePendingAction(token, 'conv-1')).not.toBeNull();
    const anon = createPendingAction(action({ conversationId: null }));
    expect(takePendingAction(anon, undefined)).not.toBeNull();
  });

  it('expires after ten minutes', () => {
    vi.useFakeTimers();
    const token = createPendingAction(action());
    vi.advanceTimersByTime(ACTION_TTL_MS + 1);
    expect(takePendingAction(token, 'conv-1')).toBeNull();
  });

  it('rejects malformed tokens without lookup', () => {
    expect(takePendingAction('../../x', 'conv-1')).toBeNull();
    expect(takePendingAction(42, 'conv-1')).toBeNull();
  });

  it('keeps at most MAX_PENDING_ACTIONS entries', () => {
    for (let i = 0; i < MAX_PENDING_ACTIONS + 10; i += 1) createPendingAction(action());
    expect(pendingActionCount()).toBeLessThanOrEqual(MAX_PENDING_ACTIONS);
  });

  it('restore puts a consumed action back', () => {
    const token = createPendingAction(action());
    const entry = takePendingAction(token, 'conv-1');
    restorePendingAction(token, entry);
    expect(takePendingAction(token, 'conv-1')).not.toBeNull();
  });

  it('confirmation is on unless ASSISTANT_CONFIRM_WRITES=0', () => {
    expect(confirmWritesEnabled({})).toBe(true);
    expect(confirmWritesEnabled({ ASSISTANT_CONFIRM_WRITES: '1' })).toBe(true);
    expect(confirmWritesEnabled({ ASSISTANT_CONFIRM_WRITES: '0' })).toBe(false);
  });

  it('confirmation is always on in desktop mode, whatever ASSISTANT_CONFIRM_WRITES says', () => {
    expect(confirmWritesEnabled({ APP_DESKTOP: '1', ASSISTANT_CONFIRM_WRITES: '0' })).toBe(true);
    expect(confirmWritesEnabled({ APP_DESKTOP: '1' })).toBe(true);
    expect(confirmWritesEnabled({ APP_DESKTOP: '0', ASSISTANT_CONFIRM_WRITES: '0' })).toBe(false);
  });

  it('describes writes in plain words without dashes', () => {
    expect(describeWrite('other', { name: 'Buy milk' })).toBe('Run other');
    expect(describeWrite('add_item', { name: 'Buy milk' })).toBe('Run add_item'); // studio mode has no write tool
    for (const n of ['add_item', 'other']) expect(describeWrite(n, {})).not.toMatch(/[‒-―]/);
  });
});

describe('approvals since the last turn (RV26-20)', () => {
  it('is seen once, by the conversation that approved', () => {
    noteApproval('conv-1');
    expect(takeApprovalSinceLastTurn('conv-2')).toBe(false);
    expect(takeApprovalSinceLastTurn('conv-1')).toBe(true);
    expect(takeApprovalSinceLastTurn('conv-1')).toBe(false);
    noteApproval(undefined);
    expect(takeApprovalSinceLastTurn(null)).toBe(true);
  });
});
