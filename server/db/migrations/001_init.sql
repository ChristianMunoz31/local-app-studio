-- Schema v1: the foundation tables every app built on the kit needs.
-- Timestamps: TEXT 'YYYY-MM-DDTHH:MM:SS.sssZ'. Dates: TEXT 'YYYY-MM-DD'. Booleans: INTEGER 0/1.
-- JSON (jsonb / text[]): TEXT holding JSON. ids: TEXT uuid generated in JS.

CREATE TABLE app_state (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL CHECK (json_valid(value)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE assistant_conversations (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE assistant_messages (
  id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES assistant_conversations (id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT,
  tool_calls TEXT CHECK (tool_calls IS NULL OR json_valid(tool_calls)),
  tool_call_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX assistant_messages_conv_idx ON assistant_messages (conversation_id, created_at);

-- AES-256-GCM ciphertext only; plaintext never stored. Never exported.
CREATE TABLE app_secrets (
  name TEXT PRIMARY KEY NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  last4 TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- was: name ~ '^[A-Z][A-Z0-9_]{1,63}$'
  CONSTRAINT app_secrets_name_chk CHECK (
    length(name) BETWEEN 2 AND 64
    AND substr(name, 1, 1) BETWEEN 'A' AND 'Z'
    AND name NOT GLOB '*[^A-Z0-9_]*'
  ),
  CONSTRAINT app_secrets_last4_chk CHECK (length(last4) BETWEEN 1 AND 4)
) STRICT;

-- Access & AI audit log. Redacted, size-capped context only. Pruned to 90 days / 5,000 rows.
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  kind TEXT NOT NULL,
  feature TEXT NOT NULL,
  page TEXT,
  provider TEXT,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'ok',
  context TEXT,
  meta TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta)),
  CONSTRAINT audit_log_kind_chk CHECK (kind IN ('llm', 'export', 'auth')),
  CONSTRAINT audit_log_status_chk CHECK (status IN ('ok', 'error')),
  -- was: feature ~ '^[a-z0-9_]{1,40}$'
  CONSTRAINT audit_log_feature_chk CHECK (length(feature) BETWEEN 1 AND 40 AND feature NOT GLOB '*[^a-z0-9_]*'),
  CONSTRAINT audit_log_page_len_chk CHECK (page IS NULL OR length(page) <= 40),
  CONSTRAINT audit_log_provider_len_chk CHECK (provider IS NULL OR length(provider) <= 20),
  CONSTRAINT audit_log_model_len_chk CHECK (model IS NULL OR length(model) <= 80),
  CONSTRAINT audit_log_context_len_chk CHECK (context IS NULL OR length(context) <= 2000)
) STRICT;
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);
