-- Schema v3: Local App Studio's own tables. `apps` holds each app's draft AppSpec, a revision counter for
-- optimistic concurrency, the spec it was last built from and the app-track migrations already shipped
-- (docs/ARCHITECTURE_DECISIONS.md ADR-004). `builds` is the build history, written from phase 4 on.
-- Both tables also exist, empty, in every built app; a built app never lists them in TABLES.
-- JSON columns are TEXT holding JSON (codec type jsonb). Shipped migrations are immutable: add 004.

CREATE TABLE apps (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  slug TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 2 AND 40 AND slug NOT GLOB '*[^a-z0-9-]*'),
  spec TEXT NOT NULL CHECK (json_valid(spec) AND length(spec) <= 1048576),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  built_spec TEXT CHECK (built_spec IS NULL OR (json_valid(built_spec) AND length(built_spec) <= 1048576)),
  app_migrations TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(app_migrations) AND json_type(app_migrations) = 'array'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX apps_updated_idx ON apps (updated_at DESC);

CREATE TABLE builds (
  id TEXT PRIMARY KEY NOT NULL,
  app_id TEXT NOT NULL REFERENCES apps (id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted')),
  spec_revision INTEGER CHECK (spec_revision IS NULL OR spec_revision >= 1),
  app_version TEXT CHECK (app_version IS NULL OR length(app_version) <= 20),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  installer_path TEXT CHECK (installer_path IS NULL OR length(installer_path) <= 1024),
  installer_sha256 TEXT CHECK (installer_sha256 IS NULL OR (length(installer_sha256) = 64 AND installer_sha256 NOT GLOB '*[^0-9a-f]*')),
  error_code TEXT CHECK (error_code IS NULL OR (length(error_code) BETWEEN 1 AND 40 AND error_code NOT GLOB '*[^a-z0-9_]*')),
  message TEXT CHECK (message IS NULL OR length(message) <= 2000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX builds_app_idx ON builds (app_id, started_at DESC);
CREATE INDEX builds_status_idx ON builds (status);
