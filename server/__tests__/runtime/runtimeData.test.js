// runtime.data.js and toolNames.js in runtime mode with the Crew Roster fixture.
import { afterAll, describe, expect, it, vi } from 'vitest';
import path from 'node:path';

vi.hoisted(() => {
  process.env.APP_MODE = 'runtime';
  process.env.APP_SPEC_PATH = new URL('../../../packages/runtime/src/spec/fixtures/crew-roster.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
});
afterAll(() => {
  delete process.env.APP_MODE;
  delete process.env.APP_SPEC_PATH;
});

const { default: runtimeData } = await import('../../modules/runtime.data.js');
const { DATA_TABLES } = await import('../../dataTables.js');
const { FOREIGN_KEYS, IMPORT_ORDER, TABLES, openDb } = await import('../../db/index.js');
const { getAppSpec, getCompiledSpec } = await import('../../spec/source.js');
const tn = await import('@local-app-studio/runtime/server/toolNames.js');

describe('runtime data descriptor', () => {
  it('carries the compiled spec', () => {
    expect(path.isAbsolute(process.env.APP_SPEC_PATH)).toBe(true);
    expect(getAppSpec().app.name).toBe('Crew Roster');
    const c = getCompiledSpec();
    expect(runtimeData.id).toBe('runtime');
    expect(Object.keys(runtimeData.tables)).toEqual(['people', 'crews']);
    expect(runtimeData.importOrder).toEqual(['people', 'crews']);
    expect(runtimeData.foreignKeys).toEqual(c.foreignKeys);
    expect(runtimeData.cloudCategories.map((x) => x.id)).toEqual(['people', 'crews']);
    expect(runtimeData.pageCategories).toEqual({ app: null, data: ['people', 'crews'] });
    expect(runtimeData.toolCategories.describe_data).toBeNull();
    expect(runtimeData.toolCategories.list_records__crews).toEqual(['crews', 'people']);
    expect(runtimeData.toolCategories.save_record).toEqual(['people', 'crews']);
    expect(runtimeData.networkFeatures).toEqual([]);
  });

  it('reaches the kit registries', () => {
    expect(Object.hasOwn(TABLES, 'crews')).toBe(true);
    expect(IMPORT_ORDER.slice(-2)).toEqual(['people', 'crews']);
    expect(FOREIGN_KEYS.some((f) => f.table === 'crews' && f.onDelete === 'set null')).toBe(true);
    expect(DATA_TABLES.find((d) => d.id === 'crews').group).toBe('Crew Roster');
  });

  it('the in-memory 001 creates the spec tables', () => {
    const db = openDb({ filename: ':memory:' });
    expect(db.prepare('SELECT version FROM app_schema_version').all()).toEqual([{ version: 1 }]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM "crews"').get().n).toBe(0);
    db.close();
  });
});

describe('toolNames', () => {
  const ids = ['people', 'crews'];

  it('names and parses canonical tools', () => {
    expect(tn.RUNTIME_MODEL_TOOL_NAMES).toEqual(['describe_data', 'list_records', 'get_stats', 'save_record']);
    expect(tn.RUNTIME_TABLE_VERBS).toEqual(['list_records', 'get_stats', 'save_record']);
    expect(tn.runtimeToolName('get_stats', 'crews')).toBe('get_stats__crews');
    expect(tn.parseRuntimeToolName('save_record__crews', ids)).toEqual({ verb: 'save_record', table: 'crews' });
    expect(tn.parseRuntimeToolName('save_record__ghosts', ids)).toBeNull();
    expect(tn.parseRuntimeToolName('save_record', ids)).toBeNull();
    expect(tn.parseRuntimeToolName(42, ids)).toBeNull();
  });

  it('maps every tool to its category', () => {
    const cats = tn.runtimeToolCategories(ids);
    expect(cats.describe_data).toBeNull();
    expect(cats.get_stats__people).toBe('people');
    expect(cats.list_records).toEqual(ids);
    expect(tn.runtimeToolCategories([])).toEqual({ describe_data: null });
    const linked = tn.runtimeToolCategories(['people', 'crews'], { crews: ['people', 'people', 'crews', 'ghost'] });
    expect(linked.list_records__crews).toEqual(['crews', 'people']);
    expect(linked.save_record__people).toBe('people');
  });
});
