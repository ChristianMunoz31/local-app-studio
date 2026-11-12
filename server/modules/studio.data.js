// Data contributed by the studio module: the `apps` and `builds` tables (migration 003), the `studio_features` table
// (migration 004), their export defs. The module registers the `features` cloud category for the Studio Assistant's
// `list_features` tool; Describe stays local only. Pure data: this file must not
// import anything that reaches server/db/ (tables.js loads it), but it may import server/appMode.js.
// Empty when the studio mode is not active (getAppMode() !== 'studio'). Replaced by studio.data.disabled.js in a runtime build.
import { getAppMode } from '../appMode.js';

const APPS_COLUMNS = {
  id: 'uuid',
  name: 'text',
  slug: 'text',
  spec: 'jsonb',
  revision: 'integer',
  built_spec: 'jsonb',
  app_migrations: 'jsonb',
  created_at: 'timestamptz',
  updated_at: 'timestamptz',
};
const BUILDS_COLUMNS = {
  id: 'uuid',
  app_id: 'uuid',
  status: 'text',
  spec_revision: 'integer',
  app_version: 'text',
  started_at: 'timestamptz',
  finished_at: 'timestamptz',
  duration_ms: 'integer',
  installer_path: 'text',
  installer_sha256: 'text',
  error_code: 'text',
  message: 'text',
  created_at: 'timestamptz',
};
/** The `build` network feature: off by default, listed in studio mode only (the runtime descriptor returns none). */
const BUILD_NETWORK_FEATURE = Object.freeze({
  id: 'build',
  label: 'Allow downloads for builds',
  description: 'Needed once per build. Nothing about your apps or data is sent.',
  hosts: Object.freeze([
    'registry.npmjs.org',
    'crates.io',
    'index.crates.io',
    'static.crates.io',
    'github.com',
    'objects.githubusercontent.com',
    'release-assets.githubusercontent.com',
  ]),
});
const FEATURES_COLUMNS = {
  id: 'text',
  label: 'text',
  description: 'text',
  version: 'integer',
  body: 'jsonb',
  created_at: 'timestamptz',
  updated_at: 'timestamptz',
};
const toCols = (o) => Object.entries(o).map(([name, type]) => ({ name, type }));

/** @type {import('./data.js').ModuleData} */
const EMPTY = {
  id: 'studio',
  tables: {},
  importOrder: [],
  foreignKeys: [],
  dataTables: [],
  cloudCategories: [],
  pageCategories: {},
  toolCategories: {},
  networkFeatures: [],
};

/** @type {import('./data.js').ModuleData} */
const studioData =
  getAppMode() === 'studio'
    ? {
        id: 'studio',
        tables: {
          apps: { primaryKey: 'id', autoNow: ['created_at', 'updated_at'], columns: APPS_COLUMNS },
          builds: { primaryKey: 'id', autoNow: ['created_at'], columns: BUILDS_COLUMNS },
          studio_features: { primaryKey: 'id', autoNow: ['created_at', 'updated_at'], columns: FEATURES_COLUMNS },
        },
        importOrder: ['apps', 'builds', 'studio_features'],
        foreignKeys: [{ table: 'builds', column: 'app_id', references: { table: 'apps', column: 'id' }, onDelete: 'cascade' }],
        dataTables: [
          { id: 'apps', label: 'Apps', group: 'Studio', primaryKey: 'id', columns: toCols(APPS_COLUMNS) },
          { id: 'builds', label: 'Builds', group: 'Studio', primaryKey: 'id', columns: toCols(BUILDS_COLUMNS) },
          { id: 'studio_features', label: 'Features', group: 'Studio', primaryKey: 'id', columns: toCols(FEATURES_COLUMNS) },
        ],
        cloudCategories: [{ id: 'features', default: true, noun: 'saved features', plural: true }],
        pageCategories: {},
        toolCategories: { list_features: 'features' },
        networkFeatures: [BUILD_NETWORK_FEATURE],
      }
    : EMPTY;

export default studioData;
