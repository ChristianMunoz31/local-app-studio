// Canonical Assistant tool names for runtime mode. Pure: no imports, so the data descriptor and the agent can share it.

export const RUNTIME_MODEL_TOOL_NAMES = Object.freeze(['describe_data', 'list_records', 'get_stats', 'save_record']);
export const RUNTIME_TABLE_VERBS = Object.freeze(['list_records', 'get_stats', 'save_record']);

/**
 * @param {string} verb one of RUNTIME_TABLE_VERBS
 * @param {string} table
 * @returns {string}
 */
export const runtimeToolName = (verb, table) => `${verb}__${table}`;

/**
 * { verb, table } for a canonical name whose table is in tableIds, else null.
 * @param {unknown} name
 * @param {readonly string[]} tableIds
 * @returns {{ verb: string, table: string } | null}
 */
export function parseRuntimeToolName(name, tableIds) {
  if (typeof name !== 'string' || !Array.isArray(tableIds)) return null;
  for (const verb of RUNTIME_TABLE_VERBS) {
    const prefix = `${verb}__`;
    if (!name.startsWith(prefix)) continue;
    const table = name.slice(prefix.length);
    if (tableIds.includes(table)) return { verb, table };
  }
  return null;
}

/**
 * describe_data: null; each canonical name: its table, plus the tables it references when `references` says so (a link
 * title, a match naming a linked record and a save by title all carry the linked table's data, so every one of those
 * categories must be shared); each generic verb: all tables (defense in depth).
 * @param {readonly string[]} tableIds
 * @param {Readonly<Record<string, readonly string[]>>} [references] table id to the table ids its link fields point at
 * @returns {Record<string, string | string[] | null>}
 */
export function runtimeToolCategories(tableIds, references = {}) {
  const ids = Array.isArray(tableIds) ? tableIds : [];
  /** @type {Record<string, string | string[] | null>} */
  const out = { describe_data: null };
  for (const verb of RUNTIME_TABLE_VERBS) {
    if (ids.length) out[verb] = [...ids];
    for (const table of ids) {
      const linked = [...new Set(references[table] ?? [])].filter((t) => t !== table && ids.includes(t));
      out[runtimeToolName(verb, table)] = linked.length === 0 ? table : [table, ...linked];
    }
  }
  return out;
}
