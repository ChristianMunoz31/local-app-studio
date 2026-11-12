// Strict allowlist of the user-data tables the app exports and describes to the user (restore preview,
// export manifest). A table name reaches the db query helper ONLY as `def.id` from this list (the
// helper re-validates it against TABLES). app_secrets and audit_log are deliberately absent.
// Add one def per table you want exported: keep it in step with IMPORT_ORDER in server/db/tables.js.
import { mergeLists } from './modules/data.js';

/** @typedef {'uuid'|'text'|'date'|'timestamptz'|'numeric'|'integer'|'real'|'boolean'|'jsonb'|'text[]'} ColType */
/** @typedef {{ id: string, label: string, group: string, primaryKey: string,
 *   columns: { name: string, type: ColType }[], redact?: 'app_state' }} DataTableDef */

const cols = (spec) =>
  Object.freeze(
    spec.split(',').map((pair) => {
      const [name, type] = pair.trim().split(':');
      return Object.freeze({ name, type });
    }),
  );

const def = (d) => Object.freeze({ primaryKey: 'id', ...d });

/** @type {ReadonlyArray<DataTableDef>} */
export const DATA_TABLES = Object.freeze([
  def({
    id: 'assistant_conversations',
    label: 'Assistant conversations',
    group: 'Assistant',
    columns: cols('id:uuid,title:text,created_at:timestamptz,updated_at:timestamptz'),
  }),
  def({
    id: 'assistant_messages',
    label: 'Assistant messages',
    group: 'Assistant',
    columns: cols('id:uuid,conversation_id:uuid,role:text,content:text,tool_calls:jsonb,tool_call_id:text,created_at:timestamptz'),
  }),
  def({
    id: 'app_state',
    label: 'Preferences',
    group: 'Preferences',
    primaryKey: 'key',
    columns: cols('key:text,value:jsonb,updated_at:timestamptz'),
    redact: 'app_state',
  }),
  // Tables the active modules contribute (server/modules/*.data.js), after the kit's; a duplicate id throws.
  ...mergeLists('dataTables', ['assistant_conversations', 'assistant_messages', 'app_state']).map((t) =>
    def({ ...t, columns: Object.freeze(t.columns.map((c) => Object.freeze({ ...c }))) }),
  ),
]);

const BY_ID = new Map(DATA_TABLES.map((t) => [t.id, t]));

/** @param {unknown} id @returns {DataTableDef | undefined} */
export const getTableDef = (id) => (typeof id === 'string' ? BY_ID.get(id) : undefined);
