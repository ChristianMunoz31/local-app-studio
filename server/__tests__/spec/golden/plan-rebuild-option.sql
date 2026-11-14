-- app-migration: rebuild
-- Generated from the app spec by Local App Studio. Do not edit.

CREATE TABLE "crews:new" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL CHECK (length("name") <= 500),
  "size" INTEGER DEFAULT 1,
  "lead_id" TEXT REFERENCES "people" ("id") ON DELETE SET NULL,
  "status" TEXT DEFAULT 'active' CHECK ("status" IS NULL OR "status" IN ('active', 'paused', 'retired')),
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
) STRICT;
INSERT INTO "crews:new" ("id", "name", "size", "lead_id", "status", "created_at", "updated_at") SELECT "id", "name", "size", "lead_id", "status", "created_at", "updated_at" FROM "crews";
DROP TRIGGER IF EXISTS "fts:crews:ai";
DROP TRIGGER IF EXISTS "fts:crews:ad";
DROP TRIGGER IF EXISTS "fts:crews:au";
DROP TABLE IF EXISTS "fts:crews";
DROP TABLE "crews";
ALTER TABLE "crews:new" RENAME TO "crews";
CREATE INDEX "idx:crews:lead_id" ON "crews" ("lead_id");
CREATE INDEX IF NOT EXISTS "idx:crews:name" ON "crews" ("name");
CREATE INDEX IF NOT EXISTS "idx:crews:status" ON "crews" ("status");
CREATE VIRTUAL TABLE "fts:crews" USING fts5("name", content='crews', content_rowid='rowid', tokenize='trigram case_sensitive 0');
CREATE TRIGGER "fts:crews:ai" AFTER INSERT ON "crews" BEGIN
  INSERT INTO "fts:crews"(rowid, "name") VALUES (new.rowid, new."name");
END;
CREATE TRIGGER "fts:crews:ad" AFTER DELETE ON "crews" BEGIN
  INSERT INTO "fts:crews"("fts:crews", rowid, "name") VALUES ('delete', old.rowid, old."name");
END;
CREATE TRIGGER "fts:crews:au" AFTER UPDATE OF "name" ON "crews" BEGIN
  INSERT INTO "fts:crews"("fts:crews", rowid, "name") VALUES ('delete', old.rowid, old."name");
  INSERT INTO "fts:crews"(rowid, "name") VALUES (new.rowid, new."name");
END;
INSERT INTO "fts:crews"("fts:crews") VALUES ('rebuild');
