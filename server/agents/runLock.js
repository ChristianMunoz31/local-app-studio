// One active Assistant run per conversation (in memory). Concurrent runs in one conversation would
// interleave their persisted rows, which weakens the per-turn checks on cloud history.
const active = new Set();

/** Reserve a conversation; false when a run already holds it. */
export function acquireConversationRun(conversationId) {
  if (active.has(conversationId)) return false;
  active.add(conversationId);
  return true;
}

/** Release a conversation reserved with acquireConversationRun. */
export function releaseConversationRun(conversationId) {
  active.delete(conversationId);
}

export const CONVERSATION_BUSY_MESSAGE = 'Assistant is still answering in this chat. Wait for it to finish, then ask again.';
