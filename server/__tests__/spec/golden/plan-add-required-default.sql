-- app-migration: alter
-- Generated from the app spec by Local App Studio. Do not edit.

ALTER TABLE "crews" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 3;
CREATE INDEX IF NOT EXISTS "idx:crews:name" ON "crews" ("name");
CREATE INDEX IF NOT EXISTS "idx:crews:status" ON "crews" ("status");
