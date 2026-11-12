// The module registry (docs/OWNERSHIP.md): descriptors are empty in phase 1, so the kit's registries are exactly what
// they were; a non-empty descriptor is merged once; a duplicate id throws at import.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SERVER_MODULES,
  activeServerModules,
  isModuleBudgetPath,
  moduleNoStorePaths,
  startServerModules,
  stopServerModules,
} from '../../modules/index.js';
import { MODULE_DATA } from '../../modules/data.js';
import studioData from '../../modules/studio.data.js';
import { TABLES, IMPORT_ORDER, FOREIGN_KEYS } from '../../db/tables.js';
import { DATA_TABLES } from '../../dataTables.js';
import { CLOUD_CATEGORY_IDS, CLOUD_CATEGORY_DEFAULTS, CATEGORY_NOUNS, PAGE_CATEGORIES, TOOL_CATEGORIES } from '../../ai/privacy.js';
import { NETWORK_FEATURES } from '../../netPolicy.js';
import { ASSISTANT_PAGE_LABELS } from '../../assistant/pages.js';

const EMPTY = (id) => ({
  id,
  tables: {},
  importOrder: [],
  foreignKeys: [],
  dataTables: [],
  cloudCategories: [],
  pageCategories: {},
  toolCategories: {},
  networkFeatures: [],
});

describe('the registries with empty descriptors (studio mode)', () => {
  it('the runtime descriptor is empty and the studio one is the Studio data descriptor', () => {
    expect(MODULE_DATA.map((m) => m.id)).toEqual(['runtime', 'studio']);
    const [runtime, studio] = MODULE_DATA;
    expect(runtime).toEqual(EMPTY('runtime'));
    expect(studio.tables).toEqual(studioData.tables);
    expect(studio.importOrder).toEqual(studioData.importOrder);
    expect(studio.foreignKeys).toEqual(studioData.foreignKeys);
    expect(studio.cloudCategories).toEqual(studioData.cloudCategories);
    expect(studio.pageCategories).toEqual({});
    expect(studio.toolCategories).toEqual({ list_features: 'features' });
    expect(studio.networkFeatures.map((f) => f.id)).toEqual(['build']);
  });

  it('TABLES, IMPORT_ORDER, FOREIGN_KEYS and DATA_TABLES are the kit ones plus the Studio tables', () => {
    expect(Object.keys(TABLES)).toEqual(['app_state', 'assistant_conversations', 'assistant_messages', 'app_secrets', 'audit_log', 'apps', 'builds', 'studio_features']);
    expect([...IMPORT_ORDER]).toEqual(['app_state', 'assistant_conversations', 'assistant_messages', 'apps', 'builds', 'studio_features']);
    expect(FOREIGN_KEYS).toHaveLength(2);
    expect(FOREIGN_KEYS.at(-1)).toMatchObject({ table: 'builds', column: 'app_id', onDelete: 'cascade' });
    expect(DATA_TABLES.map((t) => t.id)).toEqual(['assistant_conversations', 'assistant_messages', 'app_state', 'apps', 'builds', 'studio_features']);
  });

  it('privacy categories and tool map are the Studio ones, the kit adds none', () => {
    expect([...CLOUD_CATEGORY_IDS]).toEqual(['features']);
    expect(CLOUD_CATEGORY_DEFAULTS).toEqual({ features: true });
    expect(Object.keys(CATEGORY_NOUNS)).toEqual(['features']);
    expect(Object.keys(PAGE_CATEGORIES)).toEqual(['home', 'settings']);
    expect(Object.keys(TOOL_CATEGORIES)).toEqual(['list_features']);
  });

  it('network features are the kit ones plus build, and the Assistant pages are the kit ones', () => {
    expect(NETWORK_FEATURES.map((f) => f.id)).toEqual(['cloudAi', 'aiLan', 'updates', 'license', 'build']);
    expect(Object.keys(ASSISTANT_PAGE_LABELS)).toEqual(['home', 'settings']);
  });
});

describe('server module descriptors', () => {
  it('lists runtime and studio, each active in its own mode only', () => {
    expect(SERVER_MODULES.map((m) => m.id)).toEqual(['runtime', 'studio']);
    expect(activeServerModules('studio').map((m) => m.id)).toEqual(['studio']);
    expect(activeServerModules('runtime').map((m) => m.id)).toEqual(['runtime']);
  });

  it('declares the no-store paths and the /api/data budget', () => {
    const [runtime, studio] = SERVER_MODULES;
    expect(runtime.noStorePaths).toEqual(['/api/data']);
    expect(runtime.limiters).toEqual([{ path: '/api/data', windowMs: 900000, max: 3000 }]);
    expect(studio.noStorePaths).toEqual(['/api/studio', '/api/preview']);
    expect(studio.limiters).toEqual([
      { path: '/api/studio', windowMs: 900000, max: 1200 },
      { path: '/api/preview', windowMs: 900000, max: 3000 },
    ]);
    expect(moduleNoStorePaths()).toEqual(['/api/studio', '/api/preview']);
  });

  it('isModuleBudgetPath follows the mode', () => {
    expect(isModuleBudgetPath({ baseUrl: '/api', path: '/data/crews' }, 'runtime')).toBe(true);
    expect(isModuleBudgetPath({ baseUrl: '/api', path: '/data/crews' }, 'studio')).toBe(false);
    expect(isModuleBudgetPath({ baseUrl: '/api', path: '/preview/data/x' }, 'studio')).toBe(true);
  });

  it('runs start and stop hooks of the active modules and survives a failing hook', async () => {
    const calls = [];
    const studio = SERVER_MODULES[1];
    const { onStart, onStop } = studio;
    studio.onStart = async () => {
      calls.push('start');
      throw new Error('boom');
    };
    studio.onStop = () => {
      calls.push('stop');
    };
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(startServerModules()).resolves.toBeUndefined();
      await expect(stopServerModules()).resolves.toBeUndefined();
      expect(calls).toEqual(['start', 'stop']);
      expect(log).toHaveBeenCalledWith('Module studio failed to start:', 'Error');
    } finally {
      studio.onStart = onStart;
      studio.onStop = onStop;
      log.mockRestore();
    }
  });
});

