// Full text search index DDL for the app track (ADR-016). Pure and deterministic like sql.js: LF only, identifiers from a
// spec that passed checkSpecShape, always double-quoted. One FTS5 table "fts:<tableId>" per spec table that has a text or
// longtext field. It is an external content index over the table (trigram tokenizer, so a search stays a substring
// "contains"), kept in step by three triggers, so no write path needs code of its own.
import { fileText, quoteId, quoteText, tableBlock } from './sql.js';

// Field ids FTS5 reserves as column names; a field with one of these stays on the LIKE path.
const RESERVED_FTS_COLUMNS = new Set(['rank', 'rowid']);

/** @param {string} tableId @returns {string} the FTS5 table name */
export const ftsTableName = (tableId) => `fts:${tableId}`;

/** @param {string} tableId @param {'ai' | 'ad' | 'au'} kind @returns {string} a trigger name */
export const ftsTriggerName = (tableId, kind) => `fts:${tableId}:${kind}`;

/**
 * The field ids the index covers, in field order: the text and longtext fields (what the data API may search).
 * @param {{ fields: Array<{ id: string, type: string }> }} table
 * @returns {string[]}
 */
export const ftsColumns = (table) =>
  table.fields.filter((f) => (f.type === 'text' || f.type === 'longtext') && !RESERVED_FTS_COLUMNS.has(f.id)).map((f) => f.id);

/**
 * True when a field of this type adds a column to the index.
 * @param {{ id: string, type: string }} field
 * @returns {boolean}
 */
export const isFtsField = (field) => ftsColumns({ fields: [field] }).length === 1;

/**
 * CREATE VIRTUAL TABLE plus the three triggers; empty when the table has nothing to index.
 * @param {{ id: string, fields: object[] }} table
 * @param {{ ifNotExists?: boolean }} [opts] ifNotExists: idempotent statements, for the script a start applies (ftsSqlText)
 * @returns {string[]}
 */
export function createFtsStatements(table, { ifNotExists = false } = {}) {
  const guard = ifNotExists ? 'IF NOT EXISTS ' : '';
  const cols = ftsColumns(table);
  if (cols.length === 0) return [];
  const fts = quoteId(ftsTableName(table.id));
  const base = quoteId(table.id);
  const list = cols.map(quoteId).join(', ');
  const ofNew = cols.map((c) => `new.${quoteId(c)}`).join(', ');
  const ofOld = cols.map((c) => `old.${quoteId(c)}`).join(', ');
  const forget = `INSERT INTO ${fts}(${quoteId(ftsTableName(table.id))}, rowid, ${list}) VALUES ('delete', old.rowid, ${ofOld});`;
  const remember = `INSERT INTO ${fts}(rowid, ${list}) VALUES (new.rowid, ${ofNew});`;
  return [
    `CREATE VIRTUAL TABLE ${guard}${fts} USING fts5(${list}, content=${quoteText(table.id)}, content_rowid='rowid', tokenize='trigram case_sensitive 0');`,
    `CREATE TRIGGER ${guard}${quoteId(ftsTriggerName(table.id, 'ai'))} AFTER INSERT ON ${base} BEGIN\n  ${remember}\nEND;`,
    `CREATE TRIGGER ${guard}${quoteId(ftsTriggerName(table.id, 'ad'))} AFTER DELETE ON ${base} BEGIN\n  ${forget}\nEND;`,
    `CREATE TRIGGER ${guard}${quoteId(ftsTriggerName(table.id, 'au'))} AFTER UPDATE OF ${list} ON ${base} BEGIN\n  ${forget}\n  ${remember}\nEND;`,
  ];
}

/**
 * DROP statements for the triggers and the index (IF EXISTS: an app built before the index has none).
 * @param {{ id: string }} table
 * @returns {string[]}
 */
export const dropFtsStatements = (table) => [
  ...['ai', 'ad', 'au'].map((k) => `DROP TRIGGER IF EXISTS ${quoteId(ftsTriggerName(table.id, k))};`),
  `DROP TABLE IF EXISTS ${quoteId(ftsTableName(table.id))};`,
];

/**
 * Drop, create and fill the index again, for a table whose columns or rowids changed. Empty when nothing is indexed.
 * @param {{ id: string, fields: object[] }} table the table as it will be
 * @param {{ drop?: boolean }} [opts] drop: false when the caller already dropped the old index (a table rebuild)
 * @returns {string[]}
 */
export function recreateFtsStatements(table, { drop = true } = {}) {
  if (ftsColumns(table).length === 0) return [];
  const fts = quoteId(ftsTableName(table.id));
  return [...(drop ? dropFtsStatements(table) : []), ...createFtsStatements(table), `INSERT INTO ${fts}(${fts}) VALUES ('rebuild');`];
}

/**
 * CREATE TABLE, its indexes (reference and derived) and its full text index (a new, empty table: nothing to fill).
 * @param {{ id: string, fields: object[] }} table
 * @param {string[]} [derived] derived index fields of the table (indexes.js)
 * @returns {string}
 */
export const tableBlockWithFts = (table, derived = []) => [tableBlock(table, derived), ...createFtsStatements(table)].join('\n');

/**
 * The full create script of a first build (tables in import order): each table, its indexes and its full text index.
 * Not compileSpec's createSql, which stays what it was before indexes existed (hashes of it are stored).
 * @param {Array<{ id: string, fields: object[] }>} tablesInOrder
 * @param {Map<string, string[]>} [derived] table id to derived index fields (indexes.js)
 * @returns {string}
 */
export const createScriptText = (tablesInOrder, derived = new Map()) =>
  fileText('create', tablesInOrder.map((t) => tableBlockWithFts(t, derived.get(t.id) ?? [])));

/**
 * The full text indexes of a whole spec as a script of idempotent statements (ADR-016), apart from createSql like indexSql.
 * Applying it again changes nothing; filling an index it just created is the caller's job (applyFtsIndexes in migrate.js).
 * @param {Array<{ id: string, fields: object[] }>} tablesInOrder
 * @returns {string} the statements, one per line group, one final newline; '' when no table has a text field
 */
export function ftsSqlText(tablesInOrder) {
  const lines = tablesInOrder.flatMap((t) => createFtsStatements(t, { ifNotExists: true }));
  return lines.length ? `${lines.join('\n')}\n` : '';
}

/**
 * The FTS5 table names a script from ftsSqlText creates.
 * @param {string} sql
 * @returns {string[]}
 */
export const ftsTablesIn = (sql) => [...sql.matchAll(/^CREATE VIRTUAL TABLE IF NOT EXISTS "((?:[^"]|"")+)"/gm)].map((m) => m[1].replaceAll('""', '"'));
