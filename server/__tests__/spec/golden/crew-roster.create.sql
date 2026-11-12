-- app-migration: create
-- Generated from the app spec by Local App Studio. Do not edit.

CREATE TABLE "people" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL CHECK (length("name") <= 500),
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
) STRICT;

CREATE TABLE "crews" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL CHECK (length("name") <= 500),
  "size" INTEGER DEFAULT 1,
  "lead_id" TEXT REFERENCES "people" ("id") ON DELETE SET NULL,
  "status" TEXT DEFAULT 'active' CHECK ("status" IS NULL OR "status" IN ('active', 'paused')),
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
) STRICT;
CREATE INDEX "idx:crews:lead_id" ON "crews" ("lead_id");
