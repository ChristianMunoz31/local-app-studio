-- Schema v2: the example "Items" module. Copy this file's shape for your own tables: add a new
-- NNN_name.sql, never edit a shipped one (the sha256 lock in migrations.lock.json enforces it).

CREATE TABLE items (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  unit_cost REAL NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX items_category_idx ON items (category);
CREATE INDEX items_created_idx ON items (created_at DESC);
