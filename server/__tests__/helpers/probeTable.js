// A synthetic table for tests of the generic db layer, export and import. The kit ships no example module table, so
// a test that needs a "normal" user table adds this one: vi.mock the studio descriptor with withProbeTable (the
// vi.mock factory below), and createTestDb() creates the table. It exists only in the test that mocks it.
export const PROBE_TABLE = 'probe_items';

export const PROBE_COLUMNS = Object.freeze({
  id: 'uuid',
  name: 'text',
  category: 'text',
  quantity: 'integer',
  unit_cost: 'real',
  status: 'text',
  notes: 'text',
  created_at: 'timestamptz',
});

export const PROBE_DDL = `CREATE TABLE IF NOT EXISTS ${PROBE_TABLE} (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  unit_cost REAL NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX IF NOT EXISTS probe_items_category_idx ON ${PROBE_TABLE} (category);
CREATE INDEX IF NOT EXISTS probe_items_created_idx ON ${PROBE_TABLE} (created_at DESC);`;

/**
 * For `vi.mock('../modules/studio.data.js', (orig) => withProbeTable(orig))`: the real descriptor plus the probe table
 * (registered, exported and imported first, like a kit table).
 * @param {() => Promise<{ default: object }>} importOriginal
 */
export async function withProbeTable(importOriginal) {
  const real = (await importOriginal()).default;
  return {
    default: {
      ...real,
      tables: { ...real.tables, [PROBE_TABLE]: { primaryKey: 'id', autoNow: ['created_at'], columns: { ...PROBE_COLUMNS } } },
      importOrder: [PROBE_TABLE, ...real.importOrder],
      dataTables: [
        {
          id: PROBE_TABLE,
          label: 'Probe items',
          group: 'Probe',
          primaryKey: 'id',
          columns: Object.entries(PROBE_COLUMNS).map(([name, type]) => ({ name, type })),
        },
        ...real.dataTables,
      ],
    },
  };
}
