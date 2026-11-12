-- Schema v4: Local App Studio's feature library (docs/FEATURES.md, ADR-007) replaces the kit's example
-- Items module. `studio_features` holds custom features; `body` is JSON { params, fragment, bindings }.
-- The table also exists, empty, in every built app (like apps and builds); a built app never lists it in TABLES.
-- items is dropped: the pre-migration .bak (app.db.pre-v<latest>.bak, named for the newest migration) keeps any old rows. 002_items.sql stays as shipped.
-- Shipped migrations are immutable: add 005.

CREATE TABLE studio_features (
  id TEXT PRIMARY KEY NOT NULL CHECK (
    length(id) BETWEEN 1 AND 31
    AND substr(id, 1, 1) BETWEEN 'a' AND 'z'
    AND id NOT GLOB '*[^a-z0-9_]*'
  ),
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 40),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 160),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  body TEXT NOT NULL CHECK (json_valid(body) AND json_type(body) = 'object' AND length(body) <= 65536),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX studio_features_updated_idx ON studio_features (updated_at DESC);

DROP TABLE items;
