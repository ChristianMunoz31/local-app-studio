// Everything the modules contribute to the kit's frozen registries (TABLES, IMPORT_ORDER, FOREIGN_KEYS, DATA_TABLES,
// cloud categories, page and tool categories, network features). Each descriptor is pure data and is empty when
// its mode is not active. Kit files merge it once with mergeById/mergeRecords, which throw on a duplicate id.
import runtimeData from './runtime.data.js';
import studioData from './studio.data.js';

/** @typedef {'uuid'|'text'|'date'|'timestamptz'|'numeric'|'integer'|'real'|'boolean'|'jsonb'|'text[]'} ColType */
/** @typedef {{
 *   id: 'runtime' | 'studio',
 *   tables: Record<string, { primaryKey: string, autoNow: string[], columns: Record<string, ColType> }>,
 *   importOrder: string[],
 *   foreignKeys: Array<{ table: string, column: string, references: { table: string, column: 'id' }, onDelete: 'cascade' | 'set null' | 'restrict' }>,
 *   dataTables: Array<{ id: string, label: string, group: string, primaryKey?: string, columns: { name: string, type: ColType }[], redact?: 'app_state' }>,
 *   cloudCategories: Array<{ id: string, default: boolean, noun: string, plural: boolean }>,
 *   pageCategories: Record<string, string | string[] | null>,
 *   toolCategories: Record<string, string | string[] | null>,
 *   networkFeatures: Array<{ id: string, label: string, description: string, hosts: string[] }>,
 * }} ModuleData */

/** @type {ReadonlyArray<ModuleData>} */
export const MODULE_DATA = Object.freeze([runtimeData, studioData]);

/**
 * Own enumerable entries of every module's `key` record, merged. Throws when two modules (or a module and `existing`) use one name.
 * @param {'tables' | 'pageCategories' | 'toolCategories'} key
 * @param {Iterable<string>} [existing] names already taken by the kit
 * @returns {Record<string, any>}
 */
export function mergeRecords(key, existing = []) {
  const taken = new Set(existing);
  const out = {};
  for (const m of MODULE_DATA) {
    for (const [name, value] of Object.entries(m[key])) {
      if (taken.has(name)) throw new Error(`Duplicate ${key} entry "${name}" (module "${m.id}")`);
      taken.add(name);
      out[name] = value;
    }
  }
  return out;
}

/**
 * Every module's `key` list, concatenated in module order. Throws when an entry's `id` (or the string itself, for string lists) repeats.
 * @template T
 * @param {'importOrder' | 'foreignKeys' | 'dataTables' | 'cloudCategories' | 'networkFeatures'} key
 * @param {Iterable<string>} [existing] ids already taken by the kit
 * @returns {T[]}
 */
export function mergeLists(key, existing = []) {
  const taken = new Set(existing);
  const out = [];
  for (const m of MODULE_DATA) {
    for (const entry of m[key]) {
      const id = typeof entry === 'string' ? entry : (entry.id ?? `${entry.table}.${entry.column}`);
      if (taken.has(id)) throw new Error(`Duplicate ${key} entry "${id}" (module "${m.id}")`);
      taken.add(id);
      out.push(entry);
    }
  }
  return out;
}
