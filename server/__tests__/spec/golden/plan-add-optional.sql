-- app-migration: alter
-- Generated from the app spec by Local App Studio. Do not edit.

ALTER TABLE "crews" ADD COLUMN "notes" TEXT CHECK (length("notes") <= 20000);
ALTER TABLE "crews" ADD COLUMN "backup_id" TEXT REFERENCES "people" ("id") ON DELETE SET NULL;
CREATE INDEX "idx:crews:backup_id" ON "crews" ("backup_id");