describe('merging non-empty descriptors', () => {
  afterEach(() => {
    vi.doUnmock('../../modules/runtime.data.js');
    vi.doUnmock('../../modules/studio.data.js');
    vi.resetModules();
  });

  const crews = {
    ...EMPTY('runtime'),
    tables: { crews: { primaryKey: 'id', autoNow: ['created_at', 'updated_at'], columns: { id: 'uuid', name: 'text', created_at: 'timestamptz', updated_at: 'timestamptz' } } },
    importOrder: ['crews'],
    foreignKeys: [{ table: 'crews', column: 'lead_id', references: { table: 'people', column: 'id' }, onDelete: 'set null' }],
    dataTables: [{ id: 'crews', label: 'Crews', group: 'Crew Roster', columns: [{ name: 'id', type: 'uuid' }, { name: 'name', type: 'text' }] }],
    cloudCategories: [{ id: 'crews', default: false, noun: 'crews', plural: true }],
    pageCategories: { app: null },
    toolCategories: { list_crews: 'crews' },
    networkFeatures: [{ id: 'build', label: 'App builds', description: 'Builds apps.', hosts: ['registry.npmjs.org'] }],
  };

  it('adds tables, import order, foreign keys, export defs, categories and features after the kit ones', async () => {
    vi.resetModules();
    vi.doMock('../../modules/runtime.data.js', () => ({ default: crews }));
    vi.doMock('../../modules/studio.data.js', () => ({ default: EMPTY('studio') }));
    const tables = await import('../../db/tables.js');
    const dataTables = await import('../../dataTables.js');
    const privacy = await import('../../ai/privacy.js');
    const net = await import('../../netPolicy.js');
    expect(Object.keys(tables.TABLES).at(-1)).toBe('crews');
    expect(Object.isFrozen(tables.TABLES.crews)).toBe(true);
    expect([...tables.IMPORT_ORDER].at(-1)).toBe('crews');
    expect(tables.FOREIGN_KEYS.at(-1)).toMatchObject({ table: 'crews', column: 'lead_id', onDelete: 'set null' });
    expect(dataTables.DATA_TABLES.at(-1)).toMatchObject({ id: 'crews', primaryKey: 'id' });
    expect([...privacy.CLOUD_CATEGORY_IDS]).toEqual(['crews']);
    expect(privacy.CLOUD_CATEGORY_DEFAULTS.crews).toBe(false);
    expect(privacy.CATEGORY_NOUNS.crews).toEqual({ noun: 'crews', plural: true });
    expect(privacy.PAGE_CATEGORIES.app).toBeNull();
    expect(privacy.TOOL_CATEGORIES.list_crews).toBe('crews');
    expect(net.NETWORK_FEATURES.map((f) => f.id)).toEqual(['cloudAi', 'aiLan', 'updates', 'license', 'build']);
  });

  it('throws at import when a module reuses a kit table name', async () => {
    vi.resetModules();
    vi.doMock('../../modules/studio.data.js', () => ({ default: { ...EMPTY('studio'), tables: { app_state: crews.tables.crews } } }));
    await expect(import('../../db/tables.js')).rejects.toThrow(/Duplicate tables entry "app_state"/);
  });

  it('throws at import when two modules contribute the same id', async () => {
    vi.resetModules();
    vi.doMock('../../modules/runtime.data.js', () => ({ default: crews }));
    vi.doMock('../../modules/studio.data.js', () => ({ default: { ...EMPTY('studio'), importOrder: ['crews'] } }));
    await expect(import('../../db/tables.js')).rejects.toThrow(/Duplicate importOrder entry "crews"/);
  });

  it('throws at import when a module reuses a cloud category, a network feature or an export def id', async () => {
    vi.resetModules();
    vi.doMock('../../modules/runtime.data.js', () => ({ default: { ...EMPTY('runtime'), cloudCategories: [{ id: 'features', default: true, noun: 'x', plural: true }] } }));
    vi.doMock('../../modules/studio.data.js', () => ({ default: { ...EMPTY('studio'), cloudCategories: [{ id: 'features', default: true, noun: 'x', plural: true }] } }));
    await expect(import('../../ai/privacy.js')).rejects.toThrow(/Duplicate cloudCategories entry "features"/);
    vi.resetModules();
    vi.doMock('../../modules/studio.data.js', () => ({ default: { ...EMPTY('studio'), networkFeatures: [{ id: 'updates', label: 'x', description: 'x', hosts: [] }] } }));
    await expect(import('../../netPolicy.js')).rejects.toThrow(/Duplicate networkFeatures entry "updates"/);
    vi.resetModules();
    vi.doMock('../../modules/studio.data.js', () => ({ default: { ...EMPTY('studio'), dataTables: [{ id: 'app_state', label: 'x', group: 'x', columns: [] }] } }));
    await expect(import('../../dataTables.js')).rejects.toThrow(/Duplicate dataTables entry "app_state"/);
  });
});
