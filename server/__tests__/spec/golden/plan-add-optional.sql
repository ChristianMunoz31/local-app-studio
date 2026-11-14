-- app-migration: alter
-- Generated from the app spec by Local App Studio. Do not edit.

ALTER TABLE "crews" ADD COLUMN "notes" TEXT CHECK (length("notes") <= 20000);
ALTER TABLE "crews" ADD COLUMN "backup_id" TEXT REFERENCES "people" ("id") ON DELETE SET NULL;
CREATE INDEX "idx:crews:backup_id" ON "crews" ("backup_id");
CREATE INDEX IF NOT EXISTS "idx:crews:name" ON "crews" ("name");
CREATE INDEX IF NOT EXISTS "idx:crews:status" ON "crews" ("status");
DROP TRIGGER IF EXISTS "fts:crews:ai";
DROP TRIGGER IF EXISTS "fts:crews:ad";
DROP TRIGGER IF EXISTS "fts:crews:au";
DROP TABLE IF EXISTS "fts:crews";
CREATE VIRTUAL TABLE "fts:crews" USING fts5("name", "notes", content='crews', content_rowid='rowid', tokenize='trigram case_sensitive 0');
CREATE TRIGGER "fts:crews:ai" AFTER INSERT ON "crews" BEGIN
  INSERT INTO "fts:crews"(rowid, "name", "notes") VALUES (new.rowid, new."name", new."notes");
END;
CREATE TRIGGER "fts:crews:ad" AFTER DELETE ON "crews" BEGIN
  INSERT INTO "fts:crews"("fts:crews", rowid, "name", "notes") VALUES ('delete', old.rowid, old."name", old."notes");
END;
CREATE TRIGGER "fts:crews:au" AFTER UPDATE OF "name", "notes" ON "crews" BEGIN
  INSERT INTO "fts:crews"("fts:crews", rowid, "name", "notes") VALUES ('delete', old.rowid, old."name", old."notes");
  INSERT INTO "fts:crews"(rowid, "name", "notes") VALUES (new.rowid, new."name", new."notes");
END;
INSERT INTO "fts:crews"("fts:crews") VALUES ('rebuild');
