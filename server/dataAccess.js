// Plain async data-access functions over the local SQLite store: the shared query layer used by the
// assistant tools, global search and the page-advice context builders, so those features never
// duplicate the Express route queries. A database that cannot be opened surfaces as a DbError (status 503).
import { assertId, insert, nowIso, select, selectOne, update, upsert, withTransaction } from './db/index.js';

// ============================================================
// App state (key/value): provider choice, notifications, profile, network opt-ins
// ============================================================
export async function getState(key, fallback = null) {
  const row = selectOne('app_state', { columns: ['value'], where: { key } });
  return row ? row.value : fallback;
}

export async function setState(key, value) {
  const row = upsert('app_state', { key, value, updated_at: nowIso() }, { conflict: ['key'] });
  return { key: row.key, value: row.value };
}

// ============================================================
// Assistant conversations
// ============================================================
const toConversation = (r) => ({ id: r.id, title: r.title, createdTime: r.created_at, updatedTime: r.updated_at });

export async function createConversation({ title } = {}) {
  return toConversation(insert('assistant_conversations', { title: title || null }));
}

export async function listConversations({ limit = 30 } = {}) {
  return select('assistant_conversations', {
    columns: ['id', 'title', 'created_at', 'updated_at'],
    orderBy: [{ column: 'updated_at', dir: 'desc' }, { column: 'rowid', dir: 'desc' }],
    limit,
  }).map(toConversation);
}

export async function getMessages(conversationId, { limit = 40 } = {}) {
  assertId(conversationId, 'conversationId');
  const data = select('assistant_messages', {
    columns: ['id', 'role', 'content', 'tool_calls', 'tool_call_id', 'created_at'],
    where: { conversation_id: conversationId },
    // Newest N (rowid keeps same-millisecond turns ordered), reversed below to chronological.
    orderBy: [{ column: 'created_at', dir: 'desc' }, { column: 'rowid', dir: 'desc' }],
    limit,
  });
  data.reverse();
  return data.map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    toolCalls: r.tool_calls || null,
    toolCallId: r.tool_call_id || null,
    createdTime: r.created_at,
  }));
}

/**
 * Every row of a conversation, oldest first, with only the columns cloud taint detection needs
 * (no content). The history window alone can start after a withheld turn.
 */
export async function getConversationTaintRows(conversationId) {
  assertId(conversationId, 'conversationId');
  const data = select('assistant_messages', {
    columns: ['id', 'role', 'tool_calls', 'tool_call_id'],
    where: { conversation_id: conversationId },
    orderBy: [{ column: 'created_at', dir: 'asc' }, { column: 'rowid', dir: 'asc' }],
  });
  return data.map((r) => ({ id: r.id, role: r.role, toolCalls: r.tool_calls ?? null, toolCallId: r.tool_call_id || null }));
}

export async function appendMessage(conversationId, { role, content, toolCalls, toolCallId } = {}) {
  assertId(conversationId, 'conversationId');
  withTransaction(() => {
    insert('assistant_messages', {
      conversation_id: conversationId,
      role,
      content: content ?? null,
      tool_calls: toolCalls || null,
      tool_call_id: toolCallId || null,
    });
    // Touch the conversation so it sorts to the top of the recent list.
    update('assistant_conversations', { updated_at: nowIso() }, { where: { id: conversationId } });
  });
}
