// Column-type map: the single source of truth for the codec and the query helper.
// ColType = 'uuid'|'text'|'date'|'timestamptz'|'numeric'|'integer'|'real'|'boolean'|'jsonb'|'text[]'
import { DbError } from './errors.js';
import { mergeLists, mergeRecords } from '../modules/data.js';

const table = (primaryKey, autoNow, columns) =>
  Object.freeze({
    primaryKey,
    autoNow: Object.freeze(autoNow),
    columns: Object.freeze(columns),
  });

// Kit tables first, then whatever the active modules contribute (server/modules/*.data.js; a duplicate name throws).
const KIT_TABLES = {
  app_state: table('key', ['updated_at'], {
    key: 'text', value: 'jsonb', updated_at: 'timestamptz',
  }),
  assistant_conversations: table('id', ['created_at', 'updated_at'], {
    id: 'uuid', title: 'text', created_at: 'timestamptz', updated_at: 'timestamptz',
  }),
  assistant_messages: table('id', ['created_at'], {
    id: 'uuid', conversation_id: 'uuid', role: 'text', content: 'text', tool_calls: 'jsonb',
    tool_call_id: 'text', created_at: 'timestamptz',
  }),
  app_secrets: table('name', ['updated_at'], {
    name: 'text', ciphertext: 'text', iv: 'text', auth_tag: 'text', last4: 'text', updated_at: 'timestamptz',
  }),
  audit_log: table('id', ['created_at'], {
    id: 'uuid', created_at: 'timestamptz', kind: 'text', feature: 'text', page: 'text', provider: 'text',
    model: 'text', status: 'text', context: 'text', meta: 'jsonb',
  }),
};

const MODULE_TABLES = mergeRecords('tables', Object.keys(KIT_TABLES));

export const TABLES = Object.freeze({
  ...KIT_TABLES,
  ...Object.fromEntries(
    Object.entries(MODULE_TABLES).map(([name, t]) => [name, table(t.primaryKey, [...t.autoNow], { ...t.columns })]),
  ),
});

// FK parents first. Exactly the exportable/importable tables (no app_secrets, no audit_log).
// Add your own tables here, parents before children.
const KIT_IMPORT_ORDER = ['app_state', 'assistant_conversations', 'assistant_messages'];
export const IMPORT_ORDER = Object.freeze([...KIT_IMPORT_ORDER, ...mergeLists('importOrder', KIT_IMPORT_ORDER)]);

const fk = (tbl, column, refTable, onDelete) =>
  Object.freeze({
    table: tbl,
    column,
    references: Object.freeze({ table: refTable, column: 'id' }),
    onDelete,
  });

export const FOREIGN_KEYS = Object.freeze([
  fk('assistant_messages', 'conversation_id', 'assistant_conversations', 'cascade'),
  ...mergeLists('foreignKeys').map((k) => fk(k.table, k.column, k.references.table, k.onDelete)),
]);

/**
 * Returns the table definition; throws DbError('unknown_table') for anything not in TABLES.
 * @param {string} name
 */
export function getTable(name) {
  if (typeof name !== 'string' || !Object.hasOwn(TABLES, name)) {
    throw new DbError('unknown_table', 'Unknown table');
  }
  return TABLES[name];
}

/**
 * @param {string} tableName
 * @param {string} column
 * @returns {boolean}
 */
export function hasColumn(tableName, column) {
  return (
    typeof tableName === 'string' &&
    Object.hasOwn(TABLES, tableName) &&
    typeof column === 'string' &&
    Object.hasOwn(TABLES[tableName].columns, column)
  );
}
