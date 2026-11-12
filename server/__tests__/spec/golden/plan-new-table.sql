-- app-migration: alter
-- Generated from the app spec by Local App Studio. Do not edit.

CREATE TABLE "vehicles" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "plate" TEXT NOT NULL CHECK (length("plate") <= 500),
  "crew_id" TEXT REFERENCES "crews" ("id") ON DELETE SET NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
) STRICT;
CREATE INDEX "idx:vehicles:crew_id" ON "vehicles" ("crew_id");
