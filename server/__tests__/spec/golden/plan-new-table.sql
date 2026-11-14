-- app-migration: alter
-- Generated from the app spec by Local App Studio. Do not edit.

CREATE INDEX IF NOT EXISTS "idx:crews:name" ON "crews" ("name");
CREATE INDEX IF NOT EXISTS "idx:crews:status" ON "crews" ("status");

CREATE TABLE "vehicles" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "plate" TEXT NOT NULL CHECK (length("plate") <= 500),
  "crew_id" TEXT REFERENCES "crews" ("id") ON DELETE SET NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
) STRICT;
CREATE INDEX "idx:vehicles:crew_id" ON "vehicles" ("crew_id");
CREATE VIRTUAL TABLE "fts:vehicles" USING fts5("plate", content='vehicles', content_rowid='rowid', tokenize='trigram case_sensitive 0');
CREATE TRIGGER "fts:vehicles:ai" AFTER INSERT ON "vehicles" BEGIN
  INSERT INTO "fts:vehicles"(rowid, "plate") VALUES (new.rowid, new."plate");
END;
CREATE TRIGGER "fts:vehicles:ad" AFTER DELETE ON "vehicles" BEGIN
  INSERT INTO "fts:vehicles"("fts:vehicles", rowid, "plate") VALUES ('delete', old.rowid, old."plate");
END;
CREATE TRIGGER "fts:vehicles:au" AFTER UPDATE OF "plate" ON "vehicles" BEGIN
  INSERT INTO "fts:vehicles"("fts:vehicles", rowid, "plate") VALUES ('delete', old.rowid, old."plate");
  INSERT INTO "fts:vehicles"(rowid, "plate") VALUES (new.rowid, new."plate");
END;
