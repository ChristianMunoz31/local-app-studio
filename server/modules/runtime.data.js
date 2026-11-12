// Data contributed by the runtime module (tables, export defs, cloud categories, network features). Pure data: this
// file must not import anything that reaches server/db/ (tables.js loads it), but it may import server/appMode.js.
// Empty unless the runtime mode is active (getAppMode() === 'runtime') and the app has a spec.
import { getAppMode } from '../appMode.js';
import { runtimeToolCategories } from '@local-app-studio/runtime/server/toolNames.js';
import { getCompiledSpec } from '../spec/source.js';

/** @returns {import('./data.js').ModuleData} */
function buildRuntimeData() {
  const compiled = getAppMode() === 'runtime' ? getCompiledSpec() : null;
  if (!compiled) {
    return {
      id: 'runtime',
      tables: {},
      importOrder: [],
      foreignKeys: [],
      dataTables: [],
      cloudCategories: [],
      pageCategories: {},
      toolCategories: {},
      networkFeatures: [],
    };
  }
  const ids = [...compiled.importOrder];
  // table id to the tables its link fields point at: a tool of the table also carries those tables' titles.
  const references = {};
  for (const fk of compiled.foreignKeys ?? []) (references[fk.table] ??= []).push(fk.references.table);
  return {
    id: 'runtime',
    tables: compiled.tables,
    importOrder: ids,
    foreignKeys: compiled.foreignKeys,
    dataTables: compiled.dataTables,
    cloudCategories: compiled.categories,
    pageCategories: { app: null, data: ids.length ? [...ids] : null },
    toolCategories: runtimeToolCategories(ids, references),
    networkFeatures: [],
  };
}

const runtimeData = buildRuntimeData();

export default runtimeData;
