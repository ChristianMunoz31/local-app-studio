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
DROP TABLE "crews";
ALTER TABLE "crews:new" RENAME TO "crews";
CREATE INDEX "idx:crews:lead_id" ON "crews" ("lead_id");
